<?php

declare(strict_types=1);

namespace App\Services;

use App\Core\Application;
use RuntimeException;

/**
 * Mesma geracao de line art de OpenAiLineArtService, so que via Gemini
 * (modelo com geracao de imagem, independente do GEMINI_MODEL configurado
 * pra texto/visao) -- usado como fallback quando a OpenAI falha (ver
 * AiLineArtService).
 */
final class GeminiLineArtService
{
    private const API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/%s:generateContent?key=%s';
    private const MODEL = 'gemini-2.5-flash-image';

    public function generate(string $imageBinary, string $mimeType, string $prompt): string
    {
        $app = Application::instance();
        $apiKey = $app->env('GEMINI_API_KEY');
        if ($apiKey === null || $apiKey === '') {
            throw new RuntimeException('GEMINI_API_KEY nao configurada no servidor.');
        }

        $base64 = base64_encode($imageBinary);
        $payload = [
            'contents' => [[
                'parts' => [
                    ['text' => $prompt],
                    ['inline_data' => ['mime_type' => $mimeType, 'data' => $base64]],
                ],
            ]],
            'generationConfig' => [
                'responseModalities' => ['IMAGE'],
            ],
        ];

        $url = sprintf(self::API_URL, self::MODEL, (string) $apiKey);
        $response = $this->call($url, $payload);

        return $this->parseResponse($response);
    }

    private function call(string $url, array $payload): array
    {
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_POST => true,
            CURLOPT_HTTPHEADER => ['Content-Type: application/json'],
            CURLOPT_POSTFIELDS => json_encode($payload, JSON_UNESCAPED_UNICODE),
            CURLOPT_TIMEOUT => 180,
        ]);

        $raw = curl_exec($ch);
        if ($raw === false) {
            $error = curl_error($ch);
            curl_close($ch);
            throw new RuntimeException('Falha ao conectar com o Gemini: ' . $error);
        }

        $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

        $decoded = json_decode((string) $raw, true);

        if ($status !== 200) {
            $message = is_array($decoded) ? ($decoded['error']['message'] ?? null) : null;
            throw new RuntimeException($message ?? 'Erro desconhecido do Gemini (status ' . $status . ').');
        }

        return is_array($decoded) ? $decoded : [];
    }

    private function parseResponse(array $response): string
    {
        $parts = $response['candidates'][0]['content']['parts'] ?? [];
        if (!is_array($parts)) {
            throw new RuntimeException('O Gemini nao retornou uma imagem valida.');
        }

        foreach ($parts as $part) {
            // A API do Gemini alterna entre inlineData/inline_data conforme a
            // versao -- checa os dois pra nao quebrar por causa disso.
            $inline = $part['inlineData'] ?? $part['inline_data'] ?? null;
            $data = is_array($inline) ? ($inline['data'] ?? null) : null;
            if (is_string($data) && $data !== '') {
                return $data;
            }
        }

        throw new RuntimeException('O Gemini nao retornou uma imagem valida.');
    }
}
