<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api;

use App\Core\Request;
use App\Core\Response;
use App\Services\PlanoService;
use PDOException;

final class PlanoController
{
    private PlanoService $planos;

    public function __construct()
    {
        $this->planos = new PlanoService();
    }

    public function index(Request $request): Response
    {
        return Response::json(['data' => $this->planos->listAll(true)]);
    }

    public function store(Request $request): Response
    {
        $validated = $this->validatePayload($request);
        if (isset($validated['errors'])) {
            return Response::json(['errors' => $validated['errors'], 'error' => 'Verifique os campos do plano.'], 422);
        }

        $userId = (int) $request->attribute('user_id', 0);
        $plano = $this->planos->create($validated['data'], $userId);

        return Response::json(['data' => $plano], 201);
    }

    public function update(Request $request): Response
    {
        $id = (int) ($request->param('id') ?? 0);
        if ($this->planos->findRawById($id) === null) {
            return Response::json(['error' => 'Plano nao encontrado.'], 404);
        }

        $validated = $this->validatePayload($request);
        if (isset($validated['errors'])) {
            return Response::json(['errors' => $validated['errors'], 'error' => 'Verifique os campos do plano.'], 422);
        }

        $userId = (int) $request->attribute('user_id', 0);
        $plano = $this->planos->update($id, $validated['data'], $userId);

        return Response::json(['data' => $plano]);
    }

    public function setAtivo(Request $request): Response
    {
        $id = (int) ($request->param('id') ?? 0);
        if ($this->planos->findRawById($id) === null) {
            return Response::json(['error' => 'Plano nao encontrado.'], 404);
        }

        $ativo = (bool) $request->input('ativo', false);
        $userId = (int) $request->attribute('user_id', 0);
        $plano = $this->planos->setAtivo($id, $ativo, $userId);

        return Response::json(['data' => $plano]);
    }

    public function destroy(Request $request): Response
    {
        $id = (int) ($request->param('id') ?? 0);
        if ($this->planos->findRawById($id) === null) {
            return Response::json(['error' => 'Plano nao encontrado.'], 404);
        }

        try {
            $this->planos->delete($id);
        } catch (PDOException) {
            return Response::json([
                'error' => 'Esse plano ja tem pagamentos registrados e nao pode ser excluido. Desative-o em vez disso.',
            ], 422);
        }

        return Response::json(['ok' => true]);
    }

    /**
     * @return array{errors?: array<string,string>, data?: array{nome:string, valor:float, dias_acesso:int, abas:array<int,string>|null, show_in_ranking:bool, sales_override_count:int}}
     */
    private function validatePayload(Request $request): array
    {
        $nome = trim((string) $request->input('nome', ''));
        $valor = $request->input('valor');
        $diasAcesso = $request->input('dias_acesso');
        // Igual nome/valor/dias_acesso: essa API nao faz update parcial, o
        // form sempre reenvia o estado completo do checklist. Ausente ou
        // null = "todas as abas" (mesmo default de um plano recem-criado).
        $abasInput = $request->input('abas');
        $showInRanking = (bool) $request->input('show_in_ranking', false);
        $salesOverrideCount = (int) $request->input('sales_override_count', 0);

        $errors = [];

        if ($nome === '') {
            $errors['nome'] = 'Informe o nome do plano.';
        } elseif (mb_strlen($nome) > 120) {
            $errors['nome'] = 'O nome do plano e muito longo.';
        }

        if (!is_numeric($valor) || (float) $valor < 0) {
            $errors['valor'] = 'Informe um valor valido.';
        }

        if (!is_numeric($diasAcesso) || (int) $diasAcesso < 1 || (int) $diasAcesso > 3650) {
            $errors['dias_acesso'] = 'Informe uma quantidade de dias entre 1 e 3650.';
        }

        $abas = null;
        if ($abasInput !== null) {
            if (!is_array($abasInput) || array_filter($abasInput, static fn ($v) => !is_string($v)) !== []) {
                $errors['abas'] = 'Lista de abas invalida.';
            } else {
                $validas = array_values(array_intersect($abasInput, PlanoService::ALL_ABAS));
                // Marcou todas as abas conhecidas = mesma coisa que "sem restricao"
                // (null) -- fica pronto pra novas abas que vierem a existir depois
                // sem precisar editar o plano de novo.
                $abas = count($validas) === count(PlanoService::ALL_ABAS) ? null : $validas;
            }
        }

        if ($errors !== []) {
            return ['errors' => $errors];
        }

        return [
            'data' => [
                'nome' => $nome,
                'valor' => round((float) $valor, 2),
                'dias_acesso' => (int) $diasAcesso,
                'abas' => $abas,
                'show_in_ranking' => $showInRanking,
                'sales_override_count' => $salesOverrideCount,
            ],
        ];
    }
}
