<?php

declare(strict_types=1);

namespace App\Http\Middleware;

use App\Core\Request;
use App\Core\Response;
use App\Services\AuthTokenService;

final class AuthMiddleware
{
    public function handle(Request $request): ?Response
    {
        $token = $request->bearerToken();
        if ($token === null) {
            return Response::json(['error' => 'Nao autenticado.'], 401);
        }

        $userId = (new AuthTokenService())->userIdForToken($token);
        if ($userId === null) {
            return Response::json(['error' => 'Sessao invalida ou expirada.'], 401);
        }

        $request->attributes['user_id'] = $userId;

        return null;
    }
}
