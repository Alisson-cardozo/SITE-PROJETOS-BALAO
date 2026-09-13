<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api;

use App\Core\Application;
use App\Core\Request;
use App\Core\Response;
use App\Services\ChatbotService;
use App\Services\WhatsAppChatService;
use App\Services\WhatsAppService;

/**
 * Webhook publico que a Evolution API (container Docker na VPS) chama toda
 * vez que o QR muda, a conexao muda de estado, ou chega/sai uma mensagem.
 * Nao tem token de usuario — quem chama e o container, nao um humano logado
 * — por isso a protecao e um segredo compartilhado no header (ver
 * WhatsAppService::webhookConfig).
 */
final class WhatsAppWebhookController
{
    public function handle(Request $request): Response
    {
        $app = Application::instance();
        $expected = (string) ($app->env('EVOLUTION_WEBHOOK_SECRET', '') ?: $app->env('EVOLUTION_API_KEY', ''));
        $received = (string) ($request->headers['x-evolution-webhook-secret'] ?? '');
        if ($expected !== '' && !hash_equals($expected, $received)) {
            return Response::json(['error' => 'Nao autorizado'], 401);
        }

        $body = $request->body;
        $event = strtolower(str_replace(['_', '-'], '.', (string) ($body['event'] ?? '')));
        $data = is_array($body['data'] ?? null) ? $body['data'] : [];

        if (str_contains($event, 'messages.upsert') || str_contains($event, 'send.message')) {
            $this->handleMessages($data);
            return Response::json(['ok' => true]);
        }

        $qr = null;
        if (str_contains($event, 'qrcode')) {
            $qrcode = is_array($data['qrcode'] ?? null) ? $data['qrcode'] : $data;
            $qr = is_string($qrcode['base64'] ?? null) ? $qrcode['base64'] : null;
        }

        $state = null;
        if (str_contains($event, 'connection')) {
            $instanceInfo = is_array($data['instance'] ?? null) ? $data['instance'] : $data;
            $state = is_string($data['state'] ?? null)
                ? $data['state']
                : (is_string($instanceInfo['state'] ?? null) ? $instanceInfo['state'] : null);
        }

        if ($qr !== null || $state !== null) {
            (new WhatsAppService())->saveWebhookState($qr, $state);
        }

        return Response::json(['ok' => true]);
    }

    /** @param array<string, mixed> $data */
    private function handleMessages(array $data): void
    {
        $payloads = [];
        if (isset($data['messages']) && is_array($data['messages'])) {
            $payloads = $data['messages'];
        } elseif (isset($data['key'])) {
            $payloads = [$data];
        }
        if ($payloads === []) {
            return;
        }

        $chat = new WhatsAppChatService();

        foreach ($payloads as $payload) {
            if (!is_array($payload)) {
                continue;
            }
            $key = is_array($payload['key'] ?? null) ? $payload['key'] : [];
            $remoteJid = is_string($key['remoteJid'] ?? null) ? $key['remoteJid'] : null;
            if ($remoteJid === null || $remoteJid === 'status@broadcast' || str_ends_with($remoteJid, '@g.us')) {
                continue; // sem remetente, status ou grupo (foco em conversa 1:1 com cliente)
            }

            $fromMe = (bool) ($key['fromMe'] ?? false);
            $waMessageId = is_string($key['id'] ?? null) ? $key['id'] : null;
            $pushName = is_string($payload['pushName'] ?? null) ? $payload['pushName'] : null;
            $bodyText = $this->extractText($payload['message'] ?? null);
            if ($bodyText === null) {
                continue; // tipo de midia que ainda nao tratamos (sticker, reacao, etc.)
            }

            $saved = $chat->recordMessage($remoteJid, $pushName, $fromMe ? 'out' : 'in', $bodyText, $waMessageId);

            // So o chatbot reage a mensagem de quem escreveu pra gente (nao a
            // nossa propria), e so se for a PRIMEIRA vez que vemos essa
            // mensagem — a Evolution as vezes manda o mesmo evento 2x, e sem
            // essa checagem o bot rodaria o fluxo em dobro.
            if (!$fromMe && isset($saved['conversation_id']) && empty($saved['_dedup'])) {
                (new ChatbotService())->handleIncomingMessage((int) $saved['conversation_id'], $remoteJid, $bodyText);
            }
        }
    }

    private function extractText(mixed $message): ?string
    {
        if (!is_array($message)) {
            return null;
        }
        if (is_string($message['conversation'] ?? null) && $message['conversation'] !== '') {
            return $message['conversation'];
        }
        $extended = is_array($message['extendedTextMessage'] ?? null) ? $message['extendedTextMessage'] : null;
        if (is_string($extended['text'] ?? null) && $extended['text'] !== '') {
            return $extended['text'];
        }
        foreach (['imageMessage', 'videoMessage', 'documentMessage', 'audioMessage'] as $mediaKey) {
            if (is_array($message[$mediaKey] ?? null)) {
                $caption = $message[$mediaKey]['caption'] ?? null;
                return is_string($caption) && $caption !== '' ? $caption : '[mídia]';
            }
        }
        return null;
    }
}
