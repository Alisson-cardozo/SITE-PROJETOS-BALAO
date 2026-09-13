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
                'abas' => $plano['abas'],
                'show_in_ranking' => $plano['show_in_ranking'] ?? false,
                'sales_override_count' => $plano['sales_override_count'] ?? 0,
                'carla_ia' => $plano['carla_ia'] ?? false,
            ],
            $this->planos->listAll(false)
        );

        return Response::json(['data' => $data]);
    }
}
