<?php

declare(strict_types=1);

namespace App\Support;

use App\Core\Application;
use RuntimeException;

/**
 * Criptografia simetrica pra dados sensiveis em repouso (ex: access token do
 * Mercado Pago) — AES-256-CBC com IV aleatorio por valor, usando a APP_KEY
 * do .env (base64 de 32 bytes) como chave.
 */
final class Crypto
{
    private const CIPHER = 'aes-256-cbc';

    public static function encrypt(string $plaintext): string
    {
        $key = self::key();
        $ivLength = openssl_cipher_iv_length(self::CIPHER);
        $iv = random_bytes($ivLength === false ? 16 : $ivLength);
        $ciphertext = openssl_encrypt($plaintext, self::CIPHER, $key, OPENSSL_RAW_DATA, $iv);
        if ($ciphertext === false) {
            throw new RuntimeException('Falha ao criptografar o valor.');
        }

        return base64_encode($iv . $ciphertext);
    }

    public static function decrypt(string $encoded): ?string
    {
        $raw = base64_decode($encoded, true);
        if ($raw === false) {
            return null;
        }

        $ivLength = openssl_cipher_iv_length(self::CIPHER);
        $ivLength = $ivLength === false ? 16 : $ivLength;
        $iv = substr($raw, 0, $ivLength);
        $ciphertext = substr($raw, $ivLength);

        $plaintext = openssl_decrypt($ciphertext, self::CIPHER, self::key(), OPENSSL_RAW_DATA, $iv);

        return $plaintext === false ? null : $plaintext;
    }

    private static function key(): string
    {
        $appKey = (string) (Application::instance()->env('APP_KEY') ?? '');
        if ($appKey === '') {
            throw new RuntimeException('APP_KEY nao configurada no .env.');
        }

        $decoded = base64_decode($appKey, true);

        return $decoded === false ? $appKey : $decoded;
    }
}
