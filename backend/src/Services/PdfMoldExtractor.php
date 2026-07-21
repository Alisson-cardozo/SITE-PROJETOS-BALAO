<?php

declare(strict_types=1);

namespace App\Services;

use App\Core\Application;
use RuntimeException;

final class PdfMoldExtractor
{
    private const API_URL = 'https://api.openai.com/v1/chat/completions';

    public function extract(string $pdfBinary, string $filename): array
    {
        $app = Application::instance();
        $apiKey = $app->env('OPENAI_API_KEY');
        if ($apiKey === null || $apiKey === '') {
            throw new RuntimeException('OPENAI_API_KEY nao configurada no servidor.');
        }

        $model = $app->env('OPENAI_MODEL', 'gpt-4o');
        $base64 = base64_encode($pdfBinary);

        $payload = [
            'model' => $model,
            'messages' => [[
                'role' => 'user',
                'content' => [
                    ['type' => 'text', 'text' => $this->prompt()],
                    [
                        'type' => 'file',
                        'file' => [
                            'filename' => $filename,
                            'file_data' => 'data:' . 'application/pdf;base64,' . $base64,
                        ],
                    ],
                ],
            ]],
            'response_format' => [
                'type' => 'json_schema',
                'json_schema' => [
                    'name' => 'mold_data',
                    'strict' => true,
                    'schema' => $this->schema(),
                ],
            ],
        ];

        $response = $this->call($payload, (string) $apiKey);

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
                        'additionalProperties' => false,
                    ],
                ],
            ],
            'required' => ['nome_molde', 'modelo', 'quantidade_gomos', 'bainha_cm', 'pontos'],
            'additionalProperties' => false,
        ];
    }

    private function call(array $payload, string $apiKey): array
    {
        $ch = curl_init(self::API_URL);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_POST => true,
            CURLOPT_HTTPHEADER => [
                'Content-Type: application/json',
                'Authorization: Bearer ' . $apiKey,
            ],
            CURLOPT_POSTFIELDS => json_encode($payload, JSON_UNESCAPED_UNICODE),
            CURLOPT_TIMEOUT => 120,
        ]);

        $raw = curl_exec($ch);
        if ($raw === false) {
            $error = curl_error($ch);
            curl_close($ch);
            throw new RuntimeException('Falha ao conectar com a API de IA: ' . $error);
        }

        $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

        $decoded = json_decode((string) $raw, true);

        if ($status !== 200) {
            $message = is_array($decoded) ? ($decoded['error']['message'] ?? null) : null;
            throw new RuntimeException($message ?? 'Erro desconhecido da API de IA (status ' . $status . ').');
        }

        return is_array($decoded) ? $decoded : [];
    }

    private function parseResponse(array $response): array
    {
        $content = $response['choices'][0]['message']['content'] ?? null;
        if (!is_string($content) || $content === '') {
            throw new RuntimeException('A IA nao retornou dados validos.');
        }

        $data = json_decode($content, true);
        if (!is_array($data)) {
            throw new RuntimeException('A IA retornou um formato invalido.');
        }

        return $data;
    }
}
