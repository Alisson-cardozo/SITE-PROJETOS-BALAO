<?php

declare(strict_types=1);

use App\Core\Request;
use App\Core\Response;
use App\Http\Controllers\Api\AdminUserController;
use App\Http\Controllers\Api\AuthController;
use App\Http\Controllers\Api\ChatbotController;
use App\Http\Controllers\Api\WhatsAppAdminController;
use App\Http\Controllers\Api\WhatsAppChatController;
use App\Http\Controllers\Api\WhatsAppWebhookController;
use App\Http\Controllers\Api\EmailVerificationController;
use App\Http\Controllers\Api\BandeiraController;
use App\Http\Controllers\Api\MercadoPagoWebhookController;
use App\Http\Controllers\Api\MoldAlignmentController;
use App\Http\Controllers\Api\MoldController;
use App\Http\Controllers\Api\Modelo3DController;
use App\Http\Controllers\Api\MoldImportController;
use App\Http\Controllers\Api\MoldProjectController;
use App\Http\Controllers\Api\LanternaProjectController;
use App\Http\Controllers\Api\RiscadoProjectController;
use App\Http\Controllers\Api\PagamentoController;
use App\Http\Controllers\Api\PainelController;
use App\Http\Controllers\Api\PlanoController;
use App\Http\Controllers\Api\PlanoPublicController;
use App\Http\Controllers\Api\LojaProdutoController;
use App\Http\Controllers\Api\LojaPublicController;
use App\Http\Controllers\Api\RifaController;
use App\Http\Controllers\Api\RifaPublicController;
use App\Http\Controllers\Api\SystemSettingsController;
use App\Http\Controllers\Api\ComunicadoController;
use App\Http\Controllers\Api\CupomController;
use App\Http\Controllers\Api\SolicitacaoPublicController;
use App\Http\Controllers\Api\SolicitacaoAdminController;
use App\Http\Controllers\Api\NotificacaoController;
use App\Http\Controllers\Api\LineArtController;
use App\Http\Middleware\AbaAccessMiddleware;
use App\Http\Middleware\AdminMiddleware;
use App\Http\Middleware\AuthMiddleware;
use App\Http\Middleware\EmailVerifiedMiddleware;
use App\Http\Middleware\PaidAccessMiddleware;

$router = app()->router;
$auth = [[AuthMiddleware::class, 'handle']];
// Autenticado + e-mail confirmado (mas sem exigir plano) — usado nas rotas de
// pagamento: o cliente so gera um Pix depois de validar o e-mail.
$authVerified = [[AuthMiddleware::class, 'handle'], [EmailVerifiedMiddleware::class, 'handle']];
$adminOnly = [[AuthMiddleware::class, 'handle'], [AdminMiddleware::class, 'handle']];
// Alem de autenticado, exige plano pago ativo (ou ser admin) -- ver
// PaidAccessMiddleware. Usado em toda rota de funcionalidade; NAO usado nas
// rotas de auth, configuracoes do sistema, ou nas de plano/pagamento (que
// sao exatamente a saida do bloqueio).
$paid = [[AuthMiddleware::class, 'handle'], [EmailVerifiedMiddleware::class, 'handle'], [PaidAccessMiddleware::class, 'handle']];

/**
 * Alem de $paid, exige que o PLANO do usuario inclua essa aba especifica
 * (ver AbaAccessMiddleware/PlanoService::ALL_ABAS). Uma closure porque o
 * Router so aceita [Classe, 'metodo'] OU Closure(Request) como middleware —
 * precisamos fechar sobre `$abaKey`, que muda por grupo de rotas.
 */
function paidAba(array $paid, string $abaKey): array
{
    return [
        ...$paid,
        static function (Request $request) use ($abaKey): ?Response {
            return (new AbaAccessMiddleware())->handleFor($request, $abaKey);
        },
    ];
}

$paidMoldes = paidAba($paid, 'moldes');
$paidPlotterTacos = paidAba($paid, 'plotter-tacos');
$paidPlotterRiscado = paidAba($paid, 'plotter-riscado');
$paidBandeiras = paidAba($paid, 'bandeiras');
$paidPainel = paidAba($paid, 'painel-letreiros');
$paidModelo3d = paidAba($paid, '3d-fotos');
$paidRifas = paidAba($paid, 'profissionais');
$paidAcabamentos = paidAba($paid, 'acabamentos');

$router->add('GET', '/api/health', static function () {
    return Response::json(['ok' => true, 'service' => 'sistema-novo-api']);
});

$router->add('POST', '/api/auth/register', [AuthController::class, 'register']);
$router->add('POST', '/api/auth/login', [AuthController::class, 'login']);
$router->add('GET', '/api/public/planos', [PlanoPublicController::class, 'index']);

// Solicitacao de molde sob encomenda — pagina PUBLICA (sem login).
$router->add('GET', '/api/public/solicitacao-molde/config', [SolicitacaoPublicController::class, 'config']);
$router->add('POST', '/api/public/solicitacao-molde', [SolicitacaoPublicController::class, 'criar']);
$router->add('POST', '/api/public/solicitacao-molde/cartao', [SolicitacaoPublicController::class, 'criarCartao']);
$router->add('POST', '/api/public/solicitacao-molde/{id}/status', [SolicitacaoPublicController::class, 'status']);
$router->add('POST', '/api/public/solicitacao-molde/{id}/cancelar', [SolicitacaoPublicController::class, 'cancelar']);
$router->add('POST', '/api/public/solicitacao-molde/recuperar', [SolicitacaoPublicController::class, 'recuperar']);
$router->add('POST', '/api/public/solicitacao-molde/{id}/simular-pago', [SolicitacaoPublicController::class, 'simularPago']);
$router->add('POST', '/api/public/solicitacao-molde/{id}/definir-dados', [SolicitacaoPublicController::class, 'definirDados']);
$router->add('POST', '/api/public/solicitacao-molde/{id}/dados', [SolicitacaoPublicController::class, 'atualizarDados']);
$router->add('POST', '/api/public/solicitacao-molde/{id}/tacos', [SolicitacaoPublicController::class, 'salvarTacos']);
$router->add('POST', '/api/public/solicitacao-molde/{id}/entregar', [SolicitacaoPublicController::class, 'entregar']);
// Config do admin da solicitacao de molde.
$router->add('GET', '/api/admin/solicitacao-molde/config', [SolicitacaoAdminController::class, 'config'], $adminOnly);
$router->add('PUT', '/api/admin/solicitacao-molde/config', [SolicitacaoAdminController::class, 'updateConfig'], $adminOnly);
$router->add('PUT', '/api/admin/solicitacao-molde/molds/{id}', [SolicitacaoAdminController::class, 'setMoldDisponivel'], $adminOnly);
$router->add('GET', '/api/admin/solicitacao-molde/pedidos', [SolicitacaoAdminController::class, 'listPedidos'], $adminOnly);
$router->add('POST', '/api/admin/solicitacao-molde/enviar-chave', [SolicitacaoAdminController::class, 'enviarChave'], $adminOnly);
$router->add('POST', '/api/admin/solicitacao-molde/consultar-chave', [SolicitacaoAdminController::class, 'consultarChave'], $adminOnly);
$router->add('GET', '/api/auth/me', [AuthController::class, 'me'], $auth);
$router->add('PUT', '/api/auth/password', [AuthController::class, 'changePassword'], $auth);
$router->add('PUT', '/api/auth/email', [AuthController::class, 'changeEmail'], $auth);
$router->add('POST', '/api/auth/email/confirm', [AuthController::class, 'confirmEmailChange'], $auth);
$router->add('POST', '/api/auth/activity', [AuthController::class, 'reportActivity'], $auth);
$router->add('POST', '/api/auth/phone/send', [AuthController::class, 'sendPhoneCode'], $auth);
$router->add('POST', '/api/auth/phone/confirm', [AuthController::class, 'confirmPhoneCode'], $auth);
$router->add('DELETE', '/api/auth/account', [AuthController::class, 'deleteAccount'], $auth);
$router->add('POST', '/api/auth/logout', [AuthController::class, 'logout'], $auth);
$router->add('POST', '/api/auth/heartbeat', [AuthController::class, 'heartbeat'], $auth);

// Confirmacao de e-mail por codigo de 6 digitos. So autenticado (NAO exige
// e-mail verificado — e a propria saida do bloqueio).
$router->add('GET', '/api/auth/email-verification', [EmailVerificationController::class, 'status'], $auth);
$router->add('POST', '/api/auth/email-verification/send', [EmailVerificationController::class, 'send'], $auth);
$router->add('POST', '/api/auth/email-verification/confirm', [EmailVerificationController::class, 'confirm'], $auth);

// Administracao — restrito a usuarios com role 'admin'.
$router->add('GET', '/api/admin/users', [AdminUserController::class, 'index'], $adminOnly);
$router->add('PUT', '/api/admin/users/{id}/status', [AdminUserController::class, 'updateStatus'], $adminOnly);
$router->add('PUT', '/api/admin/users/{id}/grant-access', [AdminUserController::class, 'grantAccess'], $adminOnly);
$router->add('PUT', '/api/admin/users/{id}/revoke-access', [AdminUserController::class, 'revokeAccess'], $adminOnly);
$router->add('PUT', '/api/admin/users/{id}/password', [AdminUserController::class, 'updatePassword'], $adminOnly);
$router->add('POST', '/api/admin/users/{id}/revoke-session', [AdminUserController::class, 'revokeSession'], $adminOnly);
$router->add('DELETE', '/api/admin/users/{id}', [AdminUserController::class, 'destroy'], $adminOnly);
$router->add('GET', '/api/admin/whatsapp/status', [WhatsAppAdminController::class, 'status'], $adminOnly);
$router->add('POST', '/api/admin/whatsapp/connect', [WhatsAppAdminController::class, 'connect'], $adminOnly);
$router->add('POST', '/api/admin/whatsapp/connect-with-code', [WhatsAppAdminController::class, 'connectWithCode'], $adminOnly);
$router->add('POST', '/api/admin/whatsapp/disconnect', [WhatsAppAdminController::class, 'disconnect'], $adminOnly);
// Webhook publico da Evolution API (container Docker) — QR/estado novo, sem
// middleware de auth de proposito, protegido por segredo compartilhado.
$router->add('POST', '/api/whatsapp/webhook', [WhatsAppWebhookController::class, 'handle']);

// Chat do WhatsApp (aba "Mensagens" do admin).
$router->add('GET', '/api/admin/whatsapp/conversations', [WhatsAppChatController::class, 'conversations'], $adminOnly);
$router->add('GET', '/api/admin/whatsapp/conversations/{id}/messages', [WhatsAppChatController::class, 'messages'], $adminOnly);
$router->add('POST', '/api/admin/whatsapp/conversations/{id}/messages', [WhatsAppChatController::class, 'send'], $adminOnly);
$router->add('POST', '/api/admin/whatsapp/conversations/{id}/read', [WhatsAppChatController::class, 'markRead'], $adminOnly);
$router->add('POST', '/api/admin/whatsapp/conversations/{id}/bot-paused', [WhatsAppChatController::class, 'setBotPaused'], $adminOnly);
$router->add('GET', '/api/admin/whatsapp/ws-ticket', [WhatsAppChatController::class, 'wsTicket'], $adminOnly);

// Chatbot com fluxo visual (aba "Chatbot" do admin).
$router->add('GET', '/api/admin/chatbot/flows', [ChatbotController::class, 'index'], $adminOnly);
$router->add('POST', '/api/admin/chatbot/flows', [ChatbotController::class, 'store'], $adminOnly);
$router->add('GET', '/api/admin/chatbot/flows/{id}', [ChatbotController::class, 'show'], $adminOnly);
$router->add('PUT', '/api/admin/chatbot/flows/{id}', [ChatbotController::class, 'update'], $adminOnly);
$router->add('DELETE', '/api/admin/chatbot/flows/{id}', [ChatbotController::class, 'destroy'], $adminOnly);
$router->add('GET', '/api/admin/blocklist', [AdminUserController::class, 'listBlockedEmails'], $adminOnly);
$router->add('POST', '/api/admin/blocklist', [AdminUserController::class, 'blockEmail'], $adminOnly);
$router->add('DELETE', '/api/admin/blocklist', [AdminUserController::class, 'unblockEmail'], $adminOnly);

// Config global do sistema — redes sociais (rodape) e abas ocultas do menu.
// Leitura liberada pra qualquer logado (o rodape aparece pra todo mundo);
// so o admin pode alterar.
$router->add('GET', '/api/system-settings', [SystemSettingsController::class, 'show'], $auth);
$router->add('PUT', '/api/admin/system-settings', [SystemSettingsController::class, 'update'], $adminOnly);

$router->add('POST', '/api/pattern/import-pdf', [MoldImportController::class, 'importPdf'], $paidMoldes);
$router->add('POST', '/api/pattern/detect-landmarks', [MoldAlignmentController::class, 'detectLandmarks'], $paidPlotterRiscado);
$router->add('POST', '/api/pattern/lineart', [LineArtController::class, 'generate'], $paidPlotterRiscado);

$router->add('GET', '/api/molds', [MoldController::class, 'index'], $paidMoldes);
$router->add('POST', '/api/molds', [MoldController::class, 'store'], $paidMoldes);
$router->add('GET', '/api/molds/{id}', [MoldController::class, 'show'], $paidMoldes);
$router->add('PUT', '/api/molds/{id}', [MoldController::class, 'update'], $paidMoldes);
$router->add('POST', '/api/molds/{id}/copy', [MoldController::class, 'copy'], $paidMoldes);
$router->add('DELETE', '/api/molds/{id}', [MoldController::class, 'destroy'], $paidMoldes);

// Projetos: cada molde pode ter varios projetos plotados (configuracoes de
// taco diferentes) — plotar de novo sempre cria um projeto novo, nunca
// sobrescreve um existente. Mesma aba do Plotter Tacos (a galeria "Meus
// Projetos > Moldes Taqueados" e so outra tela pra essa mesma API).
$router->add('GET', '/api/projects', [MoldProjectController::class, 'index'], $paidPlotterTacos);
$router->add('GET', '/api/projects/{id}', [MoldProjectController::class, 'show'], $paidPlotterTacos);
$router->add('POST', '/api/molds/{moldId}/projects', [MoldProjectController::class, 'store'], $paidPlotterTacos);
$router->add('PUT', '/api/projects/{id}', [MoldProjectController::class, 'update'], $paidPlotterTacos);
$router->add('DELETE', '/api/projects/{id}', [MoldProjectController::class, 'destroy'], $paidPlotterTacos);
$router->add('POST', '/api/projects/{id}/send-email', [MoldProjectController::class, 'sendEmail'], $paidPlotterTacos);

// Projetos do Plotter Riscado (Lek + Criar) — listados em Meus Projetos > Moldes Riscados.
$router->add('GET', '/api/riscado-projects', [RiscadoProjectController::class, 'index'], $paidPlotterRiscado);
$router->add('POST', '/api/riscado-projects', [RiscadoProjectController::class, 'store'], $paidPlotterRiscado);
$router->add('GET', '/api/riscado-projects/{id}', [RiscadoProjectController::class, 'show'], $paidPlotterRiscado);
$router->add('PUT', '/api/riscado-projects/{id}', [RiscadoProjectController::class, 'update'], $paidPlotterRiscado);
$router->add('DELETE', '/api/riscado-projects/{id}', [RiscadoProjectController::class, 'destroy'], $paidPlotterRiscado);

// Projetos de Lanternagem de Bojo (Acabamentos) — listados em Meus Projetos > Lanternagem de Bojo.
$router->add('GET', '/api/lanterna-projects', [LanternaProjectController::class, 'index'], $paidAcabamentos);
$router->add('POST', '/api/lanterna-projects', [LanternaProjectController::class, 'store'], $paidAcabamentos);
$router->add('GET', '/api/lanterna-projects/{id}', [LanternaProjectController::class, 'show'], $paidAcabamentos);
$router->add('PUT', '/api/lanterna-projects/{id}', [LanternaProjectController::class, 'update'], $paidAcabamentos);
$router->add('DELETE', '/api/lanterna-projects/{id}', [LanternaProjectController::class, 'destroy'], $paidAcabamentos);

// Bandeiras: imagem taqueada (pixelada) numa grade com tamanho real fisico.
$router->add('GET', '/api/bandeiras', [BandeiraController::class, 'index'], $paidBandeiras);
$router->add('POST', '/api/bandeiras', [BandeiraController::class, 'store'], $paidBandeiras);
$router->add('POST', '/api/bandeiras/send-email', [BandeiraController::class, 'sendEmail'], $paidBandeiras);
$router->add('GET', '/api/bandeiras/{id}', [BandeiraController::class, 'show'], $paidBandeiras);
$router->add('PUT', '/api/bandeiras/{id}', [BandeiraController::class, 'update'], $paidBandeiras);
$router->add('DELETE', '/api/bandeiras/{id}', [BandeiraController::class, 'destroy'], $paidBandeiras);

// Painel (LED/malha): so envio por email, sem CRUD/tabela no banco — o PDF e
// gerado no navegador, igual ao "Baixar PDF".
$router->add('POST', '/api/paineis/send-email', [PainelController::class, 'sendEmail'], $paidPainel);

// "3D e Fotos": modelos de referencia so pra preview 3D — tabela separada de
// `molds` de proposito (ver comentario em database/schema.sql).
$router->add('GET', '/api/modelos-3d', [Modelo3DController::class, 'index'], $paidModelo3d);
$router->add('POST', '/api/modelos-3d', [Modelo3DController::class, 'store'], $paidModelo3d);
$router->add('PUT', '/api/modelos-3d/{id}', [Modelo3DController::class, 'update'], $paidModelo3d);
$router->add('PUT', '/api/modelos-3d/{id}/hidden', [Modelo3DController::class, 'setHidden'], $paidModelo3d);
$router->add('DELETE', '/api/modelos-3d/{id}', [Modelo3DController::class, 'destroy'], $paidModelo3d);

// Rifas — lado do dono (autenticado + plano pago ativo).
$router->add('GET', '/api/rifas', [RifaController::class, 'index'], $paidRifas);
$router->add('POST', '/api/rifas', [RifaController::class, 'store'], $paidRifas);
$router->add('GET', '/api/rifas/{id}', [RifaController::class, 'show'], $paidRifas);
$router->add('PUT', '/api/rifas/{id}', [RifaController::class, 'update'], $paidRifas);
$router->add('DELETE', '/api/rifas/{id}', [RifaController::class, 'destroy'], $paidRifas);
$router->add('POST', '/api/rifas/{id}/vendas', [RifaController::class, 'criarVendaManual'], $paidRifas);
$router->add('POST', '/api/rifas/{id}/sortear', [RifaController::class, 'sortear'], $paidRifas);
$router->add('PUT', '/api/rifas/{id}/compradores/{compradorId}/confirmar', [RifaController::class, 'confirmarPagamento'], $paidRifas);
$router->add('PUT', '/api/rifas/{id}/compradores/{compradorId}/recusar', [RifaController::class, 'recusarPagamento'], $paidRifas);
$router->add('GET', '/api/rifas/{id}/promocoes', [RifaController::class, 'listPromocoes'], $paidRifas);
$router->add('POST', '/api/rifas/{id}/promocoes', [RifaController::class, 'createPromocao'], $paidRifas);
$router->add('PUT', '/api/rifas/{id}/promocoes/{promocaoId}', [RifaController::class, 'updatePromocao'], $paidRifas);
$router->add('DELETE', '/api/rifas/{id}/promocoes/{promocaoId}', [RifaController::class, 'deletePromocao'], $paidRifas);

// Planos pagos — CRUD do admin, lista publica (autenticado) e cobranca Pix.
// Nao usam $paid de proposito: sao a propria saida do bloqueio de pagamento.
$router->add('GET', '/api/admin/planos', [PlanoController::class, 'index'], $adminOnly);
$router->add('POST', '/api/admin/planos', [PlanoController::class, 'store'], $adminOnly);
$router->add('PUT', '/api/admin/planos/{id}', [PlanoController::class, 'update'], $adminOnly);
$router->add('PUT', '/api/admin/planos/{id}/ativo', [PlanoController::class, 'setAtivo'], $adminOnly);
$router->add('DELETE', '/api/admin/planos/{id}', [PlanoController::class, 'destroy'], $adminOnly);

$router->add('GET', '/api/planos', [PlanoPublicController::class, 'index'], $auth);

// Cupons de desconto — CRUD do admin + validacao (preview) pro usuario na hora
// de pagar. A aplicacao real do desconto acontece no PagamentoController.
$router->add('GET', '/api/admin/cupons', [CupomController::class, 'index'], $adminOnly);
$router->add('POST', '/api/admin/cupons', [CupomController::class, 'store'], $adminOnly);
$router->add('PUT', '/api/admin/cupons/{id}', [CupomController::class, 'update'], $adminOnly);
$router->add('PUT', '/api/admin/cupons/{id}/campanha', [CupomController::class, 'setCampanha'], $adminOnly);
$router->add('DELETE', '/api/admin/cupons/{id}', [CupomController::class, 'destroy'], $adminOnly);
$router->add('POST', '/api/cupons/validar', [CupomController::class, 'validar'], $authVerified);

$router->add('POST', '/api/plano/pagamentos', [PagamentoController::class, 'store'], $authVerified);
$router->add('POST', '/api/plano/pagamentos/cartao', [PagamentoController::class, 'storeCartao'], $authVerified);
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

// Loja — vitrine admin-only (aba "Loja" no menu do admin) + vitrine publica
// (pagina /loja, sem login) onde o cliente compra via Pix e recebe o link de
// download por email so depois do pagamento aprovado.
$router->add('GET', '/api/admin/loja/produtos', [LojaProdutoController::class, 'index'], $adminOnly);
$router->add('POST', '/api/admin/loja/produtos', [LojaProdutoController::class, 'store'], $adminOnly);
$router->add('GET', '/api/admin/loja/produtos/{id}', [LojaProdutoController::class, 'show'], $adminOnly);
$router->add('PUT', '/api/admin/loja/produtos/{id}', [LojaProdutoController::class, 'update'], $adminOnly);
$router->add('DELETE', '/api/admin/loja/produtos/{id}', [LojaProdutoController::class, 'destroy'], $adminOnly);

$router->add('GET', '/api/public/loja/produtos', [LojaPublicController::class, 'index']);
$router->add('GET', '/api/public/loja/produtos/{id}', [LojaPublicController::class, 'show']);
$router->add('POST', '/api/public/loja/produtos/{id}/comprar', [LojaPublicController::class, 'comprar']);
$router->add('GET', '/api/public/loja/pagamentos/{id}/status', [LojaPublicController::class, 'status']);

// Comunicação
$router->add('GET', '/api/admin/comunicados', [ComunicadoController::class, 'index'], $adminOnly);
$router->add('POST', '/api/admin/comunicados', [ComunicadoController::class, 'store'], $adminOnly);
$router->add('GET', '/api/comunicados/pending', [ComunicadoController::class, 'getPending'], $auth);
$router->add('POST', '/api/comunicados/{id}/read', [ComunicadoController::class, 'markAsRead'], $auth);

// Web Push do USUARIO — deixa qualquer logado ativar notificacoes no seu
// dispositivo pra receber os comunicados. Reaproveita o NotificacaoController
// (subscribe/unsubscribe/vapidPublicKey ja usam o user_id do token).
$router->add('GET', '/api/push/vapid-public-key', [NotificacaoController::class, 'vapidPublicKey'], $auth);
$router->add('POST', '/api/push/subscribe', [NotificacaoController::class, 'subscribe'], $auth);
$router->add('POST', '/api/push/unsubscribe', [NotificacaoController::class, 'unsubscribe'], $auth);

// Notificações do admin (histórico das vendas) + Web Push
$router->add('GET', '/api/admin/notificacoes', [NotificacaoController::class, 'index'], $adminOnly);
$router->add('GET', '/api/admin/notificacoes/pending', [NotificacaoController::class, 'pending'], $adminOnly);
$router->add('POST', '/api/admin/notificacoes/read-all', [NotificacaoController::class, 'markAllAsRead'], $adminOnly);
$router->add('POST', '/api/admin/notificacoes/{id}/read', [NotificacaoController::class, 'markAsRead'], $adminOnly);
$router->add('GET', '/api/admin/push/vapid-public-key', [NotificacaoController::class, 'vapidPublicKey'], $adminOnly);
$router->add('POST', '/api/admin/push/subscribe', [NotificacaoController::class, 'subscribe'], $adminOnly);
$router->add('POST', '/api/admin/push/unsubscribe', [NotificacaoController::class, 'unsubscribe'], $adminOnly);
