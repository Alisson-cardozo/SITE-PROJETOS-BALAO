<?php

declare(strict_types=1);

namespace App\Services;

use App\Core\Application;
use RuntimeException;

/**
 * Mesma extracao de dados do molde a partir do PDF, so que via Gemini
 * (Google) em vez da OpenAI — usado como fallback quando a OpenAI falha,
 * ver AiPdfExtractorService.
 */
final class GeminiPdfMoldExtractor
{
    private const API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/%s:generateContent?key=%s';

    public function extract(string $pdfBinary, string $filename): array
    {
        $app = Application::instance();
        $apiKey = $app->env('GEMINI_API_KEY');
        if ($apiKey === null || $apiKey === '') {
            throw new RuntimeException('GEMINI_API_KEY nao configurada no servidor.');
        }

        $model = $app->env('GEMINI_MODEL', 'gemini-2.0-flash');
        $base64 = base64_encode($pdfBinary);

        $payload = [
            'contents' => [[
                'parts' => [
                    ['text' => $this->prompt()],
                    ['inline_data' => ['mime_type' => 'application/pdf', 'data' => $base64]],
                ],
            ]],
            'generationConfig' => [
                'response_mime_type' => 'application/json',
                'response_schema' => $this->schema(),
            ],
        ];

        $url = sprintf(self::API_URL, (string) $model, (string) $apiKey);
        $response = $this->call($url, $payload);

        return $this->parseResponse($response);
    }

    private function prompt(): string
    {
        return <<<'TXT'
Este PDF contem a tabela de pontos e os dados de um molde de balao (gomo) usado em plotagem tecnica.

Extraia exatamente:
- nome do molde, se houver (senao string vazia)
- modelo/categoria do molde, se houver (senao string vazia)
- quantidade de gomos
- tamanho da bainha em centimetros
- a tabela de pontos: para cada ponto, a ALTURA como incremento em relacao ao ponto anterior (nao a altura acumulada) em centimetros, e a largura/2 (metade da largura naquele ponto) em centimetros

Se o documento so tiver a altura acumulada, calcule o incremento entre pontos consecutivos.
Preserve a ordem original dos pontos, do primeiro (boca do balao) ao ultimo (bico do balao).
Se um campo nao existir no documento, use string vazia ou 0.
Responda so com o JSON, sem nenhum texto a mais.
TXT;
    }

    private function schema(): array
    {
        return [
            'type' => 'object',
            'properties' => [
                'nome_molde' => ['type' => 'string'],
                'modelo' => ['type' => 'string'],
                'quantidade_gomos' => ['type' => 'integer'],
                'bainha_cm' => ['type' => 'number'],
                'pontos' => [
                    'type' => 'array',
                    'items' => [
                        'type' => 'object',
                        'properties' => [
                            'altura_cm' => ['type' => 'number'],
                            'largura_meia_cm' => ['type' => 'number'],
                        ],
                        'required' => ['altura_cm', 'largura_meia_cm'],
                    ],
                ],
            ],
            'required' => ['nome_molde', 'modelo', 'quantidade_gomos', 'bainha_cm', 'pontos'],
        ];
    }

    private function call(string $url, array $payload): array
    {
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_POST => true,
            CURLOPT_HTTPHEADER => ['Content-Type: application/json'],
            CURLOPT_POSTFIELDS => json_encode($payload, JSON_UNESCAPED_UNICODE),
            CURLOPT_TIMEOUT => 120,
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

    private function parseResponse(array $response): array
    {
        $content = $response['candidates'][0]['content']['parts'][0]['text'] ?? null;
        if (!is_string($content) || $content === '') {
            throw new RuntimeException('O Gemini nao retornou dados validos.');
        }

        $data = json_decode($content, true);
        if (!is_array($data)) {
            throw new RuntimeException('O Gemini retornou um formato invalido.');
        }

        return $data;
    }
}
