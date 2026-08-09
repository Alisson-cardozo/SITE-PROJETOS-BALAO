<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api;

use App\Core\Request;
use App\Core\Response;
use App\Services\RiscadoProjectService;
use App\Services\UserService;

final class RiscadoProjectController
{
    /** ~12MB de JSON (imagens base64 no canvas). */
    private const MAX_STATE_JSON_BYTES = 12 * 1024 * 1024;

    private RiscadoProjectService $projects;
    private UserService $users;

    public function __construct()
    {
        $this->projects = new RiscadoProjectService();
        $this->users = new UserService();
    }

    public function index(Request $request): Response
    {
        $user = $this->currentUser($request);
        if ($user === null) {
            return Response::json(['error' => 'Usuario nao encontrado.'], 404);
        }

        $items = $this->projects->listByUserId((int) $user['id']);
        $data = array_map(fn (array $project) => $this->withPermissions($project, $user), $items);

        return Response::json(['data' => $data]);
    }

    public function show(Request $request): Response
    {
        $user = $this->currentUser($request);
        if ($user === null) {
            return Response::json(['error' => 'Usuario nao encontrado.'], 404);
        }

        $id = (int) ($request->param('id') ?? 0);
        $project = $this->projects->findById($id);
        if ($project === null) {
            return Response::json(['error' => 'Projeto riscado nao encontrado.'], 404);
        }

        return Response::json(['data' => $this->withPermissions($project, $user)]);
    }

    public function store(Request $request): Response
    {
        $user = $this->currentUser($request);
        if ($user === null) {
            return Response::json(['error' => 'Usuario nao encontrado.'], 404);
        }

        $payload = $this->validatePayload($request, true);
        if (isset($payload['error'])) {
            return Response::json(['error' => $payload['error']], 422);
        }

        $project = $this->projects->create($payload['data'], (int) $user['id']);

        return Response::json(['data' => $this->withPermissions($project, $user)], 201);
    }

    public function update(Request $request): Response
    {
        $user = $this->currentUser($request);
        if ($user === null) {
            return Response::json(['error' => 'Usuario nao encontrado.'], 404);
        }

        $id = (int) ($request->param('id') ?? 0);
        $existing = $this->projects->findRawById($id);
        if ($existing === null) {
            return Response::json(['error' => 'Projeto riscado nao encontrado.'], 404);
        }

        if (!$this->canEditExisting($existing, $user)) {
            return Response::json(['error' => 'Apenas quem criou o projeto pode editar.'], 403);
        }

        $payload = $this->validatePayload($request, false);
        if (isset($payload['error'])) {
            return Response::json(['error' => $payload['error']], 422);
        }

        $project = $this->projects->update($id, $payload['data'], (int) $user['id']);
        if ($project === null) {
            return Response::json(['error' => 'Projeto riscado nao encontrado.'], 404);
        }

        return Response::json(['data' => $this->withPermissions($project, $user)]);
    }

    public function destroy(Request $request): Response
    {
        $user = $this->currentUser($request);
        if ($user === null) {
            return Response::json(['error' => 'Usuario nao encontrado.'], 404);
        }

        $id = (int) ($request->param('id') ?? 0);
        $existing = $this->projects->findRawById($id);
        if ($existing === null) {
            return Response::json(['error' => 'Projeto riscado nao encontrado.'], 404);
        }

        if (!$this->canDeleteExisting($existing, $user)) {
            return Response::json(['error' => 'Apenas quem criou o projeto ou um administrador pode excluir.'], 403);
        }

        $this->projects->delete($id);

        return Response::json(['ok' => true]);
    }

    /**
     * @return array{error:string}|array{data:array}
     */
    private function validatePayload(Request $request, bool $requireMeta): array
    {
        $nome = trim((string) $request->input('nome', ''));
        $modeloKey = trim((string) $request->input('modelo_key', ''));
        $modeloNome = trim((string) $request->input('modelo_nome', ''));
        $altura = (float) $request->input('altura_cm', 0);
        $gomos = (int) $request->input('quantidade_gomos', 0);
        $bainha = (float) $request->input('bainha_cm', 0);
        $state = $request->input('state', null);

        if ($requireMeta) {
            if ($nome === '') {
                return ['error' => 'Informe o nome do projeto.'];
            }
            if ($altura <= 0) {
                return ['error' => 'Altura invalida.'];
            }
            if ($gomos < 3) {
                return ['error' => 'Quantidade de gomos invalida.'];
            }
        }

        if ($nome !== '' && mb_strlen($nome) > 180) {
            return ['error' => 'Nome muito longo (max 180).'];
        }

        if (!is_array($state)) {
            return ['error' => 'Estado do projeto (state) invalido.'];
        }

        $encoded = json_encode($state, JSON_UNESCAPED_UNICODE);
        if ($encoded === false || strlen($encoded) > self::MAX_STATE_JSON_BYTES) {
            return ['error' => 'Estado do projeto muito grande (limite ~12MB). Remova imagens pesadas e tente de novo.'];
        }

        $data = [
            'state' => $state,
        ];

        if ($nome !== '' || $requireMeta) {
            $data['nome'] = $nome !== '' ? $nome : 'Projeto riscado';
        }
        if ($modeloKey !== '' || $requireMeta) {
            $data['modelo_key'] = $modeloKey;
        }
        if ($modeloNome !== '' || $requireMeta) {
            $data['modelo_nome'] = $modeloNome !== '' ? $modeloNome : $modeloKey;
        }
        if ($altura > 0 || $requireMeta) {
            $data['altura_cm'] = $altura > 0 ? $altura : 300.0;
        }
        if ($gomos > 0 || $requireMeta) {
            $data['quantidade_gomos'] = $gomos > 0 ? $gomos : 16;
        }
        if (array_key_exists('bainha_cm', $request->body) || $requireMeta) {
            $data['bainha_cm'] = max(0.0, $bainha);
        }

        return ['data' => $data];
    }

    private function withPermissions(array $project, array $user): array
    {
        $ownerId = (int) ($project['created_by']['id'] ?? 0);
        $isOwner = $ownerId === (int) $user['id'];
        $isAdmin = ($user['role'] ?? '') === 'admin';

        $project['can_edit'] = $isOwner || $isAdmin;
        $project['can_delete'] = $isOwner || $isAdmin;

        return $project;
    }

    private function canEditExisting(array $raw, array $user): bool
    {
        if (($user['role'] ?? '') === 'admin') {
            return true;
        }

        return (int) ($raw['created_by'] ?? 0) === (int) $user['id'];
    }

    private function canDeleteExisting(array $raw, array $user): bool
    {
        return $this->canEditExisting($raw, $user);
    }

    private function currentUser(Request $request): ?array
    {
        $userId = (int) ($request->attribute('user_id') ?? 0);
        if ($userId <= 0) {
            return null;
        }

        return $this->users->findById($userId);
    }
}
