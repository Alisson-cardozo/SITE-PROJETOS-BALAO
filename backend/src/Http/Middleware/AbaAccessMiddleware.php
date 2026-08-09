<?php

declare(strict_types=1);

namespace App\Http\Middleware;

use App\Core\Request;
use App\Core\Response;
use App\Services\PlanoService;
use App\Services\UserService;

/**
 * Roda DEPOIS de AuthMiddleware + PaidAccessMiddleware (usuario ja
 * autenticado e com plano pago ativo) — aqui so decide se o plano DELE
 * inclui a aba especifica dessa rota. Admin sempre passa. Usuario sem
 * `plano_id` (acesso liberado manualmente, ou conta de antes dessa feature)
 * fica SEM restricao -- ver decisao de produto em PlanoService::abasForPlanoId.
 */
final class AbaAccessMiddleware
{
    public function handleFor(Request $request, string $abaKey): ?Response
    {
        $userId = (int) $request->attribute('user_id', 0);
        $user = (new UserService())->findById($userId);

        if ($user === null) {
            return Response::json(['error' => 'Usuario nao encontrado.'], 404);
        }

        if ($user['role'] === 'admin') {
            return null;
        }

        $planoId = isset($user['plano_id']) && $user['plano_id'] !== null ? (int) $user['plano_id'] : null;
        $abas = (new PlanoService())->abasForPlanoId($planoId);

        if ($abas === null || in_array($abaKey, $abas, true)) {
            return null;
        }

        return Response::json([
            'error' => 'Seu plano nao inclui esta funcionalidade.',
            'locked_aba' => $abaKey,
        ], 403);
    }
}
