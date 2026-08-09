<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api;

use App\Core\Request;
use App\Core\Response;
use App\Services\LojaPagamentoService;
use App\Services\LojaProdutoService;
use Throwable;

/**
 * Rotas SEM autenticacao — vitrine publica da Loja. O comprador nunca faz
 * login, so informa o email na hora de comprar.
 */
final class LojaPublicController
{
    private LojaProdutoService $produtos;
    private LojaPagamentoService $pagamentos;

    public function __construct()
    {
        $this->produtos = new LojaProdutoService();
        $this->pagamentos = new LojaPagamentoService();
    }

    public function index(Request $request): Response
    {
        return Response::json(['data' => $this->produtos->listPublic()]);
    }

    public function show(Request $request): Response
    {
        $id = (int) ($request->param('id') ?? 0);
        $produto = $this->produtos->findByIdPublic($id);
        if ($produto === null) {
            return Response::json(['error' => 'Produto nao encontrado.'], 404);
        }

        return Response::json(['data' => $produto]);
    }

    public function comprar(Request $request): Response
    {
        $id = (int) ($request->param('id') ?? 0);
        $email = trim((string) $request->input('email', ''));

        if ($email === '' || filter_var($email, FILTER_VALIDATE_EMAIL) === false) {
            return Response::json(['error' => 'Informe um email valido.'], 422);
        }

        $produtoRaw = $this->produtos->findRawById($id);
        if ($produtoRaw === null) {
            return Response::json(['error' => 'Produto nao encontrado.'], 404);
        }

        $notificationUrl = $this->notificationUrl($request);

        try {
            $pagamento = $this->pagamentos->criar(
                $id,
                $email,
                (float) $produtoRaw['valor'],
                (string) $produtoRaw['nome'],
                $notificationUrl
            );
        } catch (Throwable $e) {
            return Response::json(['error' => $e->getMessage()], 422);
        }

        return Response::json(['data' => $pagamento], 201);
    }

    public function status(Request $request): Response
    {
        $id = (int) ($request->param('id') ?? 0);

        try {
            $pagamento = $this->pagamentos->reconcileByLocalId($id);
        } catch (Throwable) {
            // Falha ao consultar o Mercado Pago agora nao deve travar o poll —
            // devolve o ultimo status conhecido localmente e tenta de novo no
            // proximo poll.
            $pagamento = $this->pagamentos->findRawById($id);
        }

        if ($pagamento === null) {
            return Response::json(['error' => 'Pagamento nao encontrado.'], 404);
        }

        return Response::json(['data' => $pagamento]);
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
