<?php

declare(strict_types=1);

namespace App\Services;

use App\Support\Db;

/**
 * Operacoes sobre os numeros de uma rifa. Cada numero e uma linha propria
 * (pre-criada na hora que a rifa nasce) — isso deixa a trava de concorrencia
 * e a contagem de disponiveis simples e atomicas via SQL puro, sem precisar
 * calcular contra um intervalo numerico.
 */
final class RifaNumeroService
{
    /** Minutos que um numero fica travado pra um comprador antes de voltar a ficar disponivel. */
    public const HOLD_MINUTES = 30;

    /** Cria as linhas 1..quantidade, todas 'disponivel', em lote. */
    public function criarNumeros(int $rifaId, int $quantidade): void
    {
        $pdo = Db::connection();
        $stmt = $pdo->prepare('INSERT INTO rifa_numeros (rifa_id, numero, status) VALUES (:rifa_id, :numero, \'disponivel\')');

        // insere em blocos pra nao montar uma unica query gigante com milhares de placeholders
        for ($numero = 1; $numero <= $quantidade; $numero++) {
            $stmt->execute(['rifa_id' => $rifaId, 'numero' => $numero]);
        }
    }

    /**
     * Libera (volta pra 'disponivel') numeros cujo comprador estourou o prazo
     * de espera do pagamento. Chamada de forma "preguicosa" (lazy) antes de
     * qualquer leitura/reserva nova — nao ha worker/cron nesse projeto.
     */
    public function liberarReservasExpiradas(int $rifaId): void
    {
        $pdo = Db::connection();

        $stmt = $pdo->prepare(
            "SELECT id FROM rifa_compradores
             WHERE rifa_id = :rifa_id AND status = 'aguardando_pagamento' AND expira_em IS NOT NULL AND expira_em < NOW()"
        );
        $stmt->execute(['rifa_id' => $rifaId]);
        $expiredIds = $stmt->fetchAll(\PDO::FETCH_COLUMN);

        if ($expiredIds === []) {
            return;
        }

        $placeholders = implode(',', array_fill(0, count($expiredIds), '?'));

        $release = $pdo->prepare(
            "UPDATE rifa_numeros SET status = 'disponivel', comprador_id = NULL
             WHERE comprador_id IN ($placeholders) AND status = 'reservado'"
        );
        $release->execute($expiredIds);

        $expire = $pdo->prepare(
            "UPDATE rifa_compradores SET status = 'expirado' WHERE id IN ($placeholders)"
        );
        $expire->execute($expiredIds);
    }

    /**
     * Tenta reservar `$quantidade` numeros disponiveis pro `$compradorId`.
     * Precisa rodar DENTRO de uma transacao aberta pelo chamador (usa
     * SELECT ... FOR UPDATE pra travar as linhas contra reserva concorrente).
     *
     * @return array<int,int> numeros reservados, ou [] se nao havia o suficiente
     */
    public function reservarParaComprador(int $rifaId, int $quantidade, int $compradorId): array
    {
        $pdo = Db::connection();

        $select = $pdo->prepare(
            "SELECT numero FROM rifa_numeros
             WHERE rifa_id = :rifa_id AND status = 'disponivel'
             ORDER BY numero
             LIMIT :quantidade
             FOR UPDATE"
        );
        $select->bindValue('rifa_id', $rifaId, \PDO::PARAM_INT);
        $select->bindValue('quantidade', $quantidade, \PDO::PARAM_INT);
        $select->execute();
        $numeros = array_map('intval', $select->fetchAll(\PDO::FETCH_COLUMN));

        if (count($numeros) < $quantidade) {
            return [];
        }

        $placeholders = implode(',', array_fill(0, count($numeros), '?'));
        $update = $pdo->prepare(
            "UPDATE rifa_numeros SET status = 'reservado', comprador_id = ?
             WHERE rifa_id = ? AND numero IN ($placeholders)"
        );
        $update->execute([$compradorId, $rifaId, ...$numeros]);

        return $numeros;
    }

    /** Reserva numeros ESPECIFICOS pra uma venda manual do dono (nao precisam estar disponiveis por sorte, o dono escolhe quais). */
    public function reservarNumerosEspecificos(int $rifaId, array $numeros, int $compradorId): bool
    {
        $pdo = Db::connection();
        $placeholders = implode(',', array_fill(0, count($numeros), '?'));

        $select = $pdo->prepare(
            "SELECT COUNT(*) FROM rifa_numeros WHERE rifa_id = ? AND numero IN ($placeholders) AND status = 'disponivel' FOR UPDATE"
        );
        $select->execute([$rifaId, ...$numeros]);
        if ((int) $select->fetchColumn() !== count($numeros)) {
            return false;
        }

        $update = $pdo->prepare(
            "UPDATE rifa_numeros SET status = 'reservado', comprador_id = ?
             WHERE rifa_id = ? AND numero IN ($placeholders)"
        );
        $update->execute([$compradorId, $rifaId, ...$numeros]);

        return true;
    }

    public function confirmarVenda(int $compradorId): void
    {
        $stmt = Db::connection()->prepare("UPDATE rifa_numeros SET status = 'vendido' WHERE comprador_id = ?");
        $stmt->execute([$compradorId]);
    }

    public function liberarComprador(int $compradorId): void
    {
        $stmt = Db::connection()->prepare(
            "UPDATE rifa_numeros SET status = 'disponivel', comprador_id = NULL WHERE comprador_id = ? AND status = 'reservado'"
        );
        $stmt->execute([$compradorId]);
    }

    /** @return array{disponiveis:int, reservados:int, vendidos:int, total:int} */
    public function contarStatus(int $rifaId): array
    {
        $stmt = Db::connection()->prepare(
            "SELECT status, COUNT(*) AS total FROM rifa_numeros WHERE rifa_id = ? GROUP BY status"
        );
        $stmt->execute([$rifaId]);

        $counts = ['disponivel' => 0, 'reservado' => 0, 'vendido' => 0];
        foreach ($stmt->fetchAll() as $row) {
            $counts[$row['status']] = (int) $row['total'];
        }

        return [
            'disponiveis' => $counts['disponivel'],
            'reservados' => $counts['reservado'],
            'vendidos' => $counts['vendido'],
            'total' => array_sum($counts),
        ];
    }

    /** Sorteia um numero VENDIDO aleatorio pra ser o vencedor. */
    public function sortearVendido(int $rifaId): ?int
    {
        $stmt = Db::connection()->prepare(
            "SELECT numero FROM rifa_numeros WHERE rifa_id = ? AND status = 'vendido' ORDER BY RAND() LIMIT 1"
        );
        $stmt->execute([$rifaId]);
        $numero = $stmt->fetchColumn();

        return $numero === false ? null : (int) $numero;
    }

    /** Acha o id do comprador dono de um numero especifico (usado pra achar o vencedor do sorteio). */
    public function findCompradorIdPorNumero(int $rifaId, int $numero): ?int
    {
        $stmt = Db::connection()->prepare(
            'SELECT comprador_id FROM rifa_numeros WHERE rifa_id = ? AND numero = ? LIMIT 1'
        );
        $stmt->execute([$rifaId, $numero]);
        $id = $stmt->fetchColumn();

        return $id === false || $id === null ? null : (int) $id;
    }

    public function listarNumerosDoComprador(int $compradorId): array
    {
        $stmt = Db::connection()->prepare('SELECT numero FROM rifa_numeros WHERE comprador_id = ? ORDER BY numero');
        $stmt->execute([$compradorId]);

        return array_map('intval', $stmt->fetchAll(\PDO::FETCH_COLUMN));
    }

    /**
     * Numeros reservados OU vendidos — sem nenhum dado de quem comprou junto,
     * seguro pra expor na pagina publica (o cliente ve o que ja foi pego, mas
     * nao quem pegou).
     *
     * @return array<int,int>
     */
    public function listarNumerosOcupados(int $rifaId): array
    {
        $stmt = Db::connection()->prepare(
            "SELECT numero FROM rifa_numeros WHERE rifa_id = ? AND status IN ('reservado', 'vendido') ORDER BY numero"
        );
        $stmt->execute([$rifaId]);

        return array_map('intval', $stmt->fetchAll(\PDO::FETCH_COLUMN));
    }

    /**
     * Todos os numeros (reservados ou vendidos) que esse whatsapp ja tem
     * nessa rifa, somando TODAS as compras dele (comparando so os digitos,
     * pra nao depender de formatacao igual). Usado pra reconhecer um
     * comprador que ja tinha numeros e ta voltando pra comprar mais.
     *
     * @return array<int,int>
     */
    public function listarNumerosPorWhatsapp(int $rifaId, string $whatsappDigits): array
    {
        $stmt = Db::connection()->prepare(
            "SELECT n.numero
             FROM rifa_numeros n
             INNER JOIN rifa_compradores c ON c.id = n.comprador_id
             WHERE n.rifa_id = :rifa_id
               AND n.status IN ('reservado', 'vendido')
               AND REGEXP_REPLACE(c.whatsapp, '[^0-9]', '') = :whatsapp
             ORDER BY n.numero"
        );
        $stmt->execute(['rifa_id' => $rifaId, 'whatsapp' => $whatsappDigits]);

        return array_map('intval', $stmt->fetchAll(\PDO::FETCH_COLUMN));
    }
}
