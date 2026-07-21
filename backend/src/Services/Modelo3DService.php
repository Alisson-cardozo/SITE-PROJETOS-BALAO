<?php

declare(strict_types=1);

namespace App\Services;

use App\Support\Db;

final class Modelo3DService
{
    public function listAll(): array
    {
        $sql = <<<'SQL'
            SELECT
              m.*,
              creator.name AS created_by_name,
              updater.name AS updated_by_name
            FROM modelos_3d m
            INNER JOIN users creator ON creator.id = m.created_by
            INNER JOIN users updater ON updater.id = m.updated_by
            ORDER BY m.nome ASC, m.id ASC
        SQL;

        $rows = Db::connection()->query($sql)->fetchAll();

        return array_map(fn (array $row) => $this->toPublicArray($row), $rows);
    }

    public function findRawById(int $id): ?array
    {
        $stmt = Db::connection()->prepare('SELECT * FROM modelos_3d WHERE id = :id LIMIT 1');
        $stmt->execute(['id' => $id]);
        $row = $stmt->fetch();

        return $row === false ? null : $row;
    }

    private function findById(int $id): ?array
    {
        $sql = <<<'SQL'
            SELECT
              m.*,
              creator.name AS created_by_name,
              updater.name AS updated_by_name
            FROM modelos_3d m
            INNER JOIN users creator ON creator.id = m.created_by
            INNER JOIN users updater ON updater.id = m.updated_by
            WHERE m.id = :id
            LIMIT 1
        SQL;

        $stmt = Db::connection()->prepare($sql);
        $stmt->execute(['id' => $id]);
        $row = $stmt->fetch();

        return $row === false ? null : $this->toPublicArray($row);
    }

    /**
     * @param array{nome:string,quantidade_gomos:int,pontos:array<int,array{altura_cm:float,largura_meia_cm:float}>} $data
     */
    public function create(array $data, int $userId): array
    {
        $alturaTotal = $this->computeAlturaTotal($data['pontos']);
        $pontosJson = json_encode($data['pontos'], JSON_UNESCAPED_UNICODE);
        if ($pontosJson === false) {
            throw new \RuntimeException('Nao foi possivel serializar os pontos do modelo.');
        }

        $stmt = Db::connection()->prepare(
            'INSERT INTO modelos_3d
              (nome, quantidade_gomos, altura_total_cm, pontos_json, created_by, updated_by)
             VALUES
              (:nome, :quantidade_gomos, :altura_total_cm, :pontos_json, :created_by, :updated_by)'
        );
        $stmt->execute([
            'nome' => $data['nome'],
            'quantidade_gomos' => $data['quantidade_gomos'],
            'altura_total_cm' => $alturaTotal,
            'pontos_json' => $pontosJson,
            'created_by' => $userId,
            'updated_by' => $userId,
        ]);

        $id = (int) Db::connection()->lastInsertId();

        return $this->findById($id) ?? [];
    }

    public function delete(int $id): bool
    {
        $stmt = Db::connection()->prepare('DELETE FROM modelos_3d WHERE id = :id');
        $stmt->execute(['id' => $id]);

        return $stmt->rowCount() > 0;
    }

    public function renomear(int $id, string $nome, int $userId): ?array
    {
        $stmt = Db::connection()->prepare(
            'UPDATE modelos_3d SET nome = :nome, updated_by = :updated_by WHERE id = :id'
        );
        $stmt->execute(['id' => $id, 'nome' => $nome, 'updated_by' => $userId]);

        return $this->findById($id);
    }

    /**
     * @param array<int, array{altura_cm:float|int|string, largura_meia_cm:float|int|string}> $pontos
     */
    private function computeAlturaTotal(array $pontos): float
    {
        $total = 0.0;
        foreach ($pontos as $ponto) {
            $total += (float) ($ponto['altura_cm'] ?? 0);
        }

        return round($total, 2);
    }

    private function toPublicArray(array $row): array
    {
        return [
            'id' => (int) $row['id'],
            'nome' => (string) $row['nome'],
            'quantidade_gomos' => (int) $row['quantidade_gomos'],
            'altura_total_cm' => (float) $row['altura_total_cm'],
            'pontos' => $this->decodePontos($row['pontos_json'] ?? '[]'),
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

    /**
     * @return array<int, array{altura_cm: float, largura_meia_cm: float}>
     */
    private function decodePontos(mixed $raw): array
    {
        if (is_array($raw)) {
            $decoded = $raw;
        } else {
            $decoded = json_decode((string) $raw, true);
        }

        if (!is_array($decoded)) {
            return [];
        }

        $pontos = [];
        foreach ($decoded as $item) {
            if (!is_array($item)) {
                continue;
            }
            $pontos[] = [
                'altura_cm' => (float) ($item['altura_cm'] ?? 0),
                'largura_meia_cm' => (float) ($item['largura_meia_cm'] ?? 0),
            ];
        }

        return $pontos;
    }
}
