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
        $data = array_map(fn (array $user) => $this->users->toPublicArray($user), $this->users->listAll());

        return Response::json(['data' => $data]);
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

        $this->users->grantAccess((int) $target['id'], (int) $days);

        return Response::json(['data' => $this->users->toPublicArray($this->users->findById((int) $target['id']))]);
    }

    public function destroy(Request $request): Response
    {
        $target = $this->authorizeTarget($request, 'excluir');
        if ($target instanceof Response) {
            return $target;
        }

        try {
            $this->users->delete((int) $target['id']);
        } catch (PDOException $e) {
            return Response::json([
                'error' => 'Esse usuario tem moldes, rifas ou outros dados vinculados e nao pode ser excluido.',
            ], 422);
        }

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
