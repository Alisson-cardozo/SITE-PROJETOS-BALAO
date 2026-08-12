<?php

declare(strict_types=1);

namespace App\Services;

use App\Support\Db;
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

    public function listAll(): array
    {
        // valor_pago/data_pagamento vem do ULTIMO pagamento aprovado do usuario
        // — e o que ele REALMENTE pagou no periodo atual, imune a edicoes
        // posteriores no valor do plano (que so mexem na tabela `planos`).
        return Db::connection()->query('
            SELECT u.*, p.nome AS plano_nome, p.valor AS plano_valor,
                   pg.valor AS valor_pago, pg.data_pagamento AS data_pagamento
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
            'created_at' => $user['created_at'] ?? null,
            'active_session_id' => $activeSessionId,
            'session_device' => $sessionDevice,
            'session_created_at' => null,
            'last_activity' => $lastActivity,
            'is_online' => $isOnline,
        ];
    }
}
