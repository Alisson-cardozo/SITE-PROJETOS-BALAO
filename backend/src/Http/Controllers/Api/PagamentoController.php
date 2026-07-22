<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api;

use App\Core\Request;
use App\Core\Response;
use App\Services\PagamentoService;
use App\Services\PlanoService;
use App\Services\UserService;
use Throwable;

final class PagamentoController
{
    private PagamentoService $pagamentos;
    private PlanoService $planos;
    private UserService $users;

    public function __construct()
    {
        $this->pagamentos = new PagamentoService();
        $this->planos = new PlanoService();
        $this->users = new UserService();
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

        $notificationUrl = $this->notificationUrl($request);

        try {
            $pagamento = $this->pagamentos->criar(
                $userId,
                (string) $user['email'],
                [
                    'id' => (int) $plano['id'],
                    'nome' => (string) $plano['nome'],
                    'valor' => (float) $plano['valor'],
                    'dias_acesso' => (int) $plano['dias_acesso'],
                ],
                $notificationUrl
            );
        } catch (Throwable $e) {
            return Response::json(['error' => $e->getMessage()], 502);
        }

        return Response::json(['data' => $pagamento], 201);
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
