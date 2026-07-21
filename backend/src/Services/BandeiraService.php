<?php

declare(strict_types=1);

namespace App\Services;

use App\Support\Db;

/**
 * Projeto de bandeira: imagem taqueada (pixelada) numa grade, com tamanho
 * real fisico (cm) e tabela de cores contada/nomeada.
 */
final class BandeiraService
{
    public function listAll(): array
    {
        $sql = <<<'SQL'
            SELECT
              b.*,
              creator.name AS created_by_name,
              updater.name AS updated_by_name
            FROM bandeiras b
            INNER JOIN users creator ON creator.id = b.created_by
            INNER JOIN users updater ON updater.id = b.updated_by
            ORDER BY b.updated_at DESC, b.id DESC
        SQL;

        $rows = Db::connection()->query($sql)->fetchAll();

        return array_map(fn (array $row) => $this->toPublicArray($row), $rows);
    }

    public function findById(int $id): ?array
    {
        $sql = <<<'SQL'
            SELECT
              b.*,
              creator.name AS created_by_name,
              updater.name AS updated_by_name
            FROM bandeiras b
            INNER JOIN users creator ON creator.id = b.created_by
            INNER JOIN users updater ON updater.id = b.updated_by
            WHERE b.id = :id
            LIMIT 1
        SQL;

        $stmt = Db::connection()->prepare($sql);
        $stmt->execute(['id' => $id]);
        $row = $stmt->fetch();

        return $row === false ? null : $this->toPublicArray($row);
    }

    public function findRawById(int $id): ?array
    {
        $stmt = Db::connection()->prepare('SELECT * FROM bandeiras WHERE id = :id LIMIT 1');
        $stmt->execute(['id' => $id]);
        $row = $stmt->fetch();

        return $row === false ? null : $row;
    }

    /**
     * @param array{nome:string, largura_cm:float, altura_cm:float, largura_px:int, altura_px:int, grid_runs:array<int,array{0:string,1:int}>, color_table:array<int,array{hex:string,name:string,count:int}>} $data
     */
    public function create(array $data, int $userId): array
    {
        $stmt = Db::connection()->prepare(
            'INSERT INTO bandeiras
              (nome, largura_cm, altura_cm, largura_px, altura_px, grid_json, color_table_json, created_by, updated_by)
             VALUES
              (:nome, :largura_cm, :altura_cm, :largura_px, :altura_px, :grid_json, :color_table_json, :created_by, :updated_by)'
        );
        $stmt->execute($this->bindParams($data, $userId, $userId));

        $id = (int) Db::connection()->lastInsertId();

        return $this->findById($id) ?? [];
    }

    /**
     * @param array{nome:string, largura_cm:float, altura_cm:float, largura_px:int, altura_px:int, grid_runs:array<int,array{0:string,1:int}>, color_table:array<int,array{hex:string,name:string,count:int}>} $data
     */
    public function update(int $id, array $data, int $userId): ?array
    {
        $existing = $this->findRawById($id);
        if ($existing === null) {
            return null;
        }

        $stmt = Db::connection()->prepare(
            'UPDATE bandeiras SET
              nome = :nome,
              largura_cm = :largura_cm,
              altura_cm = :altura_cm,
              largura_px = :largura_px,
              altura_px = :altura_px,
              grid_json = :grid_json,
              color_table_json = :color_table_json,
              updated_by = :updated_by
             WHERE id = :id'
        );
        $params = $this->bindParams($data, (int) $existing['created_by'], $userId);
        $params['id'] = $id;
        unset($params['created_by']);
        $stmt->execute($params);

        return $this->findById($id);
    }

    public function delete(int $id): bool
    {
        $stmt = Db::connection()->prepare('DELETE FROM bandeiras WHERE id = :id');
        $stmt->execute(['id' => $id]);

        return $stmt->rowCount() > 0;
    }

    /**
     * @param array{nome:string, largura_cm:float, altura_cm:float, largura_px:int, altura_px:int, grid_runs:array<int,array{0:string,1:int}>, color_table:array<int,array{hex:string,name:string,count:int}>} $data
     * @return array<string, mixed>
     */
    private function bindParams(array $data, int $createdBy, int $updatedBy): array
    {
        $gridJson = json_encode($data['grid_runs'], JSON_UNESCAPED_UNICODE);
        $colorTableJson = json_encode($data['color_table'], JSON_UNESCAPED_UNICODE);
        if ($gridJson === false || $colorTableJson === false) {
            throw new \RuntimeException('Nao foi possivel serializar a grade/tabela de cores da bandeira.');
        }

        return [
            'nome' => $data['nome'],
            'largura_cm' => $data['largura_cm'],
            'altura_cm' => $data['altura_cm'],
            'largura_px' => $data['largura_px'],
            'altura_px' => $data['altura_px'],
            'grid_json' => $gridJson,
            'color_table_json' => $colorTableJson,
            'created_by' => $createdBy,
            'updated_by' => $updatedBy,
        ];
    }

    private function toPublicArray(array $row): array
    {
        return [
            'id' => (int) $row['id'],
            'nome' => (string) $row['nome'],
            'largura_cm' => (float) $row['largura_cm'],
            'altura_cm' => (float) $row['altura_cm'],
            'largura_px' => (int) $row['largura_px'],
            'altura_px' => (int) $row['altura_px'],
            'grid_runs' => $this->decodeArray($row['grid_json']),
            'color_table' => $this->decodeArray($row['color_table_json']),
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

    private function decodeArray(mixed $raw): array
    {
        $decoded = is_array($raw) ? $raw : json_decode((string) $raw, true);

        return is_array($decoded) ? $decoded : [];
    }
}
