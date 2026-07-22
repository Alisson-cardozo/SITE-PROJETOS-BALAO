<?php

declare(strict_types=1);

use App\Core\Response;
use App\Http\Controllers\Api\AdminUserController;
use App\Http\Controllers\Api\AuthController;
use App\Http\Controllers\Api\BandeiraController;
use App\Http\Controllers\Api\MercadoPagoWebhookController;
use App\Http\Controllers\Api\MoldController;
use App\Http\Controllers\Api\Modelo3DController;
use App\Http\Controllers\Api\MoldImportController;
use App\Http\Controllers\Api\MoldProjectController;
use App\Http\Controllers\Api\PagamentoController;
use App\Http\Controllers\Api\PainelController;
use App\Http\Controllers\Api\PlanoController;
use App\Http\Controllers\Api\PlanoPublicController;
use App\Http\Controllers\Api\RifaController;
use App\Http\Controllers\Api\RifaPublicController;
use App\Http\Controllers\Api\SystemSettingsController;
use App\Http\Middleware\AdminMiddleware;
use App\Http\Middleware\AuthMiddleware;
use App\Http\Middleware\PaidAccessMiddleware;

$router = app()->router;
$auth = [[AuthMiddleware::class, 'handle']];
$adminOnly = [[AuthMiddleware::class, 'handle'], [AdminMiddleware::class, 'handle']];
// Alem de autenticado, exige plano pago ativo (ou ser admin) -- ver
// PaidAccessMiddleware. Usado em toda rota de funcionalidade; NAO usado nas
// rotas de auth, configuracoes do sistema, ou nas de plano/pagamento (que
// sao exatamente a saida do bloqueio).
$paid = [[AuthMiddleware::class, 'handle'], [PaidAccessMiddleware::class, 'handle']];

$router->add('GET', '/api/health', static function () {
    return Response::json(['ok' => true, 'service' => 'sistema-novo-api']);
});

$router->add('POST', '/api/auth/register', [AuthController::class, 'register']);
$router->add('POST', '/api/auth/login', [AuthController::class, 'login']);
$router->add('GET', '/api/auth/me', [AuthController::class, 'me'], $auth);
$router->add('PUT', '/api/auth/password', [AuthController::class, 'changePassword'], $auth);
$router->add('PUT', '/api/auth/email', [AuthController::class, 'changeEmail'], $auth);
$router->add('POST', '/api/auth/logout', [AuthController::class, 'logout'], $auth);

// Administracao — restrito a usuarios com role 'admin'.
$router->add('GET', '/api/admin/users', [AdminUserController::class, 'index'], $adminOnly);
$router->add('PUT', '/api/admin/users/{id}/status', [AdminUserController::class, 'updateStatus'], $adminOnly);
$router->add('PUT', '/api/admin/users/{id}/grant-access', [AdminUserController::class, 'grantAccess'], $adminOnly);
$router->add('DELETE', '/api/admin/users/{id}', [AdminUserController::class, 'destroy'], $adminOnly);

// Config global do sistema — redes sociais (rodape) e abas ocultas do menu.
// Leitura liberada pra qualquer logado (o rodape aparece pra todo mundo);
// so o admin pode alterar.
$router->add('GET', '/api/system-settings', [SystemSettingsController::class, 'show'], $auth);
$router->add('PUT', '/api/admin/system-settings', [SystemSettingsController::class, 'update'], $adminOnly);

$router->add('POST', '/api/pattern/import-pdf', [MoldImportController::class, 'importPdf'], $paid);

$router->add('GET', '/api/molds', [MoldController::class, 'index'], $paid);
$router->add('POST', '/api/molds', [MoldController::class, 'store'], $paid);
$router->add('GET', '/api/molds/{id}', [MoldController::class, 'show'], $paid);
$router->add('PUT', '/api/molds/{id}', [MoldController::class, 'update'], $paid);
$router->add('POST', '/api/molds/{id}/copy', [MoldController::class, 'copy'], $paid);
$router->add('DELETE', '/api/molds/{id}', [MoldController::class, 'destroy'], $paid);

// Projetos: cada molde pode ter varios projetos plotados (configuracoes de
// taco diferentes) — plotar de novo sempre cria um projeto novo, nunca
// sobrescreve um existente.
$router->add('GET', '/api/projects', [MoldProjectController::class, 'index'], $paid);
$router->add('GET', '/api/projects/{id}', [MoldProjectController::class, 'show'], $paid);
$router->add('POST', '/api/molds/{moldId}/projects', [MoldProjectController::class, 'store'], $paid);
$router->add('PUT', '/api/projects/{id}', [MoldProjectController::class, 'update'], $paid);
$router->add('DELETE', '/api/projects/{id}', [MoldProjectController::class, 'destroy'], $paid);
$router->add('POST', '/api/projects/{id}/send-email', [MoldProjectController::class, 'sendEmail'], $paid);

// Bandeiras: imagem taqueada (pixelada) numa grade com tamanho real fisico.
$router->add('GET', '/api/bandeiras', [BandeiraController::class, 'index'], $paid);
$router->add('POST', '/api/bandeiras', [BandeiraController::class, 'store'], $paid);
$router->add('POST', '/api/bandeiras/send-email', [BandeiraController::class, 'sendEmail'], $paid);
$router->add('GET', '/api/bandeiras/{id}', [BandeiraController::class, 'show'], $paid);
$router->add('PUT', '/api/bandeiras/{id}', [BandeiraController::class, 'update'], $paid);
$router->add('DELETE', '/api/bandeiras/{id}', [BandeiraController::class, 'destroy'], $paid);

// Painel (LED/malha): so envio por email, sem CRUD/tabela no banco — o PDF e
// gerado no navegador, igual ao "Baixar PDF".
$router->add('POST', '/api/paineis/send-email', [PainelController::class, 'sendEmail'], $paid);

// "3D e Fotos": modelos de referencia so pra preview 3D — tabela separada de
// `molds` de proposito (ver comentario em database/schema.sql).
$router->add('GET', '/api/modelos-3d', [Modelo3DController::class, 'index'], $paid);
$router->add('POST', '/api/modelos-3d', [Modelo3DController::class, 'store'], $paid);
$router->add('PUT', '/api/modelos-3d/{id}', [Modelo3DController::class, 'update'], $paid);
$router->add('PUT', '/api/modelos-3d/{id}/hidden', [Modelo3DController::class, 'setHidden'], $paid);
$router->add('DELETE', '/api/modelos-3d/{id}', [Modelo3DController::class, 'destroy'], $paid);

// Rifas — lado do dono (autenticado + plano pago ativo).
$router->add('GET', '/api/rifas', [RifaController::class, 'index'], $paid);
$router->add('POST', '/api/rifas', [RifaController::class, 'store'], $paid);
$router->add('GET', '/api/rifas/{id}', [RifaController::class, 'show'], $paid);
$router->add('PUT', '/api/rifas/{id}', [RifaController::class, 'update'], $paid);
$router->add('DELETE', '/api/rifas/{id}', [RifaController::class, 'destroy'], $paid);
$router->add('POST', '/api/rifas/{id}/vendas', [RifaController::class, 'criarVendaManual'], $paid);
$router->add('POST', '/api/rifas/{id}/sortear', [RifaController::class, 'sortear'], $paid);
$router->add('PUT', '/api/rifas/{id}/compradores/{compradorId}/confirmar', [RifaController::class, 'confirmarPagamento'], $paid);
$router->add('PUT', '/api/rifas/{id}/compradores/{compradorId}/recusar', [RifaController::class, 'recusarPagamento'], $paid);
$router->add('GET', '/api/rifas/{id}/promocoes', [RifaController::class, 'listPromocoes'], $paid);
$router->add('POST', '/api/rifas/{id}/promocoes', [RifaController::class, 'createPromocao'], $paid);
$router->add('PUT', '/api/rifas/{id}/promocoes/{promocaoId}', [RifaController::class, 'updatePromocao'], $paid);
$router->add('DELETE', '/api/rifas/{id}/promocoes/{promocaoId}', [RifaController::class, 'deletePromocao'], $paid);

// Planos pagos — CRUD do admin, lista publica (autenticado) e cobranca Pix.
// Nao usam $paid de proposito: sao a propria saida do bloqueio de pagamento.
$router->add('GET', '/api/admin/planos', [PlanoController::class, 'index'], $adminOnly);
$router->add('POST', '/api/admin/planos', [PlanoController::class, 'store'], $adminOnly);
$router->add('PUT', '/api/admin/planos/{id}', [PlanoController::class, 'update'], $adminOnly);
$router->add('PUT', '/api/admin/planos/{id}/ativo', [PlanoController::class, 'setAtivo'], $adminOnly);
$router->add('DELETE', '/api/admin/planos/{id}', [PlanoController::class, 'destroy'], $adminOnly);

$router->add('GET', '/api/planos', [PlanoPublicController::class, 'index'], $auth);
$router->add('POST', '/api/plano/pagamentos', [PagamentoController::class, 'store'], $auth);
$router->add('GET', '/api/plano/pagamentos/{id}', [PagamentoController::class, 'show'], $auth);

// Webhook do Mercado Pago — sem middleware de proposito, o MP nunca tem um
// token nosso. O handler sempre re-consulta a API do MP antes de confiar em
// qualquer coisa (ver MercadoPagoWebhookController).
$router->add('POST', '/api/public/mercado-pago/webhook', [MercadoPagoWebhookController::class, 'handle']);

// Rifas — pagina publica (link que o dono manda pro cliente). Sem middleware
// de auth de proposito — quem abre o link nunca fez login nesse sistema.
$router->add('GET', '/api/public/rifas/{slug}', [RifaPublicController::class, 'show']);
$router->add('GET', '/api/public/rifas/{slug}/meus-numeros', [RifaPublicController::class, 'meusNumeros']);
$router->add('POST', '/api/public/rifas/{slug}/reservar', [RifaPublicController::class, 'reservar']);
$router->add('GET', '/api/public/rifas/compradores/{compradorId}/status', [RifaPublicController::class, 'statusComprador']);
