export type UserRole = 'admin' | 'user';
export type UserStatus = 'active' | 'blocked' | 'pending_payment';

export interface User {
  id: number;
  name: string;
  email: string;
  role: UserRole;
  status: UserStatus;
  access_expires_at?: string | null;
  plano_id?: number | null;
  plano_nome?: string | null;
  plano_valor?: number | null;
  /** Ids de aba que o plano atual libera. null = sem restricao (admin, ou
   * plano que libera tudo) -- ver PlanoService::abasForPlanoId no backend. */
  allowed_abas?: string[] | null;
  created_at?: string | null;
  active_session_id?: string | null;
  session_device?: string | null;
  session_created_at?: string | null;
  last_activity?: string | null;
  is_online?: boolean;
}

export interface TutorialConfig {
  show: boolean;
  video_url: string;
}

export interface SystemSettings {
  telegram: string | null;
  instagram: string | null;
  whatsapp: string | null;
  hidden_nav_items: string[];
  /** Rotulo opcional por aba escondida (ex.: {"profissionais":"Em breve"}) —
   * so faz sentido pra ids que tambem estao em hidden_nav_items. */
  nav_item_labels: Record<string, string>;
  mercado_pago_public_key: string | null;
  mercado_pago_access_token_configured: boolean;
  tutorials?: Record<string, TutorialConfig> | null;
}

export interface Plano {
  id: number;
  nome: string;
  valor: number;
  dias_acesso: number;
  ativo: boolean;
  /** Ids de aba (PLANO_ABA_GROUPS) que esse plano libera. Sempre uma lista
   * concreta -- o backend ja resolve "sem abas_json" pra lista completa. */
  abas: string[];
  created_by: { id: number; name: string };
  updated_by: { id: number; name: string };
  created_at: string;
  updated_at: string;
  show_in_ranking?: boolean;
  sales_override_count?: number;
}

export interface PlanoPublic {
  id: number;
  nome: string;
  valor: number;
  dias_acesso: number;
  abas: string[];
  show_in_ranking?: boolean;
  sales_override_count?: number;
}

export interface PlanoPayload {
  nome: string;
  valor: number;
  dias_acesso: number;
  abas: string[];
  show_in_ranking: boolean;
  sales_override_count: number;
}

export type PagamentoStatus = 'pendente' | 'aprovado' | 'rejeitado';

export type PagamentoMetodo = 'pix' | 'cartao';

export interface Pagamento {
  id: number;
  plano_id: number;
  valor: number;
  status: PagamentoStatus;
  /** Como foi cobrado. Pix gera qr_code; cartao resolve na hora (sem QR). */
  metodo?: PagamentoMetodo;
  /** Numero de parcelas do cartao (Pix e sempre 1). */
  parcelas?: number;
  qr_code: string | null;
  qr_code_base64: string | null;
  created_at: string;
  paid_at: string | null;
}

/** "disponivel" -> "reservado" (Pix pendente de 1 comprador) -> "vendido"
 * (pago, nunca mais volta a ficar disponivel) -- ver LojaProdutoService. */
export type LojaProdutoStatus = 'disponivel' | 'reservado' | 'vendido';

/** Vitrine publica (/loja) -- nunca expoe link_arquivo nem quem reservou/comprou. */
export interface LojaProdutoPublic {
  id: number;
  nome: string;
  descricao: string;
  valor: number;
  imagens: string[];
  status: LojaProdutoStatus;
}

/** Visao do admin (aba "Loja") -- inclui o link dos arquivos e quem comprou. */
export interface LojaProdutoAdmin {
  id: number;
  nome: string;
  descricao: string;
  valor: number;
  link_arquivo: string;
  imagens: string[];
  status: LojaProdutoStatus;
  reservado_email: string | null;
  reserva_expira_em: string | null;
  comprador_email: string | null;
  vendido_em: string | null;
  created_by: string;
  updated_by: string;
  created_at: string;
  updated_at: string;
}

export interface LojaProdutoPayload {
  nome: string;
  descricao: string;
  valor: number;
  link_arquivo: string;
}

/** Pix da Loja -- mesmo formato de Pagamento, so que o produto e um item
 * unico (produto_id), nao um plano recorrente. */
export interface LojaPagamento {
  id: number;
  produto_id: number;
  valor: number;
  status: PagamentoStatus;
  qr_code: string | null;
  qr_code_base64: string | null;
  created_at: string;
  paid_at: string | null;
}

export interface AuthResponse {
  user: User;
  token: string;
}

export interface ImportedMoldPoint {
  altura_cm: number;
  largura_meia_cm: number;
}

export interface ImportedMoldData {
  nome_molde: string;
  modelo: string;
  quantidade_gomos: number;
  bainha_cm: number;
  pontos: ImportedMoldPoint[];
}

export interface MoldUserRef {
  id: number;
  name: string;
}

export interface MoldPoint {
  altura_cm: number;
  largura_meia_cm: number;
}

export interface MoldTacoPartitionData {
  id: string;
  tacosPorGomo: number;
  alturaTacoCm: number;
  tacosSubindo?: number;
  peso: number;
  cor: string;
  corDivisao: string;
}

export interface MoldPlotterConfig {
  section_colors: Record<'boca' | 'bojo' | 'bico', string>;
  section_ratios: { boca: number; bojo: number; bico: number };
  taco_configs: Record<'boca' | 'bojo' | 'bico', { partitions: MoldTacoPartitionData[] }>;
}

export interface MoldSummary {
  id: number;
  nome: string;
  modelo: string;
  quantidade_gomos: number;
  bainha_cm: number;
  altura_total_cm: number;
  pontos_count: number;
  pontos: MoldPoint[];
  created_by: MoldUserRef;
  updated_by: MoldUserRef;
  created_at: string;
  updated_at: string;
  can_delete: boolean;
  can_edit: boolean;
  can_copy: boolean;
}

export interface MoldDetail extends MoldSummary {}

export interface MoldPayload {
  nome: string;
  modelo: string;
  quantidade_gomos: number;
  bainha_cm: number;
  pontos: MoldPoint[];
}

/** Modelo de referencia so pra preview 3D (aba "3D e Fotos") — separado dos
 * moldes de corte/plotagem, ver comentario em database/schema.sql. */
export interface Modelo3D {
  id: number;
  nome: string;
  quantidade_gomos: number;
  altura_total_cm: number;
  pontos: MoldPoint[];
  hidden: boolean;
  can_edit: boolean;
  can_delete: boolean;
  created_by: MoldUserRef;
  updated_by: MoldUserRef;
  created_at: string;
  updated_at: string;
}

export interface Modelo3DPayload {
  nome: string;
  quantidade_gomos: number;
  pontos: MoldPoint[];
}

export type RifaModoSorteio = 'caixa_federal' | 'sistema';
export type RifaModoTermino = 'data' | 'vender_tudo';
export type RifaFormaRecebimento = 'manual' | 'mercado_pago';
export type RifaStatus = 'ativa' | 'finalizada' | 'cancelada';
export type RifaCompradorStatus = 'aguardando_pagamento' | 'pago' | 'expirado' | 'cancelado';

export interface Rifa {
  id: number;
  nome: string;
  slug: string;
  descricao: string;
  fotos: Array<string | null>;
  valor_numero: number;
  quantidade_numeros: number;
  modo_sorteio: RifaModoSorteio;
  modo_termino: RifaModoTermino;
  data_termino: string | null;
  forma_recebimento: RifaFormaRecebimento;
  whatsapp_contato: string | null;
  chave_pix: string | null;
  status: RifaStatus;
  numero_sorteado: number | null;
  vencedor_nome: string | null;
  /** So vem preenchido pro dono (rotas autenticadas) — nunca no endpoint publico. */
  vencedor_whatsapp?: string | null;
  sorteado_em: string | null;
  disponiveis: number;
  reservados: number;
  vendidos: number;
  percentual_vendido: number;
  numeros_ocupados: number[];
  promocoes: RifaPromocao[];
  valor_arrecadado?: number;
  created_at: string;
  updated_at: string;
}

export type RifaPromocaoTipo = 'pacote' | 'faixa';

export interface RifaPromocao {
  id: number;
  tipo: RifaPromocaoTipo;
  quantidade: number;
  valor_total: number | null;
  valor_unidade: number | null;
  ativo: boolean;
}

export interface RifaComprador {
  id: number;
  rifa_id: number;
  nome: string;
  whatsapp: string;
  email: string | null;
  quantidade_numeros: number;
  valor_total: string | number;
  forma_pagamento: RifaFormaRecebimento;
  status: RifaCompradorStatus;
  mp_payment_id: string | null;
  expira_em: string | null;
  pago_em: string | null;
  created_at: string;
  updated_at: string;
}

export interface RifaCompradorDetail extends RifaComprador {
  numeros: number[];
}

export interface RifaDetail extends Rifa {
  compradores: RifaCompradorDetail[];
}

export interface RifaReservaResponse {
  comprador_id: number;
  numeros: number[];
  expira_em: string | null;
  whatsapp_contato: string | null;
  chave_pix: string | null;
}

/**
 * Um projeto = uma configuracao de plotter (cores, tacos, reparticoes,
 * proporcoes) salva pra um molde. Um molde pode ter varios projetos —
 * plotar de novo sempre cria um projeto novo, nunca sobrescreve um existente.
 */
export interface MoldProjectSummary {
  id: number;
  mold_id: number;
  project_number: number;
  /** Nome do molde + numero se nao for o 1o projeto desse molde (ex: "JZ10 (2)"). */
  display_nome: string;
  nome: string;
  modelo: string;
  quantidade_gomos: number;
  bainha_cm: number;
  altura_total_cm: number;
  pontos: MoldPoint[];
  plotter_config: MoldPlotterConfig;
  created_by: MoldUserRef;
  updated_by: MoldUserRef;
  created_at: string;
  updated_at: string;
  can_edit: boolean;
  can_delete: boolean;
}

/** Poligonos + linhas do molde (cm) + bounds do PNG — recorte/wrap/linhas na aba Criar. */
export interface MoldMaskData {
  export_min_x: number;
  export_min_y: number;
  export_w: number;
  export_h: number;
  content_min_x: number;
  content_max_x: number;
  content_min_y: number;
  content_max_y: number;
  paths: number[][][];
  /** Costuras entre gomos [[x,y],[x,y]] */
  seams?: number[][][];
  /** Estacoes horizontais do perfil */
  stations?: number[][][];
  /** Linhas de guia/grade */
  guides?: number[][][];
  /** Contorno da boca */
  mouth_edges?: number[][][];
  equator_y?: number | null;
  /** Silhueta continua precomputada */
  silhouette?: { left: number[][]; right: number[][] };
}

/** Cores das linhas desenhadas por cima da arte. */
export interface MoldLineColors {
  gomo: string;
  guide: string;
  equator: string;
  mouth: string;
  outline: string;
}

/** Estado serializado do Lek + canvas da aba Criar. */
export interface RiscadoProjectState {
  lek?: Record<string, unknown>;
  canvas?: {
    objects?: unknown[];
    bgColor?: string;
    showGrid?: boolean;
    line_colors?: MoldLineColors;
    show_mold_lines?: boolean;
  };
  snapshot_svg?: string;
  mold_image_png?: string;
  mold_image_filename?: string;
  mold_mask?: MoldMaskData | null;
  [key: string]: unknown;
}

/** Projeto do Plotter Riscado (Meus Projetos > Moldes Riscados). */
export interface RiscadoProject {
  id: number;
  nome: string;
  modelo_key: string;
  modelo_nome: string;
  altura_cm: number;
  quantidade_gomos: number;
  bainha_cm: number;
  state: RiscadoProjectState;
  created_by: MoldUserRef;
  updated_by: MoldUserRef;
  created_at: string;
  updated_at: string;
  can_edit: boolean;
  can_delete: boolean;
}

export interface RiscadoProjectPayload {
  nome: string;
  modelo_key: string;
  modelo_nome: string;
  altura_cm: number;
  quantidade_gomos: number;
  bainha_cm: number;
  state: RiscadoProjectState;
}

/** Estado serializado da grade de Lanternagem de Bojo — nao e imagem, e o
 * arquivo editavel que reabre na mesma tela pra continuar o desenho. */
export interface LanternaProjectState {
  colors: string[];
  gridWidth: number;
  gridHeight: number;
  gridGomos: number;
  gridLanternasPorGomo: number;
  gridLanternasSubindo: number;
  bolinha?: boolean;
  showFineGrid?: boolean;
  fineGridColor?: string;
  showGomoLines?: boolean;
  gomoLineColor?: string;
  showDivisaoLines?: boolean;
  divisaoCount?: number;
  divisaoLineColor?: string;
  showNumbers?: boolean;
  [key: string]: unknown;
}

/** Projeto de Lanternagem de Bojo (Meus Projetos > Lanternagem de Bojo). */
export interface LanternaProject {
  id: number;
  nome: string;
  gomos: number;
  lanternas_por_gomo: number;
  lanternas_subindo: number;
  state: LanternaProjectState;
  created_by: MoldUserRef;
  updated_by: MoldUserRef;
  created_at: string;
  updated_at: string;
  can_edit: boolean;
  can_delete: boolean;
}

export interface LanternaProjectPayload {
  nome: string;
  gomos: number;
  lanternas_por_gomo: number;
  lanternas_subindo: number;
  state: LanternaProjectState;
}

export interface BandeiraColorEntry {
  hex: string;
  name: string;
  count: number;
}

/** [cor, quantas vezes seguidas] — grade comprimida (RLE), linha a linha. */
export type BandeiraGridRun = [string, number];

export interface BandeiraSummary {
  id: number;
  nome: string;
  largura_cm: number;
  altura_cm: number;
  largura_px: number;
  altura_px: number;
  grid_runs: BandeiraGridRun[];
  color_table: BandeiraColorEntry[];
  created_by: MoldUserRef;
  updated_by: MoldUserRef;
  created_at: string;
  updated_at: string;
  can_edit: boolean;
  can_delete: boolean;
}

export interface BandeiraPayload {
  nome: string;
  largura_cm: number;
  altura_cm: number;
  largura_px: number;
  altura_px: number;
  grid_runs: BandeiraGridRun[];
  color_table: BandeiraColorEntry[];
}

export interface Comunicado {
  id: number;
  titulo: string;
  conteudo: string;
  created_at: string;
  total_views?: number;
}

export interface NotificacaoDados {
  cliente_nome?: string;
  cliente_email?: string;
  plano_nome?: string;
  valor?: number;
  metodo?: string;
  metodo_label?: string;
  pagamento_id?: number;
}

export interface Notificacao {
  id: number;
  tipo: string;
  titulo: string;
  mensagem: string;
  dados: NotificacaoDados | null;
  lida: boolean;
  created_at: string;
}
