<?php

declare(strict_types=1);

namespace App\Services;

use App\Core\Application;
use RuntimeException;
use Throwable;

/**
 * Tenta extrair os dados do molde via OpenAI primeiro (provider principal);
 * se a chamada falhar por qualquer motivo (API fora do ar, chave invalida,
 * limite de uso etc), tenta de novo via Gemini antes de desistir. So falha
 * de verdade se nenhum dos dois provedores configurados conseguir responder.
 */
final class AiPdfExtractorService
{
    public function extract(string $pdfBinary, string $filename): array
    {
        $app = Application::instance();
        $openAiKey = (string) ($app->env('OPENAI_API_KEY') ?? '');
        $geminiKey = (string) ($app->env('GEMINI_API_KEY') ?? '');

        $errors = [];

        if ($openAiKey !== '') {
            try {
                return (new PdfMoldExtractor())->extract($pdfBinary, $filename);
            } catch (Throwable $e) {
                $errors[] = 'OpenAI: ' . $e->getMessage();
            }
        }

        if ($geminiKey !== '') {
            try {
                return (new GeminiPdfMoldExtractor())->extract($pdfBinary, $filename);
            } catch (Throwable $e) {
                $errors[] = 'Gemini: ' . $e->getMessage();
            }
        }

        if ($errors === []) {
            throw new RuntimeException('Nenhuma API de IA configurada no servidor (OPENAI_API_KEY / GEMINI_API_KEY).');
        }

        throw new RuntimeException('Nao foi possivel extrair os dados do PDF. ' . implode(' | ', $errors));
    }
}
