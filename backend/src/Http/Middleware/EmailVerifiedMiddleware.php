<?php

declare(strict_types=1);

namespace App\Http\Middleware;

use App\Core\Request;
use App\Core\Response;
use App\Services\UserService;

/**
 * Bloqueia rotas de funcionalidade e de pagamento pra quem ainda nao confirmou
 * o e-mail (codigo de 6 digitos) — admin sempre passa. Defesa no servidor: o
 * card no frontend ja trava a tela, mas isso impede um cliente esperto de gerar
 * pagamento ou usar a API sem validar. Se o prazo (1h) ja tiver estourado, a
 * conta e removida na hora e a resposta pede novo login.
 */
final class EmailVerifiedMiddleware
{
    public function handle(Request $request): ?Response
    {
        $userId = (int) $request->attribute('user_id', 0);
        $users = new UserService();
        $user = $users->findById($userId);

        if ($user === null) {
            return Response::json(['error' => 'Usuario nao encontrado.'], 404);
        }

        if ($users->isEmailVerified($user)) {
            return null;
        }

        // Prazo estourado: exclui e derruba a sessao.
        if (!empty($user['email_verification_deadline'])
            && strtotime((string) $user['email_verification_deadline']) < time()) {
            $users->deleteExpiredUnverified();
            return Response::json([
                'error' => 'Conta removida por falta de confirmacao do e-mail.',
                'account_deleted' => true,
            ], 410);
        }

        return Response::json([
            'error' => 'Confirme seu e-mail para continuar.',
            'email_verification_required' => true,
        ], 403);
    }
}
