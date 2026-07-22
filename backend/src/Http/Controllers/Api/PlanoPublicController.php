<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api;

use App\Core\Request;
use App\Core\Response;
use App\Services\PlanoService;

/**
 * Lista de planos pra quem esta logado escolher e pagar (aba "Solicitar
 * Acesso") — so os planos ativos, sem os campos de auditoria do admin.
 */
final class PlanoPublicController
{
    private PlanoService $planos;

    public function __construct()
    {
        $this->planos = new PlanoService();
    }

    public function index(Request $request): Response
    {
        $data = array_map(
            static fn (array $plano) => [
                'id' => $plano['id'],
                'nome' => $plano['nome'],
                'valor' => $plano['valor'],
                'dias_acesso' => $plano['dias_acesso'],
            ],
            $this->planos->listAll(false)
        );

        return Response::json(['data' => $data]);
    }
}
