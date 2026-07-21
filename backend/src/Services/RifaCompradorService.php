<?php

declare(strict_types=1);

namespace App\Services;

use App\Support\Db;

final class RifaCompradorService
{
    /**
     * @param array{nome:string, whatsapp:string, email:?string, quantidade_numeros:int, valor_total:float, forma_pagamento:string} $data
     */
    public function create(int $rifaId, array $data): array
    {
        $status = $data['status'] ?? 'aguardando_pagamento';
        // So quem ainda esta 'aguardando_pagamento' tem prazo de expiracao — uma venda
        // manual lancada ja como 'pago' (o dono confirmou na hora) nao expira nunca.
        $expiraEm = $status === 'aguardando_pagamento' ? $this->holdExpiry() : null;

        $stmt = Db::connection()->prepare(
            'INSERT INTO rifa_compradores
              (rifa_id, nome, whatsapp, email, quantidade_numeros, valor_total, forma_pagamento, status, expira_em)
             VALUES
              (:rifa_id, :nome, :whatsapp, :email, :quantidade_numeros, :valor_total, :forma_pagamento, :status, :expira_em)'
        );
        $stmt->execute([
            'rifa_id' => $rifaId,
            'nome' => $data['nome'],
            'whatsapp' => $data['whatsapp'],
            'email' => $data['email'] ?? null,
            'quantidade_numeros' => $data['quantidade_numeros'],
            'valor_total' => $data['valor_total'],
            'forma_pagamento' => $data['forma_pagamento'],
            'status' => $data['status'] ?? 'aguardando_pagamento',
            'expira_em' => $expiraEm,
        ]);

        $id = (int) Db::connection()->lastInsertId();

        return $this->findById($id) ?? [];
    }

    public function findById(int $id): ?array
    {
        $stmt = Db::connection()->prepare('SELECT * FROM rifa_compradores WHERE id = :id LIMIT 1');
        $stmt->execute(['id' => $id]);
        $row = $stmt->fetch();

        return $row === false ? null : $row;
    }

    public function listByRifa(int $rifaId): array
    {
        $stmt = Db::connection()->prepare('SELECT * FROM rifa_compradores WHERE rifa_id = :rifa_id ORDER BY created_at DESC');
        $stmt->execute(['rifa_id' => $rifaId]);

        return $stmt->fetchAll();
    }

    /** Soma so o que ja foi PAGO — nunca inclui reservas ainda aguardando pagamento. */
    public function sumValorArrecadado(int $rifaId): float
    {
        $stmt = Db::connection()->prepare(
            "SELECT COALESCE(SUM(valor_total), 0) FROM rifa_compradores WHERE rifa_id = ? AND status = 'pago'"
        );
        $stmt->execute([$rifaId]);

        return (float) $stmt->fetchColumn();
    }

    public function markPago(int $id): void
    {
        $stmt = Db::connection()->prepare("UPDATE rifa_compradores SET status = 'pago', pago_em = NOW() WHERE id = :id");
        $stmt->execute(['id' => $id]);
    }

    public function markCancelado(int $id): void
    {
        $stmt = Db::connection()->prepare("UPDATE rifa_compradores SET status = 'cancelado' WHERE id = :id");
        $stmt->execute(['id' => $id]);
    }

    private function holdExpiry(): string
    {
        return (new \DateTimeImmutable('+' . RifaNumeroService::HOLD_MINUTES . ' minutes'))->format('Y-m-d H:i:s');
    }
}
