<?php

declare(strict_types=1);

namespace App\Services;

use App\Support\Db;
use App\Support\Mailer;
use App\Support\Password;

final class UserService
{
    public function findByEmail(string $email): ?array
    {
        $stmt = Db::connection()->prepare('SELECT * FROM users WHERE email = :email LIMIT 1');
        $stmt->execute(['email' => $email]);
        $user = $stmt->fetch();

        return $user === false ? null : $user;
    }

    public function findById(int $id): ?array
    {
        $stmt = Db::connection()->prepare('SELECT * FROM users WHERE id = :id LIMIT 1');
        $stmt->execute(['id' => $id]);
        $user = $stmt->fetch();

        return $user === false ? null : $user;
    }

    public function create(string $name, string $email, string $password): array
    {
        // pending_payment: cadastro novo fica bloqueado ate pagar um plano
        // (ver PaidAccessMiddleware) -- vira 'active' quando um pagamento e
        // aprovado (PagamentoService::reconcileRow -> grantAccess()).
        $stmt = Db::connection()->prepare(
            'INSERT INTO users (name, email, password_hash, role, status)
             VALUES (:name, :email, :password_hash, "user", "pending_payment")'
        );
        $stmt->execute([
            'name' => $name,
            'email' => $email,
            'password_hash' => Password::hash($password),
        ]);

        $id = (int) Db::connection()->lastInsertId();

        return $this->findById($id) ?? [];
    }

    public function updatePassword(int $userId, string $newPassword): void
    {
        $stmt = Db::connection()->prepare('UPDATE users SET password_hash = :password_hash WHERE id = :id');
        $stmt->execute([
            'id' => $userId,
            'password_hash' => Password::hash($newPassword),
        ]);
    }

    public function updateEmail(int $userId, string $newEmail): void
    {
        $stmt = Db::connection()->prepare('UPDATE users SET email = :email WHERE id = :id');
        $stmt->execute(['id' => $userId, 'email' => $newEmail]);
    }

    /**
     * Inicia a troca de e-mail: guarda o e-mail NOVO pendente + um codigo de 6
     * digitos (prazo de 30 min) e manda o codigo pro e-mail NOVO. So confirma de
     * verdade (troca o email atual) quando o usuario digitar o codigo.
     */
    public function requestEmailChange(int $userId, string $newEmail): void
    {
        $code = str_pad((string) random_int(0, 999999), 6, '0', STR_PAD_LEFT);
        $deadline = date('Y-m-d H:i:s', time() + 30 * 60);

        Db::connection()->prepare(
            'UPDATE users SET pending_email = :email, pending_email_code = :code, pending_email_deadline = :deadline WHERE id = :id'
        )->execute(['id' => $userId, 'email' => $newEmail, 'code' => $code, 'deadline' => $deadline]);

        $user = $this->findById($userId);
        $primeiroNome = explode(' ', trim((string) ($user['name'] ?? '')))[0] ?? '';

        $subject = 'Confirme seu novo e-mail: ' . $code;
        $text = "Ola {$primeiroNome},\n\n"
            . "Voce pediu para trocar o e-mail da sua conta.\n"
            . "Seu codigo de confirmacao e: {$code}\n\n"
            . "Digite esse codigo na tela do sistema para confirmar o novo e-mail.\n"
            . "O codigo vale por 30 minutos. Se nao foi voce, ignore este e-mail.\n";
        $html = '<div style="font-family:Arial,sans-serif;max-width:480px;margin:auto">'
            . '<p>Ola ' . htmlspecialchars($primeiroNome, ENT_QUOTES) . ', use o codigo abaixo para confirmar seu novo e-mail:</p>'
            . '<p style="font-size:28px;font-weight:bold;letter-spacing:6px;text-align:center;'
            . 'background:#f4f4f5;border-radius:10px;padding:14px 0">' . htmlspecialchars($code, ENT_QUOTES) . '</p>'
            . '<p style="color:#666;font-size:13px">O codigo vale por 30 minutos. Se nao foi voce, ignore este e-mail.</p>'
            . '</div>';

        Mailer::send($newEmail, $subject, ['body' => $text, 'html' => $html]);
    }

    /**
     * Confere o codigo enviado pro e-mail novo. Se bater (e dentro do prazo, e o
     * e-mail ainda livre), troca o e-mail da conta e limpa o pendente.
     */
    public function confirmEmailChange(int $userId, string $code): bool
    {
        $user = $this->findById($userId);
        if ($user === null || empty($user['pending_email']) || empty($user['pending_email_code'])) {
            return false;
        }
        if (!empty($user['pending_email_deadline']) && strtotime((string) $user['pending_email_deadline']) < time()) {
            return false;
        }
        if (!hash_equals((string) $user['pending_email_code'], trim($code))) {
            return false;
        }
        $novo = strtolower(trim((string) $user['pending_email']));
        $existing = $this->findByEmail($novo);
        if ($existing !== null && (int) $existing['id'] !== $userId) {
            return false;
        }

        Db::connection()->prepare(
            'UPDATE users SET email = :email, pending_email = NULL, pending_email_code = NULL, pending_email_deadline = NULL WHERE id = :id'
        )->execute(['id' => $userId, 'email' => $novo]);

        return true;
    }

    // ===== Validacao de telefone por codigo no WhatsApp =====

    /**
     * Gera um codigo de 6 digitos, guarda com o telefone pendente (prazo 15 min)
     * e envia pelo WhatsApp. Lanca RuntimeException se o WhatsApp nao mandar.
     */
    public function requestPhoneVerification(int $userId, string $phone): void
    {
        $digits = preg_replace('/\D/', '', $phone) ?? '';
        if (mb_strlen($digits) < 10) {
            throw new \RuntimeException('Informe um número de telefone válido com DDD.');
        }
        $code = str_pad((string) random_int(0, 999999), 6, '0', STR_PAD_LEFT);
        $deadline = date('Y-m-d H:i:s', time() + 15 * 60);

        Db::connection()->prepare(
            'UPDATE users SET phone = :p, phone_verification_code = :c, phone_verification_deadline = :d WHERE id = :id'
        )->execute(['p' => $digits, 'c' => $code, 'd' => $deadline, 'id' => $userId]);

        $mensagem = "Alisson Projetos\n\nSeu codigo de verificacao e: {$code}\n\nDigite esse codigo na tela do sistema para validar o seu telefone. O codigo vale por 15 minutos.";
        $r = (new WhatsAppService())->send($digits, $mensagem);
        if (!$r['ok']) {
            $err = (string) ($r['data']['error'] ?? 'Não foi possível enviar pelo WhatsApp.');
            throw new \RuntimeException($err);
        }
    }

    /** Confere o codigo do telefone. Marca verificado se bater e dentro do prazo. */
    public function confirmPhoneVerification(int $userId, string $code): bool
    {
        $user = $this->findById($userId);
        if ($user === null || empty($user['phone_verification_code'])) {
            return false;
        }
        if (!empty($user['phone_verification_deadline']) && strtotime((string) $user['phone_verification_deadline']) < time()) {
            return false;
        }
        if (!hash_equals((string) $user['phone_verification_code'], trim($code))) {
            return false;
        }
        Db::connection()->prepare(
            'UPDATE users SET phone_verified_at = NOW(), phone_verification_code = NULL, phone_verification_deadline = NULL WHERE id = :id'
        )->execute(['id' => $userId]);
        return true;
    }

    /** Guarda o IP (rede/wifi) do cliente — chamado no login. */
    public function updateLastIp(int $userId, string $ip): void
    {
        $ip = trim($ip);
        if ($ip === '') {
            return;
        }
        try {
            Db::connection()->prepare('UPDATE users SET last_ip = :ip WHERE id = :id')
                ->execute(['ip' => mb_strimwidth($ip, 0, 45), 'id' => $userId]);
        } catch (\Throwable $e) {
            // coluna pode nao existir ainda — nunca trava o login
        }
    }

    // ===== Blocklist de e-mails (quem esta aqui nao loga nem cria conta) =====

    public function isEmailBlocked(string $email): bool
    {
        $email = strtolower(trim($email));
        if ($email === '') {
            return false;
        }
        try {
            $stmt = Db::connection()->prepare('SELECT 1 FROM blocked_emails WHERE email = :e LIMIT 1');
            $stmt->execute(['e' => $email]);
            return $stmt->fetchColumn() !== false;
        } catch (\Throwable $e) {
            return false; // tabela pode nao existir ainda — nunca trava o login
        }
    }

    public function blockEmail(string $email, ?string $motivo = null): void
    {
        $email = strtolower(trim($email));
        if ($email === '') {
            return;
        }
        Db::connection()->prepare(
            'INSERT INTO blocked_emails (email, motivo) VALUES (:e, :m)
             ON DUPLICATE KEY UPDATE motivo = VALUES(motivo)'
        )->execute(['e' => $email, 'm' => $motivo]);
    }

    public function unblockEmail(string $email): void
    {
        $email = strtolower(trim($email));
        Db::connection()->prepare('DELETE FROM blocked_emails WHERE email = :e')->execute(['e' => $email]);
    }

    /** @return array<int,array<string,mixed>> */
    public function listBlockedEmails(): array
    {
        try {
            return Db::connection()->query('SELECT id, email, motivo, created_at FROM blocked_emails ORDER BY created_at DESC')->fetchAll();
        } catch (\Throwable $e) {
            return [];
        }
    }

    public function listAll(): array
    {
        // valor_pago/data_pagamento vem do ULTIMO pagamento aprovado do usuario
        // — e o que ele REALMENTE pagou no periodo atual, imune a edicoes
        // posteriores no valor do plano (que so mexem na tabela `planos`).
        // pending_count/approved_count: pra saber quem GEROU pagamento (Pix) mas
        // nunca efetuou (pending > 0 e approved = 0) — coluna no painel do admin.
        return Db::connection()->query('
            SELECT u.*, p.nome AS plano_nome, p.valor AS plano_valor,
                   pg.valor AS valor_pago, pg.data_pagamento AS data_pagamento,
                   (SELECT COUNT(*) FROM pagamentos pp WHERE pp.user_id = u.id AND pp.status = "pendente") AS pending_count,
                   (SELECT COUNT(*) FROM pagamentos pa WHERE pa.user_id = u.id AND pa.status = "aprovado") AS approved_count
            FROM users u
            LEFT JOIN planos p ON p.id = u.plano_id
            LEFT JOIN (
                SELECT x.user_id, x.valor,
                       COALESCE(x.paid_at, x.created_at) AS data_pagamento
                FROM pagamentos x
                JOIN (
                    SELECT user_id, MAX(id) AS mx
                    FROM pagamentos
                    WHERE status = "aprovado"
                    GROUP BY user_id
                ) last ON last.user_id = x.user_id AND last.mx = x.id
            ) pg ON pg.user_id = u.id
            ORDER BY u.created_at DESC
        ')->fetchAll();
    }

    public function updateStatus(int $userId, string $status): void
    {
        $stmt = Db::connection()->prepare('UPDATE users SET status = :status WHERE id = :id');
        $stmt->execute(['id' => $userId, 'status' => $status]);
    }

    /**
     * "Liberar acesso": reativa a conta e define ate quando o acesso vale.
     * `$planoId` so vem preenchido no fluxo de pagamento Pix (PagamentoService
     * ja sabe exatamente qual plano foi comprado) -- define quais abas o
     * usuario passa a poder usar (ver PlanoService::abasForPlanoId). Quando
     * null (liberacao manual do admin via AdminUserController::grantAccess,
     * que so pede "quantos dias"), o `plano_id` que ja estava la NAO muda —
     * COALESCE mantem o valor atual em vez de zerar a restricao de quem ja
     * tinha um plano especifico.
     */
    public function grantAccess(int $userId, int $days, ?int $planoId = null, bool $updatePlano = true): void
    {
        $sql = "UPDATE users SET status = 'active', access_started_at = NOW(), access_expires_at = DATE_ADD(NOW(), INTERVAL :days DAY)";
        $params = ['id' => $userId, 'days' => $days];

        if ($updatePlano) {
            $sql .= ", plano_id = :plano_id";
            $params['plano_id'] = $planoId;
        } else {
            $sql .= ", plano_id = COALESCE(:plano_id, plano_id)";
            $params['plano_id'] = $planoId;
        }

        $sql .= " WHERE id = :id";

        $stmt = Db::connection()->prepare($sql);
        $stmt->execute($params);
    }

    /**
     * "Remover acesso": deixa o usuario como se nunca tivesse pago — status vira
     * 'pending_payment' e o acesso expira agora. Ele ainda consegue logar (pra
     * chegar em "Solicitar Acesso"), mas o PaidAccessMiddleware/hasPaidAccess
     * bloqueiam todas as abas na hora (checado do banco a cada request). O
     * `plano_id` e mantido — o admin pode religar o acesso quando quiser.
     */
    public function revokeAccess(int $userId): void
    {
        Db::connection()
            ->prepare("UPDATE users SET status = 'pending_payment', access_expires_at = NOW() WHERE id = :id")
            ->execute(['id' => $userId]);
    }

    /**
     * @throws \PDOException se o usuario tiver dados vinculados (moldes, rifas etc —
     *   FK com ON DELETE RESTRICT de proposito, pra nunca apagar historico junto)
     */
    /**
     * Exclui o usuario limpando todas as chaves estrangeiras.
     * Transfere autoria de moldes/planos globais criados por ele para o admin logado.
     */
    public function delete(int $userId, int $adminId): void
    {
        $pdo = Db::connection();
        $pdo->beginTransaction();

        try {
            // 1. Deleta tokens e configuracoes do usuario
            $pdo->prepare('DELETE FROM api_tokens WHERE user_id = :id')->execute(['id' => $userId]);
            $pdo->prepare('DELETE FROM user_settings WHERE user_id = :id')->execute(['id' => $userId]);
            $pdo->prepare('DELETE FROM pagamentos WHERE user_id = :id')->execute(['id' => $userId]);

            // 2. Deleta projetos do usuario
            $pdo->prepare('DELETE FROM mold_projects WHERE created_by = :created_by OR updated_by = :updated_by')
                ->execute(['created_by' => $userId, 'updated_by' => $userId]);
            $pdo->prepare('DELETE FROM lanterna_projects WHERE created_by = :created_by OR updated_by = :updated_by')
                ->execute(['created_by' => $userId, 'updated_by' => $userId]);
            $pdo->prepare('DELETE FROM riscado_projects WHERE created_by = :created_by OR updated_by = :updated_by')
                ->execute(['created_by' => $userId, 'updated_by' => $userId]);

            // 3. Limpa rifas criadas por ele (e seus compradores/numeros) se houver
            $stmt = $pdo->prepare('SELECT id FROM rifas WHERE created_by = :id');
            $stmt->execute(['id' => $userId]);
            $rifaIds = $stmt->fetchAll(\PDO::FETCH_COLUMN);
            
            if (!empty($rifaIds)) {
                $idsPlaceholders = implode(',', array_map('intval', $rifaIds));
                $pdo->exec("DELETE FROM rifa_numeros WHERE rifa_id IN ($idsPlaceholders)");
                $pdo->exec("DELETE FROM rifa_promocoes WHERE rifa_id IN ($idsPlaceholders)");
                $pdo->exec("DELETE FROM rifas WHERE id IN ($idsPlaceholders)");
            }

            // 4. Reatribui autoria de dados globais (moldes, planos, etc.) para o admin logado
            $tables = ['bandeiras', 'loja_produtos', 'modelos_3d', 'molds', 'planos', 'rifas', 'system_settings'];
            foreach ($tables as $t) {
                if ($t !== 'system_settings') {
                    $pdo->prepare("UPDATE `$t` SET created_by = :admin_id WHERE created_by = :id")
                        ->execute(['admin_id' => $adminId, 'id' => $userId]);
                }
                $pdo->prepare("UPDATE `$t` SET updated_by = :admin_id WHERE updated_by = :id")
                    ->execute(['admin_id' => $adminId, 'id' => $userId]);
            }

            // 5. Deleta o usuario final
            $pdo->prepare('DELETE FROM users WHERE id = :id')->execute(['id' => $userId]);

            $pdo->commit();
        } catch (\Throwable $e) {
            $pdo->rollBack();
            throw $e;
        }
    }

    /**
     * Admin nunca precisa validar; qualquer usuario com email_verified_at
     * preenchido esta validado.
     */
    public function isEmailVerified(array $user): bool
    {
        return ($user['role'] ?? '') === 'admin' || !empty($user['email_verified_at']);
    }

    /**
     * Inicia (ou reenvia) a verificacao de e-mail: gera um codigo de 6 digitos
     * e manda por e-mail. O PRAZO de exclusao (1h) e fixado UMA vez, na 1a
     * chamada — quando o usuario entra no sistema sem estar validado. Reenvios
     * geram um codigo novo mas NAO renovam o prazo.
     *
     * @return array{deadline: string, sent: bool, error?: string}|null null =
     *   admin ou ja verificado (nada a fazer).
     */
    public function startEmailVerification(int $userId, bool $forceResend = false): ?array
    {
        $user = $this->findById($userId);
        if ($user === null || $this->isEmailVerified($user)) {
            return null;
        }

        $hasActiveCode = !empty($user['email_verification_code']) && !empty($user['email_verification_deadline']);

        // Ja tem codigo ativo e nao foi pedido reenvio: reaproveita (nao spamar).
        if ($hasActiveCode && !$forceResend) {
            return ['deadline' => (string) $user['email_verification_deadline'], 'sent' => false];
        }

        $code = str_pad((string) random_int(0, 999999), 6, '0', STR_PAD_LEFT);
        // Prazo fixado na 1a vez; reenvio mantem o mesmo.
        $deadline = !empty($user['email_verification_deadline'])
            ? (string) $user['email_verification_deadline']
            : date('Y-m-d H:i:s', time() + 3600);

        Db::connection()
            ->prepare('UPDATE users SET email_verification_code = :code, email_verification_deadline = :deadline WHERE id = :id')
            ->execute(['code' => $code, 'deadline' => $deadline, 'id' => $userId]);

        $result = ['deadline' => $deadline, 'sent' => true];

        try {
            $nome = (string) ($user['name'] ?? '');
            $primeiroNome = $nome !== '' ? explode(' ', trim($nome))[0] : '';
            $subject = 'Seu codigo de confirmacao: ' . $code;
            $text = "Ola {$primeiroNome},\n\n"
                . "Seu codigo de confirmacao e: {$code}\n\n"
                . "Digite esse codigo na tela do sistema para liberar o seu acesso.\n"
                . "Atencao: se voce nao confirmar dentro de 1 hora, a conta sera removida automaticamente.\n\n"
                . "Se voce nao criou esta conta, ignore este e-mail.";
            $html = '<div style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:0 auto;color:#1a202c">'
                . '<h2 style="color:#2b6cb0;margin:0 0 12px">Confirme seu e-mail</h2>'
                . '<p>Ola ' . htmlspecialchars($primeiroNome, ENT_QUOTES) . ', use o codigo abaixo para liberar seu acesso:</p>'
                . '<div style="font-size:34px;font-weight:700;letter-spacing:10px;text-align:center;'
                . 'background:#edf2f7;border-radius:10px;padding:18px;margin:16px 0;color:#1a202c">' . $code . '</div>'
                . '<p style="color:#c53030;font-size:13px"><strong>Voce tem 1 hora para confirmar.</strong> '
                . 'Passado esse prazo sem confirmar, a conta e removida automaticamente.</p>'
                . '<p style="color:#718096;font-size:12px">Se voce nao criou esta conta, ignore este e-mail.</p>'
                . '</div>';

            Mailer::send((string) $user['email'], $subject, ['body' => $text, 'html' => $html]);
        } catch (\Throwable $e) {
            $result['sent'] = false;
            $result['error'] = 'Nao foi possivel enviar o e-mail agora. Tente reenviar em instantes.';
        }

        return $result;
    }

    /**
     * Confere o codigo digitado. Recusa se o prazo ja passou (a conta esta
     * sujeita a exclusao). Em caso de sucesso, marca verificado e limpa codigo.
     */
    public function confirmEmailVerification(int $userId, string $code): bool
    {
        $user = $this->findById($userId);
        if ($user === null) {
            return false;
        }
        if ($this->isEmailVerified($user)) {
            return true;
        }
        if (empty($user['email_verification_code'])) {
            return false;
        }
        if (!empty($user['email_verification_deadline']) && strtotime((string) $user['email_verification_deadline']) < time()) {
            return false;
        }
        if (!hash_equals((string) $user['email_verification_code'], trim($code))) {
            return false;
        }

        Db::connection()
            ->prepare('UPDATE users SET email_verified_at = NOW(), email_verification_code = NULL, email_verification_deadline = NULL WHERE id = :id')
            ->execute(['id' => $userId]);

        return true;
    }

    /**
     * Exclui contas de usuario (nunca admin) que entraram no sistema, receberam
     * o card de verificacao mas nao confirmaram dentro do prazo (1h). Reaproveita
     * delete() pra limpar as FKs, atribuindo dados globais ao 1o admin.
     *
     * @return int quantas contas foram excluidas
     */
    public function deleteExpiredUnverified(): int
    {
        $pdo = Db::connection();
        $adminId = (int) ($pdo->query("SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1")->fetchColumn() ?: 0);
        if ($adminId === 0) {
            return 0;
        }

        $ids = $pdo->query("
            SELECT id FROM users
            WHERE role = 'user'
              AND email_verified_at IS NULL
              AND email_verification_deadline IS NOT NULL
              AND email_verification_deadline < NOW()
        ")->fetchAll(\PDO::FETCH_COLUMN);

        $count = 0;
        foreach ($ids as $id) {
            try {
                $this->delete((int) $id, $adminId);
                $count++;
            } catch (\Throwable $e) {
                // ignora falha pontual e segue excluindo os demais
            }
        }

        return $count;
    }

    public function toPublicArray(array $user): array
    {
        $planoId = isset($user['plano_id']) && $user['plano_id'] !== null ? (int) $user['plano_id'] : null;
        $planoNome = $user['plano_nome'] ?? null;
        $planoValor = isset($user['plano_valor']) && $user['plano_valor'] !== null ? (float) $user['plano_valor'] : null;

        // Fallback se carregado sem JOIN
        if ($planoId !== null && $planoNome === null) {
            $plano = (new PlanoService())->findRawById($planoId);
            if ($plano !== null) {
                $planoNome = $plano['nome'];
                $planoValor = (float) $plano['valor'];
            }
        }

        $pdo = Db::connection();

        $activeStmt = $pdo->prepare(
            'SELECT device, last_used_at FROM api_tokens 
             WHERE user_id = :user_id 
               AND last_used_at > :threshold 
               AND (expires_at IS NULL OR expires_at > NOW())
             ORDER BY last_used_at DESC'
        );
        $activeStmt->execute([
            'user_id' => (int) $user['id'],
            'threshold' => date('Y-m-d H:i:s', time() - 60)
        ]);
        $activeTokens = $activeStmt->fetchAll();

        $isOnline = count($activeTokens) > 0;

        $devices = array_filter(array_map(fn($t) => $t['device'] ?? null, $activeTokens));
        $sessionDevice = count($devices) > 0 ? implode(', ', $devices) : null;

        $lastStmt = $pdo->prepare(
            'SELECT MAX(last_used_at) FROM api_tokens WHERE user_id = :user_id'
        );
        $lastStmt->execute(['user_id' => (int) $user['id']]);
        $lastActivity = $lastStmt->fetchColumn() ?: null;

        $activeSessionId = $isOnline ? 'active' : null;

        return [
            'id' => (int) $user['id'],
            'name' => $user['name'],
            'email' => $user['email'],
            'role' => $user['role'],
            'status' => $user['status'],
            'access_expires_at' => $user['access_expires_at'] ?? null,
            'access_started_at' => $user['access_started_at'] ?? null,
            'plano_id' => $planoId,
            'plano_nome' => $planoNome,
            'plano_valor' => $planoValor,
            // O que o cliente REALMENTE pagou no periodo atual (ultimo pagamento
            // aprovado). Null = acesso liberado manualmente pelo admin (sem
            // pagamento) — a tela cai no plano_valor nesse caso.
            'valor_pago' => isset($user['valor_pago']) && $user['valor_pago'] !== null ? (float) $user['valor_pago'] : null,
            'data_pagamento' => $user['data_pagamento'] ?? null,
            // null = sem restricao (admin, ou plano que libera tudo) -- ver
            // PlanoService::abasForPlanoId. O frontend usa isso pra saber
            // quais abas do menu mostrar bloqueadas pra esse usuario.
            'allowed_abas' => (new PlanoService())->abasForPlanoId($planoId),
            // Assistente-IA Carla liberada pra esse usuario? (recurso a parte do
            // plotter — depende do plano ter carla_ia ligado; admin sempre true).
            'carla_ia_disponivel' => (new PlanoService())->carlaForPlanoId($planoId),
            // Verificacao de e-mail: verified=true libera o sistema; deadline e o
            // prazo (1h) pra confirmar antes da conta ser excluida.
            'email_verified' => $this->isEmailVerified($user),
            'email_verification_deadline' => $user['email_verification_deadline'] ?? null,
            // So no painel do admin (listAll traz pending_count/approved_count):
            // gerou pagamento (Pix) mas nunca efetuou nenhum.
            'has_pending_payment' => isset($user['pending_count'])
                ? ((int) $user['pending_count'] > 0 && (int) $user['approved_count'] === 0)
                : false,
            'created_at' => $user['created_at'] ?? null,
            'active_session_id' => $activeSessionId,
            'session_device' => $sessionDevice,
            'session_created_at' => null,
            'last_activity' => $lastActivity,
            'is_online' => $isOnline,
            'last_ip' => $user['last_ip'] ?? null,
            'current_view' => $user['current_view'] ?? null,
            'phone' => $user['phone'] ?? null,
            'phone_verified' => !empty($user['phone_verified_at']),
            'phone_validation_required' => self::phoneValidationRequired(),
        ];
    }

    /** Le a config "exigir validacao de telefone" uma vez so (memoizado). */
    private static ?bool $phoneReqCache = null;
    public static function phoneValidationRequired(): bool
    {
        if (self::$phoneReqCache !== null) {
            return self::$phoneReqCache;
        }
        try {
            $v = Db::connection()->query('SELECT phone_validation_required FROM system_settings WHERE id = 1')->fetchColumn();
            self::$phoneReqCache = ((int) $v) === 1;
        } catch (\Throwable $e) {
            self::$phoneReqCache = false;
        }
        return self::$phoneReqCache;
    }

    /** Guarda a aba/ferramenta que o cliente esta usando agora. */
    public function updateCurrentView(int $userId, string $view): void
    {
        try {
            Db::connection()->prepare('UPDATE users SET current_view = :v, last_activity = NOW() WHERE id = :id')
                ->execute(['v' => mb_strimwidth($view, 0, 120), 'id' => $userId]);
        } catch (\Throwable $e) {
            // coluna pode nao existir ainda
        }
    }
}
