<?php

declare(strict_types=1);

/**
 * Campanha de reengajamento: manda e-mail + notificacao push pros usuarios SEM
 * acesso ativo (nunca pagaram ou expiraram), convidando a voltar com o cupom da
 * campanha. Cada usuario e contatado no maximo a cada 3 dias (last_reengage_at).
 * Admin escolhe o cupom da campanha na aba Cupons (is_campanha=1). Sem cupom de
 * campanha ativo, nao envia nada.
 *
 * Rodar por cron 1x ao dia, ex:
 *   0 12 * * * php /var/www/cardozo-projetos/backend/scripts/reengajamento.php >> /var/log/reengajamento.log 2>&1
 */

require_once __DIR__ . '/../bootstrap/app.php';

use App\Core\Application;
use App\Services\CupomService;
use App\Services\WebPushService;
use App\Support\Db;
use App\Support\Mailer;

// Limite de seguranca por execucao (o Gmail tem teto diario de envios).
const MAX_POR_EXECUCAO = 300;

$cupom = (new CupomService())->campanhaCupom();
if ($cupom === null) {
    echo date('Y-m-d H:i:s') . " - sem cupom de campanha ativo, nada a enviar.\n";
    exit(0);
}

$pdo = Db::connection();
$appUrl = (string) (Application::instance()->env('APP_URL', 'https://alisson-projetos.fun') ?? 'https://alisson-projetos.fun');
$codigo = (string) $cupom['codigo'];
$percentual = (float) $cupom['percentual'];
$percentualLabel = rtrim(rtrim(number_format($percentual, 2, ',', ''), '0'), ',');

// Sem acesso ativo (nunca pagou ou expirou), nao bloqueado, e-mail confirmado,
// e nao contatado nos ultimos 3 dias.
$rows = $pdo->query(
    "SELECT id, name, email FROM users
     WHERE role = 'user'
       AND email_verified_at IS NOT NULL
       AND status <> 'blocked'
       AND NOT (status = 'active' AND (access_expires_at IS NULL OR access_expires_at > NOW()))
       AND (last_reengage_at IS NULL OR last_reengage_at < (NOW() - INTERVAL 3 DAY))
     ORDER BY last_reengage_at IS NOT NULL, last_reengage_at ASC
     LIMIT " . MAX_POR_EXECUCAO
)->fetchAll();

$enviados = 0;
$falhas = 0;
$emailsPush = [];

foreach ($rows as $u) {
    $email = (string) ($u['email'] ?? '');
    if ($email === '') {
        continue;
    }
    $primeiroNome = trim(explode(' ', trim((string) ($u['name'] ?? '')))[0] ?? '');

    $assunto = "Volta pro Alisson Projetos com {$percentualLabel}% OFF 🎈";
    $texto = "Ola {$primeiroNome},\n\n"
        . "Sentimos sua falta! Volte a fazer parte do Alisson Projetos e use o cupom "
        . "{$codigo} pra ganhar {$percentualLabel}% de desconto no seu plano.\n\n"
        . "Acesse: {$appUrl}\n"
        . "Na hora de pagar, digite o cupom: {$codigo}\n\n"
        . "Ate breve!";
    $html = '<div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;color:#1a202c">'
        . '<h2 style="color:#2b6cb0;margin:0 0 12px">A gente sentiu sua falta! 🎈</h2>'
        . '<p>Ola ' . htmlspecialchars($primeiroNome, ENT_QUOTES) . ', volte a fazer parte do <strong>Alisson Projetos</strong> '
        . 'e aproveite um desconto especial no seu plano:</p>'
        . '<div style="text-align:center;background:#edf2f7;border-radius:10px;padding:18px;margin:16px 0">'
        . '<div style="font-size:13px;color:#4a5568;text-transform:uppercase;letter-spacing:1px">Seu cupom</div>'
        . '<div style="font-size:30px;font-weight:700;letter-spacing:4px;color:#1a202c;margin:6px 0">' . htmlspecialchars($codigo, ENT_QUOTES) . '</div>'
        . '<div style="font-size:16px;color:#2f855a;font-weight:600">' . $percentualLabel . '% de desconto</div>'
        . '</div>'
        . '<p style="text-align:center;margin:20px 0">'
        . '<a href="' . htmlspecialchars($appUrl, ENT_QUOTES) . '" style="background:#3182ce;color:#fff;text-decoration:none;'
        . 'padding:12px 24px;border-radius:8px;font-weight:600;display:inline-block">Voltar ao sistema</a></p>'
        . '<p style="color:#718096;font-size:13px">Na hora de pagar, digite o cupom <strong>' . htmlspecialchars($codigo, ENT_QUOTES) . '</strong>. '
        . 'Cada cupom pode ser usado uma vez por mes.</p>'
        . '</div>';

    try {
        Mailer::send($email, $assunto, ['body' => $texto, 'html' => $html]);
        $enviados++;
        $emailsPush[] = $email;
    } catch (\Throwable $e) {
        $falhas++;
    }

    // Marca como contatado (mesmo se o e-mail falhou, evita reprocessar em loop).
    $pdo->prepare('UPDATE users SET last_reengage_at = NOW() WHERE id = :id')->execute(['id' => (int) $u['id']]);
}

// Notificacao push (pra quem ativou) — mesma audiencia contatada agora.
$push = ['sent' => 0, 'failed' => 0, 'total' => 0];
if ($emailsPush !== []) {
    try {
        $push = (new WebPushService())->sendToUsers([
            'title' => "Volte com {$percentualLabel}% OFF 🎈",
            'body' => "Use o cupom {$codigo} e ganhe {$percentualLabel}% de desconto no seu plano.",
            'data' => ['url' => '/'],
        ], $emailsPush);
    } catch (\Throwable $e) {
        // ignora
    }
}

echo date('Y-m-d H:i:s')
    . " - reengajamento: emails_enviados={$enviados} falhas={$falhas} push_enviados={$push['sent']} (cupom {$codigo} {$percentualLabel}%)\n";
