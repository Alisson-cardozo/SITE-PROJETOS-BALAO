<?php

declare(strict_types=1);

namespace App\Http\Middleware;

use App\Core\Request;
use App\Core\Response;
use App\Services\AuthTokenService;

use App\Support\Db;

final class AuthMiddleware
{
    public function handle(Request $request): ?Response
    {
        $token = $request->bearerToken();
        if ($token === null) {
            return Response::json(['error' => 'Nao autenticado.'], 401);
        }

        $tokenHash = hash('sha256', $token);
        $pdo = Db::connection();

        $stmt = $pdo->prepare(
            'SELECT u.id, u.status, u.active_session_id, u.access_expires_at
             FROM users u
             INNER JOIN api_tokens t ON t.user_id = u.id
             WHERE t.token_hash = :hash AND (t.expires_at IS NULL OR t.expires_at > NOW())
             LIMIT 1'
        );
        $stmt->execute(['hash' => $tokenHash]);
        $row = $stmt->fetch();

        if ($row === false) {
            return Response::json(['error' => 'Sessao invalida ou expirada.'], 401);
        }

        if ($row['status'] === 'blocked') {
            return Response::json(['error' => 'Este acesso esta bloqueado. Fale com o administrador.'], 403);
        }
        // Nota: se a conta expirou (access_expires_at < time()), permite autenticar
        // no AuthMiddleware para conseguir acessar a tela de renovacao/pagamento.
        // O acesso as ferramentas pagas e bloqueado pelo PaidAccessMiddleware.


        $pdo->prepare('UPDATE users SET last_activity = NOW() WHERE id = :id')
            ->execute(['id' => $row['id']]);

        $pdo->prepare('UPDATE api_tokens SET last_used_at = NOW() WHERE token_hash = :hash')
            ->execute(['hash' => $tokenHash]);

        $request->attributes['user_id'] = (int) $row['id'];

        return null;
    }
}
