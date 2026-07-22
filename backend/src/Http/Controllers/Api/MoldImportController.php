<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api;

use App\Core\Request;
use App\Core\Response;
use App\Services\AiPdfExtractorService;
use Throwable;

final class MoldImportController
{
    private const MAX_SIZE_BYTES = 15 * 1024 * 1024;

    public function importPdf(Request $request): Response
    {
        $file = $_FILES['pdf'] ?? null;
        if (!is_array($file) || ($file['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) {
            return Response::json(['error' => 'Envie um arquivo PDF valido.'], 422);
        }

        $name = (string) ($file['name'] ?? 'molde.pdf');
        if (!str_ends_with(strtolower($name), '.pdf')) {
            return Response::json(['error' => 'O arquivo precisa ser um PDF.'], 422);
        }

        if ((int) ($file['size'] ?? 0) > self::MAX_SIZE_BYTES) {
            return Response::json(['error' => 'PDF muito grande (limite de 15MB).'], 422);
        }

        $binary = file_get_contents((string) $file['tmp_name']);
        if ($binary === false || $binary === '') {
            return Response::json(['error' => 'Nao foi possivel ler o arquivo enviado.'], 500);
        }

        try {
            $data = (new AiPdfExtractorService())->extract($binary, $name);
        } catch (Throwable $exception) {
            return Response::json(['error' => $exception->getMessage()], 502);
        }

        return Response::json(['data' => $data]);
    }
}
