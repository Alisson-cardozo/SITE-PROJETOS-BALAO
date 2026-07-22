<?php

declare(strict_types=1);

namespace App\Services;

use App\Support\Db;

final class PlanoService
{
    public function listAll(bool $includeInactive = false): array
    {
        $where = $includeInactive ? '' : 'WHERE p.ativo = 1';
        $sql = <<<SQL
            SELECT
              p.*,
              creator.name AS created_by_name,
              updater.name AS updated_by_name
            FROM planos p
            INNER JOIN users creator ON creator.id = p.created_by
            INNER JOIN users updater ON updater.id = p.updated_by
            {$where}
            ORDER BY p.valor ASC, p.id ASC
        SQL;

        $rows = Db::connection()->query($sql)->fetchAll();

        return array_map(fn (array $row) => $this->toPublicArray($row), $rows);
    }

    public function findRawById(int $id): ?array
    {
        $stmt = Db::connection()->prepare('SELECT * FROM planos WHERE id = :id LIMIT 1');
        $stmt->execute(['id' => $id]);
        $row = $stmt->fetch();

        return $row === false ? null : $row;
    }

    private function findById(int $id): ?array
    {
        $sql = <<<'SQL'
            SELECT
              p.*,
              creator.name AS created_by_name,
              updater.name AS updated_by_name
            FROM planos p
            INNER JOIN users creator ON creator.id = p.created_by
            INNER JOIN users updater ON updater.id = p.updated_by
            WHERE p.id = :id
            LIMIT 1
        SQL;

        $stmt = Db::connection()->prepare($sql);
        $stmt->execute(['id' => $id]);
        $row = $stmt->fetch();

        return $row === false ? null : $this->toPublicArray($row);
    }

    /**
     * @param array{nome:string, valor:float, dias_acesso:int} $data
     */
    public function create(array $data, int $userId): array
    {
        $stmt = Db::connection()->prepare(
            'INSERT INTO planos (nome, valor, dias_acesso, created_by, updated_by)
             VALUES (:nome, :valor, :dias_acesso, :created_by, :updated_by)'
        );
        $stmt->execute([
            'nome' => $data['nome'],
            'valor' => $data['valor'],
            'dias_acesso' => $data['dias_acesso'],
            'created_by' => $userId,
            'updated_by' => $userId,
        ]);

        $id = (int) Db::connection()->lastInsertId();

        return $this->findById($id) ?? [];
    }

    /**
     * @param array{nome:string, valor:float, dias_acesso:int} $data
     */
    public function update(int $id, array $data, int $userId): ?array
    {
        $stmt = Db::connection()->prepare(
            'UPDATE planos SET nome = :nome, valor = :valor, dias_acesso = :dias_acesso, updated_by = :updated_by
             WHERE id = :id'
        );
        $stmt->execute([
            'id' => $id,
            'nome' => $data['nome'],
            'valor' => $data['valor'],
            'dias_acesso' => $data['dias_acesso'],
            'updated_by' => $userId,
        ]);

        return $this->findById($id);
    }

    public function setAtivo(int $id, bool $ativo, int $userId): ?array
    {
        $stmt = Db::connection()->prepare(
            'UPDATE planos SET ativo = :ativo, updated_by = :updated_by WHERE id = :id'
        );
        $stmt->execute(['id' => $id, 'ativo' => $ativo ? 1 : 0, 'updated_by' => $userId]);

        return $this->findById($id);
    }

    public function delete(int $id): bool
    {
        $stmt = Db::connection()->prepare('DELETE FROM planos WHERE id = :id');
        $stmt->execute(['id' => $id]);

        return $stmt->rowCount() > 0;
    }

    private function toPublicArray(array $row): array
    {
        return [
            'id' => (int) $row['id'],
            'nome' => (string) $row['nome'],
            'valor' => (float) $row['valor'],
            'dias_acesso' => (int) $row['dias_acesso'],
            'ativo' => ((int) $row['ativo']) === 1,
            'created_by' => [
                'id' => (int) $row['created_by'],
                'name' => (string) ($row['created_by_name'] ?? ''),
            ],
            'updated_by' => [
                'id' => (int) $row['updated_by'],
                'name' => (string) ($row['updated_by_name'] ?? ''),
            ],
            'created_at' => (string) $row['created_at'],
            'updated_at' => (string) $row['updated_at'],
        ];
    }
}
