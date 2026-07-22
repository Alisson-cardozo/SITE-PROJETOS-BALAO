<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api;

use App\Core\Request;
use App\Core\Response;
use App\Services\Modelo3DService;
use App\Services\UserService;

final class Modelo3DController
{
    private Modelo3DService $modelos;
    private UserService $users;

    public function __construct()
    {
        $this->modelos = new Modelo3DService();
        $this->users = new UserService();
    }

    public function index(Request $request): Response
    {
        $user = $this->currentUser($request);
        if ($user === null) {
            return Response::json(['error' => 'Usuario nao encontrado.'], 404);
        }

        $isAdmin = $user['role'] === 'admin';
        $items = $this->modelos->listAll($isAdmin);
        $data = array_map(fn (array $modelo) => $this->withPermissions($modelo, $user), $items);

        return Response::json(['data' => $data]);
    }

    public function store(Request $request): Response
    {
        $user = $this->currentUser($request);
        if ($user === null) {
            return Response::json(['error' => 'Usuario nao encontrado.'], 404);
        }

        $validated = $this->validatePayload($request);
        if (isset($validated['errors'])) {
            return Response::json(['errors' => $validated['errors'], 'error' => 'Verifique os campos do modelo.'], 422);
        }

        $modelo = $this->modelos->create($validated['data'], (int) $user['id']);

        return Response::json(['data' => $modelo], 201);
    }

    public function update(Request $request): Response
    {
        $user = $this->currentUser($request);
        if ($user === null) {
            return Response::json(['error' => 'Usuario nao encontrado.'], 404);
        }

        $id = (int) ($request->param('id') ?? 0);
        $existing = $this->modelos->findRawById($id);
        if ($existing === null) {
            return Response::json(['error' => 'Modelo nao encontrado.'], 404);
        }

        $isOwner = (int) $existing['created_by'] === (int) $user['id'];
        $isAdmin = $user['role'] === 'admin';
        if (!$isOwner && !$isAdmin) {
            return Response::json(['error' => 'Apenas quem criou o modelo ou um administrador pode editar.'], 403);
        }

        $nome = trim((string) $request->input('nome', ''));
        if ($nome === '') {
            return Response::json(['errors' => ['nome' => 'Informe o nome do modelo.'], 'error' => 'Verifique os campos do modelo.'], 422);
        }
        if (mb_strlen($nome) > 180) {
            return Response::json(['errors' => ['nome' => 'O nome do modelo e muito longo.'], 'error' => 'Verifique os campos do modelo.'], 422);
        }

        $modelo = $this->modelos->renomear($id, $nome, (int) $user['id']);

        return Response::json(['data' => $this->withPermissions($modelo ?? [], $user)]);
    }

    public function setHidden(Request $request): Response
    {
        $user = $this->currentUser($request);
        if ($user === null) {
            return Response::json(['error' => 'Usuario nao encontrado.'], 404);
        }

        $id = (int) ($request->param('id') ?? 0);
        $existing = $this->modelos->findRawById($id);
        if ($existing === null) {
            return Response::json(['error' => 'Modelo nao encontrado.'], 404);
        }

        $isOwner = (int) $existing['created_by'] === (int) $user['id'];
        $isAdmin = $user['role'] === 'admin';
        if (!$isOwner && !$isAdmin) {
            return Response::json(['error' => 'Apenas quem criou o modelo ou um administrador pode ocultar.'], 403);
        }

        $hidden = (bool) $request->input('hidden', false);
        $modelo = $this->modelos->setHidden($id, $hidden, (int) $user['id']);

        return Response::json(['data' => $this->withPermissions($modelo ?? [], $user)]);
    }

    public function destroy(Request $request): Response
    {
        $user = $this->currentUser($request);
        if ($user === null) {
            return Response::json(['error' => 'Usuario nao encontrado.'], 404);
        }

        $id = (int) ($request->param('id') ?? 0);
        $existing = $this->modelos->findRawById($id);
        if ($existing === null) {
            return Response::json(['error' => 'Modelo nao encontrado.'], 404);
        }

        $isOwner = (int) $existing['created_by'] === (int) $user['id'];
        $isAdmin = $user['role'] === 'admin';
        if (!$isOwner && !$isAdmin) {
            return Response::json(['error' => 'Apenas quem criou o modelo ou um administrador pode excluir.'], 403);
        }

        $this->modelos->delete($id);

        return Response::json(['ok' => true]);
    }

    private function currentUser(Request $request): ?array
    {
        $userId = (int) $request->attribute('user_id', 0);
        if ($userId <= 0) {
            return null;
        }

        return $this->users->findById($userId);
    }

    /**
     * @param array<string, mixed> $modelo
     * @param array<string, mixed> $user
     * @return array<string, mixed>
     */
    private function withPermissions(array $modelo, array $user): array
    {
        $userId = (int) $user['id'];
        $isAdmin = $user['role'] === 'admin';
        $ownerId = (int) ($modelo['created_by']['id'] ?? 0);
        $isOwner = $ownerId === $userId;

        $modelo['can_edit'] = $isOwner || $isAdmin;
        $modelo['can_delete'] = $isOwner || $isAdmin;

        return $modelo;
    }

    /**
     * @return array{errors?: array<string,string>, data?: array{nome:string,quantidade_gomos:int,pontos:array<int,array{altura_cm:float,largura_meia_cm:float}>}}
     */
    private function validatePayload(Request $request): array
    {
        $nome = trim((string) $request->input('nome', ''));
        $quantidadeGomos = $request->input('quantidade_gomos');
        $pontosRaw = $request->input('pontos', []);

        $errors = [];

        if ($nome === '' || mb_strlen($nome) < 1) {
            $errors['nome'] = 'Informe o nome do modelo.';
        } elseif (mb_strlen($nome) > 180) {
            $errors['nome'] = 'O nome do modelo e muito longo.';
        }

        if (!is_numeric($quantidadeGomos) || (int) $quantidadeGomos < 1) {
            $errors['quantidade_gomos'] = 'Informe a quantidade de gomos.';
        }

        if (!is_array($pontosRaw) || count($pontosRaw) < 2) {
            $errors['pontos'] = 'Informe pelo menos 2 pontos do modelo.';
        }

        $pontos = [];
        if (is_array($pontosRaw) && !isset($errors['pontos'])) {
            foreach ($pontosRaw as $ponto) {
                if (!is_array($ponto)) {
                    $errors['pontos'] = 'Formato de pontos invalido.';
                    break;
                }

                $altura = $ponto['altura_cm'] ?? null;
                $largura = $ponto['largura_meia_cm'] ?? null;
                if (!is_numeric($altura) || !is_numeric($largura)) {
                    $errors['pontos'] = 'Todos os pontos precisam de altura e largura/2 numericos.';
                    break;
                }

                $pontos[] = [
                    'altura_cm' => round((float) $altura, 3),
                    'largura_meia_cm' => round((float) $largura, 3),
                ];
            }
        }

        if ($errors !== []) {
            return ['errors' => $errors];
        }

        return [
            'data' => [
                'nome' => $nome,
                'quantidade_gomos' => (int) $quantidadeGomos,
                'pontos' => $pontos,
            ],
        ];
    }
}
