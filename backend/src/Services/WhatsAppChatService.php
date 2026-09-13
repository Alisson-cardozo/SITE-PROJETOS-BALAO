<?php

declare(strict_types=1);

namespace App\Services;

use App\Core\Application;
use App\Support\Db;
use PDO;

/**
 * Conversas + mensagens do WhatsApp (aba "Mensagens" do admin). Guarda o
 * historico no banco (o Evolution/Baileys nao guarda historico persistente
 * pra gente por padrao — DATABASE_SAVE_DATA_CHATS esta desligado de proposito
 * pra nao duplicar dado, a fonte da verdade e essa tabela).
 */
final class WhatsAppChatService
{
    private WhatsAppService $wa;

    public function __construct()
    {
        $this->wa = new WhatsAppService();
    }

    /** @return array<int, array<string, mixed>> */
    public function listConversations(): array
    {
        $stmt = Db::connection()->query(
            'SELECT id, remote_jid, contact_name, phone, last_message_preview, last_message_at, last_direction, unread_count, bot_paused, created_at
             FROM whatsapp_conversations
             ORDER BY last_message_at IS NULL, last_message_at DESC, id DESC'
        );
        return $stmt->fetchAll(PDO::FETCH_ASSOC) ?: [];
    }

    /** @return array<int, array<string, mixed>> */
    public function getMessages(int $conversationId, int $limit = 60, ?int $beforeId = null): array
    {
        $limit = max(1, min(200, $limit));
        if ($beforeId !== null) {
            $stmt = Db::connection()->prepare(
                'SELECT id, conversation_id, wa_message_id, direction, body, status, created_at
                 FROM whatsapp_messages WHERE conversation_id = :cid AND id < :before
                 ORDER BY id DESC LIMIT ' . $limit
            );
            $stmt->execute(['cid' => $conversationId, 'before' => $beforeId]);
        } else {
            $stmt = Db::connection()->prepare(
                'SELECT id, conversation_id, wa_message_id, direction, body, status, created_at
                 FROM whatsapp_messages WHERE conversation_id = :cid
                 ORDER BY id DESC LIMIT ' . $limit
            );
            $stmt->execute(['cid' => $conversationId]);
        }
        $rows = $stmt->fetchAll(PDO::FETCH_ASSOC) ?: [];
        return array_reverse($rows);
    }

    public function markRead(int $conversationId): void
    {
        Db::connection()->prepare('UPDATE whatsapp_conversations SET unread_count = 0 WHERE id = :id')
            ->execute(['id' => $conversationId]);
    }

    /** @return array{id:int, remote_jid:string, phone:?string}|null */
    public function findConversation(int $conversationId): ?array
    {
        $stmt = Db::connection()->prepare('SELECT id, remote_jid, phone FROM whatsapp_conversations WHERE id = :id');
        $stmt->execute(['id' => $conversationId]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        return $row ?: null;
    }

    /** O bot esta pausado nessa conversa (cliente pediu atendimento humano)? */
    public function isBotPaused(int $conversationId): bool
    {
        $stmt = Db::connection()->prepare('SELECT bot_paused FROM whatsapp_conversations WHERE id = :id');
        $stmt->execute(['id' => $conversationId]);
        return (bool) $stmt->fetchColumn();
    }

    /** Pausa/retoma o bot pra essa conversa — usado pelo no "Falar com humano" e pelo botão do admin no chat. */
    public function setBotPaused(int $conversationId, bool $paused): void
    {
        Db::connection()->prepare('UPDATE whatsapp_conversations SET bot_paused = :paused WHERE id = :id')
            ->execute(['paused' => $paused ? 1 : 0, 'id' => $conversationId]);
    }

    /**
     * Admin (ou o bot) manda uma mensagem pelo chat. Envia de verdade via
     * Evolution e salva. `$typingDelaySec` (opcional): mostra "digitando..."
     * e espera esse tempo antes de mandar — usado pelo chatbot pra parecer
     * mais natural (configurado no nó de mensagem do fluxo).
     */
    public function sendMessage(int $conversationId, string $body, float $typingDelaySec = 0.0): array
    {
        $conv = $this->findConversation($conversationId);
        if ($conv === null) {
            return ['ok' => false, 'status' => 404, 'data' => ['error' => 'Conversa não encontrada.']];
        }
        $phone = $conv['phone'] ?: $this->jidToPhone($conv['remote_jid']);
        if ($typingDelaySec > 0) {
            $delayMs = (int) round(min($typingDelaySec, 8.0) * 1000);
            $this->wa->sendPresence($phone, 'composing', $delayMs);
            usleep($delayMs * 1000);
        }
        $r = $this->wa->send($phone, $body);
        if (!$r['ok']) {
            return $r;
        }
        $waId = $r['data']['key']['id'] ?? null;
        $message = $this->recordMessage($conv['remote_jid'], null, 'out', $body, is_string($waId) ? $waId : null);
        return ['ok' => true, 'status' => 200, 'data' => ['message' => $message]];
    }

    /**
     * Chamado pelo WhatsAppWebhookController quando chega/sai uma mensagem via
     * evento messages.upsert. Cria a conversa se ainda nao existir.
     * @return array<string, mixed> a linha da mensagem salva
     */
    public function recordMessage(string $remoteJid, ?string $pushName, string $direction, string $body, ?string $waMessageId): array
    {
        $pdo = Db::connection();
        $conversationId = $this->findOrCreateConversationId($remoteJid, $pushName);

        // A Evolution as vezes manda o mesmo evento de mensagem mais de uma
        // vez (ex.: status pending -> enviado). Sem isso a msm mensagem
        // apareceria duplicada no chat.
        if ($waMessageId !== null) {
            $dup = $pdo->prepare(
                'SELECT id, conversation_id, wa_message_id, direction, body, status, created_at
                 FROM whatsapp_messages WHERE wa_message_id = :wa_id LIMIT 1'
            );
            $dup->execute(['wa_id' => $waMessageId]);
            $existing = $dup->fetch(PDO::FETCH_ASSOC);
            if ($existing) {
                $existing['_dedup'] = true;
                return $existing;
            }
        }

        // Quando A GENTE manda uma mensagem (bot ou admin no chat), a Evolution
        // "ecoa" ela de volta pelo webhook (messages.upsert com fromMe=true) —
        // as vezes com um wa_message_id DIFERENTE do que a resposta sincrona do
        // envio trouxe, entao o dedupe por id acima nao pega. Esse e o dedupe
        // de seguranca: mesma conversa+direcao+texto nos ultimos 10s = eco.
        if ($direction === 'out') {
            $recent = $pdo->prepare(
                'SELECT id, conversation_id, wa_message_id, direction, body, status, created_at
                 FROM whatsapp_messages
                 WHERE conversation_id = :cid AND direction = :dir AND body = :body
                   AND created_at >= (NOW() - INTERVAL 10 SECOND)
                 ORDER BY id DESC LIMIT 1'
            );
            $recent->execute(['cid' => $conversationId, 'dir' => $direction, 'body' => $body]);
            $existing = $recent->fetch(PDO::FETCH_ASSOC);
            if ($existing) {
                if ($waMessageId !== null && $existing['wa_message_id'] === null) {
                    $pdo->prepare('UPDATE whatsapp_messages SET wa_message_id = :wid WHERE id = :id')
                        ->execute(['wid' => $waMessageId, 'id' => $existing['id']]);
                    $existing['wa_message_id'] = $waMessageId;
                }
                $existing['_dedup'] = true;
                return $existing;
            }
        }

        $this->touchConversation($conversationId, $body, $direction, $pushName);

        $stmt = $pdo->prepare(
            'INSERT INTO whatsapp_messages (conversation_id, wa_message_id, direction, body, status, created_at)
             VALUES (:cid, :wa_id, :dir, :body, :status, NOW())'
        );
        $stmt->execute([
            'cid' => $conversationId,
            'wa_id' => $waMessageId,
            'dir' => $direction,
            'body' => $body,
            'status' => $direction === 'out' ? 'sent' : null,
        ]);
        $id = (int) $pdo->lastInsertId();

        $get = $pdo->prepare('SELECT id, conversation_id, wa_message_id, direction, body, status, created_at FROM whatsapp_messages WHERE id = :id');
        $get->execute(['id' => $id]);
        $row = $get->fetch(PDO::FETCH_ASSOC) ?: [];

        $convStmt = $pdo->prepare(
            'SELECT id, remote_jid, contact_name, phone, last_message_preview, last_message_at, last_direction, unread_count, bot_paused, created_at
             FROM whatsapp_conversations WHERE id = :id'
        );
        $convStmt->execute(['id' => $conversationId]);
        $conversation = $convStmt->fetch(PDO::FETCH_ASSOC) ?: null;

        $this->broadcast(['type' => 'message', 'message' => $row, 'conversation' => $conversation]);

        return $row;
    }

    /**
     * Empurra a mensagem nova pro servico Node de WebSocket, que repassa pros
     * admins conectados na hora (ver chat-ws-service/index.js). Falha
     * silenciosa se o servico estiver fora do ar — o chat continua
     * funcionando por poll manual (F5), so perde o "tempo real".
     */
    private function broadcast(array $payload): void
    {
        $app = Application::instance();
        $port = (string) ($app->env('CHAT_WS_PORT', '3002') ?? '3002');
        $secret = (string) ($app->env('CHAT_WS_SECRET', '') ?: $app->env('EVOLUTION_API_KEY', ''));

        $ch = curl_init('http://127.0.0.1:' . $port . '/broadcast');
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_POST => true,
            CURLOPT_HTTPHEADER => ['Content-Type: application/json', 'x-broadcast-secret: ' . $secret],
            CURLOPT_POSTFIELDS => json_encode($payload, JSON_UNESCAPED_UNICODE),
            CURLOPT_TIMEOUT => 3,
            CURLOPT_CONNECTTIMEOUT => 1,
        ]);
        curl_exec($ch);
        curl_close($ch);
    }

    /** So resolve/cria a conversa — NAO mexe em preview/unread (isso e feito em touchConversation, depois do dedupe). */
    private function findOrCreateConversationId(string $remoteJid, ?string $pushName): int
    {
        $pdo = Db::connection();
        $stmt = $pdo->prepare('SELECT id, contact_name FROM whatsapp_conversations WHERE remote_jid = :jid');
        $stmt->execute(['jid' => $remoteJid]);
        $existing = $stmt->fetch(PDO::FETCH_ASSOC);

        if ($existing) {
            if ($pushName && !$existing['contact_name']) {
                $pdo->prepare('UPDATE whatsapp_conversations SET contact_name = :name WHERE id = :id')
                    ->execute(['name' => $pushName, 'id' => $existing['id']]);
            }
            return (int) $existing['id'];
        }

        $phone = $this->jidToPhone($remoteJid);
        $stmt = $pdo->prepare(
            'INSERT INTO whatsapp_conversations (remote_jid, contact_name, phone, unread_count, created_at)
             VALUES (:jid, :name, :phone, 0, NOW())'
        );
        $stmt->execute(['jid' => $remoteJid, 'name' => $pushName, 'phone' => $phone]);
        return (int) $pdo->lastInsertId();
    }

    /** Atualiza preview/ultima-mensagem/nao-lidas — so chamado depois de confirmar que NAO e uma mensagem duplicada. */
    private function touchConversation(int $conversationId, string $lastBody, string $direction, ?string $pushName): void
    {
        $pdo = Db::connection();
        $preview = mb_strimwidth($lastBody, 0, 180, '…');
        $sql = 'UPDATE whatsapp_conversations SET last_message_preview = :preview, last_message_at = NOW(), last_direction = :dir';
        $params = ['preview' => $preview, 'dir' => $direction, 'id' => $conversationId];
        if ($direction === 'in') {
            $sql .= ', unread_count = unread_count + 1';
        }
        if ($pushName) {
            $sql .= ', contact_name = COALESCE(contact_name, :name)';
            $params['name'] = $pushName;
        }
        $sql .= ' WHERE id = :id';
        $pdo->prepare($sql)->execute($params);
    }

    private function jidToPhone(string $remoteJid): string
    {
        return (string) preg_replace('/@.*/', '', $remoteJid);
    }
}
