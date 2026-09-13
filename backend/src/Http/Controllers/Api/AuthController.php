<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api;

use App\Core\Request;
use App\Core\Response;
use App\Services\AuthTokenService;
use App\Services\UserService;
use App\Support\Password;
use App\Support\Db;

final class AuthController
{
    private UserService $users;
    private AuthTokenService $tokens;

    public function __construct()
    {
        $this->users = new UserService();
        $this->tokens = new AuthTokenService();
    }

    public function register(Request $request): Response
    {
        $name = trim((string) $request->input('name', ''));
        $email = strtolower(trim((string) $request->input('email', '')));
        $password = (string) $request->input('password', '');

        $errors = [];
        if ($name === '' || mb_strlen($name) < 2) {
            $errors['name'] = 'Informe seu nome completo.';
        }
        if ($email === '' || filter_var($email, FILTER_VALIDATE_EMAIL) === false) {
            $errors['email'] = 'Informe um e-mail valido.';
        }
        if (mb_strlen($password) < 8) {
            $errors['password'] = 'A senha precisa ter pelo menos 8 caracteres.';
        }
        if ($errors === [] && $this->users->findByEmail($email) !== null) {
            $errors['email'] = 'Este e-mail ja esta cadastrado.';
        }
        if ($errors === [] && $this->users->isEmailBlocked($email)) {
            $errors['email'] = 'Este e-mail está bloqueado. Fale com o administrador.';
        }

        if ($errors !== []) {
            return Response::json(['errors' => $errors], 422);
        }

        $user = $this->users->create($name, $email, $password);
        $userAgent = $request->headers['user-agent'] ?? 'Unknown Device';
        $token = $this->tokens->issue((int) $user['id'], mb_strimwidth((string)$userAgent, 0, 255));

        $tokenHash = hash('sha256', $token);
        Db::connection()->prepare(
            'UPDATE users SET 
                active_session_id = :session_id,
                session_device = :device,
                session_created_at = NOW(),
                last_activity = NOW()
             WHERE id = :id'
        )->execute([
            'session_id' => $tokenHash,
            'device' => mb_strimwidth((string)$userAgent, 0, 255),
            'id' => (int) $user['id']
        ]);

        $this->users->updateLastIp((int) $user['id'], $this->clientIp($request));

        return Response::json([
            'user' => $this->users->toPublicArray($this->users->findById((int) $user['id'])),
            'token' => $token,
        ], 201);
    }

    public function login(Request $request): Response
    {
        $email = strtolower(trim((string) $request->input('email', '')));
        $password = (string) $request->input('password', '');

        $user = $email === '' ? null : $this->users->findByEmail($email);

        if ($user === null || !Password::verify($password, $user['password_hash'])) {
            return Response::json(['error' => 'E-mail ou senha invalidos.'], 401);
        }

        if ($this->users->isEmailBlocked($email)) {
            return Response::json(['error' => 'Este acesso esta bloqueado. Fale com o administrador.'], 403);
        }

        if ($user['status'] === 'blocked') {
            return Response::json(['error' => 'Este acesso esta bloqueado. Fale com o administrador.'], 403);
        }
        // pending_payment e contas com plano expirado passam direto no login --
        // assim o cliente consegue logar e chegar na aba "Solicitar Acesso / Renovar Plano"
        // para efetuar o pagamento da renovacao (ferramentas pagas sao bloqueadas pelo PaidAccessMiddleware).


        // Check if there is an active session (activity within the last 60 seconds)
        // Check if there are 2 or more active sessions (activity within the last 60 seconds)
        $activeCountStmt = Db::connection()->prepare(
            'SELECT COUNT(*) FROM api_tokens 
             WHERE user_id = :user_id 
               AND last_used_at > :threshold 
               AND (expires_at IS NULL OR expires_at > NOW())'
        );
        $activeCountStmt->execute([
            'user_id' => $user['id'],
            'threshold' => date('Y-m-d H:i:s', time() - 60)
        ]);
        $activeCount = (int) $activeCountStmt->fetchColumn();

        if ($activeCount >= 2) {
            return Response::json([
                'error' => 'Esta conta já está sendo utilizada no limite máximo de 2 dispositivos simultâneos.'
            ], 409); // 409 Conflict
        }

        $userAgent = $request->headers['user-agent'] ?? 'Unknown Device';
        $token = $this->tokens->issue((int) $user['id'], mb_strimwidth((string)$userAgent, 0, 255));

        $tokenHash = hash('sha256', $token);
        Db::connection()->prepare(
            'UPDATE users SET
                active_session_id = :session_id,
                session_device = :device,
                session_created_at = NOW(),
                last_activity = NOW()
             WHERE id = :id'
        )->execute([
            'session_id' => $tokenHash,
            'device' => mb_strimwidth((string)$userAgent, 0, 255),
            'id' => (int) $user['id']
        ]);

        // Guarda o IP (rede/wifi) do cliente pra o admin ver/identificar.
        $this->users->updateLastIp((int) $user['id'], $this->clientIp($request));

        return Response::json([
            'user' => $this->users->toPublicArray($this->users->findById((int) $user['id'])),
            'token' => $token,
        ]);
    }

    /** IP real do cliente. Como o nginx fica na frente, o REMOTE_ADDR e o proxy
     * (127.0.0.1) — o IP de verdade vem no X-Forwarded-For / X-Real-IP. */
    private function clientIp(Request $request): string
    {
        $fwd = trim((string) ($request->headers['x-forwarded-for'] ?? ''));
        if ($fwd !== '') {
            return trim(explode(',', $fwd)[0]);
        }
        $real = trim((string) ($request->headers['x-real-ip'] ?? ''));
        if ($real !== '') {
            return $real;
        }
        return (string) ($_SERVER['REMOTE_ADDR'] ?? '');
    }

    public function me(Request $request): Response
    {
        $user = $this->users->findById((int) $request->attribute('user_id'));
        if ($user === null) {
            return Response::json(['error' => 'Usuario nao encontrado.'], 404);
        }

        return Response::json(['user' => $this->users->toPublicArray($user)]);
    }

    public function changePassword(Request $request): Response
    {
        $user = $this->users->findById((int) $request->attribute('user_id'));
        if ($user === null) {
            return Response::json(['error' => 'Usuario nao encontrado.'], 404);
        }

        $currentPassword = (string) $request->input('current_password', '');
        $newPassword = (string) $request->input('new_password', '');

        $errors = [];
        if (!Password::verify($currentPassword, $user['password_hash'])) {
            $errors['current_password'] = 'Senha atual incorreta.';
        }
        if (mb_strlen($newPassword) < 8) {
            $errors['new_password'] = 'A nova senha precisa ter pelo menos 8 caracteres.';
        }

        if ($errors !== []) {
            return Response::json(['errors' => $errors, 'error' => 'Verifique os campos.'], 422);
        }

        $this->users->updatePassword((int) $user['id'], $newPassword);

        return Response::json(['ok' => true]);
    }

    public function changeEmail(Request $request): Response
    {
        $user = $this->users->findById((int) $request->attribute('user_id'));
        if ($user === null) {
            return Response::json(['error' => 'Usuario nao encontrado.'], 404);
        }

        $currentPassword = (string) $request->input('current_password', '');
        $newEmail = strtolower(trim((string) $request->input('new_email', '')));

        $errors = [];
        if (!Password::verify($currentPassword, $user['password_hash'])) {
            $errors['current_password'] = 'Senha atual incorreta.';
        }
        if ($newEmail === '' || filter_var($newEmail, FILTER_VALIDATE_EMAIL) === false) {
            $errors['new_email'] = 'Informe um e-mail valido.';
        } elseif ($newEmail !== $user['email'] && $this->users->findByEmail($newEmail) !== null) {
            $errors['new_email'] = 'Este e-mail ja esta em uso.';
        }

        if ($errors !== []) {
            return Response::json(['errors' => $errors, 'error' => 'Verifique os campos.'], 422);
        }

        // Se pediu o MESMO e-mail, nao ha o que trocar.
        if ($newEmail === strtolower((string) $user['email'])) {
            return Response::json(['errors' => ['new_email' => 'Este já é o seu e-mail atual.']], 422);
        }

        // Nao troca na hora: manda um codigo pro e-mail NOVO e espera a confirmacao.
        $this->users->requestEmailChange((int) $user['id'], $newEmail);

        return Response::json(['ok' => true, 'pending_email' => $newEmail]);
    }

    /** O frontend informa qual aba/ferramenta o cliente esta usando agora. */
    public function reportActivity(Request $request): Response
    {
        $userId = (int) $request->attribute('user_id');
        $view = trim((string) $request->input('view', ''));
        if ($userId > 0 && $view !== '') {
            $this->users->updateCurrentView($userId, $view);
        }
        return Response::json(['ok' => true]);
    }

    /** Cliente pede o codigo de validacao de telefone (enviado pelo WhatsApp). */
    public function sendPhoneCode(Request $request): Response
    {
        $userId = (int) $request->attribute('user_id');
        if ($this->users->findById($userId) === null) {
            return Response::json(['error' => 'Usuario nao encontrado.'], 404);
        }
        $phone = trim((string) $request->input('phone', ''));
        try {
            $this->users->requestPhoneVerification($userId, $phone);
        } catch (\Throwable $e) {
            return Response::json(['errors' => ['phone' => $e->getMessage()], 'error' => $e->getMessage()], 422);
        }
        return Response::json(['ok' => true]);
    }

    /** Confirma o telefone com o codigo recebido no WhatsApp. */
    public function confirmPhoneCode(Request $request): Response
    {
        $userId = (int) $request->attribute('user_id');
        $user = $this->users->findById($userId);
        if ($user === null) {
            return Response::json(['error' => 'Usuario nao encontrado.'], 404);
        }
        $code = trim((string) $request->input('code', ''));
        if (!preg_match('/^\d{6}$/', $code)) {
            return Response::json(['errors' => ['code' => 'Digite o código de 6 dígitos.'], 'error' => 'Código inválido.'], 422);
        }
        if (!$this->users->confirmPhoneVerification($userId, $code)) {
            return Response::json(['errors' => ['code' => 'Código incorreto ou expirado.'], 'error' => 'Não foi possível confirmar.'], 422);
        }
        return Response::json(['user' => $this->users->toPublicArray($this->users->findById($userId))]);
    }

    /** Confirma a troca de e-mail com o codigo enviado pro e-mail novo. */
    public function confirmEmailChange(Request $request): Response
    {
        $user = $this->users->findById((int) $request->attribute('user_id'));
        if ($user === null) {
            return Response::json(['error' => 'Usuario nao encontrado.'], 404);
        }

        $code = trim((string) $request->input('code', ''));
        if (!preg_match('/^\d{6}$/', $code)) {
            return Response::json(['errors' => ['code' => 'Digite o código de 6 dígitos.'], 'error' => 'Código inválido.'], 422);
        }

        if (!$this->users->confirmEmailChange((int) $user['id'], $code)) {
            return Response::json(['errors' => ['code' => 'Código incorreto ou expirado.'], 'error' => 'Não foi possível confirmar.'], 422);
        }

        return Response::json(['user' => $this->users->toPublicArray($this->users->findById((int) $user['id']))]);
    }

    /**
     * O proprio usuario exclui a conta dele. Exige a senha atual (evita exclusao
     * acidental / por sessao sequestrada). Admin nao se exclui por aqui — usa o
     * painel. Reaproveita UserService::delete, transferindo dados globais pro 1o
     * admin.
     */
    public function deleteAccount(Request $request): Response
    {
        $userId = (int) $request->attribute('user_id');
        $user = $this->users->findById($userId);
        if ($user === null) {
            return Response::json(['error' => 'Usuario nao encontrado.'], 404);
        }
        if (($user['role'] ?? '') === 'admin') {
            return Response::json(['error' => 'Conta de administrador nao pode ser excluida por aqui.'], 403);
        }

        $password = (string) $request->input('password', '');
        if (!Password::verify($password, $user['password_hash'])) {
            return Response::json(['errors' => ['password' => 'Senha incorreta.'], 'error' => 'Senha incorreta.'], 422);
        }

        $adminId = (int) (Db::connection()->query("SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1")->fetchColumn() ?: 0);
        if ($adminId === 0) {
            return Response::json(['error' => 'Nao foi possivel excluir a conta agora.'], 500);
        }

        try {
            $this->users->delete($userId, $adminId);
        } catch (\Throwable $e) {
            return Response::json(['error' => 'Nao foi possivel excluir a conta: ' . $e->getMessage()], 500);
        }

        return Response::json(['ok' => true]);
    }

    public function logout(Request $request): Response
    {
        $token = $request->bearerToken();
        if ($token !== null) {
            $this->tokens->revoke($token);

            $tokenHash = hash('sha256', $token);
            Db::connection()->prepare(
                'UPDATE users SET 
                    active_session_id = NULL,
                    session_device = NULL,
                    last_activity = NULL
                 WHERE active_session_id = :hash'
            )->execute(['hash' => $tokenHash]);
        }

        return Response::json(['ok' => true]);
    }

    public function heartbeat(Request $request): Response
    {
        $userId = (int) $request->attribute('user_id');
        $token = $request->bearerToken();
        if ($token === null) {
            return Response::json(['error' => 'Nao autenticado.'], 401);
        }

        $tokenHash = hash('sha256', $token);

        Db::connection()->prepare(
            'UPDATE users SET last_activity = NOW() WHERE id = :id'
        )->execute(['id' => $userId]);

        Db::connection()->prepare(
            'UPDATE api_tokens SET last_used_at = NOW() WHERE user_id = :user_id AND token_hash = :hash'
        )->execute([
            'user_id' => $userId,
            'hash' => $tokenHash
        ]);

        return Response::json(['ok' => true]);
    }
}
