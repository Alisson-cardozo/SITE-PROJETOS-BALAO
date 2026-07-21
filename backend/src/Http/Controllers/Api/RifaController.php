<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api;

use App\Core\Request;
use App\Core\Response;
use App\Services\RifaCompradorService;
use App\Services\RifaNumeroService;
use App\Services\RifaPromocaoService;
use App\Services\RifaReservaService;
use App\Services\RifaService;
use App\Services\UserService;
use App\Support\Db;

final class RifaController
{
    private const MAX_FOTO_BYTES = 5 * 1024 * 1024;
    private const ALLOWED_MIME = ['image/jpeg' => 'jpg', 'image/png' => 'png', 'image/webp' => 'webp'];

    private RifaService $rifas;
    private RifaCompradorService $compradores;
    private RifaReservaService $reservas;
    private RifaPromocaoService $promocoes;
    private UserService $users;

    public function __construct()
    {
        $this->rifas = new RifaService();
        $this->compradores = new RifaCompradorService();
        $this->reservas = new RifaReservaService();
        $this->promocoes = new RifaPromocaoService();
        $this->users = new UserService();
    }

    public function index(Request $request): Response
    {
        $user = $this->currentUser($request);
        if ($user === null) {
            return Response::json(['error' => 'Usuario nao encontrado.'], 404);
        }

        $rifas = array_map(
            function (array $rifa): array {
                $rifa['valor_arrecadado'] = $this->compradores->sumValorArrecadado((int) $rifa['id']);
                return $rifa;
            },
            $this->rifas->listAllForUser((int) $user['id'])
        );

        return Response::json(['data' => $rifas]);
    }

    public function show(Request $request): Response
    {
        $user = $this->currentUser($request);
        if ($user === null) {
            return Response::json(['error' => 'Usuario nao encontrado.'], 404);
        }

        $rifa = $this->authorizeOwner($request, $user);
        if ($rifa instanceof Response) {
            return $rifa;
        }

        $numeroService = new RifaNumeroService();
        $public = $this->rifas->findById((int) $rifa['id']);
        $public['valor_arrecadado'] = $this->compradores->sumValorArrecadado((int) $rifa['id']);
        $public['promocoes'] = $this->promocoes->listByRifa((int) $rifa['id']);
        $public = $this->attachVencedorWhatsapp($public, $numeroService);
        $public['compradores'] = array_map(
            function (array $comprador) use ($numeroService): array {
                $comprador['numeros'] = $numeroService->listarNumerosDoComprador((int) $comprador['id']);
                return $comprador;
            },
            $this->compradores->listByRifa((int) $rifa['id'])
        );

        return Response::json(['data' => $public]);
    }

    public function store(Request $request): Response
    {
        $user = $this->currentUser($request);
        if ($user === null) {
            return Response::json(['error' => 'Usuario nao encontrado.'], 404);
        }

        if ($this->rifas->countActiveForUser((int) $user['id']) >= RifaService::MAX_RIFAS_ATIVAS) {
            return Response::json([
                'error' => 'Voce ja tem ' . RifaService::MAX_RIFAS_ATIVAS . ' rifas ativas. Finalize ou cancele uma pra criar outra.',
            ], 422);
        }

        $validated = $this->validatePayload($request, requirePhotos: true);
        if (isset($validated['errors'])) {
            return Response::json(['errors' => $validated['errors'], 'error' => 'Verifique os campos da rifa.'], 422);
        }

        $photos = $this->handlePhotoUploads($this->newUploadDir(), optional: true);
        if (isset($photos['error'])) {
            return Response::json(['error' => $photos['error']], 422);
        }

        $data = $validated['data'];
        $data['foto1_path'] = $photos['paths'][0];
        $data['foto2_path'] = $photos['paths'][1];

        $rifa = $this->rifas->create($data, (int) $user['id']);

        return Response::json(['data' => $rifa], 201);
    }

    public function update(Request $request): Response
    {
        $user = $this->currentUser($request);
        if ($user === null) {
            return Response::json(['error' => 'Usuario nao encontrado.'], 404);
        }

        $existing = $this->authorizeOwner($request, $user);
        if ($existing instanceof Response) {
            return $existing;
        }

        // Edicao e sempre JSON puro (sem fotos) — PHP nao popula $_FILES/$_POST em
        // requisicoes PUT multipart, so em POST. Trocar as fotos depois de criada a
        // rifa nao foi pedido; se precisar no futuro, vira uma rota POST dedicada.
        $validated = $this->validatePayload($request, requirePhotos: false);
        if (isset($validated['errors'])) {
            return Response::json(['errors' => $validated['errors'], 'error' => 'Verifique os campos da rifa.'], 422);
        }

        $data = $validated['data'];

        $stmt = Db::connection()->prepare(
            'UPDATE rifas SET
              nome = :nome, descricao = :descricao,
              valor_numero = :valor_numero, modo_sorteio = :modo_sorteio, modo_termino = :modo_termino,
              data_termino = :data_termino, whatsapp_contato = :whatsapp_contato, chave_pix = :chave_pix,
              updated_by = :updated_by
             WHERE id = :id'
        );
        $stmt->execute([
            'id' => $existing['id'],
            'nome' => $data['nome'],
            'descricao' => $data['descricao'],
            'valor_numero' => $data['valor_numero'],
            'modo_sorteio' => $data['modo_sorteio'],
            'modo_termino' => $data['modo_termino'],
            'data_termino' => $data['data_termino'],
            'whatsapp_contato' => $data['whatsapp_contato'],
            'chave_pix' => $data['chave_pix'],
            'updated_by' => (int) $user['id'],
        ]);

        return Response::json(['data' => $this->rifas->findById((int) $existing['id'])]);
    }

    public function destroy(Request $request): Response
    {
        $user = $this->currentUser($request);
        if ($user === null) {
            return Response::json(['error' => 'Usuario nao encontrado.'], 404);
        }

        $existing = $this->authorizeOwner($request, $user);
        if ($existing instanceof Response) {
            return $existing;
        }

        $this->rifas->delete((int) $existing['id']);

        return Response::json(['ok' => true]);
    }

    public function confirmarPagamento(Request $request): Response
    {
        $user = $this->currentUser($request);
        if ($user === null) {
            return Response::json(['error' => 'Usuario nao encontrado.'], 404);
        }

        $rifa = $this->authorizeOwner($request, $user);
        if ($rifa instanceof Response) {
            return $rifa;
        }

        $compradorId = (int) ($request->param('compradorId') ?? 0);
        $comprador = $this->compradores->findById($compradorId);
        if ($comprador === null || (int) $comprador['rifa_id'] !== (int) $rifa['id']) {
            return Response::json(['error' => 'Comprador nao encontrado nessa rifa.'], 404);
        }

        $updated = $this->reservas->confirmarPagamentoManual($compradorId);
        if ($updated === null) {
            return Response::json(['error' => 'Esse comprador nao esta aguardando pagamento.'], 422);
        }

        return Response::json(['data' => $updated]);
    }

    /** Pagamento nao confirmado — libera os numeros de volta pra disponivel. */
    public function recusarPagamento(Request $request): Response
    {
        $user = $this->currentUser($request);
        if ($user === null) {
            return Response::json(['error' => 'Usuario nao encontrado.'], 404);
        }

        $rifa = $this->authorizeOwner($request, $user);
        if ($rifa instanceof Response) {
            return $rifa;
        }

        $compradorId = (int) ($request->param('compradorId') ?? 0);
        $comprador = $this->compradores->findById($compradorId);
        if ($comprador === null || (int) $comprador['rifa_id'] !== (int) $rifa['id']) {
            return Response::json(['error' => 'Comprador nao encontrado nessa rifa.'], 404);
        }
        if ($comprador['status'] !== 'aguardando_pagamento') {
            return Response::json(['error' => 'Esse comprador nao esta aguardando pagamento.'], 422);
        }

        $this->reservas->cancelarReserva($compradorId);

        return Response::json(['data' => $this->compradores->findById($compradorId)]);
    }

    public function criarVendaManual(Request $request): Response
    {
        $user = $this->currentUser($request);
        if ($user === null) {
            return Response::json(['error' => 'Usuario nao encontrado.'], 404);
        }

        $rifa = $this->authorizeOwner($request, $user);
        if ($rifa instanceof Response) {
            return $rifa;
        }

        $nome = trim((string) $request->input('nome', ''));
        $whatsapp = trim((string) $request->input('whatsapp', ''));
        $email = $request->input('email');
        $numerosRaw = $request->input('numeros', []);
        $jaPago = (bool) $request->input('ja_pago', true);

        $errors = [];
        if ($nome === '') {
            $errors['nome'] = 'Informe o nome do comprador.';
        }
        if ($whatsapp === '') {
            $errors['whatsapp'] = 'Informe o whatsapp do comprador.';
        }
        $numeros = is_array($numerosRaw) ? array_values(array_unique(array_map('intval', $numerosRaw))) : [];
        if ($numeros === []) {
            $errors['numeros'] = 'Escolha pelo menos 1 numero.';
        }

        if ($errors !== []) {
            return Response::json(['errors' => $errors, 'error' => 'Verifique os campos da venda.'], 422);
        }

        $comprador = $this->reservas->criarVendaManual(
            (int) $rifa['id'],
            $numeros,
            $nome,
            $whatsapp,
            $email !== null && $email !== '' ? (string) $email : null,
            (float) $rifa['valor_numero'],
            $jaPago
        );

        if ($comprador === null) {
            return Response::json(['error' => 'Um ou mais numeros escolhidos ja nao estao mais disponiveis.'], 422);
        }

        return Response::json(['data' => $comprador], 201);
    }

    public function sortear(Request $request): Response
    {
        $user = $this->currentUser($request);
        if ($user === null) {
            return Response::json(['error' => 'Usuario nao encontrado.'], 404);
        }

        $rifa = $this->authorizeOwner($request, $user);
        if ($rifa instanceof Response) {
            return $rifa;
        }

        if ($rifa['modo_sorteio'] !== 'sistema') {
            return Response::json(['error' => 'Essa rifa nao usa sorteio pelo sistema.'], 422);
        }
        if ($rifa['numero_sorteado'] !== null) {
            return Response::json(['error' => 'Essa rifa ja tem um numero sorteado.'], 422);
        }

        $numeroSorteado = (new RifaNumeroService())->sortearVendido((int) $rifa['id']);
        if ($numeroSorteado === null) {
            return Response::json(['error' => 'Nenhum numero vendido ainda — nao da pra sortear.'], 422);
        }

        $updated = $this->rifas->registrarSorteio((int) $rifa['id'], $numeroSorteado, (int) $user['id']);
        $updated = $this->attachVencedorWhatsapp($updated, new RifaNumeroService());

        return Response::json(['data' => $updated]);
    }

    /**
     * O whatsapp do vencedor so faz sentido pro DONO (pra ele chamar o cliente
     * depois do sorteio) — nunca vai pro endpoint publico, so pra nome mesmo
     * (RifaService::toPublicArray, que e compartilhado com a rota publica).
     */
    private function attachVencedorWhatsapp(array $rifa, RifaNumeroService $numeroService): array
    {
        $rifa['vencedor_whatsapp'] = null;
        if ($rifa['numero_sorteado'] === null) {
            return $rifa;
        }

        $compradorId = $numeroService->findCompradorIdPorNumero((int) $rifa['id'], (int) $rifa['numero_sorteado']);
        if ($compradorId === null) {
            return $rifa;
        }

        $comprador = $this->compradores->findById($compradorId);
        $rifa['vencedor_whatsapp'] = $comprador !== null ? $comprador['whatsapp'] : null;

        return $rifa;
    }

    public function listPromocoes(Request $request): Response
    {
        $user = $this->currentUser($request);
        if ($user === null) {
            return Response::json(['error' => 'Usuario nao encontrado.'], 404);
        }

        $rifa = $this->authorizeOwner($request, $user);
        if ($rifa instanceof Response) {
            return $rifa;
        }

        return Response::json(['data' => $this->promocoes->listByRifa((int) $rifa['id'])]);
    }

    public function createPromocao(Request $request): Response
    {
        $user = $this->currentUser($request);
        if ($user === null) {
            return Response::json(['error' => 'Usuario nao encontrado.'], 404);
        }

        $rifa = $this->authorizeOwner($request, $user);
        if ($rifa instanceof Response) {
            return $rifa;
        }

        $validated = $this->validatePromocaoPayload($request, $rifa);
        if (isset($validated['errors'])) {
            return Response::json(['errors' => $validated['errors'], 'error' => 'Verifique os campos da promocao.'], 422);
        }

        $promocao = $this->promocoes->create((int) $rifa['id'], $validated['data']);

        return Response::json(['data' => $promocao], 201);
    }

    public function updatePromocao(Request $request): Response
    {
        $user = $this->currentUser($request);
        if ($user === null) {
            return Response::json(['error' => 'Usuario nao encontrado.'], 404);
        }

        $rifa = $this->authorizeOwner($request, $user);
        if ($rifa instanceof Response) {
            return $rifa;
        }

        $promocaoId = (int) ($request->param('promocaoId') ?? 0);
        $existing = $this->promocoes->findRawById($promocaoId);
        if ($existing === null || (int) $existing['rifa_id'] !== (int) $rifa['id']) {
            return Response::json(['error' => 'Promocao nao encontrada nessa rifa.'], 404);
        }

        $validated = $this->validatePromocaoPayload($request, $rifa);
        if (isset($validated['errors'])) {
            return Response::json(['errors' => $validated['errors'], 'error' => 'Verifique os campos da promocao.'], 422);
        }

        $promocao = $this->promocoes->update($promocaoId, $validated['data']);

        return Response::json(['data' => $promocao]);
    }

    public function deletePromocao(Request $request): Response
    {
        $user = $this->currentUser($request);
        if ($user === null) {
            return Response::json(['error' => 'Usuario nao encontrado.'], 404);
        }

        $rifa = $this->authorizeOwner($request, $user);
        if ($rifa instanceof Response) {
            return $rifa;
        }

        $promocaoId = (int) ($request->param('promocaoId') ?? 0);
        $existing = $this->promocoes->findRawById($promocaoId);
        if ($existing === null || (int) $existing['rifa_id'] !== (int) $rifa['id']) {
            return Response::json(['error' => 'Promocao nao encontrada nessa rifa.'], 404);
        }

        $this->promocoes->delete($promocaoId);

        return Response::json(['ok' => true]);
    }

    /**
     * @return array{errors?: array<string,string>, data?: array{tipo:string, quantidade:int, valor_total:?float, valor_unidade:?float, ativo:bool}}
     */
    private function validatePromocaoPayload(Request $request, array $rifa): array
    {
        if ($rifa['modo_sorteio'] === 'caixa_federal') {
            return ['errors' => ['modo_sorteio' => 'Rifa por Loteria Federal nao usa promocoes de preco.']];
        }

        $tipo = (string) $request->input('tipo', '');
        $quantidade = $request->input('quantidade');
        $valorTotal = $request->input('valor_total');
        $valorUnidade = $request->input('valor_unidade');
        $ativo = $request->input('ativo', true);

        $errors = [];

        if (!in_array($tipo, ['pacote', 'faixa'], true)) {
            $errors['tipo'] = 'Escolha pacote (quantidade exata) ou faixa (a partir de X unidades).';
        }
        if (!is_numeric($quantidade) || (int) $quantidade < 1) {
            $errors['quantidade'] = 'Informe a quantidade.';
        }
        if ($tipo === 'pacote' && (!is_numeric($valorTotal) || (float) $valorTotal <= 0)) {
            $errors['valor_total'] = 'Informe o valor total do pacote.';
        }
        if ($tipo === 'faixa' && (!is_numeric($valorUnidade) || (float) $valorUnidade <= 0)) {
            $errors['valor_unidade'] = 'Informe o valor por numero da faixa.';
        }

        if ($errors !== []) {
            return ['errors' => $errors];
        }

        return [
            'data' => [
                'tipo' => $tipo,
                'quantidade' => (int) $quantidade,
                'valor_total' => $tipo === 'pacote' ? round((float) $valorTotal, 2) : null,
                'valor_unidade' => $tipo === 'faixa' ? round((float) $valorUnidade, 2) : null,
                'ativo' => (bool) $ativo,
            ],
        ];
    }

    private function currentUser(Request $request): ?array
    {
        $userId = (int) $request->attribute('user_id', 0);
        if ($userId <= 0) {
            return null;
        }

        return $this->users->findById($userId);
    }

    /** @return array<string,mixed>|Response linha crua da rifa, ou uma Response de erro pronta pra retornar */
    private function authorizeOwner(Request $request, array $user): array|Response
    {
        $id = (int) ($request->param('id') ?? 0);
        $rifa = $this->rifas->findRawById($id);
        if ($rifa === null) {
            return Response::json(['error' => 'Rifa nao encontrada.'], 404);
        }

        $isOwner = (int) $rifa['created_by'] === (int) $user['id'];
        $isAdmin = $user['role'] === 'admin';
        if (!$isOwner && !$isAdmin) {
            return Response::json(['error' => 'Voce nao tem acesso a essa rifa.'], 403);
        }

        return $rifa;
    }

    /**
     * @return array{errors?: array<string,string>, data?: array<string,mixed>}
     */
    private function validatePayload(Request $request, bool $requirePhotos): array
    {
        $nome = trim((string) $request->input('nome', ''));
        $descricao = trim((string) $request->input('descricao', ''));
        $valorNumero = $request->input('valor_numero');
        $quantidadeNumeros = $request->input('quantidade_numeros');
        $modoSorteio = (string) $request->input('modo_sorteio', '');
        $modoTermino = (string) $request->input('modo_termino', '');
        $dataTermino = $request->input('data_termino');
        $whatsappContato = $request->input('whatsapp_contato');
        $chavePix = $request->input('chave_pix');

        $errors = [];

        if ($nome === '') {
            $errors['nome'] = 'Informe o nome da rifa.';
        } elseif (mb_strlen($nome) > 180) {
            $errors['nome'] = 'O nome e muito longo.';
        }

        if ($descricao === '') {
            $errors['descricao'] = 'Informe a descricao da rifa.';
        }

        if (!is_numeric($valorNumero) || (float) $valorNumero <= 0) {
            $errors['valor_numero'] = 'Informe o valor de cada numero.';
        }

        // Loteria Federal foi retirada das opcoes — toda rifa (nova ou editada) e sorteio pelo sistema.
        if ($modoSorteio !== 'sistema') {
            $errors['modo_sorteio'] = 'Essa rifa so pode ser sorteio pelo sistema.';
        }

        if (!in_array($modoTermino, ['data', 'vender_tudo'], true)) {
            $errors['modo_termino'] = 'Escolha quando a rifa termina.';
        } elseif ($modoTermino === 'data' && (!is_string($dataTermino) || $dataTermino === '')) {
            $errors['data_termino'] = 'Informe a data de termino.';
        }

        if (!is_string($whatsappContato) || trim($whatsappContato) === '') {
            $errors['whatsapp_contato'] = 'Informe o whatsapp pra contato.';
        }
        if (!is_string($chavePix) || trim($chavePix) === '') {
            $errors['chave_pix'] = 'Informe sua chave Pix.';
        } elseif (mb_strlen(trim($chavePix)) > 140) {
            $errors['chave_pix'] = 'A chave Pix e muito longa.';
        }

        // quantidade de numeros so e definida na criacao — depois de criada a rifa ja tem
        // as linhas de numero geradas, mudar a quantidade quebraria vendas existentes.
        if ($requirePhotos) {
            if (!is_numeric($quantidadeNumeros) || (int) $quantidadeNumeros < 2) {
                $errors['quantidade_numeros'] = 'Informe a quantidade de numeros (minimo 2).';
            } elseif ((int) $quantidadeNumeros > 100000) {
                $errors['quantidade_numeros'] = 'Quantidade maxima de 100.000 numeros por rifa.';
            }
        }

        if ($errors !== []) {
            return ['errors' => $errors];
        }

        return [
            'data' => [
                'nome' => $nome,
                'descricao' => $descricao,
                'valor_numero' => round((float) $valorNumero, 2),
                'quantidade_numeros' => (int) $quantidadeNumeros,
                'modo_sorteio' => $modoSorteio,
                'modo_termino' => $modoTermino,
                'data_termino' => $modoTermino === 'data' ? (string) $dataTermino : null,
                'whatsapp_contato' => trim((string) $whatsappContato),
                'chave_pix' => trim((string) $chavePix),
            ],
        ];
    }

    /**
     * @return array{paths?: array<int, ?string>, error?: string}
     */
    private function handlePhotoUploads(string $uploadDir, bool $optional = false): array
    {
        $paths = [null, null];
        $anyProvided = false;

        for ($i = 0; $i < 2; $i++) {
            $field = 'foto' . ($i + 1);
            $file = $_FILES[$field] ?? null;

            if (!is_array($file) || ($file['error'] ?? UPLOAD_ERR_NO_FILE) === UPLOAD_ERR_NO_FILE) {
                continue;
            }

            $anyProvided = true;

            if ($file['error'] !== UPLOAD_ERR_OK) {
                return ['error' => "Falha no upload da $field."];
            }
            if ((int) $file['size'] > self::MAX_FOTO_BYTES) {
                return ['error' => "A $field precisa ter no maximo 5MB."];
            }

            $mime = mime_content_type((string) $file['tmp_name']);
            if ($mime === false || !isset(self::ALLOWED_MIME[$mime])) {
                return ['error' => "A $field precisa ser JPG, PNG ou WEBP."];
            }

            $ext = self::ALLOWED_MIME[$mime];
            $absoluteDir = __DIR__ . '/../../../../public/' . $uploadDir;
            if (!is_dir($absoluteDir) && !mkdir($absoluteDir, 0755, true) && !is_dir($absoluteDir)) {
                return ['error' => 'Nao foi possivel criar a pasta de upload.'];
            }

            $relativePath = $uploadDir . '/' . $field . '.' . $ext;
            $absolutePath = __DIR__ . '/../../../../public/' . $relativePath;
            if (!move_uploaded_file((string) $file['tmp_name'], $absolutePath)) {
                return ['error' => "Nao foi possivel salvar a $field."];
            }

            $paths[$i] = $relativePath;
        }

        if (!$optional && !$anyProvided) {
            return ['error' => 'Envie as 2 fotos da rifa.'];
        }
        if (!$optional && in_array(null, $paths, true)) {
            return ['error' => 'Envie as 2 fotos da rifa.'];
        }

        return ['paths' => $paths];
    }

    private function newUploadDir(): string
    {
        return 'uploads/rifas/' . bin2hex(random_bytes(8));
    }
}
