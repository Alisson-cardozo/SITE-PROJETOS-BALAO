<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api;

use App\Core\Request;
use App\Core\Response;
use App\Services\NotificacaoService;
use App\Services\WebPushService;
use App\Support\Db;
use Throwable;

final class NotificacaoController
{
    private NotificacaoService $notificacoes;

    public function __construct()
    {
        $this->notificacoes = new NotificacaoService();
    }

    /** Histórico completo (admin). */
    public function index(Request $request): Response
    {
        return Response::json(['data' => $this->notificacoes->listar()]);
    }

    /** Não lidas — usado pro badge/poll enquanto o painel admin está aberto. */
    public function pending(Request $request): Response
    {
        $pendentes = $this->notificacoes->pendentes();

        return Response::json(['data' => $pendentes, 'count' => count($pendentes)]);
    }

    public function markAsRead(Request $request): Response
    {
        $id = (int) ($request->param('id') ?? 0);
        if ($id <= 0) {
            return Response::json(['error' => 'Notificação inválida.'], 422);
        }
        $this->notificacoes->marcarLida($id);

        return Response::json(['ok' => true]);
    }

    public function markAllAsRead(Request $request): Response
    {
        $this->notificacoes->marcarTodasLidas();

        return Response::json(['ok' => true]);
    }

    /** Chave pública VAPID pro frontend inscrever o dispositivo. */
    public function vapidPublicKey(Request $request): Response
    {
        try {
            $key = (new WebPushService())->publicKey();
        } catch (Throwable $e) {
            return Response::json(['error' => 'Não foi possível preparar as notificações push: ' . $e->getMessage()], 500);
        }

        return Response::json(['data' => ['public_key' => $key]]);
    }

    /** Salva (ou atualiza) a subscription de Web Push do dispositivo do admin. */
    public function subscribe(Request $request): Response
    {
        $userId = (int) $request->attribute('user_id', 0);
        $endpoint = trim((string) ($request->input('endpoint') ?? ''));

        $keys = $request->input('keys');
        $p256dh = is_array($keys) ? (string) ($keys['p256dh'] ?? '') : (string) ($request->input('p256dh') ?? '');
        $auth = is_array($keys) ? (string) ($keys['auth'] ?? '') : (string) ($request->input('auth') ?? '');

        if ($endpoint === '' || $p256dh === '' || $auth === '') {
            return Response::json(['error' => 'Dados da inscrição de push incompletos.'], 422);
        }

        // endpoint é UNIQUE: upsert (o mesmo dispositivo re-inscrevendo atualiza as chaves/dono).
        Db::connection()->prepare(
            'INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
             VALUES (:user_id, :endpoint, :p256dh, :auth)
             ON DUPLICATE KEY UPDATE user_id = VALUES(user_id), p256dh = VALUES(p256dh), auth = VALUES(auth)'
        )->execute([
            'user_id' => $userId,
            'endpoint' => $endpoint,
            'p256dh' => $p256dh,
            'auth' => $auth,
        ]);

        return Response::json(['ok' => true]);
    }

    public function unsubscribe(Request $request): Response
    {
        $endpoint = trim((string) ($request->input('endpoint') ?? ''));
        if ($endpoint !== '') {
            Db::connection()
                ->prepare('DELETE FROM push_subscriptions WHERE endpoint = :endpoint')
                ->execute(['endpoint' => $endpoint]);
        }

        return Response::json(['ok' => true]);
    }
}
