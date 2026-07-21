<?php

declare(strict_types=1);

namespace App\Services;

use App\Support\Db;
use Throwable;

/**
 * Orquestra a reserva de numeros — usada tanto pelo fluxo publico (cliente
 * escolhe os numeros especificos dele) quanto pela venda manual do dono.
 * Toda a operacao roda numa unica transacao (criar o comprador + travar os
 * numeros), pra nunca deixar um comprador "orfao" sem numero se a reserva
 * falhar no meio.
 */
final class RifaReservaService
{
    private RifaNumeroService $numeros;
    private RifaCompradorService $compradores;
    private RifaPromocaoService $promocoes;

    public function __construct()
    {
        $this->numeros = new RifaNumeroService();
        $this->compradores = new RifaCompradorService();
        $this->promocoes = new RifaPromocaoService();
    }

    /**
     * Fluxo publico onde o CLIENTE escolhe os numeros especificos dele. O
     * preco e SEMPRE recalculado aqui a partir das promocoes ativas — nunca
     * confia num valor que o cliente mandou.
     *
     * @param array<int,int> $numerosEscolhidos
     * @return array{comprador: array, numeros: array<int,int>}|null null = um ou mais numeros ja nao estao mais disponiveis
     */
    public function reservarNumerosEscolhidos(array $rifa, array $numerosEscolhidos, string $nome, string $whatsapp, ?string $email): ?array
    {
        $rifaId = (int) $rifa['id'];
        $this->numeros->liberarReservasExpiradas($rifaId);

        $pdo = Db::connection();
        $pdo->beginTransaction();
        try {
            $quantidade = count($numerosEscolhidos);
            $valorTotal = $this->promocoes->calcularValorTotal($rifaId, (float) $rifa['valor_numero'], $quantidade);
            $comprador = $this->compradores->create($rifaId, [
                'nome' => $nome,
                'whatsapp' => $whatsapp,
                'email' => $email,
                'quantidade_numeros' => $quantidade,
                'valor_total' => $valorTotal,
                'forma_pagamento' => $rifa['forma_recebimento'],
            ]);

            $ok = $this->numeros->reservarNumerosEspecificos($rifaId, $numerosEscolhidos, (int) $comprador['id']);
            if (!$ok) {
                $pdo->rollBack();
                return null;
            }

            $pdo->commit();
        } catch (Throwable $e) {
            $pdo->rollBack();
            throw $e;
        }

        return ['comprador' => $comprador, 'numeros' => $numerosEscolhidos];
    }

    /**
     * Venda lancada pelo proprio dono (numeros escolhidos por ele, ex: cliente
     * pagou combinado fora do site). `$jaPago` true marca como vendida na hora.
     * Preco tambem passa pelas promocoes ativas, pra ficar consistente com o
     * que o cliente veria no link publico.
     *
     * @param array<int,int> $numerosEscolhidos
     */
    public function criarVendaManual(
        int $rifaId,
        array $numerosEscolhidos,
        string $nome,
        string $whatsapp,
        ?string $email,
        float $valorNumero,
        bool $jaPago
    ): ?array {
        $pdo = Db::connection();
        $pdo->beginTransaction();
        try {
            $valorTotal = $this->promocoes->calcularValorTotal($rifaId, $valorNumero, count($numerosEscolhidos));
            $comprador = $this->compradores->create($rifaId, [
                'nome' => $nome,
                'whatsapp' => $whatsapp,
                'email' => $email,
                'quantidade_numeros' => count($numerosEscolhidos),
                'valor_total' => $valorTotal,
                'forma_pagamento' => 'manual',
            ]);

            $ok = $this->numeros->reservarNumerosEspecificos($rifaId, $numerosEscolhidos, (int) $comprador['id']);
            if (!$ok) {
                $pdo->rollBack();
                return null;
            }

            if ($jaPago) {
                $this->numeros->confirmarVenda((int) $comprador['id']);
            }

            $pdo->commit();
        } catch (Throwable $e) {
            $pdo->rollBack();
            throw $e;
        }

        if ($jaPago) {
            $this->compradores->markPago((int) $comprador['id']);
        }

        return $this->compradores->findById((int) $comprador['id']);
    }

    /** Dono confirma manualmente um comprador que estava aguardando (contato via WhatsApp). */
    public function confirmarPagamentoManual(int $compradorId): ?array
    {
        $comprador = $this->compradores->findById($compradorId);
        if ($comprador === null || $comprador['status'] !== 'aguardando_pagamento') {
            return null;
        }

        $this->numeros->confirmarVenda($compradorId);
        $this->compradores->markPago($compradorId);

        return $this->compradores->findById($compradorId);
    }

    public function cancelarReserva(int $compradorId): void
    {
        $this->numeros->liberarComprador($compradorId);
        $this->compradores->markCancelado($compradorId);
    }
}
