<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api;

use App\Core\Request;
use App\Core\Response;
use App\Services\LojaProdutoService;

/** Admin-only (ver AdminMiddleware nas rotas) -- CRUD dos produtos da Loja. */
final class LojaProdutoController
{
    private const MAX_FOTO_BYTES = 5 * 1024 * 1024;
    private const ALLOWED_MIME = ['image/jpeg' => 'jpg', 'image/png' => 'png', 'image/webp' => 'webp'];
    private const MAX_IMAGENS = 4;

    private LojaProdutoService $produtos;

    public function __construct()
    {
        $this->produtos = new LojaProdutoService();
    }

    public function index(Request $request): Response
    {
        return Response::json(['data' => $this->produtos->listAllAdmin()]);
    }

    public function show(Request $request): Response
    {
        $id = (int) ($request->param('id') ?? 0);
        $produto = $this->produtos->findByIdAdmin($id);
        if ($produto === null) {
            return Response::json(['error' => 'Produto nao encontrado.'], 404);
        }

        return Response::json(['data' => $produto]);
    }

    public function store(Request $request): Response
    {
        $userId = (int) $request->attribute('user_id', 0);

        $validated = $this->validatePayload($request);
        if (isset($validated['errors'])) {
            return Response::json(['errors' => $validated['errors'], 'error' => 'Verifique os campos do produto.'], 422);
        }

        $photos = $this->handlePhotoUploads($this->newUploadDir());
        if (isset($photos['error'])) {
            return Response::json(['error' => $photos['error']], 422);
        }

        $data = $validated['data'];
        foreach ($photos['paths'] as $index => $path) {
            $data['imagem' . ($index + 1) . '_path'] = $path;
        }

        $produto = $this->produtos->create($data, $userId);

        return Response::json(['data' => $produto], 201);
    }

    /**
     * Edicao e sempre JSON puro (sem trocar as imagens) — PHP nao popula
     * $_FILES em requisicoes PUT multipart, so em POST (mesma limitacao de
     * RifaController::update). Pra trocar imagem, exclua e cadastre de novo.
     */
    public function update(Request $request): Response
    {
        $userId = (int) $request->attribute('user_id', 0);
        $id = (int) ($request->param('id') ?? 0);

        $existing = $this->produtos->findRawById($id);
        if ($existing === null) {
            return Response::json(['error' => 'Produto nao encontrado.'], 404);
        }

        $validated = $this->validatePayload($request);
        if (isset($validated['errors'])) {
            return Response::json(['errors' => $validated['errors'], 'error' => 'Verifique os campos do produto.'], 422);
        }

        $produto = $this->produtos->update($id, $validated['data'], $userId);

        return Response::json(['data' => $produto]);
    }

    public function destroy(Request $request): Response
    {
        $id = (int) ($request->param('id') ?? 0);
        $existing = $this->produtos->findRawById($id);
        if ($existing === null) {
            return Response::json(['error' => 'Produto nao encontrado.'], 404);
        }

        $this->produtos->delete($id);

        return Response::json(['ok' => true]);
    }

    /**
     * @return array{errors?: array<string,string>, data?: array<string,mixed>}
     */
    private function validatePayload(Request $request): array
    {
        $nome = trim((string) $request->input('nome', ''));
        $descricao = trim((string) $request->input('descricao', ''));
        $valor = $request->input('valor');
        $linkArquivo = trim((string) $request->input('link_arquivo', ''));

        $errors = [];

        if ($nome === '') {
            $errors['nome'] = 'Informe o nome do produto.';
        } elseif (mb_strlen($nome) > 180) {
            $errors['nome'] = 'O nome e muito longo.';
        }

        if (!is_numeric($valor) || (float) $valor <= 0) {
            $errors['valor'] = 'Informe o valor do produto.';
        }

        if ($linkArquivo === '') {
            $errors['link_arquivo'] = 'Informe o link dos arquivos.';
        } elseif (mb_strlen($linkArquivo) > 500) {
            $errors['link_arquivo'] = 'O link e muito longo.';
        } elseif (filter_var($linkArquivo, FILTER_VALIDATE_URL) === false) {
            $errors['link_arquivo'] = 'Informe um link valido (comecando com http:// ou https://).';
        }

        if ($errors !== []) {
            return ['errors' => $errors];
        }

        return [
            'data' => [
                'nome' => $nome,
                'descricao' => $descricao,
                'valor' => round((float) $valor, 2),
                'link_arquivo' => $linkArquivo,
            ],
        ];
    }

    /**
     * @return array{paths?: array<int, ?string>, error?: string}
     */
    private function handlePhotoUploads(string $uploadDir): array
    {
        $paths = [null, null, null, null];

        for ($i = 0; $i < self::MAX_IMAGENS; $i++) {
            $field = 'imagem' . ($i + 1);
            $file = $_FILES[$field] ?? null;

            if (!is_array($file) || ($file['error'] ?? UPLOAD_ERR_NO_FILE) === UPLOAD_ERR_NO_FILE) {
                continue;
            }

            if ($file['error'] !== UPLOAD_ERR_OK) {
                return ['error' => "Falha no upload da $field."];
            }
            if ((int) $file['size'] > self::MAX_FOTO_BYTES) {
                return ['error' => "A $field precisa ter no maximo 5MB."];
            }

            $mime = mime_content_type((string) $file['tmp_name']);
            if ($mime === false || !isset(self::ALLOWED_MIME[$mime])) {
                return ['error' => "A $field precisa ser JPG, PNG ou WEBP."];
            }

            $ext = self::ALLOWED_MIME[$mime];
            $absoluteDir = __DIR__ . '/../../../../public/' . $uploadDir;
            if (!is_dir($absoluteDir) && !mkdir($absoluteDir, 0755, true) && !is_dir($absoluteDir)) {
                return ['error' => 'Nao foi possivel criar a pasta de upload.'];
            }

            $relativePath = $uploadDir . '/' . $field . '.' . $ext;
            $absolutePath = __DIR__ . '/../../../../public/' . $relativePath;
            if (!move_uploaded_file((string) $file['tmp_name'], $absolutePath)) {
                return ['error' => "Nao foi possivel salvar a $field."];
            }

            $paths[$i] = $relativePath;
        }

        return ['paths' => $paths];
    }

    private function newUploadDir(): string
    {
        return 'uploads/loja/' . bin2hex(random_bytes(8));
    }
}
