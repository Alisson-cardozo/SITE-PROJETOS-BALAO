<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api;

use App\Core\Request;
use App\Core\Response;
use App\Services\AiImageAlignmentService;
use Throwable;

/**
 * Endpoint usado pelo "Riscar Molde" (riscar-molde.html) pra pedir ao
 * Gemini os 4 pontos de referencia (ponta, os dois lados do equador, base)
 * de uma imagem enviada pelo cliente, usados no front pra posicionar a
 * grade do cone automaticamente sobre a imagem.
 */
final class MoldAlignmentController
{
    private const MAX_SIZE_BYTES = 10 * 1024 * 1024;
    private const ALLOWED_MIME = ['image/png', 'image/jpeg', 'image/webp'];

    public function detectLandmarks(Request $request): Response
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

        try {
            $landmarks = (new AiImageAlignmentService())->detectLandmarks($binary, $mime);
        } catch (Throwable $exception) {
            return Response::json(['error' => $exception->getMessage()], 502);
        }

        return Response::json(['landmarks' => $landmarks]);
    }
}
