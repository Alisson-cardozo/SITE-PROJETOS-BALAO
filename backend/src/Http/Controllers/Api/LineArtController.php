<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api;

use App\Core\Request;
use App\Core\Response;
use App\Services\AiLineArtService;
use Throwable;

/**
 * Endpoint usado pelo modo "Ajustar risco" do Lek (lek.html) -- manda a
 * imagem original pra IA reconstruir so em linhas (contorno, preto e
 * branco), pra guiar corte/queima manual. Substitui o antigo endpoint de
 * vetorizacao por paleta de cor (ver VectorizeController, removido).
 */
final class LineArtController
{
    private const MAX_SIZE_BYTES = 10 * 1024 * 1024;
    private const ALLOWED_MIME = ['image/png', 'image/jpeg', 'image/webp'];

    public function generate(Request $request): Response
    {
        $file = $_FILES['image'] ?? null;
        if (!is_array($file) || ($file['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) {
            return Response::json(['error' => 'Envie uma imagem valida.'], 422);
        }
        if ((int) ($file['size'] ?? 0) > self::MAX_SIZE_BYTES) {
            return Response::json(['error' => 'Imagem muito grande (limite de 10MB).'], 422);
        }
        $mime = (string) ($file['type'] ?? '');
        if (!in_array($mime, self::ALLOWED_MIME, true)) {
            return Response::json(['error' => 'Envie uma imagem PNG, JPEG ou WEBP.'], 422);
        }
        $binary = file_get_contents((string) $file['tmp_name']);
        if ($binary === false || $binary === '') {
            return Response::json(['error' => 'Nao foi possivel ler a imagem enviada.'], 500);
        }

        // Geracao de imagem por IA demora bem mais que os 30s padrao do PHP
        // (o "Maximum execution time exceeded" matava a requisicao no meio,
        // sem nem devolver JSON de erro pro frontend) -- alinhado com o
        // CURLOPT_TIMEOUT dos servicos de IA (180s).
        set_time_limit(180);

        try {
            $imageBase64 = (new AiLineArtService())->generate($binary, $mime);
        } catch (Throwable $exception) {
            return Response::json(['error' => $exception->getMessage()], 502);
        }

        return Response::json(['image' => $imageBase64]);
    }
}
