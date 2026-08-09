<?php

declare(strict_types=1);

namespace App\Services;

use App\Core\Application;
use CURLFile;
use RuntimeException;

/**
 * Gera a versao "line art" (reconstrucao fiel do desenho so em contorno,
 * preto e branco) de uma imagem via OpenAI Images (gpt-image-1, edicao de
 * imagem) -- usado pelo modo "Ajustar risco" do Lek pra guiar corte/queima
 * manual. Ver AiLineArtService pro prompt e pro fallback via Gemini.
 */
final class OpenAiLineArtService
{
    private const API_URL = 'https://api.openai.com/v1/images/edits';
    private const MODEL = 'gpt-image-1';

    public function generate(string $imageBinary, string $mimeType, string $prompt): string
    {
        $app = Application::instance();
        $apiKey = $app->env('OPENAI_API_KEY');
        if ($apiKey === null || $apiKey === '') {
            throw new RuntimeException('OPENAI_API_KEY nao configurada no servidor.');
        }

        $ext = match ($mimeType) {
            'image/jpeg' => 'jpg',
            'image/webp' => 'webp',
            default => 'png',
        };
        $tmpPath = tempnam(sys_get_temp_dir(), 'lineart_');
        if ($tmpPath === false) {
            throw new RuntimeException('Nao foi possivel preparar a imagem pra envio.');
        }
        $tmpPath = $tmpPath . '.' . $ext;
        file_put_contents($tmpPath, $imageBinary);

        try {
            $response = $this->call($apiKey, $tmpPath, $mimeType, $ext, $prompt);

            return $this->parseResponse($response);
        } finally {
            @unlink($tmpPath);
        }
    }

    private function call(string $apiKey, string $tmpPath, string $mimeType, string $ext, string $prompt): array
    {
        $ch = curl_init(self::API_URL);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_POST => true,
            CURLOPT_HTTPHEADER => [
                'Authorization: Bearer ' . $apiKey,
            ],
            CURLOPT_POSTFIELDS => [
                'model' => self::MODEL,
                'image' => new CURLFile($tmpPath, $mimeType, 'imagem.' . $ext),
                'prompt' => $prompt,
                'size' => 'auto',
            ],
            CURLOPT_TIMEOUT => 180,
        ]);

        $raw = curl_exec($ch);
        if ($raw === false) {
            $error = curl_error($ch);
            curl_close($ch);
            throw new RuntimeException('Falha ao conectar com a OpenAI: ' . $error);
        }

        $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

        $decoded = json_decode((string) $raw, true);

        if ($status !== 200) {
            $message = is_array($decoded) ? ($decoded['error']['message'] ?? null) : null;
            throw new RuntimeException($message ?? 'Erro desconhecido da OpenAI (status ' . $status . ').');
        }

        return is_array($decoded) ? $decoded : [];
    }

    private function parseResponse(array $response): string
    {
        $b64 = $response['data'][0]['b64_json'] ?? null;
        if (!is_string($b64) || $b64 === '') {
            throw new RuntimeException('A OpenAI nao retornou uma imagem valida.');
        }

        return $b64;
    }
}
