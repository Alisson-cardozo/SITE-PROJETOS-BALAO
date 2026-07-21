<?php

declare(strict_types=1);

namespace App\Services;

use App\Support\Db;

final class RifaService
{
    /** Quantas rifas ATIVAS um usuario pode ter ao mesmo tempo. */
    public const MAX_RIFAS_ATIVAS = 5;

    private RifaNumeroService $numeros;
    private RifaCompradorService $compradores;

    public function __construct()
    {
        $this->numeros = new RifaNumeroService();
        $this->compradores = new RifaCompradorService();
    }

    public function listAllForUser(int $userId): array
    {
        $stmt = Db::connection()->prepare('SELECT * FROM rifas WHERE created_by = :user_id ORDER BY created_at DESC');
        $stmt->execute(['user_id' => $userId]);

        return array_map(fn (array $row) => $this->toPublicArray($row), $stmt->fetchAll());
    }

    public function findById(int $id): ?array
    {
        $row = $this->findRawById($id);

        return $row === null ? null : $this->toPublicArray($row);
    }

    public function findRawById(int $id): ?array
    {
        $stmt = Db::connection()->prepare('SELECT * FROM rifas WHERE id = :id LIMIT 1');
        $stmt->execute(['id' => $id]);
        $row = $stmt->fetch();

        return $row === false ? null : $row;
    }

    public function findRawBySlug(string $slug): ?array
    {
        $stmt = Db::connection()->prepare('SELECT * FROM rifas WHERE slug = :slug LIMIT 1');
        $stmt->execute(['slug' => $slug]);
        $row = $stmt->fetch();

        return $row === false ? null : $row;
    }

    public function countActiveForUser(int $userId): int
    {
        $stmt = Db::connection()->prepare(
            "SELECT COUNT(*) FROM rifas WHERE created_by = :user_id AND status = 'ativa'"
        );
        $stmt->execute(['user_id' => $userId]);

        return (int) $stmt->fetchColumn();
    }

    /**
     * @param array{nome:string, descricao:string, foto1_path:?string, foto2_path:?string,
     *   valor_numero:float, quantidade_numeros:int, modo_sorteio:string, modo_termino:string,
     *   data_termino:?string, whatsapp_contato:string, chave_pix:string} $data
     */
    public function create(array $data, int $userId): array
    {
        $slug = $this->generateUniqueSlug($data['nome']);

        // Recebimento e sempre manual: o dono informa a propria chave Pix e whatsapp,
        // o cliente paga direto por fora e manda o comprovante — sem integracao de
        // pagamento nenhuma (Pix automatico via Mercado Pago foi retirado).
        $stmt = Db::connection()->prepare(
            "INSERT INTO rifas
              (nome, slug, descricao, foto1_path, foto2_path, valor_numero, quantidade_numeros,
               modo_sorteio, modo_termino, data_termino, forma_recebimento, whatsapp_contato, chave_pix, created_by, updated_by)
             VALUES
              (:nome, :slug, :descricao, :foto1, :foto2, :valor_numero, :quantidade_numeros,
               :modo_sorteio, :modo_termino, :data_termino, 'manual', :whatsapp_contato, :chave_pix, :created_by, :updated_by)"
        );
        $stmt->execute([
            'nome' => $data['nome'],
            'slug' => $slug,
            'descricao' => $data['descricao'],
            'foto1' => $data['foto1_path'],
            'foto2' => $data['foto2_path'],
            'valor_numero' => $data['valor_numero'],
            'quantidade_numeros' => $data['quantidade_numeros'],
            'modo_sorteio' => $data['modo_sorteio'],
            'modo_termino' => $data['modo_termino'],
            'data_termino' => $data['data_termino'],
            'whatsapp_contato' => $data['whatsapp_contato'],
            'chave_pix' => $data['chave_pix'],
            'created_by' => $userId,
            'updated_by' => $userId,
        ]);

        $id = (int) Db::connection()->lastInsertId();
        $this->numeros->criarNumeros($id, $data['quantidade_numeros']);

        return $this->findById($id) ?? [];
    }

    public function finalizar(int $id, int $userId): ?array
    {
        $stmt = Db::connection()->prepare(
            "UPDATE rifas SET status = 'finalizada', updated_by = :updated_by WHERE id = :id"
        );
        $stmt->execute(['id' => $id, 'updated_by' => $userId]);

        return $this->findById($id);
    }

    public function registrarSorteio(int $id, int $numero, int $userId): ?array
    {
        $stmt = Db::connection()->prepare(
            "UPDATE rifas SET numero_sorteado = :numero, sorteado_em = NOW(), status = 'finalizada', updated_by = :updated_by WHERE id = :id"
        );
        $stmt->execute(['id' => $id, 'numero' => $numero, 'updated_by' => $userId]);

        return $this->findById($id);
    }

    public function delete(int $id): bool
    {
        $stmt = Db::connection()->prepare('DELETE FROM rifas WHERE id = :id');
        $stmt->execute(['id' => $id]);

        return $stmt->rowCount() > 0;
    }

    /** @return array<string,mixed> dados publicos + estatisticas de vendas */
    private function toPublicArray(array $row): array
    {
        // libera reservas expiradas antes de calcular qualquer estatistica —
        // garante que "disponiveis"/"numeros_ocupados" nunca mostrem um numero
        // preso numa reserva que ja venceu ha muito tempo.
        $this->numeros->liberarReservasExpiradas((int) $row['id']);
        $stats = $this->numeros->contarStatus((int) $row['id']);
        $percentualVendido = $stats['total'] > 0 ? round(($stats['vendidos'] / $stats['total']) * 100, 1) : 0.0;

        $vencedorNome = null;
        if ($row['numero_sorteado'] !== null) {
            $compradorId = $this->numeros->findCompradorIdPorNumero((int) $row['id'], (int) $row['numero_sorteado']);
            if ($compradorId !== null) {
                $comprador = $this->compradores->findById($compradorId);
                $vencedorNome = $comprador !== null ? (string) $comprador['nome'] : null;
            }
        }

        return [
            'id' => (int) $row['id'],
            'nome' => (string) $row['nome'],
            'slug' => (string) $row['slug'],
            'descricao' => (string) $row['descricao'],
            'fotos' => array_map(
                fn (?string $path) => $path === null ? null : rtrim((string) app()->env('APP_URL', ''), '/') . '/' . ltrim($path, '/'),
                [$row['foto1_path'], $row['foto2_path']]
            ),
            'valor_numero' => (float) $row['valor_numero'],
            'quantidade_numeros' => (int) $row['quantidade_numeros'],
            'modo_sorteio' => (string) $row['modo_sorteio'],
            'modo_termino' => (string) $row['modo_termino'],
            'data_termino' => $row['data_termino'],
            'forma_recebimento' => (string) $row['forma_recebimento'],
            'whatsapp_contato' => $row['whatsapp_contato'],
            'chave_pix' => $row['chave_pix'],
            'status' => (string) $row['status'],
            'numero_sorteado' => $row['numero_sorteado'] !== null ? (int) $row['numero_sorteado'] : null,
            'vencedor_nome' => $vencedorNome,
            'sorteado_em' => $row['sorteado_em'],
            'disponiveis' => $stats['disponiveis'],
            'reservados' => $stats['reservados'],
            'vendidos' => $stats['vendidos'],
            'percentual_vendido' => $percentualVendido,
            // so os numeros ocupados, sem dizer de quem — seguro pra mostrar na pagina publica
            // e usado pra desenhar a grade de selecao.
            'numeros_ocupados' => $this->numeros->listarNumerosOcupados((int) $row['id']),
            'created_at' => (string) $row['created_at'],
            'updated_at' => (string) $row['updated_at'],
        ];
    }

    private function generateUniqueSlug(string $nome): string
    {
        $base = strtolower(trim($nome));
        $base = preg_replace('/[^a-z0-9]+/', '-', $base) ?? 'rifa';
        $base = trim($base, '-');
        if ($base === '') {
            $base = 'rifa';
        }

        do {
            $slug = $base . '-' . substr(bin2hex(random_bytes(4)), 0, 6);
        } while ($this->findRawBySlug($slug) !== null);

        return $slug;
    }
}
