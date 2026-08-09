<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api;

use App\Core\Request;
use App\Core\Response;
use App\Services\UserService;
use PDOException;

final class AdminUserController
{
    private UserService $users;

    public function __construct()
    {
        $this->users = new UserService();
    }

    public function index(Request $request): Response
    {
        $usersRaw = $this->users->listAll();
        $data = array_map(fn (array $user) => $this->users->toPublicArray($user), $usersRaw);

        $pdo = \App\Support\Db::connection();

        // Faturamento do mes corrente
        $faturamento = (float) $pdo->query("
            SELECT COALESCE(SUM(valor), 0)
            FROM pagamentos 
            WHERE status = 'aprovado' 
              AND MONTH(paid_at) = MONTH(CURRENT_DATE()) 
              AND YEAR(paid_at) = YEAR(CURRENT_DATE())
        ")->fetchColumn();

        // Contagens
        $total = (int) $pdo->query("SELECT COUNT(*) FROM users")->fetchColumn();
        
        $active = (int) $pdo->query("
            SELECT COUNT(*) 
            FROM users 
            WHERE status = 'active' 
              AND (access_expires_at IS NULL OR access_expires_at > NOW())
        ")->fetchColumn();

        $expired = (int) $pdo->query("
            SELECT COUNT(*) 
            FROM users 
            WHERE status = 'active' 
              AND access_expires_at IS NOT NULL 
              AND access_expires_at <= NOW()
        ")->fetchColumn();

        $pending = (int) $pdo->query("SELECT COUNT(*) FROM users WHERE status = 'pending_payment'")->fetchColumn();
        $blocked = (int) $pdo->query("SELECT COUNT(*) FROM users WHERE status = 'blocked'")->fetchColumn();

        return Response::json([
            'data' => $data,
            'stats' => [
                'total' => $total,
                'active' => $active,
                'expired' => $expired,
                'pending' => $pending,
                'blocked' => $blocked,
                'monthly_billing' => $faturamento,
            ]
        ]);
    }

    public function updateStatus(Request $request): Response
    {
        $target = $this->authorizeTarget($request, 'bloquear');
        if ($target instanceof Response) {
            return $target;
        }

        $status = (string) $request->input('status', '');
        if (!in_array($status, ['active', 'blocked'], true)) {
            return Response::json(['error' => 'Status invalido.'], 422);
        }

        $this->users->updateStatus((int) $target['id'], $status);

        return Response::json(['data' => $this->users->toPublicArray($this->users->findById((int) $target['id']))]);
    }

    public function grantAccess(Request $request): Response
    {
        $target = $this->authorizeTarget($request, 'liberar acesso de');
        if ($target instanceof Response) {
            return $target;
        }

        $days = $request->input('days');
        if (!is_numeric($days) || (int) $days < 1 || (int) $days > 3650) {
            return Response::json(['error' => 'Informe uma quantidade de dias valida (1 a 3650).'], 422);
        }

        // Se no corpo vier a informacao de plano_id
        $planoId = null;
        $updatePlano = false;

        if (array_key_exists('plano_id', $request->body)) {
            $planoId = $request->body['plano_id'] !== null ? (int) $request->body['plano_id'] : null;
            $updatePlano = true;
        }

        $this->users->grantAccess((int) $target['id'], (int) $days, $planoId, $updatePlano);

        return Response::json(['data' => $this->users->toPublicArray($this->users->findById((int) $target['id']))]);
    }

    public function revokeAccess(Request $request): Response
    {
        $target = $this->authorizeTarget($request, 'remover o acesso de');
        if ($target instanceof Response) {
            return $target;
        }

        $this->users->revokeAccess((int) $target['id']);

        return Response::json(['data' => $this->users->toPublicArray($this->users->findById((int) $target['id']))]);
    }

    public function destroy(Request $request): Response
    {
        $target = $this->authorizeTarget($request, 'excluir');
        if ($target instanceof Response) {
            return $target;
        }

        $currentUserId = (int) $request->attribute('user_id', 0);

        try {
            $this->users->delete((int) $target['id'], $currentUserId);
        } catch (\Throwable $e) {
            return Response::json([
                'error' => 'Nao foi possivel excluir o usuario: ' . $e->getMessage(),
            ], 422);
        }

        return Response::json(['ok' => true]);
    }

    public function updatePassword(Request $request): Response
    {
        $target = $this->authorizeTarget($request, 'alterar a senha de');
        if ($target instanceof Response) {
            return $target;
        }

        $password = (string) $request->input('password', '');
        $passwordConfirm = (string) $request->input('password_confirmation', '');

        if (mb_strlen($password) < 8) {
            return Response::json(['error' => 'A senha precisa ter pelo menos 8 caracteres.'], 422);
        }

        if ($password !== $passwordConfirm) {
            return Response::json(['error' => 'As senhas informadas nao coincidem.'], 422);
        }

        $this->users->updatePassword((int) $target['id'], $password);

        return Response::json(['ok' => true]);
    }

    public function revokeSession(Request $request): Response
    {
        $target = $this->authorizeTarget($request, 'revogar a sessao de');
        if ($target instanceof Response) {
            return $target;
        }

        $activeSessionId = $target['active_session_id'] ?? null;
        if ($activeSessionId !== null) {
            \App\Support\Db::connection()->prepare(
                'DELETE FROM api_tokens WHERE token_hash = :hash'
            )->execute(['hash' => $activeSessionId]);
        }

        \App\Support\Db::connection()->prepare(
            'UPDATE users SET 
                active_session_id = NULL,
                session_device = NULL,
                last_activity = NULL
             WHERE id = :id'
        )->execute(['id' => (int) $target['id']]);

        return Response::json(['ok' => true]);
    }

    /** @return array<string,mixed>|Response linha crua do usuario alvo, ou uma Response de erro pronta pra retornar */
    private function authorizeTarget(Request $request, string $acao): array|Response
    {
        $id = (int) ($request->param('id') ?? 0);
        $target = $this->users->findById($id);
        if ($target === null) {
            return Response::json(['error' => 'Usuario nao encontrado.'], 404);
        }

        $currentUserId = (int) $request->attribute('user_id', 0);
        if ($id === $currentUserId) {
            return Response::json(['error' => "Voce nao pode $acao a propria conta."], 422);
        }

        return $target;
    }
}
