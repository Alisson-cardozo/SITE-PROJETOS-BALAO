<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api;

use App\Core\Request;
use App\Core\Response;
use App\Services\SolicitacaoMoldeService;
use Throwable;

/**
 * Pagina publica (sem login) de solicitacao de molde sob encomenda.
 */
final class SolicitacaoPublicController
{
    private SolicitacaoMoldeService $service;

    public function __construct()
    {
        $this->service = new SolicitacaoMoldeService();
    }

    /** Valor do metro, video tutorial e modelos disponiveis. */
    public function config(Request $request): Response
    {
        return Response::json(['data' => $this->service->config()]);
    }

    /** Cria o pedido e gera o Pix. */
    public function criar(Request $request): Response
    {
        if (!$this->service->isAtiva()) {
            return Response::json(['error' => 'A solicitação de molde está temporariamente indisponível.'], 403);
        }
        $modeloKey = trim((string) ($request->input('modelo_key') ?? ''));
        $categoria = trim((string) ($request->input('categoria') ?? ''));
        $modeloNome = trim((string) ($request->input('modelo_nome') ?? ''));
        $tamanho = (float) ($request->input('tamanho_cm') ?? 0);
        $gomos = (int) ($request->input('gomos') ?? 0);
        $bainha = (float) ($request->input('bainha_cm') ?? 0);
        $email = strtolower(trim((string) ($request->input('email') ?? '')));

        $errors = [];
        if ($modeloKey === '' || $modeloNome === '') {
            $errors['modelo_key'] = 'Escolha um modelo.';
        }
        if ($tamanho < 1) {
            $errors['tamanho_cm'] = 'Informe o tamanho do molde (em cm).';
        }
        if ($gomos < 1) {
            $errors['gomos'] = 'Informe a quantidade de gomos.';
        }
        if ($bainha < 0) {
            $errors['bainha_cm'] = 'Bainha inválida.';
        }
        if ($email === '' || filter_var($email, FILTER_VALIDATE_EMAIL) === false) {
            $errors['email'] = 'Informe um e-mail válido.';
        }
        if ($errors !== []) {
            return Response::json(['errors' => $errors, 'error' => 'Verifique os campos.'], 422);
        }

        try {
            $pedido = $this->service->criar($modeloKey, $categoria, $modeloNome, $tamanho, $gomos, $bainha, $email, $this->notificationUrl($request));
        } catch (Throwable $e) {
            return Response::json(['error' => $e->getMessage()], 422);
        }

        return Response::json(['data' => $pedido], 201);
    }

    /** Cria o pedido e cobra no CARTÃO (mesmo esquema dos planos). */
    public function criarCartao(Request $request): Response
    {
        if (!$this->service->isAtiva()) {
            return Response::json(['error' => 'A solicitação de molde está temporariamente indisponível.'], 403);
        }
        $modeloKey = trim((string) ($request->input('modelo_key') ?? ''));
        $categoria = trim((string) ($request->input('categoria') ?? ''));
        $modeloNome = trim((string) ($request->input('modelo_nome') ?? ''));
        $tamanho = (float) ($request->input('tamanho_cm') ?? 0);
        $gomos = (int) ($request->input('gomos') ?? 0);
        $bainha = (float) ($request->input('bainha_cm') ?? 0);
        $email = strtolower(trim((string) ($request->input('email') ?? '')));

        $errors = [];
        if ($modeloKey === '' || $modeloNome === '') {
            $errors['modelo_key'] = 'Escolha um modelo.';
        }
        if ($tamanho < 1) {
            $errors['tamanho_cm'] = 'Informe o tamanho do molde (em cm).';
        }
        if ($gomos < 1) {
            $errors['gomos'] = 'Informe a quantidade de gomos.';
        }
        if ($email === '' || filter_var($email, FILTER_VALIDATE_EMAIL) === false) {
            $errors['email'] = 'Informe um e-mail válido.';
        }
        if ($errors !== []) {
            return Response::json(['errors' => $errors, 'error' => 'Verifique os campos.'], 422);
        }

        $token = trim((string) ($request->input('token') ?? ''));
        $paymentMethodId = trim((string) ($request->input('payment_method_id') ?? ''));
        if ($token === '' || $paymentMethodId === '') {
            return Response::json(['error' => 'Dados do cartão inválidos.'], 422);
        }
        $installments = (int) ($request->input('installments') ?? 1);
        if ($installments < 1 || $installments > 4) {
            return Response::json(['error' => 'Parcelamento permitido apenas de 1x a 4x.'], 422);
        }
        $issuerRaw = $request->input('issuer_id');
        $issuerId = ($issuerRaw === null || $issuerRaw === '') ? null : (int) $issuerRaw;
        $deviceRaw = $request->input('device_id');
        $deviceId = is_string($deviceRaw) && $deviceRaw !== '' ? $deviceRaw : null;
        $identification = null;
        $identRaw = $request->input('identification');
        if (is_array($identRaw)) {
            $number = preg_replace('/\D/', '', (string) ($identRaw['number'] ?? '')) ?? '';
            $type = trim((string) ($identRaw['type'] ?? 'CPF'));
            if ($number !== '') {
                $identification = ['type' => $type !== '' ? $type : 'CPF', 'number' => $number];
            }
        }

        try {
            $pedido = $this->service->criarComCartao($modeloKey, $categoria, $modeloNome, $tamanho, $gomos, $bainha, $email, $this->notificationUrl($request), [
                'token' => $token,
                'payment_method_id' => $paymentMethodId,
                'installments' => $installments,
                'issuer_id' => $issuerId,
                'device_id' => $deviceId,
                'identification' => $identification,
            ]);
        } catch (Throwable $e) {
            return Response::json(['error' => $e->getMessage()], 502);
        }

        return Response::json(['data' => $pedido], 201);
    }

    /** Cancela um pedido que ainda esta aguardando pagamento (cliente desistiu). */
    public function cancelar(Request $request): Response
    {
        $id = (int) ($request->param('id') ?? 0);
        $token = (string) ($request->input('token') ?? '');
        $row = $this->service->findRawById($id);
        if ($row === null || !hash_equals((string) $row['public_token'], $token)) {
            return Response::json(['error' => 'Pedido não encontrado.'], 404);
        }
        if (($row['status'] ?? '') !== 'aguardando_pagamento') {
            return Response::json(['error' => 'Este pedido não pode ser cancelado.'], 422);
        }
        $this->service->cancelar($id);
        return Response::json(['ok' => true]);
    }

    /** Poll do status: reconcilia o pagamento e devolve a chave quando pago. */
    public function status(Request $request): Response
    {
        $id = (int) ($request->param('id') ?? 0);
        $token = (string) ($request->input('token') ?? '');

        $row = $this->service->findRawById($id);
        if ($row === null || !hash_equals((string) $row['public_token'], $token)) {
            return Response::json(['error' => 'Pedido não encontrado.'], 404);
        }

        $reconciled = $this->service->reconcile($id) ?? $row;
        return Response::json(['data' => $this->service->toPublicArray($reconciled, true)]);
    }

    /** SO LOCAL: simula o pagamento (pra testar sem Mercado Pago). */
    public function simularPago(Request $request): Response
    {
        $id = (int) ($request->param('id') ?? 0);
        $token = (string) ($request->input('token') ?? '');
        $row = $this->service->findRawById($id);
        if ($row === null || !hash_equals((string) $row['public_token'], $token)) {
            return Response::json(['error' => 'Pedido não encontrado.'], 404);
        }
        if (!$this->service->isLocalDev()) {
            return Response::json(['error' => 'Indisponível.'], 403);
        }
        $updated = $this->service->simularPago($id) ?? $row;
        return Response::json(['data' => $this->service->toPublicArray($updated, true)]);
    }

    /** Retomar um pedido PAGO pela chave enviada no e-mail. */
    public function recuperar(Request $request): Response
    {
        $chave = strtoupper(trim((string) ($request->input('chave') ?? '')));
        if ($chave === '') {
            return Response::json(['error' => 'Informe a chave.'], 422);
        }

        $row = $this->service->findByChave($chave);
        if ($row === null || ($row['status'] ?? '') === 'aguardando_pagamento') {
            return Response::json(['error' => 'Chave inválida ou pagamento não confirmado.'], 404);
        }

        return Response::json(['data' => $this->service->toPublicArray($row, true)]);
    }

    /** Preenche os dados do molde num pedido de cortesia (chave do admin). */
    public function definirDados(Request $request): Response
    {
        $id = (int) ($request->param('id') ?? 0);
        $token = (string) ($request->input('token') ?? '');
        $row = $this->service->findRawById($id);
        if ($row === null || !hash_equals((string) $row['public_token'], $token)) {
            return Response::json(['error' => 'Pedido não encontrado.'], 404);
        }
        if (($row['status'] ?? '') === 'aguardando_pagamento') {
            return Response::json(['error' => 'Pagamento não confirmado.'], 403);
        }

        $modeloKey = trim((string) ($request->input('modelo_key') ?? ''));
        $categoria = trim((string) ($request->input('categoria') ?? ''));
        $modeloNome = trim((string) ($request->input('modelo_nome') ?? ''));
        $tamanho = (float) ($request->input('tamanho_cm') ?? 0);
        $gomos = (int) ($request->input('gomos') ?? 0);
        $bainha = (float) ($request->input('bainha_cm') ?? 0);

        $errors = [];
        if ($modeloKey === '' || $modeloNome === '') {
            $errors['modelo_key'] = 'Escolha um modelo.';
        }
        if ($tamanho < 1) {
            $errors['tamanho_cm'] = 'Informe o tamanho (cm).';
        }
        if ($gomos < 1) {
            $errors['gomos'] = 'Informe os gomos.';
        }
        if ($bainha < 0) {
            $errors['bainha_cm'] = 'Bainha inválida.';
        }
        if ($errors !== []) {
            return Response::json(['errors' => $errors, 'error' => 'Verifique os campos.'], 422);
        }

        $ok = $this->service->definirDados($id, $modeloKey, $categoria, $modeloNome, $tamanho, $gomos, $bainha);
        if (!$ok) {
            return Response::json(['error' => 'Os dados deste pedido já foram definidos.'], 422);
        }
        $fresh = $this->service->findRawById($id) ?? $row;
        return Response::json(['data' => $this->service->toPublicArray($fresh, true)]);
    }

    /** Troca modelo/gomos/bainha (tamanho e e-mail ficam travados). */
    public function atualizarDados(Request $request): Response
    {
        $id = (int) ($request->param('id') ?? 0);
        $token = (string) ($request->input('token') ?? '');
        $row = $this->service->findRawById($id);
        if ($row === null || !hash_equals((string) $row['public_token'], $token)) {
            return Response::json(['error' => 'Pedido não encontrado.'], 404);
        }
        if (($row['status'] ?? '') === 'aguardando_pagamento') {
            return Response::json(['error' => 'Pagamento não confirmado.'], 403);
        }
        if (($row['status'] ?? '') === 'entregue') {
            return Response::json(['error' => 'Molde já entregue.'], 403);
        }

        $modeloKey = trim((string) ($request->input('modelo_key') ?? ''));
        $categoria = trim((string) ($request->input('categoria') ?? ''));
        $modeloNome = trim((string) ($request->input('modelo_nome') ?? ''));
        $gomos = (int) ($request->input('gomos') ?? 0);
        $bainha = (float) ($request->input('bainha_cm') ?? 0);

        $errors = [];
        if ($modeloKey === '' || $modeloNome === '') {
            $errors['modelo_key'] = 'Escolha um modelo.';
        }
        if ($gomos < 1) {
            $errors['gomos'] = 'Informe a quantidade de gomos.';
        }
        if ($bainha < 0) {
            $errors['bainha_cm'] = 'Bainha inválida.';
        }
        if ($errors !== []) {
            return Response::json(['errors' => $errors, 'error' => 'Verifique os campos.'], 422);
        }

        $this->service->atualizarDados($id, $modeloKey, $categoria, $modeloNome, $gomos, $bainha);
        $fresh = $this->service->findRawById($id) ?? $row;
        return Response::json(['data' => $this->service->toPublicArray($fresh, true)]);
    }

    /** Salva as medidas do chat (assistente de tacos). */
    public function salvarTacos(Request $request): Response
    {
        $id = (int) ($request->param('id') ?? 0);
        $token = (string) ($request->input('token') ?? '');
        $row = $this->service->findRawById($id);
        if ($row === null || !hash_equals((string) $row['public_token'], $token)) {
            return Response::json(['error' => 'Pedido não encontrado.'], 404);
        }
        if (($row['status'] ?? '') === 'aguardando_pagamento') {
            return Response::json(['error' => 'Pagamento não confirmado.'], 403);
        }
        $config = $request->input('config');
        if (!is_array($config)) {
            return Response::json(['error' => 'Medidas inválidas.'], 422);
        }
        $this->service->salvarTacos($id, $config);
        return Response::json(['ok' => true]);
    }

    /** Recebe o PDF do molde (gerado no navegador) e envia por e-mail. */
    public function entregar(Request $request): Response
    {
        $id = (int) ($request->param('id') ?? 0);
        $token = (string) ($request->input('token') ?? '');
        $row = $this->service->findRawById($id);
        if ($row === null || !hash_equals((string) $row['public_token'], $token)) {
            return Response::json(['error' => 'Pedido não encontrado.'], 404);
        }
        if (($row['status'] ?? '') === 'aguardando_pagamento') {
            return Response::json(['error' => 'Pagamento não confirmado.'], 403);
        }

        $pdf = (string) ($request->input('pdf_base64') ?? '');
        // aceita data URL ou base64 puro
        if (str_contains($pdf, ',')) {
            $pdf = substr($pdf, strpos($pdf, ',') + 1);
        }
        if ($pdf === '') {
            return Response::json(['error' => 'PDF ausente.'], 422);
        }
        $filename = trim((string) ($request->input('filename') ?? 'molde.pdf'));
        if ($filename === '') {
            $filename = 'molde.pdf';
        }
        $resumo = (string) ($request->input('resumo') ?? '');

        // Versoes fatiadas (A4/A3) sao opcionais — nao travam a entrega se faltarem.
        $extras = [];
        foreach (['a4' => 'pdf_a4_base64', 'a3' => 'pdf_a3_base64'] as $key => $field) {
            $raw = (string) ($request->input($field) ?? '');
            if (str_contains($raw, ',')) {
                $raw = substr($raw, strpos($raw, ',') + 1);
            }
            if ($raw === '') {
                continue;
            }
            $extraFilename = trim((string) ($request->input('filename_' . $key) ?? "molde-{$key}.pdf"));
            if ($extraFilename === '') {
                $extraFilename = "molde-{$key}.pdf";
            }
            $extras[] = ['filename' => $extraFilename, 'contentBase64' => $raw];
        }

        $this->service->entregarMolde($id, $pdf, $filename, $resumo, $extras);
        $fresh = $this->service->findRawById($id) ?? $row;
        return Response::json(['data' => $this->service->toPublicArray($fresh, true)]);
    }

    private function notificationUrl(Request $request): string
    {
        $scheme = ($request->headers['x-forwarded-proto'] ?? '') === 'https' || !empty($_SERVER['HTTPS']) ? 'https' : 'http';
        $host = (string) ($request->headers['host'] ?? ($_SERVER['HTTP_HOST'] ?? 'localhost'));
        return "{$scheme}://{$host}/api/public/mercado-pago/webhook";
    }
}
