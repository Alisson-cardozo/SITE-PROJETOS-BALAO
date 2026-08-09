<?php

declare(strict_types=1);

namespace App\Services;

use App\Support\Db;

final class PlanoService
{
    /**
     * Todas as abas "de verdade" do sistema, na granularidade que da pra
     * aplicar no backend (algumas telas do frontend, tipo "Galeria de
     * Moldes" e "Adicionar Tabela de Molde", dividem a mesma rota/prefixo de
     * API e por isso contam como UMA aba so aqui — ver AbaAccessMiddleware e
     * routes/api.php). Usada como fallback de "libera tudo" pra planos sem
     * abas_json definido (legado) e como allowlist de validacao.
     */
    public const ALL_ABAS = [
        'moldes',
        'plotter-tacos',
        'plotter-riscado',
        'bandeiras',
        'painel-letreiros',
        '3d-fotos',
        'profissionais',
        'acabamentos',
    ];

    /**
     * Abas que o plano `$planoId` libera. `null` (id ou retorno) sempre
     * significa "sem restricao, libera tudo" — usuario sem plano especifico
     * (acesso manual do admin) ou plano sem abas_json definido (criado antes
     * dessa coluna existir, ou explicitamente marcado como "todas").
     *
     * @return array<int,string>|null
     */
    public function abasForPlanoId(?int $planoId): ?array
    {
        if ($planoId === null) {
            return null;
        }

        $plano = $this->findRawById($planoId);

        return $plano === null ? null : $this->decodeAbas($plano['abas_json'] ?? null);
    }

    /** @return array<int,string>|null null = sem abas_json (plano legado / "todas") */
    private function decodeAbas(?string $abasJson): ?array
    {
        if (empty($abasJson)) {
            return null;
        }

        $decoded = json_decode($abasJson, true);
        if (!is_array($decoded)) {
            return null;
        }

        return array_values(array_filter($decoded, 'is_string'));
    }

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
     * @param array{nome:string, valor:float, dias_acesso:int, abas:array<int,string>|null, show_in_ranking:bool, sales_override_count:int} $data
     */
    public function create(array $data, int $userId): array
    {
        $stmt = Db::connection()->prepare(
            'INSERT INTO planos (nome, valor, dias_acesso, abas_json, created_by, updated_by, show_in_ranking, sales_override_count)
             VALUES (:nome, :valor, :dias_acesso, :abas_json, :created_by, :updated_by, :show_in_ranking, :sales_override_count)'
        );
        $stmt->execute([
            'nome' => $data['nome'],
            'valor' => $data['valor'],
            'dias_acesso' => $data['dias_acesso'],
            'abas_json' => $this->encodeAbas($data['abas']),
            'created_by' => $userId,
            'updated_by' => $userId,
            'show_in_ranking' => $data['show_in_ranking'] ? 1 : 0,
            'sales_override_count' => (int) $data['sales_override_count'],
        ]);

        $id = (int) Db::connection()->lastInsertId();

        return $this->findById($id) ?? [];
    }

    /**
     * @param array{nome:string, valor:float, dias_acesso:int, abas:array<int,string>|null, show_in_ranking:bool, sales_override_count:int} $data
     */
    public function update(int $id, array $data, int $userId): ?array
    {
        $stmt = Db::connection()->prepare(
            'UPDATE planos SET nome = :nome, valor = :valor, dias_acesso = :dias_acesso,
               abas_json = :abas_json, updated_by = :updated_by, show_in_ranking = :show_in_ranking,
               sales_override_count = :sales_override_count
             WHERE id = :id'
        );
        $stmt->execute([
            'id' => $id,
            'nome' => $data['nome'],
            'valor' => $data['valor'],
            'dias_acesso' => $data['dias_acesso'],
            'abas_json' => $this->encodeAbas($data['abas']),
            'updated_by' => $userId,
            'show_in_ranking' => $data['show_in_ranking'] ? 1 : 0,
            'sales_override_count' => (int) $data['sales_override_count'],
        ]);

        return $this->findById($id);
    }

    /** @param array<int,string>|null $abas */
    private function encodeAbas(?array $abas): ?string
    {
        return $abas === null ? null : json_encode(array_values($abas), JSON_UNESCAPED_UNICODE);
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
            // null (sem abas_json = plano legado) exibido pro admin/cliente
            // ja resolvido pra lista completa -- ninguem precisa saber da
            // diferenca entre "null" e "todas explicitamente marcadas".
            'abas' => $this->decodeAbas($row['abas_json'] ?? null) ?? self::ALL_ABAS,
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
            'show_in_ranking' => isset($row['show_in_ranking']) ? (((int)$row['show_in_ranking']) === 1) : false,
            'sales_override_count' => isset($row['sales_override_count']) ? ((int)$row['sales_override_count']) : 0,
        ];
    }
}
