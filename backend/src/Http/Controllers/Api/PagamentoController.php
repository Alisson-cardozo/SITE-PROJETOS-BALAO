<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api;

use App\Core\Request;
use App\Core\Response;
use App\Services\CupomService;
use App\Services\PagamentoService;
use App\Services\PlanoService;
use App\Services\UserService;
use Throwable;

final class PagamentoController
{
    private PagamentoService $pagamentos;
    private PlanoService $planos;
    private UserService $users;
    private CupomService $cupons;

    public function __construct()
    {
        $this->pagamentos = new PagamentoService();
        $this->planos = new PlanoService();
        $this->users = new UserService();
        $this->cupons = new CupomService();
    }

    /**
     * Resolve o cupom (opcional) enviado no pagamento: valida pro usuario/plano
     * e devolve [valorFinal, cupomId]. Se nao houver cupom, devolve o valor cheio.
     * Retorna Response (422) se o cupom foi informado mas e invalido.
     *
     * @return array{0: float, 1: ?int}|Response
     */
    private function resolveCupom(Request $request, int $userId, int $planoId, float $valorPlano): array|Response
    {
        $codigo = trim((string) ($request->input('codigo_cupom') ?? ''));
        if ($codigo === '') {
            return [$valorPlano, null];
        }

        $result = $this->cupons->validateForUser($codigo, $userId, $planoId, $valorPlano);
        if (!$result['ok']) {
            return Response::json(['error' => $result['error']], 422);
        }

        return [(float) $result['valor_final'], (int) $result['cupom']['id']];
    }

    public function store(Request $request): Response
    {
        $userId = (int) $request->attribute('user_id', 0);
        $user = $this->users->findById($userId);
        if ($user === null) {
            return Response::json(['error' => 'Usuario nao encontrado.'], 404);
        }

        $planoId = (int) ($request->input('plano_id') ?? 0);
        $plano = $planoId > 0 ? $this->planos->findRawById($planoId) : null;
        if ($plano === null || ((int) $plano['ativo']) !== 1) {
            return Response::json(['error' => 'Plano nao encontrado ou indisponivel.'], 422);
        }

        $cupom = $this->resolveCupom($request, $userId, (int) $plano['id'], (float) $plano['valor']);
        if ($cupom instanceof Response) {
            return $cupom;
        }
        [$valorFinal, $cupomId] = $cupom;

        $notificationUrl = $this->notificationUrl($request);

        try {
            $pagamento = $this->pagamentos->criar(
                $userId,
                (string) $user['email'],
                [
                    'id' => (int) $plano['id'],
                    'nome' => (string) $plano['nome'],
                    'valor' => $valorFinal,
                    'dias_acesso' => (int) $plano['dias_acesso'],
                ],
                $notificationUrl,
                $cupomId
            );
        } catch (Throwable $e) {
            return Response::json(['error' => $e->getMessage()], 502);
        }

        return Response::json(['data' => $pagamento], 201);
    }

    public function storeCartao(Request $request): Response
    {
        $userId = (int) $request->attribute('user_id', 0);
        $user = $this->users->findById($userId);
        if ($user === null) {
            return Response::json(['error' => 'Usuario nao encontrado.'], 404);
        }

        $planoId = (int) ($request->input('plano_id') ?? 0);
        $plano = $planoId > 0 ? $this->planos->findRawById($planoId) : null;
        if ($plano === null || ((int) $plano['ativo']) !== 1) {
            return Response::json(['error' => 'Plano nao encontrado ou indisponivel.'], 422);
        }

        $token = trim((string) ($request->input('token') ?? ''));
        $paymentMethodId = trim((string) ($request->input('payment_method_id') ?? ''));
        if ($token === '' || $paymentMethodId === '') {
            return Response::json(['error' => 'Dados do cartao invalidos.'], 422);
        }

        // So credito e ate 4x (decisao de produto). Blindagem no servidor mesmo
        // que o frontend ja limite -- o cliente e quem manda o valor.
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

        $cupom = $this->resolveCupom($request, $userId, (int) $plano['id'], (float) $plano['valor']);
        if ($cupom instanceof Response) {
            return $cupom;
        }
        [$valorFinal, $cupomId] = $cupom;

        $notificationUrl = $this->notificationUrl($request);

        try {
            $pagamento = $this->pagamentos->criarComCartao(
                $userId,
                (string) $user['email'],
                [
                    'id' => (int) $plano['id'],
                    'nome' => (string) $plano['nome'],
                    'valor' => $valorFinal,
                    'dias_acesso' => (int) $plano['dias_acesso'],
                ],
                $notificationUrl,
                [
                    'token' => $token,
                    'payment_method_id' => $paymentMethodId,
                    'installments' => $installments,
                    'issuer_id' => $issuerId,
                    'device_id' => $deviceId,
                    'identification' => $identification,
                ],
                $cupomId
            );
        } catch (Throwable $e) {
            return Response::json(['error' => $e->getMessage()], 502);
        }

        // Cartao aprovado libera o acesso na hora -- devolve o usuario atualizado
        // (como o show() faz) pro frontend destravar o menu sem esperar o poll.
        $freshUser = $this->users->findById($userId);

        return Response::json([
            'data' => $pagamento,
            'user' => $freshUser === null ? null : [
                'status' => $freshUser['status'],
                'access_expires_at' => $freshUser['access_expires_at'],
            ],
        ], 201);
    }

    public function show(Request $request): Response
    {
        $userId = (int) $request->attribute('user_id', 0);
        $id = (int) ($request->param('id') ?? 0);

        $existing = $this->pagamentos->findRawById($id);
        if ($existing === null || !$this->pagamentos->belongsToUser($existing, $userId)) {
            return Response::json(['error' => 'Pagamento nao encontrado.'], 404);
        }

        try {
            $pagamento = $this->pagamentos->reconcileByLocalId($id);
        } catch (Throwable $e) {
            // Falha ao consultar o Mercado Pago agora nao deve travar o poll —
            // devolve o ultimo status conhecido localmente e tenta de novo no
            // proximo poll.
            $pagamento = $this->pagamentos->findRawById($id);
        }

        $user = $this->users->findById($userId);

        return Response::json([
            'data' => $pagamento,
            'user' => $user === null ? null : [
                'status' => $user['status'],
                'access_expires_at' => $user['access_expires_at'],
            ],
        ]);
    }

    private function notificationUrl(Request $request): string
    {
        $scheme = ($request->headers['x-forwarded-proto'] ?? '') === 'https' || !empty($_SERVER['HTTPS'])
            ? 'https'
            : 'http';
        $host = (string) ($request->headers['host'] ?? ($_SERVER['HTTP_HOST'] ?? 'localhost'));

        return "{$scheme}://{$host}/api/public/mercado-pago/webhook";
    }
}
