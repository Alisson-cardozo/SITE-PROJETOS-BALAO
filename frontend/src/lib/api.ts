import type {
  AuthResponse,
  BandeiraPayload,
  BandeiraSummary,
  Comunicado,
  Cupom,
  CupomPayload,
  CupomValidacao,
  SolicitacaoConfigPublic,
  SolicitacaoPedido,
  SolicitacaoChaveConsulta,
  AdminSolicitacaoConfig,
  Notificacao,
  ImportedMoldData,
  LanternaProject,
  LanternaProjectPayload,
  LojaPagamento,
  LojaProdutoAdmin,
  LojaProdutoPayload,
  LojaProdutoPublic,
  Modelo3D,
  Modelo3DPayload,
  MoldDetail,
  MoldPayload,
  MoldPlotterConfig,
  MoldProjectSummary,
  MoldSummary,
  Pagamento,
  Plano,
  PlanoPayload,
  PlanoPublic,
  Rifa,
  RifaComprador,
  RifaDetail,
  RifaPromocao,
  RifaReservaResponse,
  RiscadoProject,
  RiscadoProjectPayload,
  SystemSettings,
  TutorialConfig,
  User,
  UserStatus,
  WhatsAppConversation,
  WhatsAppMessage,
  ChatbotFlowSummary,
  ChatbotFlowDetail,
  ChatbotFlowGraph,
} from '../types';

const API_BASE = '/api';

export class ApiError extends Error {
  status: number;
  errors?: Record<string, string>;

  constructor(message: string, status: number, errors?: Record<string, string>) {
    super(message);
    this.status = status;
    this.errors = errors;
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  token?: string | null;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, token } = options;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
  });

  let data: unknown = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }

  if (!response.ok) {
    const payload = (data ?? {}) as { error?: string; errors?: Record<string, string> };
    throw new ApiError(payload.error ?? 'Nao foi possivel completar a operacao.', response.status, payload.errors);
  }

  return data as T;
}

export const api = {
  register: (payload: { name: string; email: string; password: string }) =>
    request<AuthResponse>('/auth/register', { method: 'POST', body: payload }),
  login: (payload: { email: string; password: string }) =>
    request<AuthResponse>('/auth/login', { method: 'POST', body: payload }),
  me: (token: string) => request<{ user: User }>('/auth/me', { token }),
  changePassword: (payload: { current_password: string; new_password: string }, token: string) =>
    request<{ ok: boolean }>('/auth/password', { method: 'PUT', body: payload, token }),
  changeEmail: (payload: { current_password: string; new_email: string }, token: string) =>
    request<{ ok: boolean; pending_email: string }>('/auth/email', { method: 'PUT', body: payload, token }),
  confirmEmailChange: (code: string, token: string) =>
    request<{ user: User }>('/auth/email/confirm', { method: 'POST', body: { code }, token }),
  reportActivity: (view: string, token: string) =>
    request<{ ok: boolean }>('/auth/activity', { method: 'POST', body: { view }, token }),
  sendPhoneCode: (phone: string, token: string) =>
    request<{ ok: boolean }>('/auth/phone/send', { method: 'POST', body: { phone }, token }),
  confirmPhoneCode: (code: string, token: string) =>
    request<{ user: User }>('/auth/phone/confirm', { method: 'POST', body: { code }, token }),
  deleteAccount: (password: string, token: string) =>
    request<{ ok: boolean }>('/auth/account', { method: 'DELETE', body: { password }, token }),
  logout: (token: string) => request<{ ok: boolean }>('/auth/logout', { method: 'POST', token }),
  emailVerificationStatus: (token: string) =>
    request<{ verified: boolean; email: string; deadline: string | null }>('/auth/email-verification', { token }),
  emailVerificationSend: (token: string) =>
    request<{ sent?: boolean; verified?: boolean; deadline?: string | null }>('/auth/email-verification/send', {
      method: 'POST',
      token,
    }),
  emailVerificationConfirm: (code: string, token: string) =>
    request<{ verified: boolean; user: User }>('/auth/email-verification/confirm', {
      method: 'POST',
      body: { code },
      token,
    }),
  adminListUsers: (token: string) =>
    request<{
      data: User[];
      stats: {
        total: number;
        active: number;
        expired: number;
        pending: number;
        blocked: number;
        monthly_billing: number;
        molds_sold_total?: number;
        molds_billing?: number;
        total_billing?: number;
      };
    }>('/admin/users', { token }),
  adminUpdateUserStatus: (id: number, status: 'active' | 'blocked', token: string) =>
    request<{ data: User }>(`/admin/users/${id}/status`, { method: 'PUT', body: { status }, token }),
  adminWhatsappStatus: (token: string) =>
    request<{ data: { connected: boolean; qr: string | null; pairingCode?: string | null; initializing?: boolean; service_online: boolean; error?: string | null } }>('/admin/whatsapp/status', { token }),
  adminWhatsappConnect: (token: string) =>
    request<{ data: unknown }>('/admin/whatsapp/connect', { method: 'POST', token }),
  adminWhatsappConnectWithCode: (phone: string, token: string) =>
    request<{ data: { pairingCode?: string } }>('/admin/whatsapp/connect-with-code', { method: 'POST', body: { phone }, token }),
  adminWhatsappDisconnect: (token: string) =>
    request<{ data: unknown }>('/admin/whatsapp/disconnect', { method: 'POST', token }),
  adminWhatsappConversations: (token: string) =>
    request<{ data: WhatsAppConversation[] }>('/admin/whatsapp/conversations', { token }),
  adminWhatsappMessages: (conversationId: number, token: string, before?: number) =>
    request<{ data: WhatsAppMessage[] }>(`/admin/whatsapp/conversations/${conversationId}/messages${before ? `?before=${before}` : ''}`, { token }),
  adminWhatsappSendMessage: (conversationId: number, body: string, token: string) =>
    request<{ data: { message: WhatsAppMessage } }>(`/admin/whatsapp/conversations/${conversationId}/messages`, { method: 'POST', body: { body }, token }),
  adminWhatsappMarkRead: (conversationId: number, token: string) =>
    request<{ ok: boolean }>(`/admin/whatsapp/conversations/${conversationId}/read`, { method: 'POST', token }),
  adminWhatsappSetBotPaused: (conversationId: number, paused: boolean, token: string) =>
    request<{ ok: boolean }>(`/admin/whatsapp/conversations/${conversationId}/bot-paused`, { method: 'POST', body: { paused }, token }),
  adminWhatsappWsTicket: (token: string) =>
    request<{ data: { ticket: string } }>('/admin/whatsapp/ws-ticket', { token }),
  adminChatbotFlows: (token: string) =>
    request<{ data: ChatbotFlowSummary[] }>('/admin/chatbot/flows', { token }),
  adminChatbotFlow: (id: number, token: string) =>
    request<{ data: ChatbotFlowDetail }>(`/admin/chatbot/flows/${id}`, { token }),
  adminChatbotCreateFlow: (name: string, token: string) =>
    request<{ data: ChatbotFlowDetail }>('/admin/chatbot/flows', { method: 'POST', body: { name }, token }),
  adminChatbotUpdateFlow: (
    id: number,
    payload: { name?: string; trigger_keyword?: string; is_active?: boolean; flow?: ChatbotFlowGraph },
    token: string,
  ) => request<{ data: ChatbotFlowDetail }>(`/admin/chatbot/flows/${id}`, { method: 'PUT', body: payload, token }),
  adminChatbotDeleteFlow: (id: number, token: string) =>
    request<{ ok: boolean }>(`/admin/chatbot/flows/${id}`, { method: 'DELETE', token }),
  adminListBlockedEmails: (token: string) =>
    request<{ data: Array<{ id: number; email: string; motivo: string | null; created_at: string }> }>('/admin/blocklist', { token }),
  adminBlockEmail: (email: string, token: string, motivo?: string) =>
    request<{ ok: boolean }>('/admin/blocklist', { method: 'POST', body: { email, motivo }, token }),
  adminUnblockEmail: (email: string, token: string) =>
    request<{ ok: boolean }>('/admin/blocklist', { method: 'DELETE', body: { email }, token }),
  adminGrantAccess: (id: number, days: number, token: string, planoId?: number | null) =>
    request<{ data: User }>(`/admin/users/${id}/grant-access`, {
      method: 'PUT',
      body: planoId !== undefined ? { days, plano_id: planoId } : { days },
      token,
    }),
  adminRevokeAccess: (id: number, token: string) =>
    request<{ data: User }>(`/admin/users/${id}/revoke-access`, { method: 'PUT', token }),
  adminDeleteUser: (id: number, token: string) =>
    request<{ ok: boolean }>(`/admin/users/${id}`, { method: 'DELETE', token }),
  adminUpdateUserPassword: (id: number, payload: { password: string; password_confirmation: string }, token: string) =>
    request<{ ok: boolean }>(`/admin/users/${id}/password`, { method: 'PUT', body: payload, token }),
  heartbeat: (token: string) =>
    request<{ ok: boolean }>('/auth/heartbeat', { method: 'POST', token }),
  adminRevokeSession: (id: number, token: string) =>
    request<{ ok: boolean }>(`/admin/users/${id}/revoke-session`, { method: 'POST', token }),
  getSystemSettings: (token: string) => request<{ data: SystemSettings }>('/system-settings', { token }),
  adminUpdateSystemSettings: (
    payload: Partial<{
      telegram: string;
      instagram: string;
      whatsapp: string;
      youtube: string;
      phone_validation_required: boolean;
      hidden_nav_items: string[];
      nav_item_labels: Record<string, string>;
      mercado_pago_public_key: string;
      mercado_pago_access_token: string;
      tutorials: Record<string, TutorialConfig>;
      no_plan_msg_enabled: boolean;
      no_plan_msg_text: string;
      no_plan_msg_delay_min: number;
      no_plan_msg_repeat_min: number;
    }>,
    token: string
  ) => request<{ data: SystemSettings }>('/admin/system-settings', { method: 'PUT', body: payload, token }),
  adminListPlanos: (token: string) => request<{ data: Plano[] }>('/admin/planos', { token }),
  adminCreatePlano: (payload: PlanoPayload, token: string) =>
    request<{ data: Plano }>('/admin/planos', { method: 'POST', body: payload, token }),
  adminUpdatePlano: (id: number, payload: PlanoPayload, token: string) =>
    request<{ data: Plano }>(`/admin/planos/${id}`, { method: 'PUT', body: payload, token }),
  adminSetPlanoAtivo: (id: number, ativo: boolean, token: string) =>
    request<{ data: Plano }>(`/admin/planos/${id}/ativo`, { method: 'PUT', body: { ativo }, token }),
  adminDeletePlano: (id: number, token: string) =>
    request<{ ok: boolean }>(`/admin/planos/${id}`, { method: 'DELETE', token }),
  listPlanos: (token: string) => request<{ data: PlanoPublic[] }>('/planos', { token }),
  listPublicPlanos: () => request<{ data: PlanoPublic[] }>('/public/planos'),
  createPagamento: (planoId: number, token: string, codigoCupom?: string | null) =>
    request<{ data: Pagamento }>('/plano/pagamentos', {
      method: 'POST',
      body: { plano_id: planoId, codigo_cupom: codigoCupom ?? undefined },
      token,
    }),
  validarCupom: (codigo: string, planoId: number, token: string) =>
    request<{ data: CupomValidacao }>('/cupons/validar', {
      method: 'POST',
      body: { codigo, plano_id: planoId },
      token,
    }),
  adminListCupons: (token: string) => request<{ data: Cupom[] }>('/admin/cupons', { token }),
  adminCreateCupom: (payload: CupomPayload, token: string) =>
    request<{ data: Cupom }>('/admin/cupons', { method: 'POST', body: payload, token }),
  adminUpdateCupom: (id: number, payload: CupomPayload, token: string) =>
    request<{ data: Cupom }>(`/admin/cupons/${id}`, { method: 'PUT', body: payload, token }),
  adminSetCupomCampanha: (id: number, token: string) =>
    request<{ ok: boolean }>(`/admin/cupons/${id}/campanha`, { method: 'PUT', token }),
  adminDeleteCupom: (id: number, token: string) =>
    request<{ ok: boolean }>(`/admin/cupons/${id}`, { method: 'DELETE', token }),
  createPagamentoCartao: (
    payload: {
      plano_id: number;
      token: string;
      payment_method_id: string;
      installments: number;
      issuer_id?: number | null;
      device_id?: string | null;
      identification?: { type: string; number: string } | null;
      codigo_cupom?: string | null;
    },
    token: string
  ) =>
    request<{ data: Pagamento; user: { status: UserStatus; access_expires_at: string | null } | null }>(
      '/plano/pagamentos/cartao',
      { method: 'POST', body: payload, token }
    ),
  getPagamento: (id: number, token: string) =>
    request<{ data: Pagamento; user: { status: UserStatus; access_expires_at: string | null } | null }>(
      `/plano/pagamentos/${id}`,
      { token }
    ),
  listMolds: (token: string) => request<{ data: MoldSummary[] }>('/molds', { token }),
  getMold: (id: number, token: string) => request<{ data: MoldDetail }>(`/molds/${id}`, { token }),
  createMold: (payload: MoldPayload, token: string) =>
    request<{ data: MoldDetail }>('/molds', { method: 'POST', body: payload, token }),
  updateMold: (id: number, payload: MoldPayload, token: string) =>
    request<{ data: MoldDetail }>(`/molds/${id}`, { method: 'PUT', body: payload, token }),
  copyMold: (id: number, token: string) =>
    request<{ data: MoldDetail }>(`/molds/${id}/copy`, { method: 'POST', token }),
  deleteMold: (id: number, token: string) =>
    request<{ ok: boolean }>(`/molds/${id}`, { method: 'DELETE', token }),
  listModelos3D: (token: string) => request<{ data: Modelo3D[] }>('/modelos-3d', { token }),
  createModelo3D: (payload: Modelo3DPayload, token: string) =>
    request<{ data: Modelo3D }>('/modelos-3d', { method: 'POST', body: payload, token }),
  renameModelo3D: (id: number, nome: string, token: string) =>
    request<{ data: Modelo3D }>(`/modelos-3d/${id}`, { method: 'PUT', body: { nome }, token }),
  setModelo3DHidden: (id: number, hidden: boolean, token: string) =>
    request<{ data: Modelo3D }>(`/modelos-3d/${id}/hidden`, { method: 'PUT', body: { hidden }, token }),
  deleteModelo3D: (id: number, token: string) =>
    request<{ ok: boolean }>(`/modelos-3d/${id}`, { method: 'DELETE', token }),
  listProjects: (token: string) => request<{ data: MoldProjectSummary[] }>('/projects', { token }),
  getProject: (id: number, token: string) => request<{ data: MoldProjectSummary }>(`/projects/${id}`, { token }),
  createProject: (moldId: number, payload: MoldPlotterConfig, token: string) =>
    request<{ data: MoldProjectSummary }>(`/molds/${moldId}/projects`, { method: 'POST', body: payload, token }),
  updateProject: (id: number, payload: MoldPlotterConfig, token: string) =>
    request<{ data: MoldProjectSummary }>(`/projects/${id}`, { method: 'PUT', body: payload, token }),
  deleteProject: (id: number, token: string) =>
    request<{ ok: boolean }>(`/projects/${id}`, { method: 'DELETE', token }),
  listRiscadoProjects: (token: string) =>
    request<{ data: RiscadoProject[] }>('/riscado-projects', { token }),
  getRiscadoProject: (id: number, token: string) =>
    request<{ data: RiscadoProject }>(`/riscado-projects/${id}`, { token }),
  createRiscadoProject: (payload: RiscadoProjectPayload, token: string) =>
    request<{ data: RiscadoProject }>('/riscado-projects', { method: 'POST', body: payload, token }),
  updateRiscadoProject: (id: number, payload: Partial<RiscadoProjectPayload> & { state: RiscadoProject['state'] }, token: string) =>
    request<{ data: RiscadoProject }>(`/riscado-projects/${id}`, { method: 'PUT', body: payload, token }),
  deleteRiscadoProject: (id: number, token: string) =>
    request<{ ok: boolean }>(`/riscado-projects/${id}`, { method: 'DELETE', token }),

  listLanternaProjects: (token: string) =>
    request<{ data: LanternaProject[] }>('/lanterna-projects', { token }),
  getLanternaProject: (id: number, token: string) =>
    request<{ data: LanternaProject }>(`/lanterna-projects/${id}`, { token }),
  createLanternaProject: (payload: LanternaProjectPayload, token: string) =>
    request<{ data: LanternaProject }>('/lanterna-projects', { method: 'POST', body: payload, token }),
  updateLanternaProject: (id: number, payload: Partial<LanternaProjectPayload> & { state: LanternaProject['state'] }, token: string) =>
    request<{ data: LanternaProject }>(`/lanterna-projects/${id}`, { method: 'PUT', body: payload, token }),
  deleteLanternaProject: (id: number, token: string) =>
    request<{ ok: boolean }>(`/lanterna-projects/${id}`, { method: 'DELETE', token }),
  listBandeiras: (token: string) => request<{ data: BandeiraSummary[] }>('/bandeiras', { token }),
  getBandeira: (id: number, token: string) => request<{ data: BandeiraSummary }>(`/bandeiras/${id}`, { token }),
  createBandeira: (payload: BandeiraPayload, token: string) =>
    request<{ data: BandeiraSummary }>('/bandeiras', { method: 'POST', body: payload, token }),
  updateBandeira: (id: number, payload: BandeiraPayload, token: string) =>
    request<{ data: BandeiraSummary }>(`/bandeiras/${id}`, { method: 'PUT', body: payload, token }),
  deleteBandeira: (id: number, token: string) =>
    request<{ ok: boolean }>(`/bandeiras/${id}`, { method: 'DELETE', token }),
  listRifas: (token: string) => request<{ data: Rifa[] }>('/rifas', { token }),
  getRifa: (id: number, token: string) => request<{ data: RifaDetail }>(`/rifas/${id}`, { token }),
  updateRifa: (
    id: number,
    payload: {
      nome: string;
      descricao: string;
      valor_numero: number;
      modo_sorteio: string;
      modo_termino: string;
      data_termino: string | null;
      whatsapp_contato: string;
      chave_pix: string;
    },
    token: string
  ) => request<{ data: Rifa }>(`/rifas/${id}`, { method: 'PUT', body: payload, token }),
  deleteRifa: (id: number, token: string) => request<{ ok: boolean }>(`/rifas/${id}`, { method: 'DELETE', token }),
  confirmarPagamentoManual: (rifaId: number, compradorId: number, token: string) =>
    request<{ data: RifaComprador }>(`/rifas/${rifaId}/compradores/${compradorId}/confirmar`, {
      method: 'PUT',
      token,
    }),
  recusarPagamento: (rifaId: number, compradorId: number, token: string) =>
    request<{ data: RifaComprador }>(`/rifas/${rifaId}/compradores/${compradorId}/recusar`, {
      method: 'PUT',
      token,
    }),
  criarVendaManual: (
    rifaId: number,
    payload: { nome: string; whatsapp: string; email?: string; numeros: number[]; ja_pago: boolean },
    token: string
  ) => request<{ data: RifaComprador }>(`/rifas/${rifaId}/vendas`, { method: 'POST', body: payload, token }),
  sortear: (rifaId: number, token: string) => request<{ data: Rifa }>(`/rifas/${rifaId}/sortear`, { method: 'POST', token }),
  listPromocoes: (rifaId: number, token: string) => request<{ data: RifaPromocao[] }>(`/rifas/${rifaId}/promocoes`, { token }),
  createPromocao: (
    rifaId: number,
    payload: { tipo: 'pacote' | 'faixa'; quantidade: number; valor_total?: number; valor_unidade?: number; ativo: boolean },
    token: string
  ) => request<{ data: RifaPromocao }>(`/rifas/${rifaId}/promocoes`, { method: 'POST', body: payload, token }),
  updatePromocao: (
    rifaId: number,
    promocaoId: number,
    payload: { tipo: 'pacote' | 'faixa'; quantidade: number; valor_total?: number; valor_unidade?: number; ativo: boolean },
    token: string
  ) =>
    request<{ data: RifaPromocao }>(`/rifas/${rifaId}/promocoes/${promocaoId}`, { method: 'PUT', body: payload, token }),
  deletePromocao: (rifaId: number, promocaoId: number, token: string) =>
    request<{ ok: boolean }>(`/rifas/${rifaId}/promocoes/${promocaoId}`, { method: 'DELETE', token }),
  // Pagina publica da rifa — sem token, quem abre o link nunca fez login.
  getRifaPublica: (slug: string) => request<{ data: Rifa }>(`/public/rifas/${slug}`),
  reservarNumeros: (slug: string, payload: { nome: string; whatsapp: string; email?: string; numeros: number[] }) =>
    request<{ data: RifaReservaResponse }>(`/public/rifas/${slug}/reservar`, { method: 'POST', body: payload }),
  getStatusComprador: (compradorId: number) =>
    request<{ data: { status: string; numeros: number[] } }>(`/public/rifas/compradores/${compradorId}/status`),
  getMeusNumeros: (slug: string, whatsapp: string) =>
    request<{ data: { numeros: number[] } }>(`/public/rifas/${slug}/meus-numeros?whatsapp=${encodeURIComponent(whatsapp)}`),

  // Loja — admin (aba "Loja").
  adminListLojaProdutos: (token: string) => request<{ data: LojaProdutoAdmin[] }>('/admin/loja/produtos', { token }),
  adminGetLojaProduto: (id: number, token: string) =>
    request<{ data: LojaProdutoAdmin }>(`/admin/loja/produtos/${id}`, { token }),
  adminUpdateLojaProduto: (id: number, payload: LojaProdutoPayload, token: string) =>
    request<{ data: LojaProdutoAdmin }>(`/admin/loja/produtos/${id}`, { method: 'PUT', body: payload, token }),
  adminDeleteLojaProduto: (id: number, token: string) =>
    request<{ ok: boolean }>(`/admin/loja/produtos/${id}`, { method: 'DELETE', token }),

  // Loja — vitrine publica (/loja), sem token, o comprador nunca faz login.
  listLojaProdutosPublic: () => request<{ data: LojaProdutoPublic[] }>('/public/loja/produtos'),
  getLojaProdutoPublic: (id: number) => request<{ data: LojaProdutoPublic }>(`/public/loja/produtos/${id}`),
  comprarLojaProduto: (id: number, email: string) =>
    request<{ data: LojaPagamento }>(`/public/loja/produtos/${id}/comprar`, { method: 'POST', body: { email } }),
  getLojaPagamentoStatus: (id: number) => request<{ data: LojaPagamento }>(`/public/loja/pagamentos/${id}/status`),

  // Comunicados / Comunicação
  adminListComunicados: (token: string) =>
    request<{ data: Comunicado[] }>('/admin/comunicados', { token }),
  adminCreateComunicado: (payload: { titulo: string; conteudo: string; send_email_to: 'all' | 'selected'; emails?: string[] }, token: string) =>
    request<{ data: Comunicado; email_stats: { sent: number; failed: number } }>('/admin/comunicados', {
      method: 'POST',
      body: payload,
      token,
    }),
  getPendingComunicado: (token: string) =>
    request<{ data: Comunicado | null }>('/comunicados/pending', { token }),
  markComunicadoAsRead: (id: number, token: string) =>
    request<{ ok: boolean }>(`/comunicados/${id}/read`, { method: 'POST', token }),

  // Notificações do admin (histórico de vendas) + Web Push
  adminListNotificacoes: (token: string) =>
    request<{ data: Notificacao[] }>('/admin/notificacoes', { token }),
  adminGetPendingNotificacoes: (token: string) =>
    request<{ data: Notificacao[]; count: number }>('/admin/notificacoes/pending', { token }),
  adminMarkNotificacaoRead: (id: number, token: string) =>
    request<{ ok: boolean }>(`/admin/notificacoes/${id}/read`, { method: 'POST', token }),
  adminMarkAllNotificacoesRead: (token: string) =>
    request<{ ok: boolean }>('/admin/notificacoes/read-all', { method: 'POST', token }),
  adminGetVapidPublicKey: (token: string) =>
    request<{ data: { public_key: string } }>('/admin/push/vapid-public-key', { token }),
  adminSubscribePush: (
    payload: { endpoint: string; keys: { p256dh: string; auth: string } },
    token: string
  ) => request<{ ok: boolean }>('/admin/push/subscribe', { method: 'POST', body: payload, token }),
  adminUnsubscribePush: (endpoint: string, token: string) =>
    request<{ ok: boolean }>('/admin/push/unsubscribe', { method: 'POST', body: { endpoint }, token }),

  // ===== Solicitação de molde sob encomenda =====
  // Público (sem login):
  solicitacaoConfig: () =>
    request<{ data: SolicitacaoConfigPublic }>('/public/solicitacao-molde/config'),
  solicitacaoCriar: (payload: { modelo_key: string; categoria: string; modelo_nome: string; tamanho_cm: number; gomos: number; bainha_cm: number; email: string }) =>
    request<{ data: SolicitacaoPedido }>('/public/solicitacao-molde', { method: 'POST', body: payload }),
  solicitacaoCriarCartao: (payload: {
    modelo_key: string; categoria: string; modelo_nome: string; tamanho_cm: number; gomos: number; bainha_cm: number; email: string;
    token: string; payment_method_id: string; installments: number; issuer_id: number | null; device_id: string | null; identification: { type: string; number: string };
  }) => request<{ data: SolicitacaoPedido }>('/public/solicitacao-molde/cartao', { method: 'POST', body: payload }),
  solicitacaoStatus: (id: number, token: string) =>
    request<{ data: SolicitacaoPedido }>(`/public/solicitacao-molde/${id}/status`, { method: 'POST', body: { token } }),
  solicitacaoCancelar: (id: number, token: string) =>
    request<{ ok: boolean }>(`/public/solicitacao-molde/${id}/cancelar`, { method: 'POST', body: { token } }),
  solicitacaoRecuperar: (chave: string) =>
    request<{ data: SolicitacaoPedido }>('/public/solicitacao-molde/recuperar', { method: 'POST', body: { chave } }),
  solicitacaoSimularPago: (id: number, token: string) =>
    request<{ data: SolicitacaoPedido }>(`/public/solicitacao-molde/${id}/simular-pago`, { method: 'POST', body: { token } }),
  solicitacaoAtualizarDados: (id: number, token: string, dados: { modelo_key: string; categoria: string; modelo_nome: string; gomos: number; bainha_cm: number }) =>
    request<{ data: SolicitacaoPedido }>(`/public/solicitacao-molde/${id}/dados`, { method: 'POST', body: { token, ...dados } }),
  solicitacaoSalvarTacos: (id: number, token: string, config: unknown) =>
    request<{ ok: boolean }>(`/public/solicitacao-molde/${id}/tacos`, { method: 'POST', body: { token, config } }),
  solicitacaoEntregar: (
    id: number,
    token: string,
    pdfBase64: string,
    filename: string,
    resumo?: string,
    tiled?: { a4?: { base64: string; filename: string }; a3?: { base64: string; filename: string } }
  ) =>
    request<{ data: SolicitacaoPedido }>(`/public/solicitacao-molde/${id}/entregar`, {
      method: 'POST',
      body: {
        token,
        pdf_base64: pdfBase64,
        filename,
        resumo,
        pdf_a4_base64: tiled?.a4?.base64,
        filename_a4: tiled?.a4?.filename,
        pdf_a3_base64: tiled?.a3?.base64,
        filename_a3: tiled?.a3?.filename,
      },
    }),
  // Admin:
  adminSolicitacaoConfig: (token: string) =>
    request<{ data: AdminSolicitacaoConfig }>('/admin/solicitacao-molde/config', { token }),
  adminSolicitacaoUpdateConfig: (payload: { valor_metro: number; video_url: string; ativo: boolean }, token: string) =>
    request<{ ok: boolean }>('/admin/solicitacao-molde/config', { method: 'PUT', body: payload, token }),
  adminSolicitacaoEnviarChave: (payload: { email: string }, token: string) =>
    request<{ ok: boolean; chave: string | null }>('/admin/solicitacao-molde/enviar-chave', { method: 'POST', body: payload, token }),
  adminSolicitacaoConsultarChave: (chave: string, token: string) =>
    request<{ data: SolicitacaoChaveConsulta }>('/admin/solicitacao-molde/consultar-chave', { method: 'POST', body: { chave }, token }),
  solicitacaoDefinirDados: (id: number, token: string, dados: { modelo_key: string; categoria: string; modelo_nome: string; tamanho_cm: number; gomos: number; bainha_cm: number }) =>
    request<{ data: SolicitacaoPedido }>(`/public/solicitacao-molde/${id}/definir-dados`, { method: 'POST', body: { token, ...dados } }),
  // Push do USUARIO (qualquer logado) — pra receber os comunicados no navegador/app.
  getVapidPublicKey: (token: string) =>
    request<{ data: { public_key: string } }>('/push/vapid-public-key', { token }),
  subscribePush: (
    payload: { endpoint: string; keys: { p256dh: string; auth: string } },
    token: string
  ) => request<{ ok: boolean }>('/push/subscribe', { method: 'POST', body: payload, token }),
  unsubscribePush: (endpoint: string, token: string) =>
    request<{ ok: boolean }>('/push/unsubscribe', { method: 'POST', body: { endpoint }, token }),
};

/** Criacao de rifa manda texto + as 3 fotos juntos (multipart) — primeiro form
 * do sistema que faz upload de arquivo persistido de verdade. */
export async function createRifa(formData: FormData, token: string): Promise<Rifa> {
  const response = await fetch(`${API_BASE}/rifas`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
  });

  let data: unknown = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }

  if (!response.ok) {
    const payload = (data ?? {}) as { error?: string; errors?: Record<string, string> };
    throw new ApiError(payload.error ?? 'Nao foi possivel criar a rifa.', response.status, payload.errors);
  }

  return (data as { data: Rifa }).data;
}

/** Criacao de produto da Loja manda texto + as 4 imagens juntos (multipart)
 * -- mesmo padrao de createRifa. */
export async function createLojaProduto(formData: FormData, token: string): Promise<LojaProdutoAdmin> {
  const response = await fetch(`${API_BASE}/admin/loja/produtos`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
  });

  let data: unknown = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }

  if (!response.ok) {
    const payload = (data ?? {}) as { error?: string; errors?: Record<string, string> };
    throw new ApiError(payload.error ?? 'Nao foi possivel criar o produto.', response.status, payload.errors);
  }

  return (data as { data: LojaProdutoAdmin }).data;
}

export async function importMoldPdf(file: File, token: string): Promise<ImportedMoldData> {
  const formData = new FormData();
  formData.append('pdf', file);

  const response = await fetch(`${API_BASE}/pattern/import-pdf`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
  });

  let data: unknown = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }

  if (!response.ok) {
    const payload = (data ?? {}) as { error?: string };
    throw new ApiError(payload.error ?? 'Nao foi possivel importar o PDF.', response.status);
  }

  return (data as { data: ImportedMoldData }).data;
}

export async function sendProjectEmail(
  projectId: number,
  formData: FormData,
  token: string
): Promise<{ ok: boolean }> {
  const response = await fetch(`${API_BASE}/projects/${projectId}/send-email`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
  });

  let data: unknown = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }

  if (!response.ok) {
    const payload = (data ?? {}) as { error?: string };
    throw new ApiError(payload.error ?? 'Nao foi possivel enviar o email.', response.status);
  }

  return data as { ok: boolean };
}

/** Nao depende de a bandeira ja estar salva — o PDF vem pronto (gerado no
 * navegador, igual ao "Baixar PDF") dentro do FormData. */
export async function sendBandeiraEmail(formData: FormData, token: string): Promise<{ ok: boolean }> {
  const response = await fetch(`${API_BASE}/bandeiras/send-email`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
  });

  let data: unknown = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }

  if (!response.ok) {
    const payload = (data ?? {}) as { error?: string };
    throw new ApiError(payload.error ?? 'Nao foi possivel enviar o email.', response.status);
  }

  return data as { ok: boolean };
}

/** Nao depende de o painel ja estar salvo — o PDF vem pronto (gerado no
 * navegador, igual ao "Baixar PDF") dentro do FormData. */
export async function sendPainelEmail(formData: FormData, token: string): Promise<{ ok: boolean }> {
  const response = await fetch(`${API_BASE}/paineis/send-email`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
  });

  let data: unknown = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }

  if (!response.ok) {
    const payload = (data ?? {}) as { error?: string };
    throw new ApiError(payload.error ?? 'Nao foi possivel enviar o email.', response.status);
  }

  return data as { ok: boolean };
}
