<?php

declare(strict_types=1);

namespace App\Services;

use App\Support\Db;

/**
 * Projetos de Lanternagem de Bojo (Acabamentos).
 * Cada "Salvar projeto" gera um registro listado em Meus Projetos > Lanternagem de Bojo.
 */
final class LanternaProjectService
{
    public function listAll(): array
    {
        $sql = <<<'SQL'
            SELECT
              lp.*,
              creator.name AS created_by_name,
              updater.name AS updated_by_name
            FROM lanterna_projects lp
            INNER JOIN users creator ON creator.id = lp.created_by
            INNER JOIN users updater ON updater.id = lp.updated_by
            ORDER BY lp.updated_at DESC, lp.id DESC
        SQL;

        $rows = Db::connection()->query($sql)->fetchAll();

        return array_map(fn (array $row) => $this->toPublicArray($row), $rows);
    }

    public function listByUserId(int $userId): array
    {
        $sql = <<<'SQL'
            SELECT
              lp.*,
              creator.name AS created_by_name,
              updater.name AS updated_by_name
            FROM lanterna_projects lp
            INNER JOIN users creator ON creator.id = lp.created_by
            INNER JOIN users updater ON updater.id = lp.updated_by
            WHERE lp.created_by = :user_id
            ORDER BY lp.updated_at DESC, lp.id DESC
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
              lp.*,
              creator.name AS created_by_name,
              updater.name AS updated_by_name
            FROM lanterna_projects lp
            INNER JOIN users creator ON creator.id = lp.created_by
            INNER JOIN users updater ON updater.id = lp.updated_by
            WHERE lp.id = :id
            LIMIT 1
        SQL;

        $stmt = Db::connection()->prepare($sql);
        $stmt->execute(['id' => $id]);
        $row = $stmt->fetch();

        return $row === false ? null : $this->toPublicArray($row);
    }

    public function findRawById(int $id): ?array
    {
        $stmt = Db::connection()->prepare('SELECT * FROM lanterna_projects WHERE id = :id LIMIT 1');
        $stmt->execute(['id' => $id]);
        $row = $stmt->fetch();

        return $row === false ? null : $row;
    }

    /**
     * @param array{
     *   nome:string,
     *   gomos:int,
     *   lanternas_por_gomo:int,
     *   lanternas_subindo:int,
     *   state:array
     * } $data
     */
    public function create(array $data, int $userId): array
    {
        $stateJson = json_encode($data['state'], JSON_UNESCAPED_UNICODE);
        if ($stateJson === false) {
            throw new \RuntimeException('Nao foi possivel serializar o estado do projeto de lanternagem.');
        }

        $stmt = Db::connection()->prepare(
            'INSERT INTO lanterna_projects
              (nome, gomos, lanternas_por_gomo, lanternas_subindo, state_json, created_by, updated_by)
             VALUES
              (:nome, :gomos, :lanternas_por_gomo, :lanternas_subindo, :state_json, :created_by, :updated_by)'
        );
        $stmt->execute([
            'nome' => $data['nome'],
            'gomos' => $data['gomos'],
            'lanternas_por_gomo' => $data['lanternas_por_gomo'],
            'lanternas_subindo' => $data['lanternas_subindo'],
            'state_json' => $stateJson,
            'created_by' => $userId,
            'updated_by' => $userId,
        ]);

        $id = (int) Db::connection()->lastInsertId();

        return $this->findById($id) ?? [];
    }

    /**
     * @param array{
     *   nome?:string,
     *   gomos?:int,
     *   lanternas_por_gomo?:int,
     *   lanternas_subindo?:int,
     *   state:array
     * } $data
     */
    public function update(int $id, array $data, int $userId): ?array
    {
        $existing = $this->findRawById($id);
        if ($existing === null) {
            return null;
        }

        $stateJson = json_encode($data['state'], JSON_UNESCAPED_UNICODE);
        if ($stateJson === false) {
            throw new \RuntimeException('Nao foi possivel serializar o estado do projeto de lanternagem.');
        }

        $nome = array_key_exists('nome', $data) ? (string) $data['nome'] : (string) $existing['nome'];
        $gomos = array_key_exists('gomos', $data) ? (int) $data['gomos'] : (int) $existing['gomos'];
        $lanternasPorGomo = array_key_exists('lanternas_por_gomo', $data)
            ? (int) $data['lanternas_por_gomo']
            : (int) $existing['lanternas_por_gomo'];
        $lanternasSubindo = array_key_exists('lanternas_subindo', $data)
            ? (int) $data['lanternas_subindo']
            : (int) $existing['lanternas_subindo'];

        $stmt = Db::connection()->prepare(
            'UPDATE lanterna_projects SET
              nome = :nome,
              gomos = :gomos,
              lanternas_por_gomo = :lanternas_por_gomo,
              lanternas_subindo = :lanternas_subindo,
              state_json = :state_json,
              updated_by = :updated_by
             WHERE id = :id'
        );
        $stmt->execute([
            'id' => $id,
            'nome' => $nome,
            'gomos' => $gomos,
            'lanternas_por_gomo' => $lanternasPorGomo,
            'lanternas_subindo' => $lanternasSubindo,
            'state_json' => $stateJson,
            'updated_by' => $userId,
        ]);

        return $this->findById($id);
    }

    public function delete(int $id): bool
    {
        $stmt = Db::connection()->prepare('DELETE FROM lanterna_projects WHERE id = :id');
        $stmt->execute(['id' => $id]);

        return $stmt->rowCount() > 0;
    }

    private function toPublicArray(array $row): array
    {
        return [
            'id' => (int) $row['id'],
            'nome' => (string) $row['nome'],
            'gomos' => (int) $row['gomos'],
            'lanternas_por_gomo' => (int) $row['lanternas_por_gomo'],
            'lanternas_subindo' => (int) $row['lanternas_subindo'],
            'state' => $this->decodeState($row['state_json'] ?? '{}'),
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

    private function decodeState(mixed $raw): array
    {
        if (is_array($raw)) {
            return $raw;
        }
        $decoded = json_decode((string) $raw, true);

        return is_array($decoded) ? $decoded : [];
    }
}
