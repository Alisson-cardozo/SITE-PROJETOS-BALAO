<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api;

use App\Core\Request;
use App\Core\Response;
use App\Services\SolicitacaoMoldeService;
use App\Support\Db;
use Throwable;

/**
 * Config do admin pra solicitacao de molde sob encomenda: valor do metro,
 * video tutorial, e quais moldes ficam disponiveis. Lista tambem os pedidos.
 */
final class SolicitacaoAdminController
{
    /** Config atual (valor do metro + video tutorial). Os modelos vem do
     * catalogo do frontend (/data.json), nao precisam ser marcados aqui. */
    public function config(Request $request): Response
    {
        $pdo = Db::connection();
        $pdo->exec('INSERT IGNORE INTO system_settings (id) VALUES (1)');
        $cfg = $pdo->query('SELECT valor_metro_molde, solicitacao_video_url, solicitacao_molde_ativa FROM system_settings WHERE id = 1')->fetch();

        return Response::json([
            'data' => [
                'valor_metro' => $cfg ? (float) ($cfg['valor_metro_molde'] ?? 0) : 0.0,
                'video_url' => $cfg['solicitacao_video_url'] ?? null,
                'ativo' => $cfg ? (int) ($cfg['solicitacao_molde_ativa'] ?? 1) === 1 : true,
            ],
        ]);
    }

    /** Salva valor do metro + video tutorial. */
    public function updateConfig(Request $request): Response
    {
        $valor = (float) ($request->input('valor_metro') ?? 0);
        $video = trim((string) ($request->input('video_url') ?? ''));
        $ativoRaw = $request->input('ativo');
        $ativo = $ativoRaw === null ? true : (bool) $ativoRaw;

        if ($valor < 0) {
            return Response::json(['error' => 'Valor do metro inválido.'], 422);
        }

        $pdo = Db::connection();
        $pdo->exec('INSERT IGNORE INTO system_settings (id) VALUES (1)');
        $pdo->prepare('UPDATE system_settings SET valor_metro_molde = :v, solicitacao_video_url = :u, solicitacao_molde_ativa = :a WHERE id = 1')
            ->execute(['v' => $valor, 'u' => $video !== '' ? $video : null, 'a' => $ativo ? 1 : 0]);

        return Response::json(['ok' => true]);
    }

    /** Liga/desliga a disponibilidade de um molde pra solicitacao. */
    public function setMoldDisponivel(Request $request): Response
    {
        $id = (int) ($request->param('id') ?? 0);
        $disp = (bool) ($request->input('disponivel') ?? false);

        $pdo = Db::connection();
        $exists = $pdo->prepare('SELECT id FROM molds WHERE id = :id');
        $exists->execute(['id' => $id]);
        if ($exists->fetch() === false) {
            return Response::json(['error' => 'Molde não encontrado.'], 404);
        }

        $pdo->prepare('UPDATE molds SET disponivel_solicitacao = :d WHERE id = :id')
            ->execute(['d' => $disp ? 1 : 0, 'id' => $id]);

        return Response::json(['ok' => true]);
    }

    /** Admin envia uma chave grátis (cortesia) pro e-mail do cliente — só o e-mail. */
    public function enviarChave(Request $request): Response
    {
        $email = strtolower(trim((string) ($request->input('email') ?? '')));
        if ($email === '' || filter_var($email, FILTER_VALIDATE_EMAIL) === false) {
            return Response::json(['errors' => ['email' => 'Informe um e-mail válido.'], 'error' => 'Verifique o e-mail.'], 422);
        }

        try {
            $pedido = (new SolicitacaoMoldeService())->criarChaveManual($email);
        } catch (Throwable $e) {
            return Response::json(['error' => 'Não foi possível enviar a chave: ' . $e->getMessage()], 500);
        }

        return Response::json(['ok' => true, 'chave' => $pedido['chave_unica'] ?? null]);
    }

    /** Consulta uma chave: mostra se o molde foi entregue e qual é. */
    public function consultarChave(Request $request): Response
    {
        $chave = strtoupper(trim((string) ($request->input('chave') ?? '')));
        if ($chave === '') {
            return Response::json(['error' => 'Informe a chave.'], 422);
        }

        $row = (new SolicitacaoMoldeService())->findByChave($chave);
        if ($row === null) {
            return Response::json(['error' => 'Chave não encontrada.'], 404);
        }

        $status = (string) ($row['status'] ?? '');
        return Response::json([
            'data' => [
                'chave' => (string) ($row['chave_unica'] ?? $chave),
                'status' => $status,
                'entregue' => $status === 'entregue',
                'modelo_nome' => (string) ($row['modelo_nome'] ?? ''),
                'categoria' => $row['categoria'] ?? null,
                'tamanho_cm' => (float) ($row['tamanho_cm'] ?? 0),
                'gomos' => (int) ($row['gomos'] ?? 0),
                'bainha_cm' => (float) ($row['bainha_cm'] ?? 0),
                'valor' => (float) ($row['valor'] ?? 0),
                'email' => (string) ($row['email'] ?? ''),
                'created_at' => $row['created_at'] ?? null,
                'paid_at' => $row['paid_at'] ?? null,
                'entregue_at' => $row['entregue_at'] ?? null,
            ],
        ]);
    }

    /** Lista os pedidos de molde sob encomenda. */
    public function listPedidos(Request $request): Response
    {
        $rows = Db::connection()->query(
            'SELECT id, modelo_nome, tamanho_cm, gomos, bainha_cm, valor, email, status, chave_unica, created_at, paid_at
             FROM solicitacoes_molde ORDER BY created_at DESC LIMIT 500'
        )->fetchAll();

        return Response::json(['data' => $rows]);
    }
}
