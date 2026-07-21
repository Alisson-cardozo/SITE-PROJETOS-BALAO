<?php

declare(strict_types=1);

namespace App\Support;

use App\Core\Application;
use RuntimeException;

/**
 * @phpstan-type Attachment array{filename: string, contentType: string, contentBase64: string}
 */
final class Mailer
{
    /**
     * @param array{body: string, html?: string, files?: array<int, array{filename:string, contentType:string, contentBase64:string}>} $payload
     */
    public static function send(string $to, string $subject, array $payload): void
    {
        $app = Application::instance();
        $host = $app->env('MAIL_HOST', 'smtp.gmail.com') ?? 'smtp.gmail.com';
        $port = (int) ($app->env('MAIL_PORT', '587') ?? '587');
        $encryption = strtolower($app->env('MAIL_ENCRYPTION', 'tls') ?? 'tls');
        $username = $app->env('MAIL_USER', '') ?? '';
        $password = $app->env('MAIL_PASS', '') ?? '';
        $from = $app->env('MAIL_FROM', $username !== '' ? $username : 'noreply@example.com') ?? 'noreply@example.com';
        $timeout = 20;

        if ($username === '' || $password === '') {
            throw new RuntimeException('Envio de email nao configurado (MAIL_USER/MAIL_PASS ausentes no .env).');
        }

        $transport = $encryption === 'ssl' ? 'ssl://' . $host : $host;
        $socket = @stream_socket_client($transport . ':' . $port, $errorNumber, $errorMessage, $timeout, STREAM_CLIENT_CONNECT);
        if (!is_resource($socket)) {
            throw new RuntimeException('Falha ao conectar no servidor SMTP: ' . $errorMessage . ' (' . $errorNumber . ').');
        }

        stream_set_timeout($socket, $timeout);

        try {
            self::expectResponse($socket, [220]);
            self::writeCommand($socket, 'EHLO localhost');
            self::expectResponse($socket, [250]);

            if ($encryption === 'tls') {
                self::writeCommand($socket, 'STARTTLS');
                self::expectResponse($socket, [220]);
                if (!stream_socket_enable_crypto($socket, true, STREAM_CRYPTO_METHOD_TLS_CLIENT)) {
                    throw new RuntimeException('Nao foi possivel ativar TLS na conexao SMTP.');
                }
                self::writeCommand($socket, 'EHLO localhost');
                self::expectResponse($socket, [250]);
            }

            self::writeCommand($socket, 'AUTH LOGIN');
            self::expectResponse($socket, [334]);
            self::writeCommand($socket, base64_encode($username));
            self::expectResponse($socket, [334]);
            self::writeCommand($socket, base64_encode($password));
            self::expectResponse($socket, [235]);

            self::writeCommand($socket, 'MAIL FROM:<' . $from . '>');
            self::expectResponse($socket, [250]);
            self::writeCommand($socket, 'RCPT TO:<' . $to . '>');
            self::expectResponse($socket, [250, 251]);
            self::writeCommand($socket, 'DATA');
            self::expectResponse($socket, [354]);

            [$headers, $body] = self::buildMimeMessage($to, $subject, $payload);
            $message = implode("\r\n", $headers) . "\r\n\r\n" . self::escapeSmtpBody($body) . "\r\n.";
            self::writeRaw($socket, $message . "\r\n");
            self::expectResponse($socket, [250]);
            self::writeCommand($socket, 'QUIT');
        } finally {
            fclose($socket);
        }
    }

    /**
     * @param array{body: string, html?: string, files?: array<int, array{filename:string, contentType:string, contentBase64:string}>} $payload
     * @return array{0: array<int,string>, 1: string}
     */
    private static function buildMimeMessage(string $to, string $subject, array $payload): array
    {
        $app = Application::instance();
        $from = $app->env('MAIL_FROM', 'noreply@example.com') ?? 'noreply@example.com';
        $fromName = $app->env('MAIL_FROM_NAME', $app->env('APP_NAME', 'Alisson Projetos') ?? 'Alisson Projetos')
            ?? 'Alisson Projetos';
        $body = (string) ($payload['body'] ?? '');
        $html = isset($payload['html']) ? (string) $payload['html'] : null;
        $attachments = is_array($payload['files'] ?? null) ? $payload['files'] : [];

        $headers = [
            'MIME-Version: 1.0',
            'From: ' . self::formatAddress($from, $fromName),
            'To: ' . $to,
            'Subject: ' . self::encodeHeader($subject),
        ];

        // Corpo do email: so texto, ou texto+html (multipart/alternative) se
        // "html" foi passado — o cliente de email escolhe qual mostrar.
        if ($html === null) {
            $bodyHeaders = ['Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: 8bit'];
            $bodyContent = $body;
        } else {
            $altBoundary = 'alt_' . bin2hex(random_bytes(12));
            $altParts = [];
            $altParts[] = '--' . $altBoundary;
            $altParts[] = 'Content-Type: text/plain; charset=UTF-8';
            $altParts[] = 'Content-Transfer-Encoding: 8bit';
            $altParts[] = '';
            $altParts[] = $body;
            $altParts[] = '--' . $altBoundary;
            $altParts[] = 'Content-Type: text/html; charset=UTF-8';
            $altParts[] = 'Content-Transfer-Encoding: 8bit';
            $altParts[] = '';
            $altParts[] = $html;
            $altParts[] = '--' . $altBoundary . '--';

            $bodyHeaders = ['Content-Type: multipart/alternative; boundary="' . $altBoundary . '"'];
            $bodyContent = implode("\r\n", $altParts);
        }

        if ($attachments === []) {
            return [array_merge($headers, $bodyHeaders), $bodyContent];
        }

        $boundary = 'mixed_' . bin2hex(random_bytes(12));
        $headers[] = 'Content-Type: multipart/mixed; boundary="' . $boundary . '"';

        $parts = [];
        $parts[] = '--' . $boundary;
        $parts[] = implode("\r\n", $bodyHeaders);
        $parts[] = '';
        $parts[] = $bodyContent;

        foreach ($attachments as $attachment) {
            $filename = (string) ($attachment['filename'] ?? 'arquivo.bin');
            $contentType = (string) ($attachment['contentType'] ?? 'application/octet-stream');
            $contentBase64 = (string) ($attachment['contentBase64'] ?? '');
            if ($contentBase64 === '') {
                continue;
            }

            $parts[] = '--' . $boundary;
            $parts[] = 'Content-Type: ' . $contentType . '; name="' . addslashes($filename) . '"';
            $parts[] = 'Content-Transfer-Encoding: base64';
            $parts[] = 'Content-Disposition: attachment; filename="' . addslashes($filename) . '"';
            $parts[] = '';
            $parts[] = chunk_split($contentBase64, 76, "\r\n");
        }

        $parts[] = '--' . $boundary . '--';

        return [$headers, implode("\r\n", $parts)];
    }

    private static function encodeHeader(string $value): string
    {
        return '=?UTF-8?B?' . base64_encode($value) . '?=';
    }

    private static function formatAddress(string $email, string $name): string
    {
        return self::encodeHeader($name) . ' <' . $email . '>';
    }

    /** @param resource $socket */
    private static function writeCommand($socket, string $command): void
    {
        self::writeRaw($socket, $command . "\r\n");
    }

    /** @param resource $socket */
    private static function writeRaw($socket, string $data): void
    {
        $written = fwrite($socket, $data);
        if ($written === false) {
            throw new RuntimeException('Falha ao escrever na conexao SMTP.');
        }
    }

    /**
     * @param resource $socket
     * @param array<int,int> $expectedCodes
     */
    private static function expectResponse($socket, array $expectedCodes): void
    {
        $response = self::readResponse($socket);
        $code = (int) substr($response, 0, 3);
        if (!in_array($code, $expectedCodes, true)) {
            throw new RuntimeException('SMTP respondeu com erro: ' . trim($response));
        }
    }

    /** @param resource $socket */
    private static function readResponse($socket): string
    {
        $response = '';
        while (($line = fgets($socket, 515)) !== false) {
            $response .= $line;
            if (isset($line[3]) && $line[3] === ' ') {
                break;
            }
        }

        if ($response === '') {
            throw new RuntimeException('Servidor SMTP nao respondeu.');
        }

        return $response;
    }

    private static function escapeSmtpBody(string $body): string
    {
        return preg_replace('/^\./m', '..', $body) ?? $body;
    }
}
