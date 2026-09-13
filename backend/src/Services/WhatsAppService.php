<?php

declare(strict_types=1);

namespace App\Services;

use App\Core\Application;

/**
 * Ponte entre o backend PHP e a Evolution API (self-hosted, roda em Docker na
 * VPS, so em 127.0.0.1). A Evolution usa a lib Baileys (sem Chrome/Puppeteer).
 *
 * O QR do WhatsApp so vale ~45s e a Evolution troca ele sozinha nesse ritmo.
 * Ficar chamando /instance/connect a cada poll do admin (a cada 3s) desincroniza
 * do que a Evolution ta mostrando de verdade. Por isso usamos WEBHOOK: a
 * Evolution avisa esse backend (evento QRCODE_UPDATED / CONNECTION_UPDATE)
 * toda vez que o QR muda ou a conexao muda de estado, e a gente so guarda o
 * ultimo valor recebido (ver WhatsAppWebhookController). O /instance/connect
 * so e chamado UMA VEZ, no botao "Conectar" — depois disso e so o webhook que
 * atualiza.
 */
final class WhatsAppService
{
    private string $baseUrl;
    private string $apiKey;
    private string $instance;
    private string $webhookSecret;
    private string $stateFile;

    public function __construct()
    {
        $app = Application::instance();
        $this->baseUrl = rtrim((string) ($app->env('EVOLUTION_API_URL', 'http://127.0.0.1:8088') ?? 'http://127.0.0.1:8088'), '/');
        $this->apiKey = (string) ($app->env('EVOLUTION_API_KEY', '') ?? '');
        $this->instance = (string) ($app->env('EVOLUTION_INSTANCE', 'cardozo') ?? 'cardozo');
        $this->webhookSecret = (string) ($app->env('EVOLUTION_WEBHOOK_SECRET', '') ?: $this->apiKey);
        $this->stateFile = __DIR__ . '/../../storage/whatsapp_state.json';
    }

    /**
     * @param array<string,mixed>|null $body
     * @return array{ok:bool, status:int, data:array<string,mixed>}
     */
    private function call(string $method, string $path, ?array $body = null): array
    {
        $ch = curl_init($this->baseUrl . $path);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_CUSTOMREQUEST => $method,
            CURLOPT_HTTPHEADER => [
                'Content-Type: application/json',
                'apikey: ' . $this->apiKey,
            ],
            CURLOPT_TIMEOUT => 25,
            CURLOPT_CONNECTTIMEOUT => 5,
        ]);
        if ($body !== null) {
            curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($body, JSON_UNESCAPED_UNICODE));
        }
        $raw = curl_exec($ch);
        $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $err = curl_error($ch);
        curl_close($ch);

        if ($raw === false || $status === 0) {
            return ['ok' => false, 'status' => 0, 'data' => ['error' => 'Serviço de WhatsApp (Evolution API) offline. ' . $err]];
        }
        $data = json_decode((string) $raw, true);
        if (!is_array($data)) {
            $data = [];
        }
        return ['ok' => $status >= 200 && $status < 300, 'status' => $status, 'data' => $data];
    }

    /** URL publica que a Evolution (rodando em Docker) chama pra avisar QR/estado novo. */
    private function webhookUrl(): string
    {
        $app = Application::instance();
        $appUrl = rtrim((string) ($app->env('APP_URL', 'https://alisson-projetos.fun') ?? 'https://alisson-projetos.fun'), '/');
        return $appUrl . '/api/whatsapp/webhook';
    }

    /** @return array<string,mixed> */
    private function webhookConfig(): array
    {
        return [
            'enabled' => true,
            'url' => $this->webhookUrl(),
            'byEvents' => false,
            'base64' => true,
            'events' => ['QRCODE_UPDATED', 'CONNECTION_UPDATE', 'MESSAGES_UPSERT', 'SEND_MESSAGE'],
            'headers' => ['x-evolution-webhook-secret' => $this->webhookSecret],
        ];
    }

    /** Garante que o webhook ta configurado na instancia (idempotente, seguro chamar sempre). */
    private function setWebhook(): void
    {
        $this->call('POST', '/webhook/set/' . $this->instance, ['webhook' => $this->webhookConfig()]);
    }

    private function createInstance(): void
    {
        $this->call('POST', '/instance/create', [
            'instanceName' => $this->instance,
            'qrcode' => true,
            'integration' => 'WHATSAPP-BAILEYS',
            'webhook' => $this->webhookConfig(),
        ]);
        $this->setWebhook();
    }

    /** @return array{qr:?string, state:?string, pairingCode:?string} */
    private function readState(): array
    {
        if (!is_file($this->stateFile)) {
            return ['qr' => null, 'state' => null, 'pairingCode' => null];
        }
        $raw = file_get_contents($this->stateFile);
        $data = $raw !== false ? json_decode($raw, true) : null;
        if (!is_array($data)) {
            return ['qr' => null, 'state' => null, 'pairingCode' => null];
        }
        return [
            'qr' => is_string($data['qr'] ?? null) ? $data['qr'] : null,
            'state' => is_string($data['state'] ?? null) ? $data['state'] : null,
            'pairingCode' => is_string($data['pairingCode'] ?? null) ? $data['pairingCode'] : null,
        ];
    }

    private function writeState(?string $qr, ?string $state, ?string $pairingCode = null): void
    {
        @file_put_contents($this->stateFile, json_encode([
            'qr' => $qr,
            'state' => $state,
            'pairingCode' => $pairingCode,
            'updated_at' => time(),
        ]));
    }

    private function clearState(): void
    {
        if (is_file($this->stateFile)) {
            @unlink($this->stateFile);
        }
    }

    /** Chamado pelo WhatsAppWebhookController quando a Evolution avisa QR/estado novo. */
    public function saveWebhookState(?string $qr, ?string $state): void
    {
        $current = $this->readState();
        // Um QR novo empurrado pelo webhook so pode vir da tela de QR — limpa o
        // pairing code antigo pra nao mostrar os dois ao mesmo tempo.
        $this->writeState($qr ?? $current['qr'], $state ?? $current['state'], $qr !== null ? null : $current['pairingCode']);
    }

    /** Status + QR (o admin faz poll disso enquanto não conecta). NUNCA chama /instance/connect aqui. */
    public function status(): array
    {
        $r = $this->call('GET', '/instance/connectionState/' . $this->instance);
        if (!$r['ok'] && $r['status'] === 0) {
            return $r;
        }

        if ($r['status'] === 404) {
            return ['ok' => true, 'status' => 200, 'data' => ['connected' => false, 'qr' => null, 'initializing' => true]];
        }

        $state = (string) ($r['data']['instance']['state'] ?? 'close');
        if ($state === 'open') {
            $this->clearState();
            return ['ok' => true, 'status' => 200, 'data' => ['connected' => true, 'qr' => null]];
        }

        $saved = $this->readState();
        return ['ok' => true, 'status' => 200, 'data' => ['connected' => false, 'qr' => $saved['qr'], 'pairingCode' => $saved['pairingCode']]];
    }

    /** (Re)inicia a conexão — botão "Conectar" / "Gerar novo QR". So aqui chamamos /instance/connect. */
    public function connect(): array
    {
        $r = $this->call('GET', '/instance/connectionState/' . $this->instance);
        if ($r['status'] === 404) {
            $this->createInstance();
        } else {
            $this->setWebhook();
        }

        $qr = $this->call('GET', '/instance/connect/' . $this->instance);
        $base64 = $qr['data']['base64'] ?? null;
        $base64 = is_string($base64) ? $base64 : null;
        $this->writeState($base64, 'connecting');

        return ['ok' => true, 'status' => 200, 'data' => ['qr' => $base64]];
    }

    /**
     * Metodo alternativo ao QR: gera um codigo de 8 digitos pra digitar no
     * celular (WhatsApp → Aparelhos conectados → Conectar com numero de
     * telefone). Usa um mecanismo diferente do QR no WhatsApp — pode
     * funcionar mesmo quando o QR fica preso em "connecting".
     */
    public function connectWithPairingCode(string $phoneNumber): array
    {
        $number = $this->normalizeNumber($phoneNumber);
        if ($number === null) {
            return ['ok' => false, 'status' => 422, 'data' => ['error' => 'Número inválido.']];
        }

        $r = $this->call('GET', '/instance/connectionState/' . $this->instance);
        if ($r['status'] === 404) {
            $this->createInstance();
        } else {
            $this->setWebhook();
        }

        $resp = $this->call('GET', '/instance/connect/' . $this->instance . '?number=' . $number);
        $pairingCode = $resp['data']['pairingCode'] ?? null;
        $pairingCode = is_string($pairingCode) ? $pairingCode : null;
        $base64 = $resp['data']['base64'] ?? null;
        $base64 = is_string($base64) ? $base64 : null;

        if ($pairingCode === null) {
            return ['ok' => false, 'status' => $resp['status'] ?: 502, 'data' => ['error' => 'A Evolution não retornou um código de pareamento. ' . (string) ($resp['data']['error'] ?? '')]];
        }

        $this->writeState($base64, 'connecting', $pairingCode);
        return ['ok' => true, 'status' => 200, 'data' => ['pairingCode' => $pairingCode]];
    }

    /** Desconecta o número (logout) — a sessão sai, o próximo /connect pede QR novo. */
    public function disconnect(): array
    {
        $this->clearState();
        return $this->call('DELETE', '/instance/logout/' . $this->instance);
    }

    /** Envia uma mensagem de texto. @return array{ok:bool, status:int, data:array<string,mixed>} */
    public function send(string $to, string $message): array
    {
        $number = $this->normalizeNumber($to);
        if ($number === null) {
            return ['ok' => false, 'status' => 422, 'data' => ['error' => 'Número inválido.']];
        }
        return $this->call('POST', '/message/sendText/' . $this->instance, [
            'number' => $number,
            'text' => $message,
        ]);
    }

    /**
     * Mostra "digitando..." pro cliente antes de mandar a mensagem (efeito
     * "tempo digitando" configurado no no de mensagem do chatbot) — melhor
     * esforco, nunca lanca (se a Evolution nao tiver esse endpoint, so nao
     * mostra o indicador, o envio da mensagem continua normal).
     */
    public function sendPresence(string $to, string $presence, int $delayMs = 0): void
    {
        $number = $this->normalizeNumber($to);
        if ($number === null) {
            return;
        }
        $this->call('POST', '/chat/sendPresence/' . $this->instance, [
            'number' => $number,
            'presence' => $presence,
            'delay' => max(0, $delayMs),
        ]);
    }

    /**
     * Numero -> so digitos, com DDI. Se vier sem codigo de pais (10 ou 11
     * digitos = DDD + numero), assume Brasil e adiciona 55.
     */
    private function normalizeNumber(string $numero): ?string
    {
        $digits = preg_replace('/\D/', '', $numero) ?? '';
        if ($digits === '') {
            return null;
        }
        if ((strlen($digits) === 10 || strlen($digits) === 11) && !str_starts_with($digits, '55')) {
            $digits = '55' . $digits;
        }
        return $digits;
    }

    /** Conveniencia: o WhatsApp esta conectado agora? */
    public function isConnected(): bool
    {
        $r = $this->status();
        return $r['ok'] && !empty($r['data']['connected']);
    }
}
