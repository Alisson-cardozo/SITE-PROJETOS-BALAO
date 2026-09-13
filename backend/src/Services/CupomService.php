<?php

declare(strict_types=1);

namespace App\Services;

use App\Support\Db;

/**
 * Cupons de desconto (percentual sobre o valor do plano). Regras:
 *  - codigo unico (guardado em MAIUSCULO).
 *  - validade opcional (valido_ate).
 *  - 1 uso por usuario POR MES (tabela cupom_usos, coluna ym='YYYY-MM').
 *  - is_campanha=1 marca o cupom usado no reengajamento diario (so um).
 * O uso e registrado quando o pagamento com o cupom e APROVADO
 * (PagamentoService::reconcileRow), nao na geracao do Pix.
 */
final class CupomService
{
    /** Normaliza codigo: MAIUSCULO, sem espacos. */
    public static function normalizeCodigo(string $codigo): string
    {
        return strtoupper(trim(preg_replace('/\s+/', '', $codigo) ?? ''));
    }

    /** @return array<int,array<string,mixed>> */
    public function listAll(): array
    {
        return Db::connection()->query('SELECT * FROM cupons ORDER BY is_campanha DESC, created_at DESC')->fetchAll();
    }

    public function findRawById(int $id): ?array
    {
        $stmt = Db::connection()->prepare('SELECT * FROM cupons WHERE id = :id LIMIT 1');
        $stmt->execute(['id' => $id]);
        $row = $stmt->fetch();
        return $row === false ? null : $row;
    }

    public function findByCodigo(string $codigo): ?array
    {
        $stmt = Db::connection()->prepare('SELECT * FROM cupons WHERE codigo = :codigo LIMIT 1');
        $stmt->execute(['codigo' => self::normalizeCodigo($codigo)]);
        $row = $stmt->fetch();
        return $row === false ? null : $row;
    }

    /**
     * @param array{codigo:string, nome:string, percentual:float, valido_ate:?string, ativo:bool,
     *   planos?:array<int,array{plano_id:int, percentual:float}>} $data
     */
    public function create(array $data): array
    {
        $stmt = Db::connection()->prepare(
            'INSERT INTO cupons (codigo, nome, percentual, valido_ate, ativo, max_usos)
             VALUES (:codigo, :nome, :percentual, :valido_ate, :ativo, :max_usos)'
        );
        $stmt->execute([
            'codigo' => self::normalizeCodigo($data['codigo']),
            'nome' => $data['nome'],
            'percentual' => $data['percentual'],
            'valido_ate' => $data['valido_ate'] !== '' ? $data['valido_ate'] : null,
            'ativo' => $data['ativo'] ? 1 : 0,
            'max_usos' => ($data['max_usos'] ?? null) !== null && (int) $data['max_usos'] > 0 ? (int) $data['max_usos'] : null,
        ]);
        $id = (int) Db::connection()->lastInsertId();
        $this->salvarPlanos($id, $data['planos'] ?? []);
        return $this->toPublicArray($this->findRawById($id) ?? []);
    }

    /**
     * @param array{codigo:string, nome:string, percentual:float, valido_ate:?string, ativo:bool,
     *   planos?:array<int,array{plano_id:int, percentual:float}>} $data
     */
    public function update(int $id, array $data): array
    {
        $stmt = Db::connection()->prepare(
            'UPDATE cupons SET codigo = :codigo, nome = :nome, percentual = :percentual,
                    valido_ate = :valido_ate, ativo = :ativo, max_usos = :max_usos WHERE id = :id'
        );
        $stmt->execute([
            'id' => $id,
            'codigo' => self::normalizeCodigo($data['codigo']),
            'nome' => $data['nome'],
            'percentual' => $data['percentual'],
            'valido_ate' => $data['valido_ate'] !== '' ? $data['valido_ate'] : null,
            'ativo' => $data['ativo'] ? 1 : 0,
            'max_usos' => ($data['max_usos'] ?? null) !== null && (int) $data['max_usos'] > 0 ? (int) $data['max_usos'] : null,
        ]);
        $this->salvarPlanos($id, $data['planos'] ?? []);
        return $this->toPublicArray($this->findRawById($id) ?? []);
    }

    /** Substitui as regras de plano do cupom. Lista vazia = vale pra todos. */
    private function salvarPlanos(int $cupomId, array $planos): void
    {
        $pdo = Db::connection();
        $pdo->prepare('DELETE FROM cupom_planos WHERE cupom_id = :id')->execute(['id' => $cupomId]);
        if ($planos === []) {
            return;
        }
        $stmt = $pdo->prepare(
            'INSERT INTO cupom_planos (cupom_id, plano_id, percentual) VALUES (:cupom_id, :plano_id, :percentual)
             ON DUPLICATE KEY UPDATE percentual = VALUES(percentual)'
        );
        foreach ($planos as $p) {
            $planoId = (int) ($p['plano_id'] ?? 0);
            $perc = (float) ($p['percentual'] ?? 0);
            if ($planoId <= 0 || $perc <= 0) {
                continue;
            }
            $stmt->execute(['cupom_id' => $cupomId, 'plano_id' => $planoId, 'percentual' => $perc]);
        }
    }

    /** @return array<int,array{plano_id:int, percentual:float}> */
    public function planosDoCupom(int $cupomId): array
    {
        $stmt = Db::connection()->prepare('SELECT plano_id, percentual FROM cupom_planos WHERE cupom_id = :id');
        $stmt->execute(['id' => $cupomId]);
        return array_map(
            static fn (array $r): array => ['plano_id' => (int) $r['plano_id'], 'percentual' => (float) $r['percentual']],
            $stmt->fetchAll()
        );
    }

    /**
     * Percentual do cupom PARA um plano. Se o cupom tem regras de plano e o plano
     * nao esta na lista, retorna null (cupom nao vale pra esse plano). Se nao tem
     * regras, vale pra todos com o percentual padrao.
     */
    public function percentualParaPlano(array $cupom, int $planoId): ?float
    {
        $regras = $this->planosDoCupom((int) $cupom['id']);
        if ($regras === []) {
            return (float) $cupom['percentual'];
        }
        foreach ($regras as $r) {
            if ($r['plano_id'] === $planoId) {
                return $r['percentual'];
            }
        }
        return null;
    }

    public function delete(int $id): void
    {
        Db::connection()->prepare('DELETE FROM cupom_usos WHERE cupom_id = :id')->execute(['id' => $id]);
        Db::connection()->prepare('DELETE FROM cupom_planos WHERE cupom_id = :id')->execute(['id' => $id]);
        Db::connection()->prepare('DELETE FROM cupons WHERE id = :id')->execute(['id' => $id]);
    }

    /** Marca um cupom como o da campanha (desmarca os outros). */
    public function setCampanha(int $id): void
    {
        $pdo = Db::connection();
        $pdo->exec('UPDATE cupons SET is_campanha = 0');
        $pdo->prepare('UPDATE cupons SET is_campanha = 1 WHERE id = :id')->execute(['id' => $id]);
    }

    /** Cupom da campanha ativo e dentro da validade (ou null). */
    public function campanhaCupom(): ?array
    {
        $row = Db::connection()->query(
            "SELECT * FROM cupons
             WHERE is_campanha = 1 AND ativo = 1
               AND (valido_ate IS NULL OR valido_ate >= CURDATE())
             LIMIT 1"
        )->fetch();
        return $row === false ? null : $row;
    }

    /** Total de vezes que o cupom ja foi usado (linhas em cupom_usos). */
    public function totalUsos(int $cupomId): int
    {
        $stmt = Db::connection()->prepare('SELECT COUNT(*) FROM cupom_usos WHERE cupom_id = :id');
        $stmt->execute(['id' => $cupomId]);
        return (int) $stmt->fetchColumn();
    }

    public function jaUsouEsteMes(int $cupomId, int $userId): bool
    {
        $stmt = Db::connection()->prepare(
            'SELECT 1 FROM cupom_usos WHERE cupom_id = :cupom_id AND user_id = :user_id AND ym = :ym LIMIT 1'
        );
        $stmt->execute(['cupom_id' => $cupomId, 'user_id' => $userId, 'ym' => date('Y-m')]);
        return $stmt->fetchColumn() !== false;
    }

    /** Registra o uso (1x por mes). INSERT IGNORE evita corrida/duplicidade. */
    public function registrarUso(int $cupomId, int $userId, ?int $pagamentoId = null): void
    {
        Db::connection()->prepare(
            'INSERT IGNORE INTO cupom_usos (cupom_id, user_id, ym, pagamento_id)
             VALUES (:cupom_id, :user_id, :ym, :pagamento_id)'
        )->execute([
            'cupom_id' => $cupomId,
            'user_id' => $userId,
            'ym' => date('Y-m'),
            'pagamento_id' => $pagamentoId,
        ]);
    }

    /**
     * Valida o cupom pra um usuario/valor. Retorna sempre um array:
     * ['ok'=>bool, 'error'=>?string, 'cupom'=>?array, 'percentual'=>float,
     *  'desconto'=>float, 'valor_final'=>float].
     */
    public function validateForUser(string $codigo, int $userId, int $planoId, float $planoValor): array
    {
        $fail = static fn (string $msg): array => [
            'ok' => false, 'error' => $msg, 'cupom' => null,
            'percentual' => 0.0, 'desconto' => 0.0, 'valor_final' => $planoValor,
        ];

        $cupom = $this->findByCodigo($codigo);
        if ($cupom === null) {
            return $fail('Cupom inválido.');
        }
        if ((int) $cupom['ativo'] !== 1) {
            return $fail('Este cupom não está mais ativo.');
        }
        if (!empty($cupom['valido_ate']) && strtotime((string) $cupom['valido_ate'] . ' 23:59:59') < time()) {
            return $fail('Este cupom expirou.');
        }

        $percentual = $this->percentualParaPlano($cupom, $planoId);
        if ($percentual === null) {
            return $fail('Este cupom não é válido para o plano selecionado.');
        }

        if ($this->jaUsouEsteMes((int) $cupom['id'], $userId)) {
            return $fail('Você já usou este cupom neste mês.');
        }

        // Limite total de usos (estoque do cupom). NULL = ilimitado.
        $maxUsos = $cupom['max_usos'] ?? null;
        if ($maxUsos !== null && (int) $maxUsos > 0 && $this->totalUsos((int) $cupom['id']) >= (int) $maxUsos) {
            return $fail('Este cupom esgotou (limite de usos atingido).');
        }

        $desconto = round($planoValor * $percentual / 100, 2);
        $valorFinal = max(0.50, round($planoValor - $desconto, 2));

        return [
            'ok' => true,
            'error' => null,
            'cupom' => $cupom,
            'percentual' => $percentual,
            'desconto' => round($planoValor - $valorFinal, 2),
            'valor_final' => $valorFinal,
        ];
    }

    public function toPublicArray(array $row): array
    {
        $planos = isset($row['id']) ? $this->planosDoCupom((int) $row['id']) : [];
        return [
            'id' => (int) $row['id'],
            'codigo' => (string) $row['codigo'],
            'nome' => (string) $row['nome'],
            'percentual' => (float) $row['percentual'],
            'valido_ate' => $row['valido_ate'] ?? null,
            'ativo' => (int) $row['ativo'] === 1,
            'is_campanha' => (int) ($row['is_campanha'] ?? 0) === 1,
            // Estoque do cupom: quantas vezes ja foi usado e o limite (null = ilimitado).
            'usos' => isset($row['id']) ? $this->totalUsos((int) $row['id']) : 0,
            'max_usos' => ($row['max_usos'] ?? null) !== null ? (int) $row['max_usos'] : null,
            // Vazio = vale pra todos os planos (usa `percentual`). Com itens =
            // vale so pra esses planos, cada um com seu percentual.
            'aplica_todos' => $planos === [],
            'planos' => $planos,
            'created_at' => $row['created_at'] ?? null,
        ];
    }
}
