<?php

declare(strict_types=1);

namespace App\Services;

use App\Core\Application;
use App\Support\Crypto;
use App\Support\Db;
use RuntimeException;

/**
 * Web Push (VAPID + criptografia aes128gcm) implementado em PHP puro, sem
 * Composer/biblioteca — usa so openssl + hash_hkdf. Segue a RFC 8291 (payload
 * encryption) e a RFC 8292 (VAPID). As chaves VAPID sao geradas uma unica vez e
 * guardadas em system_settings (a privada criptografada em repouso).
 *
 * Fluxo: o admin ativa notificacoes no navegador -> pushManager.subscribe com a
 * chave publica VAPID -> a subscription (endpoint/p256dh/auth) e salva em
 * push_subscriptions -> aqui a gente criptografa o payload pra cada subscription
 * e faz um POST no endpoint do push service (FCM/Mozilla/etc).
 */
final class WebPushService
{
    // Prefixo DER (SubjectPublicKeyInfo) de uma chave publica EC P-256, ate o
    // ponto nao comprimido -- concatenar com os 65 bytes (0x04||X||Y) forma a
    // chave publica completa pra openssl_pkey_get_public.
    private const P256_SPKI_PREFIX_HEX = '3059301306072a8648ce3d020106082a8648ce3d030107034200';

    /** Chave publica VAPID (base64url) — vai pro frontend e pro header `k=`. */
    public function publicKey(): string
    {
        return $this->ensureKeys()['public'];
    }

    /**
     * Envia a notificacao pra todos os dispositivos (push_subscriptions) dos
     * admins. Nunca lanca — retorna quantos deram certo/falharam. Subscriptions
     * expiradas (404/410) sao removidas.
     *
     * @param array{title:string, body:string, data?:array<string,mixed>} $notif
     * @return array{sent:int, failed:int, total:int}
     */
    public function sendToAdmins(array $notif): array
    {
        $subs = Db::connection()->query(
            "SELECT ps.* FROM push_subscriptions ps
             JOIN users u ON u.id = ps.user_id
             WHERE u.role = 'admin'"
        )->fetchAll();

        $json = json_encode([
            'title' => $notif['title'] ?? 'Notificação',
            'body' => $notif['body'] ?? '',
            'data' => $notif['data'] ?? new \stdClass(),
        ], JSON_UNESCAPED_UNICODE);

        $sent = 0;
        $failed = 0;
        foreach ($subs as $sub) {
            try {
                $code = $this->sendOne($sub, (string) $json);
                if ($code >= 200 && $code < 300) {
                    $sent++;
                    Db::connection()
                        ->prepare('UPDATE push_subscriptions SET last_used_at = NOW() WHERE id = :id')
                        ->execute(['id' => $sub['id']]);
                } elseif ($code === 404 || $code === 410) {
                    // Subscription morta: o dispositivo desinstalou/expirou.
                    Db::connection()
                        ->prepare('DELETE FROM push_subscriptions WHERE id = :id')
                        ->execute(['id' => $sub['id']]);
                    $failed++;
                } else {
                    $failed++;
                }
            } catch (\Throwable $e) {
                $failed++;
            }
        }

        return ['sent' => $sent, 'failed' => $failed, 'total' => count($subs)];
    }

    /** @param array<string,mixed> $sub linha de push_subscriptions */
    private function sendOne(array $sub, string $json): int
    {
        $endpoint = (string) $sub['endpoint'];
        $clientPublic = self::b64urlDecode((string) $sub['p256dh']); // 65 bytes
        $authSecret = self::b64urlDecode((string) $sub['auth']);     // 16 bytes

        $encrypted = self::encryptAes128Gcm($json, $clientPublic, $authSecret);
        $jwt = $this->vapidAuthorization($endpoint);

        $headers = [
            'Content-Type: application/octet-stream',
            'Content-Encoding: aes128gcm',
            'TTL: 2419200',
            'Urgency: high',
            'Authorization: ' . $jwt,
        ];

        $ch = curl_init($endpoint);
        curl_setopt_array($ch, [
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => $encrypted['body'],
            CURLOPT_HTTPHEADER => $headers,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => 15,
        ]);
        curl_exec($ch);
        $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

        return $code;
    }

    /**
     * Monta o header Authorization VAPID (`vapid t=<jwt>, k=<publicKey>`) para o
     * endpoint dado. `aud` = origem (scheme://host) do push service.
     */
    private function vapidAuthorization(string $endpoint): string
    {
        $keys = $this->ensureKeys();
        $priv = openssl_pkey_get_private($keys['private_pem']);
        if ($priv === false) {
            throw new RuntimeException('Chave privada VAPID invalida.');
        }

        $parts = parse_url($endpoint);
        $aud = ($parts['scheme'] ?? 'https') . '://' . ($parts['host'] ?? '');
        $sub = (string) (Application::instance()->env('MAIL_FROM') ?? 'admin@alisson-projetos.fun');

        $header = self::b64urlEncode((string) json_encode(['typ' => 'JWT', 'alg' => 'ES256']));
        $payload = self::b64urlEncode((string) json_encode([
            'aud' => $aud,
            'exp' => time() + 43200, // 12h
            'sub' => str_starts_with($sub, 'mailto:') ? $sub : 'mailto:' . $sub,
        ]));
        $signingInput = $header . '.' . $payload;

        $der = '';
        if (!openssl_sign($signingInput, $der, $priv, OPENSSL_ALGO_SHA256)) {
            throw new RuntimeException('Falha ao assinar o JWT VAPID.');
        }
        $jwt = $signingInput . '.' . self::b64urlEncode(self::derToRawEs256($der));

        return 'vapid t=' . $jwt . ', k=' . $keys['public'];
    }

    /**
     * Criptografa `$payload` pro esquema aes128gcm (RFC 8291/8188). Deixa injetar
     * a chave efemera do servidor e o salt (pra testes deterministicos); em
     * producao gera ambos aleatorios.
     *
     * @return array{body:string, salt:string, as_public:string}
     */
    public static function encryptAes128Gcm(
        string $payload,
        string $clientPublic,
        string $authSecret,
        ?string $serverPrivatePem = null,
        ?string $serverPublicRaw = null,
        ?string $salt = null
    ): array {
        if ($serverPrivatePem === null || $serverPublicRaw === null) {
            $pair = self::genEcKeyPair();
            $serverPrivatePem = $pair['pem'];
            $serverPublicRaw = $pair['public_raw'];
        }
        $salt = $salt ?? random_bytes(16);

        $serverPriv = openssl_pkey_get_private($serverPrivatePem);
        $clientPub = openssl_pkey_get_public(self::rawPublicToPem($clientPublic));
        if ($serverPriv === false || $clientPub === false) {
            throw new RuntimeException('Falha ao carregar as chaves para o ECDH.');
        }

        $shared = openssl_pkey_derive($clientPub, $serverPriv, 32);
        if ($shared === false) {
            throw new RuntimeException('Falha no ECDH (openssl_pkey_derive).');
        }

        // RFC 8291 §3.4: deriva o IKM a partir do segredo ECDH + auth secret.
        $ikm = hash_hkdf(
            'sha256',
            $shared,
            32,
            "WebPush: info\x00" . $clientPublic . $serverPublicRaw,
            $authSecret
        );
        // RFC 8188: CEK e nonce a partir do IKM + salt da mensagem.
        $cek = hash_hkdf('sha256', $ikm, 16, "Content-Encoding: aes128gcm\x00", $salt);
        $nonce = hash_hkdf('sha256', $ikm, 12, "Content-Encoding: nonce\x00", $salt);

        // Registro unico: dados + delimitador 0x02 (ultimo registro), sem padding.
        $plaintext = $payload . "\x02";
        $tag = '';
        $cipher = openssl_encrypt($plaintext, 'aes-128-gcm', $cek, OPENSSL_RAW_DATA, $nonce, $tag);
        if ($cipher === false) {
            throw new RuntimeException('Falha ao cifrar o payload (aes-128-gcm).');
        }

        // Header aes128gcm: salt(16) || rs(4) || idlen(1) || keyid(=as_public,65)
        $body = $salt . pack('N', 4096) . chr(strlen($serverPublicRaw)) . $serverPublicRaw . $cipher . $tag;

        return ['body' => $body, 'salt' => $salt, 'as_public' => $serverPublicRaw];
    }

    /** Gera as chaves VAPID se ainda nao existirem; retorna public(b64url)+pem privado. */
    private function ensureKeys(): array
    {
        $row = Db::connection()->query(
            'SELECT vapid_public_key, vapid_private_key_encrypted FROM system_settings WHERE id = 1'
        )->fetch();

        $public = $row['vapid_public_key'] ?? null;
        $privEnc = $row['vapid_private_key_encrypted'] ?? null;

        if (!empty($public) && !empty($privEnc)) {
            $pem = Crypto::decrypt((string) $privEnc);
            if ($pem !== null && $pem !== '') {
                return ['public' => (string) $public, 'private_pem' => $pem];
            }
        }

        // Gera e persiste (uma unica vez).
        $pair = self::genEcKeyPair();
        $publicB64 = self::b64urlEncode($pair['public_raw']);

        // Garante que existe a linha id=1 antes de atualizar.
        Db::connection()->exec('INSERT IGNORE INTO system_settings (id) VALUES (1)');
        Db::connection()->prepare(
            'UPDATE system_settings
             SET vapid_public_key = :pub, vapid_private_key_encrypted = :priv
             WHERE id = 1'
        )->execute([
            'pub' => $publicB64,
            'priv' => Crypto::encrypt($pair['pem']),
        ]);

        return ['public' => $publicB64, 'private_pem' => $pair['pem']];
    }

    /** @return array{pem:string, public_raw:string} par EC P-256 (public_raw = 0x04||X||Y, 65 bytes) */
    private static function genEcKeyPair(): array
    {
        $res = openssl_pkey_new([
            'curve_name' => 'prime256v1',
            'private_key_type' => OPENSSL_KEYTYPE_EC,
        ]);
        if ($res === false) {
            throw new RuntimeException('Falha ao gerar par de chaves EC (openssl).');
        }
        openssl_pkey_export($res, $pem);
        $details = openssl_pkey_get_details($res);
        $x = str_pad($details['ec']['x'], 32, "\x00", STR_PAD_LEFT);
        $y = str_pad($details['ec']['y'], 32, "\x00", STR_PAD_LEFT);

        return ['pem' => (string) $pem, 'public_raw' => "\x04" . $x . $y];
    }

    /** Monta o PEM de uma chave publica EC P-256 a partir do ponto cru (65 bytes). */
    private static function rawPublicToPem(string $raw65): string
    {
        $der = hex2bin(self::P256_SPKI_PREFIX_HEX) . $raw65;

        return "-----BEGIN PUBLIC KEY-----\n"
            . chunk_split(base64_encode($der), 64, "\n")
            . "-----END PUBLIC KEY-----\n";
    }

    /** Converte a assinatura DER do openssl (SEQUENCE de 2 INTEGERs) pra r||s cru (64 bytes). */
    private static function derToRawEs256(string $der): string
    {
        $offset = 0;
        if (($der[$offset++] ?? '') !== "\x30") {
            throw new RuntimeException('Assinatura DER invalida (sem SEQUENCE).');
        }
        // Comprimento da sequencia (assume forma curta, < 128 bytes — sempre o caso p/ P-256).
        $offset++;

        $readInt = static function (string $der, int &$offset): string {
            if (($der[$offset++] ?? '') !== "\x02") {
                throw new RuntimeException('Assinatura DER invalida (sem INTEGER).');
            }
            $len = ord($der[$offset++]);
            $val = substr($der, $offset, $len);
            $offset += $len;
            // Remove byte 0x00 de sinal e left-pad pra 32 bytes.
            $val = ltrim($val, "\x00");

            return str_pad($val, 32, "\x00", STR_PAD_LEFT);
        };

        $r = $readInt($der, $offset);
        $s = $readInt($der, $offset);

        return $r . $s;
    }

    public static function b64urlEncode(string $data): string
    {
        return rtrim(strtr(base64_encode($data), '+/', '-_'), '=');
    }

    public static function b64urlDecode(string $data): string
    {
        $pad = strlen($data) % 4;
        if ($pad > 0) {
            $data .= str_repeat('=', 4 - $pad);
        }

        return (string) base64_decode(strtr($data, '-_', '+/'));
    }
}
