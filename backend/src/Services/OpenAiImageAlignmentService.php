<?php

declare(strict_types=1);

namespace App\Services;

use App\Core\Application;
use RuntimeException;

/**
 * Mesma deteccao de pontos de referencia do GeminiImageAlignmentService, so
 * que via OpenAI (provider principal) em vez do Gemini — ver
 * AiImageAlignmentService, que tenta OpenAI primeiro e cai pro Gemini se
 * falhar.
 */
final class OpenAiImageAlignmentService
{
    private const API_URL = 'https://api.openai.com/v1/chat/completions';

    public function detectLandmarks(string $imageBinary, string $mimeType): array
    {
        $app = Application::instance();
        $apiKey = $app->env('OPENAI_API_KEY');
        if ($apiKey === null || $apiKey === '') {
            throw new RuntimeException('OPENAI_API_KEY nao configurada no servidor.');
        }

        $model = $app->env('OPENAI_MODEL', 'gpt-4o');
        $base64 = base64_encode($imageBinary);

        $payload = [
            'model' => $model,
            'messages' => [[
                'role' => 'user',
                'content' => [
                    ['type' => 'text', 'text' => $this->prompt()],
                    ['type' => 'image_url', 'image_url' => ['url' => 'data:' . $mimeType . ';base64,' . $base64]],
                ],
            ]],
            'response_format' => [
                'type' => 'json_schema',
                'json_schema' => [
                    'name' => 'landmarks',
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
Esta imagem e a arte de referencia de um objeto conico feito de gomos (fatias triangulares) que se encontram numa PONTA no topo e se abrem numa BOCA (base) embaixo -- como uma pipa, balao ou bandeira em formato de leque/diamante.

A imagem pode ter uma margem/fundo em branco ou vazio ao redor do desenho -- IGNORE completamente essa margem. Considere APENAS o contorno onde a arte colorida/desenhada de verdade comeca e termina, nunca a borda da imagem/tela em branco.

Identifique 4 pontos, sempre na borda EXATA do desenho colorido:
- apex: o pixel mais alto/agudo que ainda faz parte do desenho colorido (a ponta de cima).
- equator_left: o pixel mais a ESQUERDA que ainda faz parte do desenho colorido (geralmente a parte mais larga, perto do meio da imagem).
- equator_right: o pixel mais a DIREITA que ainda faz parte do desenho colorido (geralmente a parte mais larga, perto do meio da imagem, na mesma altura aproximada de equator_left).
- bottom_tip: o pixel central da borda de baixo do desenho colorido (a boca/base, embaixo).

Responda as coordenadas de cada ponto NORMALIZADAS de 0 a 1000, onde (0,0) e o canto superior esquerdo da IMAGEM INTEIRA (incluindo a margem em branco, se houver) e (1000,1000) e o canto inferior direito. Responda so com o JSON.
TXT;
    }

    private function schema(): array
    {
        $point = [
            'type' => 'object',
            'properties' => [
                'x' => ['type' => 'integer'],
                'y' => ['type' => 'integer'],
            ],
            'required' => ['x', 'y'],
            'additionalProperties' => false,
        ];

        return [
            'type' => 'object',
            'properties' => [
                'apex' => $point,
                'equator_left' => $point,
                'equator_right' => $point,
                'bottom_tip' => $point,
            ],
            'required' => ['apex', 'equator_left', 'equator_right', 'bottom_tip'],
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
            CURLOPT_TIMEOUT => 60,
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

    private function parseResponse(array $response): array
    {
        $content = $response['choices'][0]['message']['content'] ?? null;
        if (!is_string($content) || $content === '') {
            throw new RuntimeException('A OpenAI nao retornou pontos validos.');
        }

        $data = json_decode($content, true);
        if (!is_array($data)) {
            throw new RuntimeException('A OpenAI retornou um formato invalido.');
        }

        foreach (['apex', 'equator_left', 'equator_right', 'bottom_tip'] as $key) {
            if (!isset($data[$key]['x'], $data[$key]['y'])) {
                throw new RuntimeException('A OpenAI nao retornou todos os pontos esperados.');
            }
        }

        return $data;
    }
}
