<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api;

use App\Core\Request;
use App\Core\Response;
use App\Services\CupomService;
use App\Services\PlanoService;
use Throwable;

final class CupomController
{
    private CupomService $cupons;

    public function __construct()
    {
        $this->cupons = new CupomService();
    }

    /** Lista todos os cupons (admin). */
    public function index(Request $request): Response
    {
        $data = array_map(fn (array $c) => $this->cupons->toPublicArray($c), $this->cupons->listAll());
        return Response::json(['data' => $data]);
    }

    public function store(Request $request): Response
    {
        $payload = $this->validatePayload($request);
        if ($payload instanceof Response) {
            return $payload;
        }

        if ($this->cupons->findByCodigo($payload['codigo']) !== null) {
            return Response::json(['errors' => ['codigo' => 'Já existe um cupom com esse código.']], 422);
        }

        try {
            $cupom = $this->cupons->create($payload);
        } catch (Throwable $e) {
            return Response::json(['error' => 'Não foi possível criar o cupom.'], 500);
        }

        return Response::json(['data' => $cupom], 201);
    }

    public function update(Request $request): Response
    {
        $id = (int) ($request->param('id') ?? 0);
        if ($this->cupons->findRawById($id) === null) {
            return Response::json(['error' => 'Cupom não encontrado.'], 404);
        }

        $payload = $this->validatePayload($request);
        if ($payload instanceof Response) {
            return $payload;
        }

        $existing = $this->cupons->findByCodigo($payload['codigo']);
        if ($existing !== null && (int) $existing['id'] !== $id) {
            return Response::json(['errors' => ['codigo' => 'Já existe um cupom com esse código.']], 422);
        }

        return Response::json(['data' => $this->cupons->update($id, $payload)]);
    }

    public function destroy(Request $request): Response
    {
        $id = (int) ($request->param('id') ?? 0);
        if ($this->cupons->findRawById($id) === null) {
            return Response::json(['error' => 'Cupom não encontrado.'], 404);
        }
        $this->cupons->delete($id);
        return Response::json(['ok' => true]);
    }

    /** Marca este cupom como o da campanha diária (desmarca os outros). */
    public function setCampanha(Request $request): Response
    {
        $id = (int) ($request->param('id') ?? 0);
        if ($this->cupons->findRawById($id) === null) {
            return Response::json(['error' => 'Cupom não encontrado.'], 404);
        }
        $this->cupons->setCampanha($id);
        return Response::json(['ok' => true]);
    }

    /**
     * Preview do desconto pro cliente (antes de pagar): valida o cupom pro plano
     * escolhido e devolve o valor com desconto. Rota de usuario autenticado.
     */
    public function validar(Request $request): Response
    {
        $userId = (int) $request->attribute('user_id', 0);
        $codigo = trim((string) $request->input('codigo', ''));
        $planoId = (int) ($request->input('plano_id') ?? 0);

        if ($codigo === '') {
            return Response::json(['error' => 'Informe o código do cupom.'], 422);
        }

        $plano = $planoId > 0 ? (new PlanoService())->findRawById($planoId) : null;
        if ($plano === null || ((int) $plano['ativo']) !== 1) {
            return Response::json(['error' => 'Plano inválido.'], 422);
        }

        $result = $this->cupons->validateForUser($codigo, $userId, $planoId, (float) $plano['valor']);
        if (!$result['ok']) {
            return Response::json(['error' => $result['error']], 422);
        }

        return Response::json([
            'data' => [
                'codigo' => CupomService::normalizeCodigo($codigo),
                'percentual' => $result['percentual'],
                'desconto' => $result['desconto'],
                'valor_original' => (float) $plano['valor'],
                'valor_final' => $result['valor_final'],
            ],
        ]);
    }

    /**
     * @return array{codigo:string, nome:string, percentual:float, valido_ate:?string, ativo:bool,
     *   planos:array<int,array{plano_id:int, percentual:float}>}|Response
     */
    private function validatePayload(Request $request): array|Response
    {
        $codigo = CupomService::normalizeCodigo((string) $request->input('codigo', ''));
        $nome = trim((string) $request->input('nome', ''));
        $percentual = (float) $request->input('percentual', 0);
        $validoAte = trim((string) $request->input('valido_ate', ''));
        $ativo = $request->input('ativo');
        $ativo = $ativo === null ? true : (bool) $ativo;
        // Limite total de usos (estoque). Vazio/0 = ilimitado.
        $maxUsosRaw = $request->input('max_usos');
        $maxUsos = ($maxUsosRaw === null || $maxUsosRaw === '' || (int) $maxUsosRaw <= 0) ? null : (int) $maxUsosRaw;

        // Regras por plano (opcional). Formato: [{plano_id, percentual}, ...].
        // Vazio = cupom vale pra todos os planos usando `percentual`.
        $planosRaw = $request->input('planos');
        $planos = [];
        if (is_array($planosRaw)) {
            foreach ($planosRaw as $p) {
                if (!is_array($p)) {
                    continue;
                }
                $pid = (int) ($p['plano_id'] ?? 0);
                $perc = (float) ($p['percentual'] ?? 0);
                if ($pid > 0 && $perc >= 1 && $perc <= 95) {
                    $planos[] = ['plano_id' => $pid, 'percentual' => $perc];
                }
            }
        }

        $errors = [];
        if ($codigo === '' || !preg_match('/^[A-Z0-9\-]{3,40}$/', $codigo)) {
            $errors['codigo'] = 'Código: 3 a 40 caracteres (letras, números ou hífen).';
        }
        if (mb_strlen($nome) < 2) {
            $errors['nome'] = 'Informe um nome para o cupom.';
        }
        // `percentual` e o valor padrao (usado quando vale pra todos os planos).
        if ($percentual < 1 || $percentual > 95) {
            $errors['percentual'] = 'O desconto deve ser entre 1% e 95%.';
        }
        if ($validoAte !== '' && !preg_match('/^\d{4}-\d{2}-\d{2}$/', $validoAte)) {
            $errors['valido_ate'] = 'Data de validade inválida.';
        }
        // Se marcou "planos específicos" mas nao selecionou nenhum valido.
        if (is_array($planosRaw) && $planosRaw !== [] && $planos === []) {
            $errors['planos'] = 'Selecione ao menos um plano com desconto válido (1% a 95%).';
        }

        if ($errors !== []) {
            return Response::json(['errors' => $errors, 'error' => 'Verifique os campos.'], 422);
        }

        return [
            'codigo' => $codigo,
            'nome' => $nome,
            'percentual' => $percentual,
            'valido_ate' => $validoAte,
            'ativo' => $ativo,
            'max_usos' => $maxUsos,
            'planos' => $planos,
        ];
    }
}
