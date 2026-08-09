<?php

declare(strict_types=1);

namespace App\Services;

use App\Support\Db;

/**
 * Um "projeto" e uma configuracao de plotter (cores, tacos, reparticoes,
 * proporcoes) salva para um molde. Um MESMO molde pode ter varios projetos —
 * plotar de novo nunca sobrescreve um projeto ja salvo, sempre cria um novo.
 */
final class MoldProjectService
{
    public function listAll(): array
    {
        $sql = <<<'SQL'
            SELECT
              mp.*,
              m.nome AS mold_nome,
              m.modelo AS mold_modelo,
              m.quantidade_gomos AS mold_quantidade_gomos,
              m.bainha_cm AS mold_bainha_cm,
              m.altura_total_cm AS mold_altura_total_cm,
              m.pontos_json AS mold_pontos_json,
              creator.name AS created_by_name,
              updater.name AS updated_by_name,
              ROW_NUMBER() OVER (PARTITION BY mp.mold_id ORDER BY mp.id ASC) AS project_number
            FROM mold_projects mp
            INNER JOIN molds m ON m.id = mp.mold_id
            INNER JOIN users creator ON creator.id = mp.created_by
            INNER JOIN users updater ON updater.id = mp.updated_by
            ORDER BY mp.updated_at DESC, mp.id DESC
        SQL;

        $rows = Db::connection()->query($sql)->fetchAll();

        return array_map(fn (array $row) => $this->toPublicArray($row), $rows);
    }

    public function listByUserId(int $userId): array
    {
        $sql = <<<'SQL'
            SELECT
              mp.*,
              m.nome AS mold_nome,
              m.modelo AS mold_modelo,
              m.quantidade_gomos AS mold_quantidade_gomos,
              m.bainha_cm AS mold_bainha_cm,
              m.altura_total_cm AS mold_altura_total_cm,
              m.pontos_json AS mold_pontos_json,
              creator.name AS created_by_name,
              updater.name AS updated_by_name,
              ROW_NUMBER() OVER (PARTITION BY mp.mold_id ORDER BY mp.id ASC) AS project_number
            FROM mold_projects mp
            INNER JOIN molds m ON m.id = mp.mold_id
            INNER JOIN users creator ON creator.id = mp.created_by
            INNER JOIN users updater ON updater.id = mp.updated_by
            WHERE mp.created_by = :user_id
            ORDER BY mp.updated_at DESC, mp.id DESC
        SQL;

        $stmt = Db::connection()->prepare($sql);
        $stmt->execute(['user_id' => $userId]);
        $rows = $stmt->fetchAll();

        return array_map(fn (array $row) => $this->toPublicArray($row), $rows);
    }

    public function findById(int $id): ?array
    {
        $sql = <<<'SQL'
            SELECT
              mp.*,
              m.nome AS mold_nome,
              m.modelo AS mold_modelo,
              m.quantidade_gomos AS mold_quantidade_gomos,
              m.bainha_cm AS mold_bainha_cm,
              m.altura_total_cm AS mold_altura_total_cm,
              m.pontos_json AS mold_pontos_json,
              creator.name AS created_by_name,
              updater.name AS updated_by_name,
              (
                SELECT COUNT(*) FROM mold_projects sibling
                WHERE sibling.mold_id = mp.mold_id AND sibling.id <= mp.id
              ) AS project_number
            FROM mold_projects mp
            INNER JOIN molds m ON m.id = mp.mold_id
            INNER JOIN users creator ON creator.id = mp.created_by
            INNER JOIN users updater ON updater.id = mp.updated_by
            WHERE mp.id = :id
            LIMIT 1
        SQL;

        $stmt = Db::connection()->prepare($sql);
        $stmt->execute(['id' => $id]);
        $row = $stmt->fetch();

        return $row === false ? null : $this->toPublicArray($row);
    }

    public function findRawById(int $id): ?array
    {
        $stmt = Db::connection()->prepare('SELECT * FROM mold_projects WHERE id = :id LIMIT 1');
        $stmt->execute(['id' => $id]);
        $row = $stmt->fetch();

        return $row === false ? null : $row;
    }

    /**
     * Cria um projeto NOVO para o molde (nunca sobrescreve um existente).
     */
    public function create(int $moldId, array $config, int $userId): array
    {
        $configJson = json_encode($config, JSON_UNESCAPED_UNICODE);
        if ($configJson === false) {
            throw new \RuntimeException('Nao foi possivel serializar a configuracao do plotter.');
        }

        $stmt = Db::connection()->prepare(
            'INSERT INTO mold_projects (mold_id, plotter_config_json, created_by, updated_by)
             VALUES (:mold_id, :plotter_config_json, :created_by, :updated_by)'
        );
        $stmt->execute([
            'mold_id' => $moldId,
            'plotter_config_json' => $configJson,
            'created_by' => $userId,
            'updated_by' => $userId,
        ]);

        $id = (int) Db::connection()->lastInsertId();

        return $this->findById($id) ?? [];
    }

    /**
     * Atualiza a configuracao de UM projeto ja existente (usado ao editar via
     * "Modificar" — continua sendo o mesmo projeto, so muda o conteudo).
     */
    public function update(int $id, array $config, int $userId): ?array
    {
        $existing = $this->findRawById($id);
        if ($existing === null) {
            return null;
        }

        $configJson = json_encode($config, JSON_UNESCAPED_UNICODE);
        if ($configJson === false) {
            throw new \RuntimeException('Nao foi possivel serializar a configuracao do plotter.');
        }

        $stmt = Db::connection()->prepare(
            'UPDATE mold_projects SET plotter_config_json = :plotter_config_json, updated_by = :updated_by WHERE id = :id'
        );
        $stmt->execute([
            'id' => $id,
            'plotter_config_json' => $configJson,
            'updated_by' => $userId,
        ]);

        return $this->findById($id);
    }

    public function delete(int $id): bool
    {
        $stmt = Db::connection()->prepare('DELETE FROM mold_projects WHERE id = :id');
        $stmt->execute(['id' => $id]);

        return $stmt->rowCount() > 0;
    }

    private function toPublicArray(array $row): array
    {
        $pontos = $this->decodePontos($row['mold_pontos_json'] ?? '[]');
        $projectNumber = (int) ($row['project_number'] ?? 1);
        $moldNome = (string) $row['mold_nome'];

        return [
            'id' => (int) $row['id'],
            'mold_id' => (int) $row['mold_id'],
            'project_number' => $projectNumber,
            'nome' => $moldNome,
            'display_nome' => $projectNumber > 1 ? "{$moldNome} ({$projectNumber})" : $moldNome,
            'modelo' => (string) $row['mold_modelo'],
            'quantidade_gomos' => (int) $row['mold_quantidade_gomos'],
            'bainha_cm' => (float) $row['mold_bainha_cm'],
            'altura_total_cm' => (float) $row['mold_altura_total_cm'],
            'pontos' => $pontos,
            'plotter_config' => $this->decodePlotterConfig($row['plotter_config_json']),
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

    private function decodePlotterConfig(mixed $raw): array
    {
        $decoded = is_array($raw) ? $raw : json_decode((string) $raw, true);

        return is_array($decoded) ? $decoded : [];
    }

    /**
     * @return array<int, array{altura_cm: float, largura_meia_cm: float}>
     */
    private function decodePontos(mixed $raw): array
    {
        $decoded = is_array($raw) ? $raw : json_decode((string) $raw, true);
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
