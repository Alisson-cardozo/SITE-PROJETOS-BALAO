<?php

declare(strict_types=1);

namespace App\Services;

use App\Support\Db;

/**
 * Precos promocionais por quantidade de numeros. Editaveis a qualquer
 * momento pelo dono (ex: baixar preco perto do fim da rifa pra vender mais
 * rapido) — nao sao imutaveis depois de criados.
 */
final class RifaPromocaoService
{
    public function listByRifa(int $rifaId): array
    {
        $stmt = Db::connection()->prepare(
            'SELECT * FROM rifa_promocoes WHERE rifa_id = :rifa_id ORDER BY quantidade ASC'
        );
        $stmt->execute(['rifa_id' => $rifaId]);

        return array_map(fn (array $row) => $this->toPublicArray($row), $stmt->fetchAll());
    }

    private function listAtivasRaw(int $rifaId): array
    {
        $stmt = Db::connection()->prepare(
            'SELECT * FROM rifa_promocoes WHERE rifa_id = :rifa_id AND ativo = 1'
        );
        $stmt->execute(['rifa_id' => $rifaId]);

        return $stmt->fetchAll();
    }

    /** So as ativas, no formato publico — usado na rota publica (cliente nao ve promocao desativada). */
    public function listAtivas(int $rifaId): array
    {
        return array_map(fn (array $row) => $this->toPublicArray($row), $this->listAtivasRaw($rifaId));
    }

    public function findRawById(int $id): ?array
    {
        $stmt = Db::connection()->prepare('SELECT * FROM rifa_promocoes WHERE id = :id LIMIT 1');
        $stmt->execute(['id' => $id]);
        $row = $stmt->fetch();

        return $row === false ? null : $row;
    }

    /**
     * @param array{tipo:string, quantidade:int, valor_total:?float, valor_unidade:?float, ativo:bool} $data
     */
    public function create(int $rifaId, array $data): array
    {
        $stmt = Db::connection()->prepare(
            'INSERT INTO rifa_promocoes (rifa_id, tipo, quantidade, valor_total, valor_unidade, ativo)
             VALUES (:rifa_id, :tipo, :quantidade, :valor_total, :valor_unidade, :ativo)'
        );
        $stmt->execute([
            'rifa_id' => $rifaId,
            'tipo' => $data['tipo'],
            'quantidade' => $data['quantidade'],
            'valor_total' => $data['valor_total'],
            'valor_unidade' => $data['valor_unidade'],
            'ativo' => $data['ativo'] ? 1 : 0,
        ]);

        $id = (int) Db::connection()->lastInsertId();
        $row = $this->findRawById($id);

        return $row !== null ? $this->toPublicArray($row) : [];
    }

    /**
     * @param array{tipo:string, quantidade:int, valor_total:?float, valor_unidade:?float, ativo:bool} $data
     */
    public function update(int $id, array $data): ?array
    {
        $stmt = Db::connection()->prepare(
            'UPDATE rifa_promocoes SET tipo = :tipo, quantidade = :quantidade, valor_total = :valor_total,
             valor_unidade = :valor_unidade, ativo = :ativo WHERE id = :id'
        );
        $stmt->execute([
            'id' => $id,
            'tipo' => $data['tipo'],
            'quantidade' => $data['quantidade'],
            'valor_total' => $data['valor_total'],
            'valor_unidade' => $data['valor_unidade'],
            'ativo' => $data['ativo'] ? 1 : 0,
        ]);

        $row = $this->findRawById($id);

        return $row !== null ? $this->toPublicArray($row) : null;
    }

    public function delete(int $id): bool
    {
        $stmt = Db::connection()->prepare('DELETE FROM rifa_promocoes WHERE id = :id');
        $stmt->execute(['id' => $id]);

        return $stmt->rowCount() > 0;
    }

    /**
     * Calcula o valor total pra uma quantidade de numeros, aplicando a melhor
     * promocao ativa que se encaixa (pacote de quantidade EXATA sempre vence;
     * senao a faixa de menor valor_unidade entre as que a quantidade atinge o
     * minimo; senao cai pro preco base * quantidade).
     */
    public function calcularValorTotal(int $rifaId, float $valorBase, int $quantidade): float
    {
        $promocoes = $this->listAtivasRaw($rifaId);

        foreach ($promocoes as $p) {
            if ($p['tipo'] === 'pacote' && (int) $p['quantidade'] === $quantidade) {
                return round((float) $p['valor_total'], 2);
            }
        }

        $melhorUnidade = null;
        foreach ($promocoes as $p) {
            if ($p['tipo'] === 'faixa' && $quantidade >= (int) $p['quantidade']) {
                $unidade = (float) $p['valor_unidade'];
                if ($melhorUnidade === null || $unidade < $melhorUnidade) {
                    $melhorUnidade = $unidade;
                }
            }
        }
        if ($melhorUnidade !== null) {
            return round($melhorUnidade * $quantidade, 2);
        }

        return round($valorBase * $quantidade, 2);
    }

    private function toPublicArray(array $row): array
    {
        return [
            'id' => (int) $row['id'],
            'tipo' => (string) $row['tipo'],
            'quantidade' => (int) $row['quantidade'],
            'valor_total' => $row['valor_total'] !== null ? (float) $row['valor_total'] : null,
            'valor_unidade' => $row['valor_unidade'] !== null ? (float) $row['valor_unidade'] : null,
            'ativo' => (bool) $row['ativo'],
        ];
    }
}
