<?php

declare(strict_types=1);

/**
 * Mensagem automatica por WhatsApp pra quem se cadastrou e NAO ativou nenhum
 * plano ainda. O admin configura (aba Comunicação/WhatsApp):
 *   - o texto da mensagem (aceita {{nome}} pra personalizar);
 *   - quanto tempo depois do cadastro manda a 1a mensagem (no_plan_msg_delay_min);
 *   - de quanto em quanto tempo insiste, pros que continuam sem plano
 *     (no_plan_msg_repeat_min) — cooldown em users.last_no_plan_msg_at.
 *
 * So manda pra quem tem telefone salvo. Sem WhatsApp conectado, cada envio
 * falha silenciosamente (fica registrado no log) e tenta de novo na proxima
 * execucao.
 *
 * Rodar por cron a cada 10 min, ex (minuto 0,10,20,30,40,50 de cada hora):
 *   0,10,20,30,40,50 * * * * php /var/www/cardozo-projetos/backend/scripts/no-plan-followup.php >> /var/log/no-plan-followup.log 2>&1
 */

require_once __DIR__ . '/../bootstrap/app.php';

use App\Services\SystemSettingsService;
use App\Services\WhatsAppService;
use App\Support\Db;

// Limite de seguranca por execucao.
const MAX_POR_EXECUCAO = 100;

$settings = (new SystemSettingsService())->get();
if (!$settings['no_plan_msg_enabled']) {
    echo date('Y-m-d H:i:s') . " - desativado, nada a enviar.\n";
    exit(0);
}

$mensagemBase = trim((string) ($settings['no_plan_msg_text'] ?? ''));
if ($mensagemBase === '') {
    echo date('Y-m-d H:i:s') . " - sem mensagem configurada, nada a enviar.\n";
    exit(0);
}

$delayMin = max(1, (int) $settings['no_plan_msg_delay_min']);
$repeatMin = max(1, (int) $settings['no_plan_msg_repeat_min']);

$pdo = Db::connection();

// Cadastrado ha mais de $delayMin minutos, sem acesso ativo (nunca ativou
// plano ou expirou), tem telefone salvo, nao bloqueado, e nao contatado nos
// ultimos $repeatMin minutos.
$stmt = $pdo->prepare(
    "SELECT id, name, phone FROM users
     WHERE role = 'user'
       AND status <> 'blocked'
       AND phone IS NOT NULL AND phone <> ''
       AND NOT (status = 'active' AND (access_expires_at IS NULL OR access_expires_at > NOW()))
       AND created_at <= (NOW() - INTERVAL :delay MINUTE)
       AND (last_no_plan_msg_at IS NULL OR last_no_plan_msg_at <= (NOW() - INTERVAL :repeat MINUTE))
     ORDER BY last_no_plan_msg_at IS NOT NULL, last_no_plan_msg_at ASC
     LIMIT " . MAX_POR_EXECUCAO
);
$stmt->execute(['delay' => $delayMin, 'repeat' => $repeatMin]);
$rows = $stmt->fetchAll();

$wa = new WhatsAppService();
$enviados = 0;
$falhas = 0;

foreach ($rows as $u) {
    $primeiroNome = trim(explode(' ', trim((string) ($u['name'] ?? '')))[0] ?? '');
    $mensagem = str_replace(['{{nome}}', '{{Nome}}'], $primeiroNome !== '' ? $primeiroNome : 'tudo bem', $mensagemBase);

    $r = $wa->send((string) $u['phone'], $mensagem);
    if ($r['ok']) {
        $enviados++;
    } else {
        $falhas++;
    }

    // Marca como contatado mesmo se falhou (WhatsApp desconectado etc.) —
    // evita tentar o mesmo usuario a cada 10 min em loop; tenta de novo so
    // depois do proximo intervalo configurado.
    $pdo->prepare('UPDATE users SET last_no_plan_msg_at = NOW() WHERE id = :id')->execute(['id' => (int) $u['id']]);
}

echo date('Y-m-d H:i:s') . " - no-plan-followup: enviados={$enviados} falhas={$falhas} candidatos=" . count($rows) . "\n";
