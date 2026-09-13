<?php

declare(strict_types=1);

namespace App\Services;

use App\Support\Db;
use App\Support\Mailer;
use App\Core\Application;
use RuntimeException;
use Throwable;

/**
 * Solicitacao de molde taqueado sob encomenda (pagina publica, sem login).
 * Fluxo: cliente escolhe um molde (mold_id), informa tamanho/gomos/bainha ->
 * preco = (tamanho_cm / 100) * valor_metro -> Pix -> ao pagar, gera uma chave
 * unica e manda por e-mail (o cliente usa a chave pra retomar). A geracao do
 * molde em si e a fase 2 (assistente de tacos).
 */
final class SolicitacaoMoldeService
{
    private MercadoPagoService $mercadoPago;

    public function __construct()
    {
        $this->mercadoPago = new MercadoPagoService();
    }

    /** Config publica: valor do metro e video tutorial. Os modelos vem do
     * catalogo do frontend (/data.json), nao do banco. */
    public function config(): array
    {
        $cfg = Db::connection()->query('SELECT valor_metro_molde, solicitacao_video_url, whatsapp, mercado_pago_public_key, solicitacao_molde_ativa FROM system_settings WHERE id = 1')->fetch();
        return [
            'valor_metro' => $cfg ? (float) ($cfg['valor_metro_molde'] ?? 0) : 0.0,
            'video_url' => $cfg['solicitacao_video_url'] ?? null,
            'whatsapp' => $cfg['whatsapp'] ?? null,
            'mp_public_key' => $cfg['mercado_pago_public_key'] ?? null,
            'ativo' => $cfg ? (int) ($cfg['solicitacao_molde_ativa'] ?? 1) === 1 : true,
            'dev_mode' => $this->isLocalDev(),
        ];
    }

    /** A pagina publica de solicitacao de molde esta ligada? (admin liga/desliga) */
    public function isAtiva(): bool
    {
        $cfg = Db::connection()->query('SELECT solicitacao_molde_ativa FROM system_settings WHERE id = 1')->fetch();
        return $cfg ? (int) ($cfg['solicitacao_molde_ativa'] ?? 1) === 1 : true;
    }

    /** Preco = (tamanho_cm / 100) * valor_metro, piso de R$0,50. */
    public function calcularValor(float $tamanhoCm, float $valorMetro): float
    {
        return max(0.50, round(($tamanhoCm / 100) * $valorMetro, 2));
    }

    /**
     * Cria o pedido + Pix. Retorna os dados publicos (inclui public_token pro
     * navegador consultar o status).
     */
    public function criar(string $modeloKey, string $categoria, string $modeloNome, float $tamanhoCm, int $gomos, float $bainhaCm, string $email, string $notificationUrl): array
    {
        $pdo = Db::connection();

        $cfg = $pdo->query('SELECT valor_metro_molde FROM system_settings WHERE id = 1')->fetch();
        $valorMetro = $cfg ? (float) ($cfg['valor_metro_molde'] ?? 0) : 0.0;
        if ($valorMetro <= 0) {
            throw new RuntimeException('O valor do metro ainda não foi configurado. Fale com o administrador.');
        }

        $valor = $this->calcularValor($tamanhoCm, $valorMetro);
        $publicToken = bin2hex(random_bytes(16));

        $stmt = $pdo->prepare(
            "INSERT INTO solicitacoes_molde
                (modelo_key, categoria, modelo_nome, tamanho_cm, gomos, bainha_cm, valor, email, status, public_token)
             VALUES (:modelo_key, :categoria, :modelo_nome, :tamanho, :gomos, :bainha, :valor, :email, 'aguardando_pagamento', :token)"
        );
        $stmt->execute([
            'modelo_key' => $modeloKey,
            'categoria' => $categoria,
            'modelo_nome' => $modeloNome,
            'tamanho' => $tamanhoCm,
            'gomos' => $gomos,
            'bainha' => $bainhaCm,
            'valor' => $valor,
            'email' => $email,
            'token' => $publicToken,
        ]);
        $id = (int) $pdo->lastInsertId();

        try {
            $pix = $this->mercadoPago->createPixPayment(
                $valor,
                'Molde sob encomenda: ' . $modeloNome,
                'molde-' . $id,
                $email,
                $notificationUrl
            );
            $pdo->prepare(
                'UPDATE solicitacoes_molde SET mp_payment_id = :mp, qr_code = :qr, qr_code_base64 = :qr64 WHERE id = :id'
            )->execute([
                'id' => $id,
                'mp' => $pix['id'],
                'qr' => $pix['qr_code'],
                'qr64' => $pix['qr_code_base64'],
            ]);
        } catch (Throwable $e) {
            // Em ambiente LOCAL (sem Mercado Pago), mantem o pedido sem Pix pra
            // permitir testar o fluxo via "simular pagamento". Em producao, aborta.
            if (!$this->isLocalDev()) {
                $pdo->prepare('DELETE FROM solicitacoes_molde WHERE id = :id')->execute(['id' => $id]);
                throw $e;
            }
        }

        return $this->toPublicArray($this->findRawById($id) ?? [], true);
    }

    public function isLocalDev(): bool
    {
        return (string) (Application::instance()->env('APP_ENV', 'production') ?? 'production') === 'local';
    }

    /** SO em ambiente local: marca o pedido como pago (simula o Pix) pra testar. */
    public function simularPago(int $id): ?array
    {
        if (!$this->isLocalDev()) {
            return null;
        }
        $row = $this->findRawById($id);
        if ($row === null || $row['status'] !== 'aguardando_pagamento') {
            return $row;
        }
        $chave = $this->gerarChave();
        Db::connection()->prepare(
            "UPDATE solicitacoes_molde SET status = 'pago', paid_at = NOW(), chave_unica = :chave WHERE id = :id"
        )->execute(['id' => $id, 'chave' => $chave]);
        $row = $this->findRawById($id) ?? $row;
        $this->enviarChaveEmail($row);
        $this->notificarVenda($row);
        return $row;
    }

    /**
     * Igual ao criar(), mas cobrando no CARTAO (resolve na hora). Se aprovar,
     * ja marca pago + gera a chave + manda o e-mail.
     *
     * @param array{token:string, payment_method_id:string, installments:int,
     *   issuer_id:?int, device_id:?string, identification:?array{type:string, number:string}} $cartao
     */
    public function criarComCartao(string $modeloKey, string $categoria, string $modeloNome, float $tamanhoCm, int $gomos, float $bainhaCm, string $email, string $notificationUrl, array $cartao): array
    {
        $pdo = Db::connection();
        $cfg = $pdo->query('SELECT valor_metro_molde FROM system_settings WHERE id = 1')->fetch();
        $valorMetro = $cfg ? (float) ($cfg['valor_metro_molde'] ?? 0) : 0.0;
        if ($valorMetro <= 0) {
            throw new RuntimeException('O valor do metro ainda não foi configurado. Fale com o administrador.');
        }

        $valor = $this->calcularValor($tamanhoCm, $valorMetro);
        $publicToken = bin2hex(random_bytes(16));

        $stmt = $pdo->prepare(
            "INSERT INTO solicitacoes_molde
                (modelo_key, categoria, modelo_nome, tamanho_cm, gomos, bainha_cm, valor, email, status, public_token)
             VALUES (:modelo_key, :categoria, :modelo_nome, :tamanho, :gomos, :bainha, :valor, :email, 'aguardando_pagamento', :token)"
        );
        $stmt->execute([
            'modelo_key' => $modeloKey,
            'categoria' => $categoria,
            'modelo_nome' => $modeloNome,
            'tamanho' => $tamanhoCm,
            'gomos' => $gomos,
            'bainha' => $bainhaCm,
            'valor' => $valor,
            'email' => $email,
            'token' => $publicToken,
        ]);
        $id = (int) $pdo->lastInsertId();

        try {
            $pay = $this->mercadoPago->createCardPayment(
                $valor,
                'Molde sob encomenda: ' . $modeloNome,
                'molde-' . $id,
                $email,
                $notificationUrl,
                (string) $cartao['token'],
                (string) $cartao['payment_method_id'],
                (int) $cartao['installments'],
                isset($cartao['issuer_id']) ? (int) $cartao['issuer_id'] : null,
                $cartao['identification'] ?? null,
                $cartao['device_id'] ?? null
            );
        } catch (Throwable $e) {
            $pdo->prepare('DELETE FROM solicitacoes_molde WHERE id = :id')->execute(['id' => $id]);
            throw $e;
        }

        $pdo->prepare('UPDATE solicitacoes_molde SET mp_payment_id = :mp WHERE id = :id')
            ->execute(['mp' => $pay['id'], 'id' => $id]);

        if (($pay['status'] ?? '') === 'approved') {
            $chave = $this->gerarChave();
            $upd = $pdo->prepare(
                "UPDATE solicitacoes_molde SET status = 'pago', paid_at = NOW(), chave_unica = :chave
                 WHERE id = :id AND status = 'aguardando_pagamento'"
            );
            $upd->execute(['id' => $id, 'chave' => $chave]);
            if ($upd->rowCount() > 0) {
                $paidRow = $this->findRawById($id) ?? [];
                $this->enviarChaveEmail($paidRow);
                $this->notificarVenda($paidRow);
            }
        }

        return $this->toPublicArray($this->findRawById($id) ?? [], true);
    }

    /**
     * O ADMIN gera uma chave manualmente (cortesia): cria o pedido ja PAGO
     * (valor 0) SEM os dados do molde — o cliente escolhe modelo/tamanho/gomos/
     * bainha quando usar a chave. `tamanho_cm = 0` marca "dados a definir".
     */
    public function criarChaveManual(string $email): array
    {
        $pdo = Db::connection();
        $publicToken = bin2hex(random_bytes(16));
        $chave = $this->gerarChave();

        $stmt = $pdo->prepare(
            "INSERT INTO solicitacoes_molde
                (modelo_nome, tamanho_cm, gomos, bainha_cm, valor, email, status, chave_unica, public_token, paid_at)
             VALUES ('(a definir)', 0, 0, 0, 0, :email, 'pago', :chave, :token, NOW())"
        );
        $stmt->execute(['email' => $email, 'chave' => $chave, 'token' => $publicToken]);
        $id = (int) $pdo->lastInsertId();

        $this->enviarChaveEmail($this->findRawById($id) ?? []);

        return $this->toPublicArray($this->findRawById($id) ?? [], true);
    }

    /**
     * Preenche os dados do molde num pedido de CORTESIA (tamanho ainda 0). Usado
     * quando o cliente resgata uma chave enviada pelo admin e escolhe o molde.
     */
    public function definirDados(int $id, string $modeloKey, string $categoria, string $modeloNome, float $tamanhoCm, int $gomos, float $bainhaCm): bool
    {
        $stmt = Db::connection()->prepare(
            'UPDATE solicitacoes_molde
             SET modelo_key = :k, categoria = :c, modelo_nome = :n, tamanho_cm = :t, gomos = :g, bainha_cm = :b
             WHERE id = :id AND tamanho_cm = 0'
        );
        $stmt->execute([
            'id' => $id, 'k' => $modeloKey, 'c' => $categoria, 'n' => $modeloNome,
            't' => $tamanhoCm, 'g' => $gomos, 'b' => $bainhaCm,
        ]);
        return $stmt->rowCount() > 0;
    }

    public function findRawById(int $id): ?array
    {
        $stmt = Db::connection()->prepare('SELECT * FROM solicitacoes_molde WHERE id = :id LIMIT 1');
        $stmt->execute(['id' => $id]);
        $row = $stmt->fetch();
        return $row === false ? null : $row;
    }

    /**
     * Atualiza modelo/gomos/bainha de um pedido pago (o cliente pode trocar).
     * NAO mexe em tamanho, valor nem e-mail (travados — o tamanho define o preco).
     */
    public function atualizarDados(int $id, string $modeloKey, string $categoria, string $modeloNome, int $gomos, float $bainhaCm): void
    {
        Db::connection()->prepare(
            'UPDATE solicitacoes_molde
             SET modelo_key = :key, categoria = :cat, modelo_nome = :nome, gomos = :gomos, bainha_cm = :bainha
             WHERE id = :id'
        )->execute([
            'id' => $id,
            'key' => $modeloKey,
            'cat' => $categoria,
            'nome' => $modeloNome,
            'gomos' => $gomos,
            'bainha' => $bainhaCm,
        ]);
    }

    /** Salva as medidas de tacos coletadas pelo chat (assistente da fase 2). */
    public function salvarTacos(int $id, array $config): void
    {
        Db::connection()
            ->prepare('UPDATE solicitacoes_molde SET taco_config_json = :cfg WHERE id = :id')
            ->execute(['id' => $id, 'cfg' => json_encode($config, JSON_UNESCAPED_UNICODE)]);
    }

    /**
     * Marca o pedido como entregue e envia o molde (PDF em base64 gerado no
     * navegador) por e-mail como anexo. `$extras` = versoes fatiadas opcionais
     * (A4/A3), cada uma ['filename' => ..., 'contentBase64' => ...].
     */
    public function entregarMolde(int $id, string $pdfBase64, string $filename, string $resumo = '', array $extras = []): void
    {
        $row = $this->findRawById($id);
        if ($row === null) {
            return;
        }
        try {
            $appUrl = rtrim((string) (Application::instance()->env('APP_URL', 'https://alisson-projetos.fun') ?? 'https://alisson-projetos.fun'), '/');
            $chave = (string) ($row['chave_unica'] ?? '');
            $infoTxt = "Balao/modelo: {$row['modelo_nome']}"
                . ($row['categoria'] ? " ({$row['categoria']})" : '')
                . "\nTamanho: {$row['tamanho_cm']} cm | Gomos: {$row['gomos']} | Bainha: {$row['bainha_cm']} cm";
            $resumoTxt = trim($resumo) !== '' ? "\n\n--- Medidas do chat ---\n{$resumo}" : '';
            $resumoHtml = trim($resumo) !== ''
                ? '<div style="margin-top:14px;background:#f7fafc;border-radius:8px;padding:12px;font-size:13px;color:#4a5568;white-space:pre-line">'
                    . '<strong>Medidas do chat</strong><br>' . nl2br(htmlspecialchars(trim($resumo), ENT_QUOTES)) . '</div>'
                : '';
            $temFatiado = count($extras) > 0;
            $fatiadoTxt = $temFatiado
                ? "\n\nJunto vao mais 2 versoes do molde fatiadas em folha comum (A4 e A3), numeradas e com seta de "
                    . "orientacao, pra montar encaixando pedaco por pedaco caso voce nao tenha plotter."
                : '';
            $fatiadoHtml = $temFatiado
                ? '<p style="margin-top:10px;color:#4a5568;font-size:13px">Junto vao mais 2 versoes fatiadas em folha A4 e A3, '
                    . 'numeradas e com seta de orientacao, pra montar sem plotter.</p>'
                : '';

            $files = [[
                'filename' => $filename,
                'contentType' => 'application/pdf',
                'contentBase64' => $pdfBase64,
            ]];
            foreach ($extras as $extra) {
                $files[] = [
                    'filename' => (string) $extra['filename'],
                    'contentType' => 'application/pdf',
                    'contentBase64' => (string) $extra['contentBase64'],
                ];
            }

            Mailer::send((string) $row['email'], 'Seu molde taqueado ficou pronto! 🎈', [
                'body' => "Ola!\n\nSeu molde \"{$row['modelo_nome']}\" esta pronto e vai em anexo neste e-mail.\n\n"
                    . "{$infoTxt}\n\nSua chave de acesso: {$chave}{$resumoTxt}{$fatiadoTxt}\n\n"
                    . "Obrigado pela preferencia! Qualquer coisa, estamos a disposicao.\nASS: ALISSON PROJETOS\n\n"
                    . "Nao deixe de usar mais funcionalidades do nosso sistema: {$appUrl}\n"
                    . "Baixe o app para ficar por dentro de cada atualizacao: {$appUrl}",
                'html' => '<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;color:#1a202c">'
                    . '<h2 style="color:#2b6cb0">Seu molde ficou pronto! 🎈</h2>'
                    . '<p>Segue em anexo o molde <strong>' . htmlspecialchars((string) $row['modelo_nome'], ENT_QUOTES) . '</strong>.</p>'
                    . '<div style="background:#f7fafc;border-radius:8px;padding:12px;font-size:14px;color:#4a5568;line-height:1.7">'
                    . 'Tamanho: <strong>' . (int) $row['tamanho_cm'] . ' cm</strong><br>'
                    . 'Gomos: <strong>' . (int) $row['gomos'] . '</strong><br>'
                    . 'Bainha: <strong>' . htmlspecialchars((string) $row['bainha_cm'], ENT_QUOTES) . ' cm</strong></div>'
                    . '<p style="margin-top:14px">Chave de acesso: <strong style="letter-spacing:2px">' . htmlspecialchars($chave, ENT_QUOTES) . '</strong></p>'
                    . $resumoHtml
                    . $fatiadoHtml
                    . '<p style="margin-top:18px;color:#1a202c">Obrigado pela preferência! Qualquer coisa, estamos à disposição.<br><strong>ASS: ALISSON PROJETOS</strong></p>'
                    . '<div style="margin-top:16px;padding:16px;background:#edf2f7;border-radius:10px;text-align:center">'
                    . '<p style="margin:0 0 12px;font-weight:600;color:#2b6cb0">Não deixe de usar mais funcionalidades do nosso sistema!</p>'
                    . '<a href="' . htmlspecialchars($appUrl, ENT_QUOTES) . '" style="background:#3182ce;color:#fff;text-decoration:none;padding:11px 20px;border-radius:8px;font-weight:600;display:inline-block;margin:4px">Acessar o sistema</a>'
                    . '<a href="' . htmlspecialchars($appUrl, ENT_QUOTES) . '" style="background:#48bb78;color:#06210f;text-decoration:none;padding:11px 20px;border-radius:8px;font-weight:700;display:inline-block;margin:4px">📲 Baixar o app</a>'
                    . '<p style="margin:12px 0 0;font-size:12px;color:#718096">Baixe o app para ficar por dentro de cada atualização.</p>'
                    . '</div></div>',
                'files' => $files,
            ]);
        } catch (Throwable $e) {
            // best-effort; o cliente ainda baixa o PDF na tela. Registra o erro
            // pra diagnostico (pedido #, e-mail, motivo).
            try {
                $logDir = __DIR__ . '/../../storage/logs';
                if (!is_dir($logDir)) {
                    @mkdir($logDir, 0775, true);
                }
                @file_put_contents(
                    $logDir . '/solicitacao-mail.log',
                    date('Y-m-d H:i:s') . " - pedido #{$id} ({$row['email']}): " . $e->getMessage() . "\n",
                    FILE_APPEND
                );
            } catch (Throwable $e2) {
                /* ignora */
            }
        }
        Db::connection()
            ->prepare("UPDATE solicitacoes_molde SET status = 'entregue', entregue_at = NOW() WHERE id = :id")
            ->execute(['id' => $id]);
    }

    public function findByChave(string $chave): ?array
    {
        $stmt = Db::connection()->prepare('SELECT * FROM solicitacoes_molde WHERE chave_unica = :c LIMIT 1');
        $stmt->execute(['c' => strtoupper(trim($chave))]);
        $row = $stmt->fetch();
        return $row === false ? null : $row;
    }

    /**
     * Reconcilia o pagamento no Mercado Pago. Se aprovou e ainda estava
     * aguardando, marca como pago, gera a chave unica e manda por e-mail.
     * Idempotente (WHERE status='aguardando_pagamento').
     */
    /**
     * Cancela um pedido que ainda esta aguardando pagamento (o cliente desistiu).
     * So apaga se NAO foi pago — pedidos pagos ficam. Retorna true se cancelou.
     */
    public function cancelar(int $id): bool
    {
        $stmt = Db::connection()->prepare(
            "DELETE FROM solicitacoes_molde WHERE id = :id AND status = 'aguardando_pagamento'"
        );
        $stmt->execute(['id' => $id]);
        return $stmt->rowCount() > 0;
    }

    public function reconcile(int $id): ?array
    {
        $row = $this->findRawById($id);
        if ($row === null) {
            return null;
        }
        if ($row['status'] === 'aguardando_pagamento' && !empty($row['mp_payment_id'])) {
            try {
                $mp = $this->mercadoPago->fetchPayment((string) $row['mp_payment_id']);
            } catch (Throwable $e) {
                return $row; // nao trava o poll
            }
            if (($mp['status'] ?? '') === 'approved') {
                $chave = $this->gerarChave();
                $stmt = Db::connection()->prepare(
                    "UPDATE solicitacoes_molde SET status = 'pago', paid_at = NOW(), chave_unica = :chave
                     WHERE id = :id AND status = 'aguardando_pagamento'"
                );
                $stmt->execute(['id' => $id, 'chave' => $chave]);
                if ($stmt->rowCount() > 0) {
                    $row = $this->findRawById($id) ?? $row;
                    $this->enviarChaveEmail($row);
                    $this->notificarVenda($row);
                }
            } elseif (in_array($mp['status'] ?? '', ['rejected', 'cancelled'], true)) {
                // deixa como esta; o cliente pode gerar outro
            }
        }
        return $this->findRawById($id) ?? $row;
    }

    /** Avisa o admin da venda de molde (push + historico). Best-effort. */
    private function notificarVenda(array $row): void
    {
        try {
            (new NotificacaoService())->criarMoldeNotificacao($row);
        } catch (Throwable $e) {
            // nunca trava o fluxo de pagamento
        }
    }

    private function gerarChave(): string
    {
        // 10 caracteres, sem ambiguidade excessiva (hex maiusculo).
        return strtoupper(bin2hex(random_bytes(5)));
    }

    private function enviarChaveEmail(array $row): void
    {
        try {
            $appUrl = (string) (Application::instance()->env('APP_URL', 'https://alisson-projetos.fun') ?? 'https://alisson-projetos.fun');
            $link = rtrim($appUrl, '/') . '/solicitar-molde';
            $chave = (string) $row['chave_unica'];
            $texto = "Sua chave de acesso ao molde sob encomenda esta pronta!\n\n"
                . "Chave: {$chave}\n\n"
                . "Guarde esta chave. Acesse {$link}, clique em \"Ja paguei / tenho uma chave\", "
                . "cole a chave e monte o seu molde.\n";
            $html = '<div style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:0 auto;color:#1a202c">'
                . '<h2 style="color:#2b6cb0;margin:0 0 12px">Sua chave está pronta! 🔑</h2>'
                . '<p>Guarde sua <strong>chave de acesso</strong> — use-a para montar seu molde:</p>'
                . '<div style="font-size:28px;font-weight:700;letter-spacing:6px;text-align:center;background:#edf2f7;'
                . 'border-radius:10px;padding:16px;margin:16px 0;color:#1a202c">' . htmlspecialchars($chave, ENT_QUOTES) . '</div>'
                . '<p style="text-align:center;margin:18px 0"><a href="' . htmlspecialchars($link, ENT_QUOTES) . '" '
                . 'style="background:#3182ce;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:600">'
                . 'Continuar meu molde</a></p>'
                . '<p style="color:#718096;font-size:13px">Cole a chave no campo "Já paguei / tenho uma chave" para continuar.</p>'
                . '</div>';
            Mailer::send((string) $row['email'], 'Sua chave do molde sob encomenda', ['body' => $texto, 'html' => $html]);
        } catch (Throwable $e) {
            // best-effort: o cliente ainda ve a chave na tela apos pagar
        }
    }

    public function toPublicArray(array $row, bool $includeChave = false): array
    {
        $pago = ($row['status'] ?? '') !== 'aguardando_pagamento';
        return [
            'id' => (int) $row['id'],
            'modelo_key' => $row['modelo_key'] ?? null,
            'categoria' => $row['categoria'] ?? null,
            'modelo_nome' => (string) $row['modelo_nome'],
            'tamanho_cm' => (float) $row['tamanho_cm'],
            'gomos' => (int) $row['gomos'],
            'bainha_cm' => (float) $row['bainha_cm'],
            'valor' => (float) $row['valor'],
            'email' => (string) $row['email'],
            'status' => (string) $row['status'],
            'public_token' => (string) $row['public_token'],
            // chave so vai pro cliente quando pago (e quando ele e o dono do token/chave).
            'chave_unica' => ($includeChave && $pago) ? ($row['chave_unica'] ?? null) : null,
            'qr_code' => $row['qr_code'] ?? null,
            'qr_code_base64' => $row['qr_code_base64'] ?? null,
            'created_at' => $row['created_at'] ?? null,
            'paid_at' => $row['paid_at'] ?? null,
        ];
    }
}
