<?php

declare(strict_types=1);

namespace App\Services;

use App\Support\Db;
use PDO;

/**
 * Chatbot com fluxo visual (aba "Chatbot" do admin). O fluxo e um grafo de
 * nos (mensagem / pergunta com opcoes / fim) salvo como JSON — o editor
 * visual no frontend (React Flow) monta esse JSON, esse service so executa.
 *
 * Como funciona a execucao:
 *  - Mensagem chega (webhook) -> se a conversa ja esta "presa" numa pergunta
 *    (chatbot_sessions), a resposta e comparada com as opcoes daquele no pra
 *    decidir o proximo passo.
 *  - Se NAO esta presa em nada, tenta casar a mensagem com a palavra-chave de
 *    algum fluxo ativo (ou usa um fluxo sem palavra-chave como fallback).
 *  - Nos do tipo "mensagem" disparam e seguem direto pro proximo (em cadeia);
 *    nos do tipo "pergunta" mandam a pergunta e PARAM, esperando a resposta;
 *    nos do tipo "fim" encerram a sessao (o cliente volta a falar com um
 *    humano normalmente, sem o bot interferir mais).
 */
final class ChatbotService
{
    private WhatsAppChatService $chat;

    public function __construct()
    {
        $this->chat = new WhatsAppChatService();
    }

    // ---------------------------------------------------------------------
    // CRUD dos fluxos (usado pelo ChatbotController)
    // ---------------------------------------------------------------------

    /** @return array<int, array<string, mixed>> */
    public function listFlows(): array
    {
        $stmt = Db::connection()->query(
            'SELECT id, name, trigger_keyword, is_active, updated_at, created_at FROM chatbot_flows ORDER BY id DESC'
        );
        return $stmt->fetchAll(PDO::FETCH_ASSOC) ?: [];
    }

    /** @return array<string, mixed>|null */
    public function getFlow(int $id): ?array
    {
        $stmt = Db::connection()->prepare('SELECT * FROM chatbot_flows WHERE id = :id');
        $stmt->execute(['id' => $id]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        if (!$row) {
            return null;
        }
        $row['flow'] = json_decode((string) ($row['flow_json'] ?? ''), true) ?: ['nodes' => [], 'edges' => []];
        unset($row['flow_json']);
        return $row;
    }

    /** @return array<string, mixed> */
    public function createFlow(string $name): array
    {
        $pdo = Db::connection();
        $stmt = $pdo->prepare(
            'INSERT INTO chatbot_flows (name, trigger_keyword, is_active, flow_json, created_at, updated_at)
             VALUES (:name, NULL, 0, :flow, NOW(), NOW())'
        );
        $stmt->execute(['name' => $name, 'flow' => json_encode(['nodes' => [], 'edges' => []])]);
        return $this->getFlow((int) $pdo->lastInsertId()) ?? [];
    }

    /**
     * @param array<string, mixed>|null $flow
     */
    public function updateFlow(int $id, ?string $name, ?string $triggerKeyword, ?bool $isActive, ?array $flow): void
    {
        $sets = [];
        $params = ['id' => $id];
        if ($name !== null) {
            $sets[] = 'name = :name';
            $params['name'] = $name;
        }
        if ($triggerKeyword !== null) {
            $sets[] = 'trigger_keyword = :kw';
            $params['kw'] = $triggerKeyword === '' ? null : $triggerKeyword;
        }
        if ($isActive !== null) {
            $sets[] = 'is_active = :active';
            $params['active'] = $isActive ? 1 : 0;
        }
        if ($flow !== null) {
            $sets[] = 'flow_json = :flow';
            $params['flow'] = json_encode($flow, JSON_UNESCAPED_UNICODE);
        }
        if ($sets === []) {
            return;
        }
        $sets[] = 'updated_at = NOW()';
        Db::connection()->prepare('UPDATE chatbot_flows SET ' . implode(', ', $sets) . ' WHERE id = :id')->execute($params);
    }

    public function deleteFlow(int $id): void
    {
        $pdo = Db::connection();
        $pdo->prepare('DELETE FROM chatbot_sessions WHERE flow_id = :id')->execute(['id' => $id]);
        $pdo->prepare('DELETE FROM chatbot_flows WHERE id = :id')->execute(['id' => $id]);
    }

    // ---------------------------------------------------------------------
    // Motor de execucao — chamado pelo WhatsAppWebhookController
    // ---------------------------------------------------------------------

    public function handleIncomingMessage(int $conversationId, string $remoteJid, string $text): void
    {
        // Bot pausado (cliente pediu pra falar com humano, ver no "handoff")
        // — nao interfere, o admin conversa direto pelo chat.
        if ($this->chat->isBotPaused($conversationId)) {
            return;
        }

        $session = $this->getSession($conversationId);
        if ($session !== null) {
            $flowRow = $this->getFlow((int) $session['flow_id']);
            if ($flowRow !== null && (int) $flowRow['is_active'] === 1) {
                $this->advance($flowRow, $session, $conversationId, $remoteJid, $text);
                return;
            }
            $this->clearSession($conversationId);
        }

        $flowRow = $this->matchTrigger($text);
        if ($flowRow === null) {
            return;
        }
        $this->startFlow($flowRow, $conversationId, $remoteJid);
    }

    /** @return array<string, mixed>|null */
    private function matchTrigger(string $text): ?array
    {
        $norm = mb_strtolower(trim($text));
        $stmt = Db::connection()->query('SELECT * FROM chatbot_flows WHERE is_active = 1 ORDER BY id ASC');
        $rows = $stmt->fetchAll(PDO::FETCH_ASSOC) ?: [];

        $fallback = null;
        foreach ($rows as $row) {
            $kw = trim((string) ($row['trigger_keyword'] ?? ''));
            if ($kw === '') {
                $fallback ??= $row;
                continue;
            }
            $keywords = array_filter(array_map('trim', explode(',', mb_strtolower($kw))));
            foreach ($keywords as $k) {
                if ($k !== '' && str_contains($norm, $k)) {
                    return $row;
                }
            }
        }
        return $fallback;
    }

    /**
     * $flowRow pode vir de duas formas: bruta do SQL (com flow_json em string,
     * usada por matchTrigger) ou ja tratada por getFlow() (com flow[] pronto,
     * sem flow_json). Aceita as duas pra nao operar num grafo vazio por engano.
     * @param array<string, mixed> $flowRow
     * @return array<string, mixed>
     */
    private function decodeFlowGraph(array $flowRow): array
    {
        if (isset($flowRow['flow']) && is_array($flowRow['flow'])) {
            return $flowRow['flow'];
        }
        return json_decode((string) ($flowRow['flow_json'] ?? ''), true) ?: ['nodes' => [], 'edges' => []];
    }

    private function startFlow(array $flowRow, int $conversationId, string $remoteJid): void
    {
        $flow = $this->decodeFlowGraph($flowRow);
        $first = $this->findStartNode($flow);
        if ($first === null) {
            return;
        }
        $this->runFrom($flow, (int) $flowRow['id'], $conversationId, $remoteJid, $first, []);
    }

    /** @param array<string, mixed> $session */
    private function advance(array $flowRow, array $session, int $conversationId, string $remoteJid, string $text): void
    {
        $flow = $this->decodeFlowGraph($flowRow);
        $currentNode = $this->findNode($flow, (string) $session['current_node_id']);
        if ($currentNode === null) {
            $this->clearSession($conversationId);
            return;
        }
        $history = $this->decodeHistory($session['history_json'] ?? null);

        // "voltar" funciona em QUALQUER pergunta, sem precisar desenhar nada
        // no fluxo — volta pro no anterior (repete a pergunta de antes).
        if ($this->isBackCommand($text)) {
            if ($history === []) {
                $this->sendText($conversationId, $remoteJid, 'Você já está no começo da conversa.');
                $this->sendText($conversationId, $remoteJid, (string) ($currentNode['data']['text'] ?? ''));
                return;
            }
            $previousId = array_pop($history);
            $previousNode = $this->findNode($flow, $previousId);
            if ($previousNode === null) {
                $this->clearSession($conversationId);
                return;
            }
            $this->runFrom($flow, (int) $flowRow['id'], $conversationId, $remoteJid, $previousNode, $history);
            return;
        }

        if ((string) ($currentNode['type'] ?? '') === 'identify') {
            // Estava esperando o e-mail pra confirmar se e cliente.
            $email = $this->extractEmail($text) ?? trim($text);
            $client = $this->findClientByEmail($email);
            if ($client !== null) {
                $this->linkPhoneIfMissing((int) $client['id'], $remoteJid);
            }
            $nextNodeId = $this->edgeTarget($flow, (string) $currentNode['id'], $client !== null ? 'found' : 'not_found');
        } else {
            $nextNodeId = $this->resolveNext($flow, $currentNode, $text);
        }

        if ($nextNodeId === null) {
            // Nao reconheceu a resposta: repete a pergunta.
            $this->sendText($conversationId, $remoteJid, (string) ($currentNode['data']['text'] ?? ''));
            return;
        }
        $nextNode = $this->findNode($flow, $nextNodeId);
        if ($nextNode === null) {
            $this->clearSession($conversationId);
            return;
        }
        $history[] = (string) $currentNode['id'];
        $this->runFrom($flow, (int) $flowRow['id'], $conversationId, $remoteJid, $nextNode, $history);
    }

    /**
     * Executa nos em cadeia ate achar um que precisa esperar resposta
     * ("question"/"identify" sem achar cliente) ou parar de vez ("end",
     * "handoff"). $history = pilha de nos "de espera" ja visitados, pra dar
     * pra "voltar".
     * @param array<string, mixed> $flow
     * @param array<string, mixed> $node
     * @param array<int, string> $history
     */
    private function runFrom(array $flow, int $flowId, int $conversationId, string $remoteJid, array $node, array $history = []): void
    {
        $guard = 0;
        while ($guard++ < 25) {
            $type = (string) ($node['type'] ?? 'message');

            if ($type === 'identify') {
                $client = $this->findClientByPhone($remoteJid);
                if ($client !== null) {
                    $nextId = $this->edgeTarget($flow, (string) $node['id'], 'found');
                } else {
                    $askText = trim((string) ($node['data']['text'] ?? ''));
                    if ($askText !== '') {
                        $this->sendText($conversationId, $remoteJid, $askText);
                    }
                    $this->saveSession($conversationId, $flowId, (string) $node['id'], $history);
                    return;
                }
                $next = $nextId !== null ? $this->findNode($flow, $nextId) : null;
                if ($next === null) {
                    $this->clearSession($conversationId);
                    return;
                }
                $node = $next;
                continue;
            }

            if ($type === 'handoff') {
                $handoffText = trim((string) ($node['data']['text'] ?? ''))
                    ?: 'Já vou te conectar com um atendente humano, só um momento! 🙋';
                $this->sendText($conversationId, $remoteJid, $handoffText);
                $this->chat->setBotPaused($conversationId, true);
                $this->notifyAdminHandoff($conversationId);
                $this->clearSession($conversationId);
                return;
            }

            $text = $type === 'plans' ? $this->buildPlansText() : trim((string) ($node['data']['text'] ?? ''));
            $typingDelaySec = is_numeric($node['data']['typingDelaySec'] ?? null) ? (float) $node['data']['typingDelaySec'] : 0.0;
            if ($text !== '') {
                $this->sendText($conversationId, $remoteJid, $text, $typingDelaySec);
            }

            if ($type === 'question') {
                $this->saveSession($conversationId, $flowId, (string) $node['id'], $history);
                return;
            }
            if ($type === 'end') {
                $this->clearSession($conversationId);
                return;
            }

            $nextId = $this->findSimpleNext($flow, (string) $node['id']);
            $next = $nextId !== null ? $this->findNode($flow, $nextId) : null;
            if ($next === null) {
                $this->clearSession($conversationId);
                return;
            }
            $node = $next;
        }
    }

    /** @return array<int, array<string, mixed>> */
    private function planos(): array
    {
        return (new PlanoService())->listAll(false);
    }

    private function buildPlansText(): string
    {
        $planos = $this->planos();
        if ($planos === []) {
            return 'No momento não temos planos disponíveis — fala com a gente que a gente te ajuda!';
        }
        $lines = ['📋 *Nossos planos disponíveis:*', ''];
        foreach ($planos as $p) {
            $valor = number_format((float) ($p['valor'] ?? 0), 2, ',', '.');
            $dias = (int) ($p['dias_acesso'] ?? 0);
            $lines[] = '• *' . (string) ($p['nome'] ?? '') . "* — R$ {$valor} ({$dias} dias de acesso)";
        }
        return implode("\n", $lines);
    }

    /** Avisa os admins (push do navegador) que um cliente pediu atendimento humano — com um resumo das ultimas mensagens da conversa. */
    private function notifyAdminHandoff(int $conversationId): void
    {
        $conv = $this->chat->findConversation($conversationId);
        $who = $conv !== null && !empty($conv['phone']) ? (string) $conv['phone'] : 'um cliente';

        $messages = $this->chat->getMessages($conversationId, 12);
        $lines = [];
        foreach ($messages as $m) {
            $who2 = ($m['direction'] ?? '') === 'in' ? 'Cliente' : 'Bot';
            $lines[] = $who2 . ': ' . mb_strimwidth((string) ($m['body'] ?? ''), 0, 140, '…');
        }

        (new WebPushService())->sendToAdmins([
            'title' => 'Cliente pediu atendimento humano',
            'body' => $who . "\n" . mb_strimwidth(implode("\n", $lines), 0, 220, '…'),
            'data' => ['url' => '/admin-whatsapp-mensagens', 'conversation_id' => $conversationId],
        ]);
    }

    /** @return array<int, string> */
    private function decodeHistory(mixed $raw): array
    {
        if (!is_string($raw) || $raw === '') {
            return [];
        }
        $decoded = json_decode($raw, true);
        if (!is_array($decoded)) {
            return [];
        }
        return array_values(array_filter($decoded, 'is_string'));
    }

    private function isBackCommand(string $text): bool
    {
        $norm = mb_strtolower(trim($text));
        return $norm === 'voltar' || $norm === 'menu anterior';
    }

    /** @param array<string, mixed> $flow */
    private function resolveNext(array $flow, array $questionNode, string $text): ?string
    {
        $options = $questionNode['data']['options'] ?? [];
        if (!is_array($options)) {
            return null;
        }
        $norm = mb_strtolower(trim($text));
        $digits = preg_replace('/\D/', '', $norm) ?? '';

        foreach (array_values($options) as $idx => $opt) {
            $optId = is_array($opt) ? ($opt['id'] ?? null) : null;
            if (!is_string($optId)) {
                continue;
            }
            $label = mb_strtolower((string) ($opt['label'] ?? ''));
            $kwRaw = mb_strtolower((string) ($opt['matchKeywords'] ?? ''));
            $candidates = array_filter(array_map('trim', explode(',', $kwRaw)));

            $numberMatch = $digits !== '' && $digits === (string) ($idx + 1);
            $labelMatch = $label !== '' && str_contains($norm, $label);
            $kwMatch = false;
            foreach ($candidates as $c) {
                if ($c !== '' && str_contains($norm, $c)) {
                    $kwMatch = true;
                    break;
                }
            }

            if ($numberMatch || $labelMatch || $kwMatch) {
                $target = $this->edgeTarget($flow, (string) $questionNode['id'], $optId);
                if ($target !== null) {
                    return $target;
                }
            }
        }
        return null;
    }

    /** @param array<string, mixed> $flow */
    private function findSimpleNext(array $flow, string $nodeId): ?string
    {
        foreach ($flow['edges'] ?? [] as $edge) {
            if (($edge['source'] ?? null) === $nodeId) {
                return is_string($edge['target'] ?? null) ? $edge['target'] : null;
            }
        }
        return null;
    }

    /** Acha o destino da edge que sai de $nodeId por um "handle" especifico (opcao de pergunta, ou found/not_found do no de identificar). */
    private function edgeTarget(array $flow, string $nodeId, string $handleId): ?string
    {
        foreach ($flow['edges'] ?? [] as $edge) {
            if (($edge['source'] ?? null) === $nodeId && ($edge['sourceHandle'] ?? null) === $handleId) {
                return is_string($edge['target'] ?? null) ? $edge['target'] : null;
            }
        }
        return null;
    }

    // ---------------------------------------------------------------------
    // Identificacao de cliente (no "identify") — telefone primeiro, e-mail
    // como confirmacao se o telefone nao bater com nenhum cadastro.
    // ---------------------------------------------------------------------

    /** @return array<string, mixed>|null */
    private function findClientByPhone(string $remoteJid): ?array
    {
        $digits = preg_replace('/\D/', '', explode('@', $remoteJid)[0] ?? '') ?? '';
        if ($digits === '') {
            return null;
        }
        $variants = [$digits];
        $variants[] = str_starts_with($digits, '55') ? substr($digits, 2) : ('55' . $digits);

        $stmt = Db::connection()->query("SELECT id, name, email, phone FROM users WHERE phone IS NOT NULL AND phone <> ''");
        foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $u) {
            $uDigits = preg_replace('/\D/', '', (string) $u['phone']) ?? '';
            if ($uDigits === '') {
                continue;
            }
            foreach ($variants as $v) {
                if ($uDigits === $v || str_ends_with($uDigits, $v) || str_ends_with($v, $uDigits)) {
                    return $u;
                }
            }
        }
        return null;
    }

    /** @return array<string, mixed>|null */
    private function findClientByEmail(string $email): ?array
    {
        $email = mb_strtolower(trim($email));
        if ($email === '' || !str_contains($email, '@')) {
            return null;
        }
        $stmt = Db::connection()->prepare('SELECT id, name, email, phone FROM users WHERE LOWER(email) = :email LIMIT 1');
        $stmt->execute(['email' => $email]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        return $row ?: null;
    }

    private function extractEmail(string $text): ?string
    {
        if (preg_match('/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/', $text, $m) === 1) {
            return $m[0];
        }
        return null;
    }

    /** Cliente confirmado por e-mail mas sem telefone cadastrado — guarda o numero do WhatsApp pra da proxima vez achar direto por telefone. */
    private function linkPhoneIfMissing(int $userId, string $remoteJid): void
    {
        $digits = preg_replace('/\D/', '', explode('@', $remoteJid)[0] ?? '') ?? '';
        if ($digits === '') {
            return;
        }
        Db::connection()->prepare("UPDATE users SET phone = :phone WHERE id = :id AND (phone IS NULL OR phone = '')")
            ->execute(['phone' => $digits, 'id' => $userId]);
    }

    /**
     * No inicial = o unico que nenhuma edge aponta pra ele (raiz do grafo).
     * @param array<string, mixed> $flow
     * @return array<string, mixed>|null
     */
    private function findStartNode(array $flow): ?array
    {
        $targets = array_column(is_array($flow['edges'] ?? null) ? $flow['edges'] : [], 'target');
        foreach ($flow['nodes'] ?? [] as $node) {
            if (!in_array($node['id'] ?? null, $targets, true)) {
                return $node;
            }
        }
        return $flow['nodes'][0] ?? null;
    }

    /**
     * @param array<string, mixed> $flow
     * @return array<string, mixed>|null
     */
    private function findNode(array $flow, string $id): ?array
    {
        foreach ($flow['nodes'] ?? [] as $node) {
            if (($node['id'] ?? null) === $id) {
                return $node;
            }
        }
        return null;
    }

    private function sendText(int $conversationId, string $remoteJid, string $text, float $typingDelaySec = 0.0): void
    {
        if ($text === '') {
            return;
        }
        $this->chat->sendMessage($conversationId, $text, $typingDelaySec);
    }

    // ---------------------------------------------------------------------
    // Sessao (em que "no" a conversa esta parada, esperando resposta)
    // ---------------------------------------------------------------------

    /** @return array<string, mixed>|null */
    private function getSession(int $conversationId): ?array
    {
        $stmt = Db::connection()->prepare('SELECT * FROM chatbot_sessions WHERE conversation_id = :cid');
        $stmt->execute(['cid' => $conversationId]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        return $row ?: null;
    }

    /** @param array<int, string> $history */
    private function saveSession(int $conversationId, int $flowId, string $nodeId, array $history = []): void
    {
        // Cada placeholder nomeado so pode aparecer 1x em prepared statement
        // nativo do MySQL — por isso :fid2/:node2/:hist2 em vez de reusar
        // :fid/:node/:hist.
        $historyJson = json_encode(array_values($history));
        Db::connection()->prepare(
            'INSERT INTO chatbot_sessions (conversation_id, flow_id, current_node_id, history_json, updated_at)
             VALUES (:cid, :fid, :node, :hist, NOW())
             ON DUPLICATE KEY UPDATE flow_id = :fid2, current_node_id = :node2, history_json = :hist2, updated_at = NOW()'
        )->execute([
            'cid' => $conversationId,
            'fid' => $flowId,
            'node' => $nodeId,
            'hist' => $historyJson,
            'fid2' => $flowId,
            'node2' => $nodeId,
            'hist2' => $historyJson,
        ]);
    }

    private function clearSession(int $conversationId): void
    {
        Db::connection()->prepare('DELETE FROM chatbot_sessions WHERE conversation_id = :cid')->execute(['cid' => $conversationId]);
    }
}
