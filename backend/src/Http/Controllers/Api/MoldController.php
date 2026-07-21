<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api;

use App\Core\Request;
use App\Core\Response;
use App\Services\MoldService;
use App\Services\UserService;

final class MoldController
{
    private MoldService $molds;
    private UserService $users;

    public function __construct()
    {
        $this->molds = new MoldService();
        $this->users = new UserService();
    }

    public function index(Request $request): Response
    {
        $user = $this->currentUser($request);
        if ($user === null) {
            return Response::json(['error' => 'Usuario nao encontrado.'], 404);
        }

        $items = $this->molds->listAll();
        $data = array_map(fn (array $mold) => $this->withPermissions($mold, $user), $items);

        return Response::json(['data' => $data]);
    }

    public function show(Request $request): Response
    {
        $user = $this->currentUser($request);
        if ($user === null) {
            return Response::json(['error' => 'Usuario nao encontrado.'], 404);
        }

        $id = (int) ($request->param('id') ?? 0);
        $mold = $this->molds->findById($id);
        if ($mold === null) {
            return Response::json(['error' => 'Molde nao encontrado.'], 404);
        }

        return Response::json(['data' => $this->withPermissions($mold, $user)]);
    }

    public function store(Request $request): Response
    {
        $user = $this->currentUser($request);
        if ($user === null) {
            return Response::json(['error' => 'Usuario nao encontrado.'], 404);
        }

        $validated = $this->validatePayload($request);
        if (isset($validated['errors'])) {
            return Response::json(['errors' => $validated['errors'], 'error' => 'Verifique os campos do molde.'], 422);
        }

        $mold = $this->molds->create($validated['data'], (int) $user['id']);

        return Response::json(['data' => $this->withPermissions($mold, $user)], 201);
    }

    public function update(Request $request): Response
    {
        $user = $this->currentUser($request);
        if ($user === null) {
            return Response::json(['error' => 'Usuario nao encontrado.'], 404);
        }

        $id = (int) ($request->param('id') ?? 0);
        $existing = $this->molds->findRawById($id);
        if ($existing === null) {
            return Response::json(['error' => 'Molde nao encontrado.'], 404);
        }

        if (!$this->canEditExisting($existing, $user)) {
            return Response::json([
                'error' => 'Apenas quem criou o molde pode editar. Outros usuarios podem criar uma copia.',
            ], 403);
        }

        $validated = $this->validatePayload($request);
        if (isset($validated['errors'])) {
            return Response::json(['errors' => $validated['errors'], 'error' => 'Verifique os campos do molde.'], 422);
        }

        $mold = $this->molds->update($id, $validated['data'], (int) $user['id']);
        if ($mold === null) {
            return Response::json(['error' => 'Molde nao encontrado.'], 404);
        }

        return Response::json(['data' => $this->withPermissions($mold, $user)]);
    }

    public function copy(Request $request): Response
    {
        $user = $this->currentUser($request);
        if ($user === null) {
            return Response::json(['error' => 'Usuario nao encontrado.'], 404);
        }

        $id = (int) ($request->param('id') ?? 0);
        $existing = $this->molds->findRawById($id);
        if ($existing === null) {
            return Response::json(['error' => 'Molde nao encontrado.'], 404);
        }

        // Dono ja pode editar o original; copia e para os demais usarem sem alterar o original.
        if ((int) $existing['created_by'] === (int) $user['id']) {
            return Response::json([
                'error' => 'Este molde ja e seu. Use Modificar para editar o original.',
            ], 422);
        }

        $mold = $this->molds->copy($id, (int) $user['id']);
        if ($mold === null) {
            return Response::json(['error' => 'Molde nao encontrado.'], 404);
        }

        return Response::json(['data' => $this->withPermissions($mold, $user)], 201);
    }

    public function destroy(Request $request): Response
    {
        $user = $this->currentUser($request);
        if ($user === null) {
            return Response::json(['error' => 'Usuario nao encontrado.'], 404);
        }

        $id = (int) ($request->param('id') ?? 0);
        $existing = $this->molds->findRawById($id);
        if ($existing === null) {
            return Response::json(['error' => 'Molde nao encontrado.'], 404);
        }

        if (!$this->canDeleteExisting($existing, $user)) {
            return Response::json(['error' => 'Apenas quem criou o molde ou um administrador pode excluir.'], 403);
        }

        $this->molds->delete($id);

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

    private function canEditExisting(array $existing, array $user): bool
    {
        $isOwner = (int) $existing['created_by'] === (int) $user['id'];
        $isAdmin = $user['role'] === 'admin';

        return $isOwner || $isAdmin;
    }

    private function canDeleteExisting(array $existing, array $user): bool
    {
        return $this->canEditExisting($existing, $user);
    }

    /**
     * @param array<string, mixed> $mold
     * @param array<string, mixed> $user
     * @return array<string, mixed>
     */
    private function withPermissions(array $mold, array $user): array
    {
        $userId = (int) $user['id'];
        $isAdmin = $user['role'] === 'admin';
        $ownerId = (int) ($mold['created_by']['id'] ?? 0);
        $isOwner = $ownerId === $userId;

        $mold['can_edit'] = $isOwner || $isAdmin;
        $mold['can_delete'] = $isOwner || $isAdmin;
        $mold['can_copy'] = !$isOwner;

        return $mold;
    }

    /**
     * @return array{errors?: array<string,string>, data?: array{nome:string,modelo:string,quantidade_gomos:int,bainha_cm:float,pontos:array<int,array{altura_cm:float,largura_meia_cm:float}>}}
     */
    private function validatePayload(Request $request): array
    {
        $nome = trim((string) $request->input('nome', ''));
        $modelo = trim((string) $request->input('modelo', ''));
        $quantidadeGomos = $request->input('quantidade_gomos');
        $bainhaCm = $request->input('bainha_cm');
        $pontosRaw = $request->input('pontos', []);

        $errors = [];

        if ($nome === '' || mb_strlen($nome) < 1) {
            $errors['nome'] = 'Informe o nome do molde.';
        } elseif (mb_strlen($nome) > 180) {
            $errors['nome'] = 'O nome do molde e muito longo.';
        }

        if ($modelo === '') {
            $errors['modelo'] = 'Informe o modelo do molde.';
        } elseif (mb_strlen($modelo) > 80) {
            $errors['modelo'] = 'O modelo e muito longo.';
        }

        if (!is_numeric($quantidadeGomos) || (int) $quantidadeGomos < 1) {
            $errors['quantidade_gomos'] = 'Informe a quantidade de gomos.';
        }

        if (!is_numeric($bainhaCm) || (float) $bainhaCm < 0) {
            $errors['bainha_cm'] = 'Informe o tamanho da bainha.';
        }

        if (!is_array($pontosRaw) || count($pontosRaw) < 2) {
            $errors['pontos'] = 'Informe pelo menos 2 pontos do molde.';
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
                'modelo' => $modelo,
                'quantidade_gomos' => (int) $quantidadeGomos,
                'bainha_cm' => round((float) $bainhaCm, 2),
                'pontos' => $pontos,
            ],
        ];
    }
}
