<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api;

use App\Core\Request;
use App\Core\Response;
use App\Services\UserService;

/**
 * Fluxo de confirmacao de e-mail por codigo de 6 digitos. Rotas apenas
 * autenticadas (NAO exigem plano pago nem e-mail verificado — sao a propria
 * saida do bloqueio). Admin nunca cai aqui: o card so aparece pra usuario.
 */
final class EmailVerificationController
{
    private UserService $users;

    public function __construct()
    {
        $this->users = new UserService();
    }

    /**
     * Status do card. Se o usuario entrou e ainda nao validou, ja DISPARA o 1o
     * envio do codigo (e fixa o prazo de 1h). Se o prazo ja passou, exclui a
     * conta e responde 410 pra o frontend deslogar.
     */
    public function status(Request $request): Response
    {
        $userId = (int) $request->attribute('user_id');
        $user = $this->users->findById($userId);
        if ($user === null) {
            return Response::json(['error' => 'Usuario nao encontrado.'], 404);
        }

        if ($this->users->isEmailVerified($user)) {
            return Response::json(['verified' => true, 'email' => $user['email'], 'deadline' => null]);
        }

        // Prazo estourado: exclui e derruba a sessao.
        if (!empty($user['email_verification_deadline'])
            && strtotime((string) $user['email_verification_deadline']) < time()) {
            $this->users->deleteExpiredUnverified();
            return Response::json([
                'error' => 'Conta removida por falta de confirmacao do e-mail.',
                'account_deleted' => true,
            ], 410);
        }

        // Dispara o 1o envio (e fixa o prazo) se ainda nao houver codigo ativo.
        $this->users->startEmailVerification($userId, false);
        $user = $this->users->findById($userId) ?? $user;

        return Response::json([
            'verified' => false,
            'email' => $user['email'],
            'deadline' => $user['email_verification_deadline'] ?? null,
        ]);
    }

    /** Reenvia um codigo novo (mantendo o mesmo prazo de 1h). */
    public function send(Request $request): Response
    {
        $userId = (int) $request->attribute('user_id');
        $result = $this->users->startEmailVerification($userId, true);

        // null = admin ou ja verificado.
        if ($result === null) {
            return Response::json(['verified' => true]);
        }

        if (!empty($result['error'])) {
            return Response::json(['error' => $result['error'], 'deadline' => $result['deadline']], 502);
        }

        return Response::json(['sent' => true, 'deadline' => $result['deadline']]);
    }

    /** Confere o codigo digitado e libera o acesso. */
    public function confirm(Request $request): Response
    {
        $userId = (int) $request->attribute('user_id');
        $code = trim((string) $request->input('code', ''));

        if (!preg_match('/^\d{6}$/', $code)) {
            return Response::json(['error' => 'Informe o codigo de 6 digitos.'], 422);
        }

        $user = $this->users->findById($userId);
        if ($user === null) {
            return Response::json(['error' => 'Usuario nao encontrado.'], 404);
        }

        // Prazo estourado antes de digitar: exclui e desloga.
        if (!$this->users->isEmailVerified($user)
            && !empty($user['email_verification_deadline'])
            && strtotime((string) $user['email_verification_deadline']) < time()) {
            $this->users->deleteExpiredUnverified();
            return Response::json([
                'error' => 'Prazo expirado. A conta foi removida.',
                'account_deleted' => true,
            ], 410);
        }

        if (!$this->users->confirmEmailVerification($userId, $code)) {
            return Response::json(['error' => 'Codigo invalido. Confira e tente de novo.'], 422);
        }

        $fresh = $this->users->findById($userId);
        return Response::json([
            'verified' => true,
            'user' => $fresh !== null ? $this->users->toPublicArray($fresh) : null,
        ]);
    }
}
