export type UserRole = 'admin' | 'user';
export type UserStatus = 'active' | 'blocked' | 'pending_payment';

export interface User {
  id: number;
  name: string;
  email: string;
  role: UserRole;
  status: UserStatus;
  access_expires_at?: string | null;
  created_at?: string | null;
}

export interface SystemSettings {
  telegram: string | null;
  instagram: string | null;
  whatsapp: string | null;
  hidden_nav_items: string[];
  mercado_pago_public_key: string | null;
  mercado_pago_access_token_configured: boolean;
}

export interface Plano {
  id: number;
  nome: string;
  valor: number;
  dias_acesso: number;
  ativo: boolean;
  created_by: { id: number; name: string };
  updated_by: { id: number; name: string };
  created_at: string;
  updated_at: string;
}

export interface PlanoPublic {
  id: number;
  nome: string;
  valor: number;
  dias_acesso: number;
}

export interface PlanoPayload {
  nome: string;
  valor: number;
  dias_acesso: number;
}

export type PagamentoStatus = 'pendente' | 'aprovado' | 'rejeitado';

export interface Pagamento {
  id: number;
  plano_id: number;
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
