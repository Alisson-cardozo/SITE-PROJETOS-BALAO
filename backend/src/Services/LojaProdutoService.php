<?php

declare(strict_types=1);

namespace App\Services;

use App\Support\Db;

/**
 * Produtos da Loja (vitrine admin-only) — cada produto e um item UNICO (nao
 * e SKU com estoque): "disponivel" -> "reservado" (Pix pendente de um
 * comprador) -> "vendido" (pago, nunca mais volta a ficar disponivel). Uma
 * reserva expirada (Pix nao pago dentro do prazo) libera o produto de volta
 * pra "disponivel" sozinha, sem cron — a checagem roda de forma preguicosa
 * (liberarReservasExpiradas) sempre que a vitrine publica e consultada.
 */
final class LojaProdutoService
{
    public const RESERVA_MINUTOS = 30;

    public function listAllAdmin(): array
    {
        $sql = <<<'SQL'
            SELECT
              lp.*,
              creator.name AS created_by_name,
              updater.name AS updated_by_name
            FROM loja_produtos lp
            INNER JOIN users creator ON creator.id = lp.created_by
            INNER JOIN users updater ON updater.id = lp.updated_by
            ORDER BY lp.created_at DESC, lp.id DESC
        SQL;

        $rows = Db::connection()->query($sql)->fetchAll();

        return array_map(fn (array $row) => $this->toAdminArray($row), $rows);
    }

    public function findRawById(int $id): ?array
    {
        $stmt = Db::connection()->prepare('SELECT * FROM loja_produtos WHERE id = :id LIMIT 1');
        $stmt->execute(['id' => $id]);
        $row = $stmt->fetch();

        return $row === false ? null : $row;
    }

    public function findByIdAdmin(int $id): ?array
    {
        $sql = <<<'SQL'
            SELECT
              lp.*,
              creator.name AS created_by_name,
              updater.name AS updated_by_name
            FROM loja_produtos lp
            INNER JOIN users creator ON creator.id = lp.created_by
            INNER JOIN users updater ON updater.id = lp.updated_by
            WHERE lp.id = :id
            LIMIT 1
        SQL;

        $stmt = Db::connection()->prepare($sql);
        $stmt->execute(['id' => $id]);
        $row = $stmt->fetch();

        return $row === false ? null : $this->toAdminArray($row);
    }

    /** Vitrine publica -- libera reservas expiradas antes de listar. */
    public function listPublic(): array
    {
        $this->liberarReservasExpiradas();

        $stmt = Db::connection()->query('SELECT * FROM loja_produtos ORDER BY created_at DESC, id DESC');
        $rows = $stmt->fetchAll();

        return array_map(fn (array $row) => $this->toPublicArray($row), $rows);
    }

    public function findByIdPublic(int $id): ?array
    {
        $this->liberarReservasExpiradas();
        $row = $this->findRawById($id);

        return $row === null ? null : $this->toPublicArray($row);
    }

    /**
     * @param array{nome:string, descricao:string, valor:float, link_arquivo:string, imagem1_path?:?string, imagem2_path?:?string, imagem3_path?:?string, imagem4_path?:?string} $data
     */
    public function create(array $data, int $userId): array
    {
        $stmt = Db::connection()->prepare(
            'INSERT INTO loja_produtos
              (nome, descricao, valor, link_arquivo, imagem1_path, imagem2_path, imagem3_path, imagem4_path, created_by, updated_by)
             VALUES
              (:nome, :descricao, :valor, :link_arquivo, :imagem1, :imagem2, :imagem3, :imagem4, :created_by, :updated_by)'
        );
        $stmt->execute([
            'nome' => $data['nome'],
            'descricao' => $data['descricao'],
            'valor' => $data['valor'],
            'link_arquivo' => $data['link_arquivo'],
            'imagem1' => $data['imagem1_path'] ?? null,
            'imagem2' => $data['imagem2_path'] ?? null,
            'imagem3' => $data['imagem3_path'] ?? null,
            'imagem4' => $data['imagem4_path'] ?? null,
            'created_by' => $userId,
            'updated_by' => $userId,
        ]);

        $id = (int) Db::connection()->lastInsertId();

        return $this->findByIdAdmin($id) ?? [];
    }

    /**
     * @param array{nome:string, descricao:string, valor:float, link_arquivo:string} $data
     */
    public function update(int $id, array $data, int $userId): ?array
    {
        $stmt = Db::connection()->prepare(
            'UPDATE loja_produtos SET
              nome = :nome, descricao = :descricao, valor = :valor, link_arquivo = :link_arquivo,
              updated_by = :updated_by
             WHERE id = :id'
        );
        $stmt->execute([
            'id' => $id,
            'nome' => $data['nome'],
            'descricao' => $data['descricao'],
            'valor' => $data['valor'],
            'link_arquivo' => $data['link_arquivo'],
            'updated_by' => $userId,
        ]);

        return $this->findByIdAdmin($id);
    }

    public function delete(int $id): bool
    {
        $stmt = Db::connection()->prepare('DELETE FROM loja_produtos WHERE id = :id');
        $stmt->execute(['id' => $id]);

        return $stmt->rowCount() > 0;
    }

    /**
     * Tenta reservar o produto pra esse comprador -- so funciona se ainda
     * estiver "disponivel" (guarda contra 2 pessoas comprando ao mesmo
     * tempo: quem realmente mudar a linha, rowCount() > 0, e quem ganha).
     */
    public function reservarParaPagamento(int $produtoId, string $email): bool
    {
        $expiraEm = date('Y-m-d H:i:s', time() + self::RESERVA_MINUTOS * 60);

        $stmt = Db::connection()->prepare(
            "UPDATE loja_produtos SET status = 'reservado', reservado_email = :email, reserva_expira_em = :expira
             WHERE id = :id AND status = 'disponivel'"
        );
        $stmt->execute(['email' => $email, 'expira' => $expiraEm, 'id' => $produtoId]);

        return $stmt->rowCount() > 0;
    }

    /** Devolve o produto pra "disponivel" (Pix nao pago/recusado/expirado). */
    public function liberarReserva(int $produtoId): void
    {
        Db::connection()->prepare(
            "UPDATE loja_produtos SET status = 'disponivel', reservado_email = NULL, reserva_expira_em = NULL
             WHERE id = :id AND status = 'reservado'"
        )->execute(['id' => $produtoId]);
    }

    /** Marca vendido de vez -- nunca mais volta a ficar disponivel. */
    public function marcarVendido(int $produtoId, string $email): bool
    {
        $stmt = Db::connection()->prepare(
            "UPDATE loja_produtos SET status = 'vendido', comprador_email = :email, vendido_em = NOW()
             WHERE id = :id AND status = 'reservado'"
        );
        $stmt->execute(['email' => $email, 'id' => $produtoId]);

        return $stmt->rowCount() > 0;
    }

    /**
     * Libera reservas expiradas de volta pra "disponivel" e marca o Pix
     * pendente correspondente como rejeitado -- roda antes de toda consulta
     * publica (sem cron nenhum, so preguicoso).
     */
    public function liberarReservasExpiradas(): void
    {
        $stmt = Db::connection()->query(
            "SELECT id FROM loja_produtos WHERE status = 'reservado' AND reserva_expira_em < NOW()"
        );
        $expiredIds = array_map(static fn (array $row) => (int) $row['id'], $stmt->fetchAll());

        foreach ($expiredIds as $produtoId) {
            $this->liberarReserva($produtoId);
            Db::connection()
                ->prepare("UPDATE loja_pagamentos SET status = 'rejeitado' WHERE produto_id = :produto_id AND status = 'pendente'")
                ->execute(['produto_id' => $produtoId]);
        }
    }

    private function imagens(array $row): array
    {
        return array_values(array_filter(array_map(
            fn (?string $path) => $path === null ? null : '/' . ltrim($path, '/'),
            [$row['imagem1_path'], $row['imagem2_path'], $row['imagem3_path'], $row['imagem4_path']]
        )));
    }

    /** Nunca expoe link_arquivo, reservado_email nem comprador_email aqui. */
    private function toPublicArray(array $row): array
    {
        return [
            'id' => (int) $row['id'],
            'nome' => (string) $row['nome'],
            'descricao' => (string) $row['descricao'],
            'valor' => (float) $row['valor'],
            'imagens' => $this->imagens($row),
            'status' => (string) $row['status'],
        ];
    }

    private function toAdminArray(array $row): array
    {
        return [
            'id' => (int) $row['id'],
            'nome' => (string) $row['nome'],
            'descricao' => (string) $row['descricao'],
            'valor' => (float) $row['valor'],
            'link_arquivo' => (string) $row['link_arquivo'],
            'imagens' => $this->imagens($row),
            'status' => (string) $row['status'],
            'reservado_email' => $row['reservado_email'] ?? null,
            'reserva_expira_em' => $row['reserva_expira_em'] ?? null,
            'comprador_email' => $row['comprador_email'] ?? null,
            'vendido_em' => $row['vendido_em'] ?? null,
            'created_by' => (string) ($row['created_by_name'] ?? ''),
            'updated_by' => (string) ($row['updated_by_name'] ?? ''),
            'created_at' => (string) $row['created_at'],
            'updated_at' => (string) $row['updated_at'],
        ];
    }
}
