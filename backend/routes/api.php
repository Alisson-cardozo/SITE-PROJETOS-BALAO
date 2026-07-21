<?php

declare(strict_types=1);

use App\Core\Response;
use App\Http\Controllers\Api\AuthController;
use App\Http\Controllers\Api\BandeiraController;
use App\Http\Controllers\Api\MoldController;
use App\Http\Controllers\Api\Modelo3DController;
use App\Http\Controllers\Api\MoldImportController;
use App\Http\Controllers\Api\MoldProjectController;
use App\Http\Controllers\Api\PainelController;
use App\Http\Controllers\Api\RifaController;
use App\Http\Controllers\Api\RifaPublicController;
use App\Http\Middleware\AuthMiddleware;

$router = app()->router;
$auth = [[AuthMiddleware::class, 'handle']];

$router->add('GET', '/api/health', static function () {
    return Response::json(['ok' => true, 'service' => 'sistema-novo-api']);
});

$router->add('POST', '/api/auth/register', [AuthController::class, 'register']);
$router->add('POST', '/api/auth/login', [AuthController::class, 'login']);
$router->add('GET', '/api/auth/me', [AuthController::class, 'me'], $auth);
$router->add('PUT', '/api/auth/password', [AuthController::class, 'changePassword'], $auth);
$router->add('POST', '/api/auth/logout', [AuthController::class, 'logout'], $auth);

$router->add('POST', '/api/pattern/import-pdf', [MoldImportController::class, 'importPdf'], $auth);

$router->add('GET', '/api/molds', [MoldController::class, 'index'], $auth);
$router->add('POST', '/api/molds', [MoldController::class, 'store'], $auth);
$router->add('GET', '/api/molds/{id}', [MoldController::class, 'show'], $auth);
$router->add('PUT', '/api/molds/{id}', [MoldController::class, 'update'], $auth);
$router->add('POST', '/api/molds/{id}/copy', [MoldController::class, 'copy'], $auth);
$router->add('DELETE', '/api/molds/{id}', [MoldController::class, 'destroy'], $auth);

// Projetos: cada molde pode ter varios projetos plotados (configuracoes de
// taco diferentes) — plotar de novo sempre cria um projeto novo, nunca
// sobrescreve um existente.
$router->add('GET', '/api/projects', [MoldProjectController::class, 'index'], $auth);
$router->add('GET', '/api/projects/{id}', [MoldProjectController::class, 'show'], $auth);
$router->add('POST', '/api/molds/{moldId}/projects', [MoldProjectController::class, 'store'], $auth);
$router->add('PUT', '/api/projects/{id}', [MoldProjectController::class, 'update'], $auth);
$router->add('DELETE', '/api/projects/{id}', [MoldProjectController::class, 'destroy'], $auth);
$router->add('POST', '/api/projects/{id}/send-email', [MoldProjectController::class, 'sendEmail'], $auth);

// Bandeiras: imagem taqueada (pixelada) numa grade com tamanho real fisico.
$router->add('GET', '/api/bandeiras', [BandeiraController::class, 'index'], $auth);
$router->add('POST', '/api/bandeiras', [BandeiraController::class, 'store'], $auth);
$router->add('POST', '/api/bandeiras/send-email', [BandeiraController::class, 'sendEmail'], $auth);
$router->add('GET', '/api/bandeiras/{id}', [BandeiraController::class, 'show'], $auth);
$router->add('PUT', '/api/bandeiras/{id}', [BandeiraController::class, 'update'], $auth);
$router->add('DELETE', '/api/bandeiras/{id}', [BandeiraController::class, 'destroy'], $auth);

// Painel (LED/malha): so envio por email, sem CRUD/tabela no banco — o PDF e
// gerado no navegador, igual ao "Baixar PDF".
$router->add('POST', '/api/paineis/send-email', [PainelController::class, 'sendEmail'], $auth);

// "3D e Fotos": modelos de referencia so pra preview 3D — tabela separada de
// `molds` de proposito (ver comentario em database/schema.sql).
$router->add('GET', '/api/modelos-3d', [Modelo3DController::class, 'index'], $auth);
$router->add('POST', '/api/modelos-3d', [Modelo3DController::class, 'store'], $auth);
$router->add('PUT', '/api/modelos-3d/{id}', [Modelo3DController::class, 'update'], $auth);
$router->add('DELETE', '/api/modelos-3d/{id}', [Modelo3DController::class, 'destroy'], $auth);

// Rifas — lado do dono (autenticado).
$router->add('GET', '/api/rifas', [RifaController::class, 'index'], $auth);
$router->add('POST', '/api/rifas', [RifaController::class, 'store'], $auth);
$router->add('GET', '/api/rifas/{id}', [RifaController::class, 'show'], $auth);
$router->add('PUT', '/api/rifas/{id}', [RifaController::class, 'update'], $auth);
$router->add('DELETE', '/api/rifas/{id}', [RifaController::class, 'destroy'], $auth);
$router->add('POST', '/api/rifas/{id}/vendas', [RifaController::class, 'criarVendaManual'], $auth);
$router->add('POST', '/api/rifas/{id}/sortear', [RifaController::class, 'sortear'], $auth);
$router->add('PUT', '/api/rifas/{id}/compradores/{compradorId}/confirmar', [RifaController::class, 'confirmarPagamento'], $auth);
$router->add('PUT', '/api/rifas/{id}/compradores/{compradorId}/recusar', [RifaController::class, 'recusarPagamento'], $auth);
$router->add('GET', '/api/rifas/{id}/promocoes', [RifaController::class, 'listPromocoes'], $auth);
$router->add('POST', '/api/rifas/{id}/promocoes', [RifaController::class, 'createPromocao'], $auth);
$router->add('PUT', '/api/rifas/{id}/promocoes/{promocaoId}', [RifaController::class, 'updatePromocao'], $auth);
$router->add('DELETE', '/api/rifas/{id}/promocoes/{promocaoId}', [RifaController::class, 'deletePromocao'], $auth);

// Rifas — pagina publica (link que o dono manda pro cliente). Sem middleware
// de auth de proposito — quem abre o link nunca fez login nesse sistema.
$router->add('GET', '/api/public/rifas/{slug}', [RifaPublicController::class, 'show']);
$router->add('GET', '/api/public/rifas/{slug}/meus-numeros', [RifaPublicController::class, 'meusNumeros']);
$router->add('POST', '/api/public/rifas/{slug}/reservar', [RifaPublicController::class, 'reservar']);
$router->add('GET', '/api/public/rifas/compradores/{compradorId}/status', [RifaPublicController::class, 'statusComprador']);
