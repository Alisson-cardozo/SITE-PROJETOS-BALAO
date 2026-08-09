<?php

declare(strict_types=1);

namespace App\Services;

use App\Core\Application;
use RuntimeException;
use Throwable;

/**
 * Tenta detectar os pontos de referencia da imagem via OpenAI primeiro
 * (provider principal); se a chamada falhar por qualquer motivo (API fora
 * do ar, chave invalida, credito esgotado etc), tenta de novo via Gemini
 * antes de desistir. So falha de verdade se nenhum dos dois provedores
 * configurados conseguir responder. Mesmo padrao de AiPdfExtractorService.
 */
final class AiImageAlignmentService
{
    public function detectLandmarks(string $imageBinary, string $mimeType): array
    {
        $app = Application::instance();
        $openAiKey = (string) ($app->env('OPENAI_API_KEY') ?? '');
        $geminiKey = (string) ($app->env('GEMINI_API_KEY') ?? '');

        $errors = [];

        if ($openAiKey !== '') {
            try {
                return (new OpenAiImageAlignmentService())->detectLandmarks($imageBinary, $mimeType);
            } catch (Throwable $e) {
                $errors[] = 'OpenAI: ' . $e->getMessage();
            }
        }

        if ($geminiKey !== '') {
            try {
                return (new GeminiImageAlignmentService())->detectLandmarks($imageBinary, $mimeType);
            } catch (Throwable $e) {
                $errors[] = 'Gemini: ' . $e->getMessage();
            }
        }

        if ($errors === []) {
            throw new RuntimeException('Nenhuma API de IA configurada no servidor (OPENAI_API_KEY / GEMINI_API_KEY).');
        }

        throw new RuntimeException('Nao foi possivel alinhar a imagem. ' . implode(' | ', $errors));
    }
}
