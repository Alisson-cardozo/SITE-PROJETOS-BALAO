<?php

declare(strict_types=1);

namespace App\Services;

use App\Core\Application;
use RuntimeException;

/**
 * Detecta 4 pontos de referencia (ponta, os dois lados mais largos do
 * contorno, e o centro da base) numa imagem de arte de cliente via Gemini
 * (visao) -- usado pelo "Riscar Molde" pra posicionar a grade do cone
 * automaticamente sobre a imagem em vez do usuario ter que arrastar tudo
 * manualmente do zero.
 *
 * Coordenadas retornadas SEMPRE normalizadas de 0 a 1000 (convencao de
 * "spatial understanding" do Gemini) -- o chamador reescala pro tamanho
 * real da imagem em pixels.
 */
final class GeminiImageAlignmentService
{
    private const API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/%s:generateContent?key=%s';

    public function detectLandmarks(string $imageBinary, string $mimeType): array
    {
        $app = Application::instance();
        $apiKey = $app->env('GEMINI_API_KEY');
        if ($apiKey === null || $apiKey === '') {
            throw new RuntimeException('GEMINI_API_KEY nao configurada no servidor.');
        }

        $model = $app->env('GEMINI_MODEL', 'gemini-2.0-flash');
        $base64 = base64_encode($imageBinary);

        $payload = [
            'contents' => [[
                'parts' => [
                    ['text' => $this->prompt()],
                    ['inline_data' => ['mime_type' => $mimeType, 'data' => $base64]],
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
            CURLOPT_TIMEOUT => 60,
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
            throw new RuntimeException('O Gemini nao retornou pontos validos.');
        }

        $data = json_decode($content, true);
        if (!is_array($data)) {
            throw new RuntimeException('O Gemini retornou um formato invalido.');
        }

        foreach (['apex', 'equator_left', 'equator_right', 'bottom_tip'] as $key) {
            if (!isset($data[$key]['x'], $data[$key]['y'])) {
                throw new RuntimeException('O Gemini nao retornou todos os pontos esperados.');
            }
        }

        return $data;
    }
}
