import type { RiscadoProjectState } from '../types';

const PREFIX = 'riscado_project_autosave_v1_';

export interface RiscadoLocalDraft {
  projectId: number;
  updatedAt: string;
  nome: string;
  modelo_key: string;
  modelo_nome: string;
  altura_cm: number;
  quantidade_gomos: number;
  bainha_cm: number;
  state: RiscadoProjectState;
}

function key(projectId: number): string {
  return `${PREFIX}${projectId}`;
}

export function saveRiscadoLocalDraft(draft: RiscadoLocalDraft): void {
  try {
    localStorage.setItem(key(draft.projectId), JSON.stringify(draft));
  } catch {
    // quota / private mode — ignora; o save no servidor ainda roda
  }
}

export function loadRiscadoLocalDraft(projectId: number): RiscadoLocalDraft | null {
  try {
    const raw = localStorage.getItem(key(projectId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as RiscadoLocalDraft;
    if (!parsed || parsed.projectId !== projectId || !parsed.state) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearRiscadoLocalDraft(projectId: number): void {
  try {
    localStorage.removeItem(key(projectId));
  } catch {
    // ignore
  }
}

/** true se o draft local e mais novo que updatedAt do servidor (string ISO ou SQL). */
export function isLocalDraftNewer(localUpdatedAt: string, serverUpdatedAt: string): boolean {
  const a = Date.parse(localUpdatedAt.replace(' ', 'T'));
  const b = Date.parse(serverUpdatedAt.replace(' ', 'T'));
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  return a > b + 500;
}
