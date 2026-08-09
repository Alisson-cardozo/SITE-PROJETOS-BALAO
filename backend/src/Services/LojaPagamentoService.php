<?php

declare(strict_types=1);

namespace App\Services;

use App\Support\Db;
use App\Support\Mailer;
use RuntimeException;
use Throwable;

/**
 * Cobrancas Pix (Mercado Pago) da Loja e a reconciliacao de status — mesmo
 * padrao de PagamentoService (Planos), so que o "beneficio" liberado na
 * aprovacao e marcar o produto como vendido + mandar o link de download por
 * email pro comprador, em vez de liberar acesso de usuario. Igual la, a
 * confirmacao SEMPRE re-consulta a API do Mercado Pago antes de fazer
 * qualquer coisa (nunca confia direto no corpo do webhook).
 */
final class LojaPagamentoService
{
    private MercadoPagoService $mercadoPago;
    private LojaProdutoService $produtos;

    public function __construct()
    {
        $this->mercadoPago = new MercadoPagoService();
        $this->produtos = new LojaProdutoService();
    }

    public function criar(int $produtoId, string $email, float $valor, string $nomeProduto, string $notificationUrl): array
    {
        $this->produtos->liberarReservasExpiradas();

        if (!$this->produtos->reservarParaPagamento($produtoId, $email)) {
            throw new RuntimeException('Esse produto ja nao esta mais disponivel.');
        }

        $stmt = Db::connection()->prepare(
            "INSERT INTO loja_pagamentos (produto_id, email, valor, status) VALUES (:produto_id, :email, :valor, 'pendente')"
        );
        $stmt->execute(['produto_id' => $produtoId, 'email' => $email, 'valor' => $valor]);
        $id = (int) Db::connection()->lastInsertId();

        try {
            $pix = $this->mercadoPago->createPixPayment(
                $valor,
                'Loja - ' . $nomeProduto,
                (string) $id,
                $email,
                $notificationUrl
            );
        } catch (Throwable $e) {
            Db::connection()
                ->prepare("UPDATE loja_pagamentos SET status = 'rejeitado' WHERE id = :id")
                ->execute(['id' => $id]);
            $this->produtos->liberarReserva($produtoId);
            throw $e;
        }

        $stmt = Db::connection()->prepare(
            'UPDATE loja_pagamentos SET mp_payment_id = :mp_id, qr_code = :qr_code, qr_code_base64 = :qr_code_base64
             WHERE id = :id'
        );
        $stmt->execute([
            'id' => $id,
            'mp_id' => $pix['id'],
            'qr_code' => $pix['qr_code'],
            'qr_code_base64' => $pix['qr_code_base64'],
        ]);

        return $this->toPublicArray($this->findRawById($id) ?? []);
    }

    public function findRawById(int $id): ?array
    {
        $stmt = Db::connection()->prepare('SELECT * FROM loja_pagamentos WHERE id = :id LIMIT 1');
        $stmt->execute(['id' => $id]);
        $row = $stmt->fetch();

        return $row === false ? null : $row;
    }

    /** Re-consulta o Mercado Pago e aplica o resultado (idempotente) — usada pelo polling do frontend. */
    public function reconcileByLocalId(int $id): ?array
    {
        $row = $this->findRawById($id);
        if ($row === null) {
            return null;
        }

        $this->reconcileRow($row);

        return $this->toPublicArray($this->findRawById($id) ?? $row);
    }

    /** Usada pelo webhook publico do Mercado Pago — so tem o mp_payment_id. */
    public function reconcileByMpPaymentId(string $mpPaymentId): void
    {
        $stmt = Db::connection()->prepare('SELECT * FROM loja_pagamentos WHERE mp_payment_id = :mp_id LIMIT 1');
        $stmt->execute(['mp_id' => $mpPaymentId]);
        $row = $stmt->fetch();
        if ($row === false) {
            return;
        }

        $this->reconcileRow($row);
    }

    private function reconcileRow(array $row): void
    {
        if ($row['status'] !== 'pendente' || empty($row['mp_payment_id'])) {
            return;
        }

        $mpStatus = $this->mercadoPago->fetchPayment((string) $row['mp_payment_id']);
        $produtoId = (int) $row['produto_id'];
        $email = (string) $row['email'];

        if ($mpStatus['status'] === 'approved') {
            // WHERE status='pendente' torna isso idempotente mesmo se o poll e o
            // webhook chegarem quase juntos -- so quem realmente mudar a linha
            // (rowCount > 0) marca o produto como vendido e manda o email.
            $stmt = Db::connection()->prepare(
                "UPDATE loja_pagamentos SET status = 'aprovado', paid_at = NOW() WHERE id = :id AND status = 'pendente'"
            );
            $stmt->execute(['id' => $row['id']]);

            if ($stmt->rowCount() > 0 && $this->produtos->marcarVendido($produtoId, $email)) {
                $produto = $this->produtos->findRawById($produtoId);
                if ($produto !== null) {
                    $this->enviarEmailComLink($email, (string) $produto['nome'], (string) $produto['link_arquivo']);
                }
            }
        } elseif (in_array($mpStatus['status'], ['rejected', 'cancelled'], true)) {
            $stmt = Db::connection()->prepare(
                "UPDATE loja_pagamentos SET status = 'rejeitado' WHERE id = :id AND status = 'pendente'"
            );
            $stmt->execute(['id' => $row['id']]);

            if ($stmt->rowCount() > 0) {
                $this->produtos->liberarReserva($produtoId);
            }
        }
    }

    /** Falha no envio nunca derruba o reconcile -- o produto ja foi marcado
     * vendido; se o email falhar, o admin pode reenviar o link manualmente
     * (comprador_email/link_arquivo ficam salvos no produto). */
    private function enviarEmailComLink(string $email, string $nomeProduto, string $link): void
    {
        try {
            Mailer::send($email, 'Sua compra: ' . $nomeProduto, [
                'body' => "Obrigado pela compra!\n\nProduto: {$nomeProduto}\n\nBaixe seus arquivos aqui:\n{$link}",
                'html' => '<p>Obrigado pela compra!</p>'
                    . '<p><strong>Produto:</strong> ' . htmlspecialchars($nomeProduto, ENT_QUOTES, 'UTF-8') . '</p>'
                    . '<p><a href="' . htmlspecialchars($link, ENT_QUOTES, 'UTF-8') . '">Clique aqui para baixar seus arquivos</a></p>',
            ]);
        } catch (Throwable) {
            // silencioso de proposito -- ver comentario acima
        }
    }

    private function toPublicArray(array $row): array
    {
        return [
            'id' => (int) $row['id'],
            'produto_id' => (int) $row['produto_id'],
            'valor' => (float) $row['valor'],
            'status' => (string) $row['status'],
            'qr_code' => $row['qr_code'] ?? null,
            'qr_code_base64' => $row['qr_code_base64'] ?? null,
            'created_at' => (string) $row['created_at'],
            'paid_at' => $row['paid_at'] ?? null,
        ];
    }
}
