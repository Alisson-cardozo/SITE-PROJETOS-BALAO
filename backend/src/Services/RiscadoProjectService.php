<?php

declare(strict_types=1);

namespace App\Services;

use App\Support\Db;

/**
 * Projetos do Plotter Riscado (Lek + aba Editar).
 * Cada "Usar lek" gera um registro listado em Meus Projetos > Moldes Riscados.
 */
final class RiscadoProjectService
{
    public function listAll(): array
    {
        $sql = <<<'SQL'
            SELECT
              rp.*,
              creator.name AS created_by_name,
              updater.name AS updated_by_name
            FROM riscado_projects rp
            INNER JOIN users creator ON creator.id = rp.created_by
            INNER JOIN users updater ON updater.id = rp.updated_by
            ORDER BY rp.updated_at DESC, rp.id DESC
        SQL;

        $rows = Db::connection()->query($sql)->fetchAll();

        return array_map(fn (array $row) => $this->toPublicArray($row), $rows);
    }

    public function listByUserId(int $userId): array
    {
        $sql = <<<'SQL'
            SELECT
              rp.*,
              creator.name AS created_by_name,
              updater.name AS updated_by_name
            FROM riscado_projects rp
            INNER JOIN users creator ON creator.id = rp.created_by
            INNER JOIN users updater ON updater.id = rp.updated_by
            WHERE rp.created_by = :user_id
            ORDER BY rp.updated_at DESC, rp.id DESC
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
              rp.*,
              creator.name AS created_by_name,
              updater.name AS updated_by_name
            FROM riscado_projects rp
            INNER JOIN users creator ON creator.id = rp.created_by
            INNER JOIN users updater ON updater.id = rp.updated_by
            WHERE rp.id = :id
            LIMIT 1
        SQL;

        $stmt = Db::connection()->prepare($sql);
        $stmt->execute(['id' => $id]);
        $row = $stmt->fetch();

        return $row === false ? null : $this->toPublicArray($row);
    }

    public function findRawById(int $id): ?array
    {
        $stmt = Db::connection()->prepare('SELECT * FROM riscado_projects WHERE id = :id LIMIT 1');
        $stmt->execute(['id' => $id]);
        $row = $stmt->fetch();

        return $row === false ? null : $row;
    }

    /**
     * @param array{
     *   nome:string,
     *   modelo_key:string,
     *   modelo_nome:string,
     *   altura_cm:float,
     *   quantidade_gomos:int,
     *   bainha_cm:float,
     *   state:array
     * } $data
     */
    public function create(array $data, int $userId): array
    {
        $stateJson = json_encode($data['state'], JSON_UNESCAPED_UNICODE);
        if ($stateJson === false) {
            throw new \RuntimeException('Nao foi possivel serializar o estado do projeto riscado.');
        }

        $stmt = Db::connection()->prepare(
            'INSERT INTO riscado_projects
              (nome, modelo_key, modelo_nome, altura_cm, quantidade_gomos, bainha_cm, state_json, created_by, updated_by)
             VALUES
              (:nome, :modelo_key, :modelo_nome, :altura_cm, :quantidade_gomos, :bainha_cm, :state_json, :created_by, :updated_by)'
        );
        $stmt->execute([
            'nome' => $data['nome'],
            'modelo_key' => $data['modelo_key'],
            'modelo_nome' => $data['modelo_nome'],
            'altura_cm' => $data['altura_cm'],
            'quantidade_gomos' => $data['quantidade_gomos'],
            'bainha_cm' => $data['bainha_cm'],
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
     *   modelo_key?:string,
     *   modelo_nome?:string,
     *   altura_cm?:float,
     *   quantidade_gomos?:int,
     *   bainha_cm?:float,
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
            throw new \RuntimeException('Nao foi possivel serializar o estado do projeto riscado.');
        }

        $nome = array_key_exists('nome', $data) ? (string) $data['nome'] : (string) $existing['nome'];
        $modeloKey = array_key_exists('modelo_key', $data) ? (string) $data['modelo_key'] : (string) $existing['modelo_key'];
        $modeloNome = array_key_exists('modelo_nome', $data) ? (string) $data['modelo_nome'] : (string) $existing['modelo_nome'];
        $altura = array_key_exists('altura_cm', $data) ? (float) $data['altura_cm'] : (float) $existing['altura_cm'];
        $gomos = array_key_exists('quantidade_gomos', $data) ? (int) $data['quantidade_gomos'] : (int) $existing['quantidade_gomos'];
        $bainha = array_key_exists('bainha_cm', $data) ? (float) $data['bainha_cm'] : (float) $existing['bainha_cm'];

        $stmt = Db::connection()->prepare(
            'UPDATE riscado_projects SET
              nome = :nome,
              modelo_key = :modelo_key,
              modelo_nome = :modelo_nome,
              altura_cm = :altura_cm,
              quantidade_gomos = :quantidade_gomos,
              bainha_cm = :bainha_cm,
              state_json = :state_json,
              updated_by = :updated_by
             WHERE id = :id'
        );
        $stmt->execute([
            'id' => $id,
            'nome' => $nome,
            'modelo_key' => $modeloKey,
            'modelo_nome' => $modeloNome,
            'altura_cm' => $altura,
            'quantidade_gomos' => $gomos,
            'bainha_cm' => $bainha,
            'state_json' => $stateJson,
            'updated_by' => $userId,
        ]);

        return $this->findById($id);
    }

    public function delete(int $id): bool
    {
        $stmt = Db::connection()->prepare('DELETE FROM riscado_projects WHERE id = :id');
        $stmt->execute(['id' => $id]);

        return $stmt->rowCount() > 0;
    }

    private function toPublicArray(array $row): array
    {
        return [
            'id' => (int) $row['id'],
            'nome' => (string) $row['nome'],
            'modelo_key' => (string) $row['modelo_key'],
            'modelo_nome' => (string) $row['modelo_nome'],
            'altura_cm' => (float) $row['altura_cm'],
            'quantidade_gomos' => (int) $row['quantidade_gomos'],
            'bainha_cm' => (float) $row['bainha_cm'],
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
