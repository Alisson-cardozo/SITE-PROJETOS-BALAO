import type {
  AuthResponse,
  BandeiraPayload,
  BandeiraSummary,
  ImportedMoldData,
  Modelo3D,
  Modelo3DPayload,
  MoldDetail,
  MoldPayload,
  MoldPlotterConfig,
  MoldProjectSummary,
  MoldSummary,
  Rifa,
  RifaComprador,
  RifaDetail,
  RifaPromocao,
  RifaReservaResponse,
  User,
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
  logout: (token: string) => request<{ ok: boolean }>('/auth/logout', { method: 'POST', token }),
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
