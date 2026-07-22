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
                    $this->users->grantAccess((int) $row['user_id'], (int) $plano['dias_acesso']);
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
            'qr_code' => $row['qr_code'] ?? null,
            'qr_code_base64' => $row['qr_code_base64'] ?? null,
            'created_at' => (string) $row['created_at'],
            'paid_at' => $row['paid_at'] ?? null,
        ];
    }
}
