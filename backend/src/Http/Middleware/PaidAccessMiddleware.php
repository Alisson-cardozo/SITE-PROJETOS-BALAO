<?php

declare(strict_types=1);

namespace App\Http\Middleware;

use App\Core\Request;
use App\Core\Response;
use App\Services\UserService;

/**
 * Bloqueia toda rota de funcionalidade (moldes, bandeiras, paineis, 3D,
 * rifas etc) pra quem nao tem um plano pago ativo — admin sempre passa.
 * Mesma checagem que AuthController::login ja faz na hora do login, so que
 * repetida em CADA requisicao (hoje isso so era validado uma vez, no login;
 * um usuario bloqueado/expirado com token ainda valido continuava acessando
 * tudo ate deslogar).
 */
final class PaidAccessMiddleware
{
    public function handle(Request $request): ?Response
    {
        $userId = (int) $request->attribute('user_id', 0);
        $user = (new UserService())->findById($userId);

        if ($user === null) {
            return Response::json(['error' => 'Usuario nao encontrado.'], 404);
        }

        if ($user['role'] === 'admin') {
            return null;
        }

        if ($user['status'] !== 'active') {
            return Response::json(['error' => 'Voce ainda nao tem um plano pago ativo.'], 403);
        }

        if ($user['access_expires_at'] !== null && strtotime((string) $user['access_expires_at']) < time()) {
            return Response::json(['error' => 'Seu acesso expirou. Renove seu plano.'], 403);
        }

        return null;
    }
}
