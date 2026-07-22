<?php

declare(strict_types=1);

namespace App\Services;

use App\Support\Crypto;
use App\Support\Db;
use RuntimeException;

/**
 * Integracao com a API de pagamentos do Mercado Pago (Pix). O access token
 * e do dono do sistema (system_settings, criptografado em repouso) —
 * compartilhado por todos os planos.
 */
final class MercadoPagoService
{
    private const API_URL = 'https://api.mercadopago.com/v1/payments';

    /**
     * @return array{id:string, status:string, qr_code:string, qr_code_base64:string}
     */
    public function createPixPayment(
        float $valor,
        string $description,
        string $externalReference,
        string $payerEmail,
        string $notificationUrl
    ): array {
        $payload = [
            'transaction_amount' => $valor,
            'description' => $description,
            'payment_method_id' => 'pix',
            'external_reference' => $externalReference,
            'notification_url' => $notificationUrl,
            'payer' => ['email' => $payerEmail],
        ];

        $response = $this->call('POST', self::API_URL, $payload, [
            'X-Idempotency-Key: ' . bin2hex(random_bytes(16)),
        ]);

        $qrCode = $response['point_of_interaction']['transaction_data']['qr_code'] ?? null;
        $qrCodeBase64 = $response['point_of_interaction']['transaction_data']['qr_code_base64'] ?? null;
        if (!isset($response['id']) || $qrCode === null) {
            throw new RuntimeException('O Mercado Pago nao retornou os dados do Pix.');
        }

        return [
            'id' => (string) $response['id'],
            'status' => (string) ($response['status'] ?? 'pending'),
            'qr_code' => (string) $qrCode,
            'qr_code_base64' => (string) $qrCodeBase64,
        ];
    }

    /**
     * Sempre re-consulta a API do Mercado Pago com o token proprio — usado
     * tanto no polling quanto no webhook, que nunca deve confiar direto no
     * status recebido no corpo da notificacao.
     *
     * @return array{id:string, status:string}
     */
    public function fetchPayment(string $paymentId): array
    {
        $response = $this->call('GET', self::API_URL . '/' . rawurlencode($paymentId), null, []);

        return [
            'id' => (string) ($response['id'] ?? $paymentId),
            'status' => (string) ($response['status'] ?? 'unknown'),
        ];
    }

    private function accessToken(): string
    {
        $row = Db::connection()->query(
            'SELECT mercado_pago_access_token_encrypted FROM system_settings WHERE id = 1'
        )->fetch();
        $encrypted = $row['mercado_pago_access_token_encrypted'] ?? null;
        if (empty($encrypted)) {
            throw new RuntimeException('O Mercado Pago ainda nao foi configurado pelo administrador.');
        }

        $token = Crypto::decrypt((string) $encrypted);
        if ($token === null || $token === '') {
            throw new RuntimeException('Nao foi possivel ler a credencial do Mercado Pago.');
        }

        return $token;
    }

    /**
     * @param array<string,mixed>|null $payload
     * @param array<int,string> $extraHeaders
     */
    private function call(string $method, string $url, ?array $payload, array $extraHeaders): array
    {
        $headers = array_merge([
            'Content-Type: application/json',
            'Authorization: Bearer ' . $this->accessToken(),
        ], $extraHeaders);

        $options = [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_HTTPHEADER => $headers,
            CURLOPT_TIMEOUT => 30,
        ];
        if ($method === 'POST') {
            $options[CURLOPT_POST] = true;
            $options[CURLOPT_POSTFIELDS] = json_encode($payload, JSON_UNESCAPED_UNICODE);
        }

        $ch = curl_init($url);
        curl_setopt_array($ch, $options);

        $raw = curl_exec($ch);
        if ($raw === false) {
            $error = curl_error($ch);
            curl_close($ch);
            throw new RuntimeException('Falha ao conectar com o Mercado Pago: ' . $error);
        }

        $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

        $decoded = json_decode((string) $raw, true);

        if ($status < 200 || $status >= 300) {
            $message = is_array($decoded)
                ? ($decoded['message'] ?? ($decoded['cause'][0]['description'] ?? null))
                : null;
            throw new RuntimeException($message ?? 'Erro desconhecido do Mercado Pago (status ' . $status . ').');
        }

        return is_array($decoded) ? $decoded : [];
    }
}
