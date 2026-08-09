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

        if ($user['status'] === 'blocked') {
            return Response::json(['error' => 'Este acesso esta bloqueado. Fale com o administrador.'], 403);
        }
        // pending_payment passa direto -- e assim que um cadastro novo, ainda
        // sem plano pago, consegue logar pra chegar na aba "Solicitar Acesso"
        // (o resto do sistema fica bloqueado pelo PaidAccessMiddleware, nao aqui).
        if ($user['status'] === 'active' && $user['access_expires_at'] !== null && strtotime((string) $user['access_expires_at']) < time()) {
            return Response::json(['error' => 'Seu acesso expirou. Fale com o administrador.'], 403);
        }

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

        return Response::json([
            'user' => $this->users->toPublicArray($this->users->findById((int) $user['id'])),
            'token' => $token,
        ]);
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

        $this->users->updateEmail((int) $user['id'], $newEmail);

        return Response::json(['user' => $this->users->toPublicArray($this->users->findById((int) $user['id']))]);
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
