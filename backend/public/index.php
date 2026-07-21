<?php

declare(strict_types=1);

error_reporting(E_ALL);
ini_set('display_errors', '0');

// So no servidor embutido de dev (`php -S`), que usa este arquivo como router
// pra TODA requisicao: deixa arquivo estatico real (ex: foto de rifa em
// public/uploads/...) ser servido direto pelo proprio servidor, em vez de
// cair no nosso Router e virar "rota nao encontrada". Sem efeito nenhum em
// producao (Apache/FastCGI nunca roda index.php via CLI-SERVER e ja serve
// public/uploads/* direto pelo document root).
if (PHP_SAPI === 'cli-server') {
    $path = parse_url($_SERVER['REQUEST_URI'] ?? '', PHP_URL_PATH) ?? '';
    $filePath = __DIR__ . $path;
    if ($path !== '/' && is_file($filePath)) {
        return false;
    }
}

$app = require __DIR__ . '/../bootstrap/app.php';

try {
    $app->run();
} catch (\Throwable $exception) {
    http_response_code(500);
    header('Content-Type: application/json; charset=utf-8');

    $debug = $app->env('APP_DEBUG', 'false') === 'true';
    echo json_encode([
        'error' => 'Erro interno do servidor.',
        'detail' => $debug ? $exception->getMessage() : null,
    ]);
}
