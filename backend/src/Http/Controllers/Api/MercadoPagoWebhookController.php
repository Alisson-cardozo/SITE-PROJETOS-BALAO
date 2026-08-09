<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api;

use App\Core\Request;
use App\Core\Response;
use App\Services\LojaPagamentoService;
use App\Services\PagamentoService;
use Throwable;

/**
 * Webhook publico do Mercado Pago (sem middleware — o MP nunca tem um token
 * nosso). O corpo da notificacao NUNCA e usado pra decidir status: so serve
 * pra saber QUAL pagamento re-consultar direto na API do MP antes de liberar
 * qualquer acesso (ver PagamentoService::reconcileRow). Um mp_payment_id so
 * pertence a UM dos dois sistemas (Planos ou Loja) — tenta reconciliar nos
 * dois, o que nao encontrar a linha so faz nada (sem erro).
 */
final class MercadoPagoWebhookController
{
    private PagamentoService $pagamentos;
    private LojaPagamentoService $lojaPagamentos;

    public function __construct()
    {
        $this->pagamentos = new PagamentoService();
        $this->lojaPagamentos = new LojaPagamentoService();
    }

    public function handle(Request $request): Response
    {
        $paymentId = $this->extractPaymentId($request);
        if ($paymentId === null) {
            // Notificacao de um tipo que nao nos interessa (ex: "merchant_order")
            // -- responde 200 mesmo assim pro Mercado Pago nao ficar retentando.
            return Response::json(['ok' => true]);
        }

        try {
            $this->pagamentos->reconcileByMpPaymentId($paymentId);
        } catch (Throwable) {
            // Nunca deixa o webhook estourar 500 -- o polling do frontend e a
            // proxima tentativa do proprio MP cobrem uma falha pontual aqui.
        }

        try {
            $this->lojaPagamentos->reconcileByMpPaymentId($paymentId);
        } catch (Throwable) {
        }

        return Response::json(['ok' => true]);
    }

    private function extractPaymentId(Request $request): ?string
    {
        $type = $request->input('type') ?? $request->input('topic');
        if ($type !== null && $type !== 'payment') {
            return null;
        }

        $data = $request->input('data');
        if (is_array($data) && isset($data['id'])) {
            return (string) $data['id'];
        }

        $flatId = $request->input('data_id') ?? $request->input('id');

        return $flatId === null ? null : (string) $flatId;
    }
}
