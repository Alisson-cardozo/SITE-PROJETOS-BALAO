<?php

declare(strict_types=1);

namespace App\Http\Middleware;

use App\Core\Request;
use App\Core\Response;
use App\Services\UserService;

final class AdminMiddleware
{
    public function handle(Request $request): ?Response
    {
        $userId = (int) $request->attribute('user_id', 0);
        $user = (new UserService())->findById($userId);

        if ($user === null || $user['role'] !== 'admin') {
            return Response::json(['error' => 'Acesso restrito ao administrador.'], 403);
        }

        return null;
    }
}
