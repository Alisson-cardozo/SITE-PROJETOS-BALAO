<?php

declare(strict_types=1);

namespace App\Services;

use App\Support\Db;
use Throwable;

/**
 * Notificacoes internas do admin. Hoje so tem um tipo ('pagamento'): a cada
 * venda aprovada, registra uma linha em `notificacoes` (pro historico na aba
 * Notificacoes) e dispara um Web Push pros dispositivos do admin. Falha de push
 * nunca quebra o fluxo de pagamento (tudo em try/catch no chamador).
 */
final class NotificacaoService
{
    private const METODO_LABEL = [
        'pix' => 'Pix',
        'cartao' => 'Cartão de crédito',
    ];

    /**
     * @param array{id:int, nome:string, valor:float, dias_acesso:int} $plano
     */
    public function criarPagamentoNotificacao(
        int $userId,
        array $plano,
        float $valor,
        string $metodo,
        int $pagamentoId
    ): void {
        $user = (new UserService())->findById($userId);
        $clienteNome = (string) ($user['name'] ?? 'Cliente');
        $clienteEmail = (string) ($user['email'] ?? '');
        $metodoLabel = self::METODO_LABEL[$metodo] ?? $metodo;
        $valorFmt = 'R$ ' . number_format($valor, 2, ',', '.');

        $titulo = '💰 Venda aprovada — ' . $clienteNome;
        $mensagem = $plano['nome'] . ' • ' . $metodoLabel . ' • ' . $valorFmt;

        $dados = [
            'cliente_nome' => $clienteNome,
            'cliente_email' => $clienteEmail,
            'plano_nome' => $plano['nome'],
            'valor' => $valor,
            'metodo' => $metodo,
            'metodo_label' => $metodoLabel,
            'pagamento_id' => $pagamentoId,
        ];

        Db::connection()->prepare(
            "INSERT INTO notificacoes (tipo, titulo, mensagem, dados_json)
             VALUES ('pagamento', :titulo, :mensagem, :dados)"
        )->execute([
            'titulo' => $titulo,
            'mensagem' => $mensagem,
            'dados' => json_encode($dados, JSON_UNESCAPED_UNICODE),
        ]);

        try {
            (new WebPushService())->sendToAdmins([
                'title' => $titulo,
                'body' => $mensagem,
                'data' => ['tipo' => 'pagamento', 'url' => '/', 'pagamento_id' => $pagamentoId],
            ]);
        } catch (Throwable $e) {
            // Push e best-effort: o historico ja foi salvo, entao o admin ve mesmo
            // que o envio falhe. Nao propaga.
        }
    }

    /**
     * Notifica o admin de uma venda de MOLDE sob encomenda (pago via Pix/cartao,
     * ou cortesia). Registra no historico + dispara Web Push. Best-effort.
     *
     * @param array<string,mixed> $pedido linha de solicitacoes_molde
     */
    public function criarMoldeNotificacao(array $pedido): void
    {
        $modelo = (string) ($pedido['modelo_nome'] ?? 'Molde');
        $email = (string) ($pedido['email'] ?? '');
        $valor = (float) ($pedido['valor'] ?? 0);
        $tamanho = (float) ($pedido['tamanho_cm'] ?? 0);
        $valorFmt = 'R$ ' . number_format($valor, 2, ',', '.');

        $titulo = '🔨 Venda de molde — ' . $modelo;
        $partes = [$valorFmt];
        if ($tamanho > 0) {
            $partes[] = rtrim(rtrim(number_format($tamanho, 2, ',', '.'), '0'), ',') . ' cm';
        }
        if ($email !== '') {
            $partes[] = $email;
        }
        $mensagem = implode(' • ', $partes);

        $dados = [
            'solicitacao_id' => (int) ($pedido['id'] ?? 0),
            'modelo_nome' => $modelo,
            'cliente_email' => $email,
            'valor' => $valor,
            'tamanho_cm' => $tamanho,
            'chave' => (string) ($pedido['chave_unica'] ?? ''),
        ];

        Db::connection()->prepare(
            "INSERT INTO notificacoes (tipo, titulo, mensagem, dados_json)
             VALUES ('molde', :titulo, :mensagem, :dados)"
        )->execute([
            'titulo' => $titulo,
            'mensagem' => $mensagem,
            'dados' => json_encode($dados, JSON_UNESCAPED_UNICODE),
        ]);

        try {
            (new WebPushService())->sendToAdmins([
                'title' => $titulo,
                'body' => $mensagem,
                'data' => ['tipo' => 'molde', 'url' => '/', 'solicitacao_id' => (int) ($pedido['id'] ?? 0)],
            ]);
        } catch (Throwable $e) {
            // Push e best-effort: o historico ja foi salvo.
        }
    }

    /** @return array<int,array<string,mixed>> */
    public function listar(int $limit = 100): array
    {
        $stmt = Db::connection()->prepare(
            'SELECT * FROM notificacoes ORDER BY created_at DESC, id DESC LIMIT :limit'
        );
        $stmt->bindValue('limit', $limit, \PDO::PARAM_INT);
        $stmt->execute();

        return array_map([$this, 'toPublicArray'], $stmt->fetchAll());
    }

    /** @return array<int,array<string,mixed>> */
    public function pendentes(): array
    {
        $rows = Db::connection()
            ->query('SELECT * FROM notificacoes WHERE lida = 0 ORDER BY created_at DESC, id DESC')
            ->fetchAll();

        return array_map([$this, 'toPublicArray'], $rows);
    }

    public function marcarLida(int $id): void
    {
        Db::connection()
            ->prepare('UPDATE notificacoes SET lida = 1, lida_em = NOW() WHERE id = :id')
            ->execute(['id' => $id]);
    }

    public function marcarTodasLidas(): void
    {
        Db::connection()->exec('UPDATE notificacoes SET lida = 1, lida_em = NOW() WHERE lida = 0');
    }

    /** @param array<string,mixed> $row */
    private function toPublicArray(array $row): array
    {
        return [
            'id' => (int) $row['id'],
            'tipo' => (string) $row['tipo'],
            'titulo' => (string) $row['titulo'],
            'mensagem' => (string) $row['mensagem'],
            'dados' => $row['dados_json'] !== null ? json_decode((string) $row['dados_json'], true) : null,
            'lida' => (bool) $row['lida'],
            'created_at' => (string) $row['created_at'],
        ];
    }
}
