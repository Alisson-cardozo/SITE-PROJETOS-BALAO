<?php

declare(strict_types=1);

namespace App\Services;

use App\Support\Db;
use Throwable;

/**
 * Cobrancas Pix (Mercado Pago) e a reconciliacao de status — usada tanto
 * pelo polling do frontend quanto pelo webhook publico. Em ambos os casos a
 * confirmacao SEMPRE re-consulta a API do Mercado Pago com o token proprio
 * antes de liberar acesso (nunca confia direto no corpo do webhook).
 */
final class PagamentoService
{
    private MercadoPagoService $mercadoPago;
    private UserService $users;
    private PlanoService $planos;

    public function __construct()
    {
        $this->mercadoPago = new MercadoPagoService();
        $this->users = new UserService();
        $this->planos = new PlanoService();
    }

    /**
     * @param array{id:int, nome:string, valor:float, dias_acesso:int} $plano
     */
    public function criar(int $userId, string $userEmail, array $plano, string $notificationUrl): array
    {
        $stmt = Db::connection()->prepare(
            "INSERT INTO pagamentos (user_id, plano_id, valor, status) VALUES (:user_id, :plano_id, :valor, 'pendente')"
        );
        $stmt->execute([
            'user_id' => $userId,
            'plano_id' => $plano['id'],
            'valor' => $plano['valor'],
        ]);
        $id = (int) Db::connection()->lastInsertId();

        try {
            $pix = $this->mercadoPago->createPixPayment(
                $plano['valor'],
                'Plano ' . $plano['nome'] . ' - Alisson Projetos',
                (string) $id,
                $userEmail,
                $notificationUrl
            );
        } catch (Throwable $e) {
            Db::connection()
                ->prepare("UPDATE pagamentos SET status = 'rejeitado' WHERE id = :id")
                ->execute(['id' => $id]);
            throw $e;
        }

        $stmt = Db::connection()->prepare(
            'UPDATE pagamentos SET mp_payment_id = :mp_id, qr_code = :qr_code, qr_code_base64 = :qr_code_base64
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

    /**
     * Cobranca por cartao de credito. Reaproveita o mesmo caminho do Pix: cria a
     * linha em `pagamentos` (pendente), cobra no Mercado Pago e delega a
     * liberacao de acesso ao MESMO reconcileByLocalId/reconcileRow usado pelo
     * polling e pelo webhook (idempotente). Cartao aprovado libera na hora;
     * in_process continua pendente e o polling/webhook resolvem depois.
     *
     * @param array{id:int, nome:string, valor:float, dias_acesso:int} $plano
     * @param array{token:string, payment_method_id:string, installments:int,
     *   issuer_id:?int, device_id:?string, identification:?array{type:string, number:string}} $cartao
     */
    public function criarComCartao(
        int $userId,
        string $userEmail,
        array $plano,
        string $notificationUrl,
        array $cartao
    ): array {
        $parcelas = max(1, (int) ($cartao['installments'] ?? 1));

        $stmt = Db::connection()->prepare(
            "INSERT INTO pagamentos (user_id, plano_id, valor, status, metodo, parcelas)
             VALUES (:user_id, :plano_id, :valor, 'pendente', 'cartao', :parcelas)"
        );
        $stmt->execute([
            'user_id' => $userId,
            'plano_id' => $plano['id'],
            'valor' => $plano['valor'],
            'parcelas' => $parcelas,
        ]);
        $id = (int) Db::connection()->lastInsertId();

        try {
            $pagamento = $this->mercadoPago->createCardPayment(
                $plano['valor'],
                'Plano ' . $plano['nome'] . ' - Alisson Projetos',
                (string) $id,
                $userEmail,
                $notificationUrl,
                (string) $cartao['token'],
                (string) $cartao['payment_method_id'],
                $parcelas,
                isset($cartao['issuer_id']) ? (int) $cartao['issuer_id'] : null,
                $cartao['identification'] ?? null,
                $cartao['device_id'] ?? null
            );
        } catch (Throwable $e) {
            Db::connection()
                ->prepare("UPDATE pagamentos SET status = 'rejeitado' WHERE id = :id")
                ->execute(['id' => $id]);
            throw $e;
        }

        Db::connection()
            ->prepare('UPDATE pagamentos SET mp_payment_id = :mp_id WHERE id = :id')
            ->execute(['id' => $id, 'mp_id' => $pagamento['id']]);

        // reconcileByLocalId re-consulta o MP e aplica approved/rejected pelo
        // mesmissimo reconcileRow (com grantAccess) usado pelo Pix e pelo webhook.
        $reconciled = $this->reconcileByLocalId($id);

        return $reconciled ?? $this->toPublicArray($this->findRawById($id) ?? []);
    }

    public function findRawById(int $id): ?array
    {
        $stmt = Db::connection()->prepare('SELECT * FROM pagamentos WHERE id = :id LIMIT 1');
        $stmt->execute(['id' => $id]);
        $row = $stmt->fetch();

        return $row === false ? null : $row;
    }

    /** Dono do pagamento — usado pra impedir um usuario ver/pollar o pagamento de outro. */
    public function belongsToUser(array $pagamento, int $userId): bool
    {
        return (int) $pagamento['user_id'] === $userId;
    }

    /**
     * Re-consulta o Mercado Pago pra esse pagamento local e aplica o
     * resultado (idempotente). Usada pelo polling do frontend.
     */
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
        $stmt = Db::connection()->prepare('SELECT * FROM pagamentos WHERE mp_payment_id = :mp_id LIMIT 1');
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

        if ($mpStatus['status'] === 'approved') {
            // WHERE status='pendente' torna isso idempotente mesmo se o poll e o
            // webhook chegarem quase juntos -- so quem realmente mudar a linha
            // (rowCount > 0) libera o acesso.
            $stmt = Db::connection()->prepare(
                "UPDATE pagamentos SET status = 'aprovado', paid_at = NOW() WHERE id = :id AND status = 'pendente'"
            );
            $stmt->execute(['id' => $row['id']]);

            if ($stmt->rowCount() > 0) {
                $plano = $this->planos->findRawById((int) $row['plano_id']);
                if ($plano !== null) {
                    $this->users->grantAccess((int) $row['user_id'], (int) $plano['dias_acesso'], (int) $plano['id']);

                    // rowCount()>0 garante que esse caminho roda UMA vez por
                    // pagamento (Pix, cartao ou webhook) -- notifica o admin da
                    // venda. Best-effort: qualquer falha aqui nunca desfaz a
                    // liberacao de acesso ja concluida acima.
                    try {
                        (new NotificacaoService())->criarPagamentoNotificacao(
                            (int) $row['user_id'],
                            [
                                'id' => (int) $plano['id'],
                                'nome' => (string) $plano['nome'],
                                'valor' => (float) $row['valor'],
                                'dias_acesso' => (int) $plano['dias_acesso'],
                            ],
                            (float) $row['valor'],
                            (string) ($row['metodo'] ?? 'pix'),
                            (int) $row['id']
                        );
                    } catch (Throwable $e) {
                        // segue o baile
                    }
                }
            }
        } elseif (in_array($mpStatus['status'], ['rejected', 'cancelled'], true)) {
            Db::connection()
                ->prepare("UPDATE pagamentos SET status = 'rejeitado' WHERE id = :id AND status = 'pendente'")
                ->execute(['id' => $row['id']]);
        }
    }

    private function toPublicArray(array $row): array
    {
        return [
            'id' => (int) $row['id'],
            'plano_id' => (int) $row['plano_id'],
            'valor' => (float) $row['valor'],
            'status' => (string) $row['status'],
            'metodo' => (string) ($row['metodo'] ?? 'pix'),
            'parcelas' => (int) ($row['parcelas'] ?? 1),
            'qr_code' => $row['qr_code'] ?? null,
            'qr_code_base64' => $row['qr_code_base64'] ?? null,
            'created_at' => (string) $row['created_at'],
            'paid_at' => $row['paid_at'] ?? null,
        ];
    }
}
