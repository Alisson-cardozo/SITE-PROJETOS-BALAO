<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api;

use App\Core\Application;
use App\Core\Request;
use App\Core\Response;
use App\Services\WhatsAppChatService;

/**
 * Chat do WhatsApp (aba "Mensagens" do admin) — conversas, historico e envio.
 * O tempo real (novas mensagens aparecendo na hora) e feito por um servico
 * Node de WebSocket separado (ver chat-ws-service/); esse controller so cuida
 * do REST (listar/enviar/marcar lido) e de emitir o "ticket" que o frontend
 * usa pra abrir a conexao WebSocket autenticada.
 */
final class WhatsAppChatController
{
    private WhatsAppChatService $chat;

    public function __construct()
    {
        $this->chat = new WhatsAppChatService();
    }

    public function conversations(Request $request): Response
    {
        return Response::json(['data' => $this->chat->listConversations()]);
    }

    public function messages(Request $request): Response
    {
        $id = (int) $request->param('id', '0');
        $before = $request->input('before');
        $beforeId = is_numeric($before) ? (int) $before : null;
        return Response::json(['data' => $this->chat->getMessages($id, 60, $beforeId)]);
    }

    public function send(Request $request): Response
    {
        $id = (int) $request->param('id', '0');
        $body = trim((string) $request->input('body', ''));
        if ($body === '') {
            return Response::json(['error' => 'Mensagem vazia.'], 422);
        }
        $r = $this->chat->sendMessage($id, $body);
        return Response::json($r['ok'] ? ['data' => $r['data']] : ['error' => (string) ($r['data']['error'] ?? 'Falha ao enviar.')], $r['ok'] ? 200 : ($r['status'] ?: 502));
    }

    public function markRead(Request $request): Response
    {
        $id = (int) $request->param('id', '0');
        $this->chat->markRead($id);
        return Response::json(['ok' => true]);
    }

    /** Pausa/retoma o bot pra essa conversa — botão "Pausar bot"/"Retomar bot" no chat do admin. */
    public function setBotPaused(Request $request): Response
    {
        $id = (int) $request->param('id', '0');
        $paused = (bool) $request->input('paused', false);
        $this->chat->setBotPaused($id, $paused);
        return Response::json(['ok' => true]);
    }

    /** Ticket curto (30s) pro frontend abrir o WebSocket autenticado como admin. */
    public function wsTicket(Request $request): Response
    {
        $app = Application::instance();
        $secret = (string) ($app->env('CHAT_WS_SECRET', '') ?: $app->env('EVOLUTION_API_KEY', ''));
        $adminId = (int) $request->attribute('user_id');

        $payload = json_encode(['uid' => $adminId, 'exp' => (int) (microtime(true) * 1000) + 30000]);
        $payloadB64 = rtrim(strtr(base64_encode((string) $payload), '+/', '-_'), '=');
        $sig = hash_hmac('sha256', $payloadB64, $secret);

        return Response::json(['data' => ['ticket' => $payloadB64 . '.' . $sig]]);
    }
}
