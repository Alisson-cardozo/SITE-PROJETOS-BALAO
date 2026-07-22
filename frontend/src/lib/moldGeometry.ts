import type { MoldPoint } from '../types';

export interface ProfilePoint {
  yCm: number;
  halfWidthCm: number;
}

export interface MoldSection {
  id: 'boca' | 'bojo' | 'bico';
  nome: string;
  /** Altura acumulada inicial (do pe da boca para cima). */
  inicioCm: number;
  /** Altura acumulada final. */
  fimCm: number;
  alturaCm: number;
  percentual: number;
  cor: string;
}

export interface MoldProfile {
  points: ProfilePoint[];
  alturaTotalCm: number;
  larguraMaximaCm: number;
  larguraBocaCm: number;
  secoes: MoldSection[];
}

/** Boca 25% embaixo, bico 30% em cima, bojo o restante (45%). */
export const SECTION_RULES = {
  boca: 0.25,
  bico: 0.3,
} as const;

/** Fracoes de altura Boca / Bojo / Bico (sempre somam 1 apos normalizar). */
export interface SectionRatios {
  boca: number;
  bojo: number;
  bico: number;
}

export const DEFAULT_SECTION_RATIOS: SectionRatios = {
  boca: SECTION_RULES.boca,
  bojo: 1 - SECTION_RULES.boca - SECTION_RULES.bico,
  bico: SECTION_RULES.bico,
};

/** Minimo de fracao de altura por secao (evita zerar Boca/Bojo/Bico). */
export const MIN_SECTION_RATIO = 0.05;

export const SECTION_COLORS: Record<MoldSection['id'], string> = {
  // Cores no formato da referencia visual (bico amarelo no topo, bojo ciano, boca rosa embaixo)
  bico: '#f4e64a',
  bojo: '#77e6f2',
  boca: '#f062b8',
};

/** Nomes de exibicao das secoes, na ordem visual de cima (bico) pra baixo (boca). */
export const SECTION_LABELS: Record<MoldSection['id'], string> = {
  bico: 'Bico',
  bojo: 'Bojo',
  boca: 'Boca',
};

export const SECTION_ORDER: Array<MoldSection['id']> = ['bico', 'bojo', 'boca'];

export function normalizeSectionRatios(ratios: SectionRatios): SectionRatios {
  const boca = Math.max(0, Number(ratios.boca) || 0);
  const bojo = Math.max(0, Number(ratios.bojo) || 0);
  const bico = Math.max(0, Number(ratios.bico) || 0);
  const sum = boca + bojo + bico;
  if (sum <= 0) {
    return { ...DEFAULT_SECTION_RATIOS };
  }
  return {
    boca: boca / sum,
    bojo: bojo / sum,
    bico: bico / sum,
  };
}

/**
 * Ajusta a fracao de `changed` para `nextRatio` (0–1),
 * tirando/devolvendo do `donor` (ex.: Boca↔Bojo). O terceiro fica fixo.
 */
export function rebalanceSectionRatios(
  current: SectionRatios,
  changed: MoldSection['id'],
  nextRatio: number,
  donor: MoldSection['id']
): SectionRatios {
  if (changed === donor) {
    return normalizeSectionRatios(current);
  }
  const cur = normalizeSectionRatios(current);
  const fixedId = (['boca', 'bojo', 'bico'] as const).find((id) => id !== changed && id !== donor)!;
  const fixed = cur[fixedId];
  const pool = Math.max(0, 1 - fixed);
  const minR = Math.min(MIN_SECTION_RATIO, pool / 2);
  const maxR = Math.max(minR, pool - minR);
  const nextChanged = Math.min(maxR, Math.max(minR, nextRatio));
  const nextDonor = pool - nextChanged;
  return normalizeSectionRatios({
    ...cur,
    [changed]: nextChanged,
    [donor]: nextDonor,
    [fixedId]: fixed,
  });
}

export function buildProfilePoints(pontos: MoldPoint[]): ProfilePoint[] {
  let acumulada = 0;
  return pontos.map((point, index) => {
    const altura = Number(point.altura_cm) || 0;
    acumulada = index === 0 ? altura : acumulada + altura;
    return {
      yCm: round1(acumulada),
      halfWidthCm: round1(Number(point.largura_meia_cm) || 0),
    };
  });
}

export function interpolateHalfWidth(yCm: number, profile: ProfilePoint[]): number {
  if (profile.length === 0) {
    return 0;
  }
  if (yCm <= profile[0].yCm) {
    return profile[0].halfWidthCm;
  }

  for (let i = 1; i < profile.length; i += 1) {
    const prev = profile[i - 1];
    const next = profile[i];
    if (yCm <= next.yCm) {
      const span = next.yCm - prev.yCm;
      if (span <= 0) {
        return next.halfWidthCm;
      }
      const t = (yCm - prev.yCm) / span;
      return prev.halfWidthCm + (next.halfWidthCm - prev.halfWidthCm) * t;
    }
  }

  return profile[profile.length - 1].halfWidthCm;
}

export function buildMoldSections(
  alturaTotalCm: number,
  ratios: SectionRatios = DEFAULT_SECTION_RATIOS
): MoldSection[] {
  const h = Math.max(0, alturaTotalCm);
  const r = normalizeSectionRatios(ratios);
  const bocaAltura = round1(h * r.boca);
  const bicoAltura = round1(h * r.bico);
  const bojoAltura = round1(Math.max(0, h - bocaAltura - bicoAltura));

  const bocaFim = bocaAltura;
  const bojoFim = bocaFim + bojoAltura;

  return [
    {
      id: 'boca',
      nome: 'Boca',
      inicioCm: 0,
      fimCm: bocaFim,
      alturaCm: bocaAltura,
      percentual: h > 0 ? round1((bocaAltura / h) * 100) : round1(r.boca * 100),
      cor: SECTION_COLORS.boca,
    },
    {
      id: 'bojo',
      nome: 'Bojo',
      inicioCm: bocaFim,
      fimCm: bojoFim,
      alturaCm: bojoAltura,
      percentual: h > 0 ? round1((bojoAltura / h) * 100) : round1(r.bojo * 100),
      cor: SECTION_COLORS.bojo,
    },
    {
      id: 'bico',
      nome: 'Bico',
      inicioCm: bojoFim,
      fimCm: h,
      alturaCm: bicoAltura,
      percentual: h > 0 ? round1((bicoAltura / h) * 100) : round1(r.bico * 100),
      cor: SECTION_COLORS.bico,
    },
  ];
}

export function buildMoldProfile(
  pontos: MoldPoint[],
  ratios: SectionRatios = DEFAULT_SECTION_RATIOS
): MoldProfile | null {
  const points = buildProfilePoints(pontos);
  if (points.length < 2) {
    return null;
  }

  const alturaTotalCm = points[points.length - 1]?.yCm ?? 0;
  if (alturaTotalCm <= 0) {
    return null;
  }

  const maxHalf = Math.max(...points.map((p) => p.halfWidthCm), 0);
  const bocaHalf = points[0]?.halfWidthCm ?? 0;

  return {
    points,
    alturaTotalCm: round1(alturaTotalCm),
    larguraMaximaCm: round1(maxHalf * 2),
    larguraBocaCm: round1(bocaHalf * 2),
    secoes: buildMoldSections(alturaTotalCm, ratios),
  };
}

/** Perfil de uma faixa [inicio, fim] em cm, com pontos de borda interpolados. */
export function sliceProfile(profile: ProfilePoint[], inicioCm: number, fimCm: number): ProfilePoint[] {
  if (fimCm <= inicioCm) {
    return [];
  }

  const slice: ProfilePoint[] = [
    { yCm: inicioCm, halfWidthCm: interpolateHalfWidth(inicioCm, profile) },
  ];

  for (const point of profile) {
    if (point.yCm > inicioCm && point.yCm < fimCm) {
      slice.push(point);
    }
  }

  slice.push({ yCm: fimCm, halfWidthCm: interpolateHalfWidth(fimCm, profile) });
  return slice;
}

export function profileToClosedPath(
  slice: ProfilePoint[],
  mapX: (half: number, sign: 1 | -1) => number,
  mapY: (yCm: number) => number
): string {
  if (slice.length === 0) {
    return '';
  }

  const left = slice.map((p) => `${mapX(p.halfWidthCm, -1)},${mapY(p.yCm)}`);
  const right = [...slice].reverse().map((p) => `${mapX(p.halfWidthCm, 1)},${mapY(p.yCm)}`);
  return `M ${[...left, ...right].join(' L ')} Z`;
}

/** Bainha fina (cortes internos de taco + laterais finas). */
export const BAINHA_FINA_CM = 0.5;
/** Bainha grossa (lado esquerdo / fecho do gomo). */
export const BAINHA_GROSSA_CM = 1;
/**
 * Bainha da JUNTA entre partes/secoes: sempre 1 cm, sempre na parte de BAIXO.
 * O ultimo taco de cima (ex. 5 cm) fica sobre esses 1 cm → total visual 6 cm.
 */
export const BAINHA_JUNTA_CM = 1;

/** Uma faixa de taco (reparticao) dentro de Bico/Bojo/Boca. */
export interface SectionPartition {
  id: string;
  tacosPorGomo: number;
  alturaTacoCm: number;
  tacosSubindo?: number;
  /**
   * Peso relativo da ALTURA desta parte na secao.
   * Ex.: pesos 50 e 50 → metade cada; 60 e 40 → 60%/40% da altura.
   * Ao mudar o total de tacos de uma parte, os pesos redistribuem o espaco.
   */
  peso: number;
  /** Cor de preenchimento desta parte no gomo. */
  cor: string;
  /** Cor da linha de divisao abaixo desta parte (quando ha reparticao). */
  corDivisao: string;
}

/** Config de uma secao principal: 1+ reparticoes (Bico 1, Bico 2...). */
export interface SectionTacoConfig {
  partitions: SectionPartition[];
}

export type SectionTacoConfigMap = Record<MoldSection['id'], SectionTacoConfig>;

/** Cores padrao para linhas de divisao entre reparticoes. */
export const PARTITION_DIVISION_COLORS = [
  '#2563eb',
  '#dc2626',
  '#16a34a',
  '#9333ea',
  '#ea580c',
  '#0891b2',
];

export function createPartition(
  tacosPorGomo = 4,
  alturaTacoCm = 5,
  tacosSubindo = 10,
  cor = '#f4e64a',
  corDivisao = PARTITION_DIVISION_COLORS[0],
  peso = 1
): SectionPartition {
  return {
    id: `p-${Math.random().toString(36).slice(2, 9)}`,
    tacosPorGomo: Math.max(1, Math.floor(tacosPorGomo) || 1),
    alturaTacoCm: Math.max(1, Math.floor(alturaTacoCm) || 1),
    tacosSubindo: Math.max(1, Math.floor(tacosSubindo) || 1),
    peso: Math.max(0.01, Number(peso) || 1),
    cor,
    corDivisao,
  };
}

export function createDefaultTacoConfigs(_bainhaCm = 1): SectionTacoConfigMap {
  return {
    boca: { partitions: [createPartition(4, 5, 10, SECTION_COLORS.boca, PARTITION_DIVISION_COLORS[0], 1)] },
    bojo: { partitions: [createPartition(8, 5, 20, SECTION_COLORS.bojo, PARTITION_DIVISION_COLORS[1], 1)] },
    bico: { partitions: [createPartition(4, 5, 10, SECTION_COLORS.bico, PARTITION_DIVISION_COLORS[2], 1)] },
  };
}

/** Compat: config "plana" usada por buildTacoDivisions. */
export interface FlatTacoConfig {
  tacosPorGomo: number;
  alturaTacoCm: number;
  bainhaCm: number;
}

/** Estimativa de fileiras e total a partir da altura da faixa. */
export function estimateTacoCounts(
  alturaCm: number,
  tacosPorGomo: number,
  alturaTacoCm: number
): { rows: number; total: number } {
  const tpg = Math.max(1, Math.floor(Number(tacosPorGomo)) || 1);
  const at = Math.max(1, Math.floor(Number(alturaTacoCm)) || 1);
  const rows = at > 0 ? Math.floor(Math.max(0, alturaCm) / at) : 0;
  return { rows, total: rows * tpg };
}

/** Altura desejada (cm) para caber `total` tacos com a config dada. */
export function desiredHeightForTotal(
  total: number,
  tacosPorGomo: number,
  alturaTacoCm: number
): number {
  const tpg = Math.max(1, Math.floor(Number(tacosPorGomo)) || 1);
  const at = Math.max(1, Math.floor(Number(alturaTacoCm)) || 1);
  const rows = Math.max(1, Math.round(Math.max(0, total) / tpg));
  return rows * at;
}

/**
 * Redistribui pesos entre reparticoes para bater os totais-alvo.
 * peso_i ∝ altura necessaria = (total_i / tacosPorGomo_i) * alturaTaco_i
 */
export function redistributePartitionPesos(
  partitions: SectionPartition[],
  targetTotals: number[]
): SectionPartition[] {
  if (partitions.length === 0) {
    return partitions;
  }
  const pesos = partitions.map((p, i) => {
    const total = Math.max(0, Math.floor(targetTotals[i] ?? 0));
    const safeTotal = Math.max(p.tacosPorGomo, total);
    return Math.max(0.01, desiredHeightForTotal(safeTotal, p.tacosPorGomo, p.alturaTacoCm));
  });
  // Se todos os alvos forem 0, mantem pesos iguais
  const sumTargets = targetTotals.reduce((s, t) => s + Math.max(0, t), 0);
  if (sumTargets <= 0) {
    return partitions.map((p) => ({ ...p, peso: 1 }));
  }
  return partitions.map((p, i) => ({
    ...p,
    peso: pesos[i],
  }));
}

/**
 * Ao mudar o total de UMA parte, as outras compensam (soma da secao constante).
 * Ex.: 50|50 → 60|40.
 */
export function balancePartitionTotals(
  partitions: SectionPartition[],
  currentTotals: number[],
  changedIndex: number,
  nextTotal: number
): number[] {
  const n = partitions.length;
  if (n === 0) {
    return [];
  }
  if (n === 1) {
    return [Math.max(partitions[0].tacosPorGomo, Math.floor(nextTotal) || partitions[0].tacosPorGomo)];
  }

  const budget = currentTotals.reduce((s, t) => s + Math.max(0, Math.floor(t)), 0);
  const safeBudget = Math.max(
    budget,
    partitions.reduce((s, p) => s + p.tacosPorGomo, 0)
  );

  // Minimo por parte = 1 fileira * tacosPorGomo
  const mins = partitions.map((p) => Math.max(1, p.tacosPorGomo));
  const minOthers = mins.reduce((s, m, i) => (i === changedIndex ? s : s + m), 0);
  const maxChanged = Math.max(mins[changedIndex], safeBudget - minOthers);
  const clamped = Math.min(maxChanged, Math.max(mins[changedIndex], Math.floor(nextTotal) || mins[changedIndex]));

  const remaining = safeBudget - clamped;
  const otherIdx = partitions.map((_, i) => i).filter((i) => i !== changedIndex);
  const otherCurrent = otherIdx.map((i) => Math.max(0, currentTotals[i] ?? 0));
  const otherSum = otherCurrent.reduce((s, t) => s + t, 0);

  const result = currentTotals.map((t) => Math.max(0, Math.floor(t)));
  result[changedIndex] = clamped;

  if (otherIdx.length === 1) {
    result[otherIdx[0]] = remaining;
  } else if (otherSum <= 0) {
    // divide igual
    const base = Math.floor(remaining / otherIdx.length);
    let left = remaining - base * otherIdx.length;
    otherIdx.forEach((i) => {
      result[i] = base + (left > 0 ? 1 : 0);
      if (left > 0) left -= 1;
    });
  } else {
    let assigned = 0;
    otherIdx.forEach((i, k) => {
      if (k === otherIdx.length - 1) {
        result[i] = Math.max(mins[i], remaining - assigned);
      } else {
        const share = Math.round((otherCurrent[k] / otherSum) * remaining);
        result[i] = Math.max(mins[i], share);
        assigned += result[i];
      }
    });
    // corrige estouro
    const otherAssigned = otherIdx.reduce((s, i) => s + result[i], 0);
    if (otherAssigned !== remaining) {
      const last = otherIdx[otherIdx.length - 1];
      result[last] = Math.max(mins[last], result[last] + (remaining - otherAssigned));
    }
  }

  return result;
}

/** Limite de fileiras por faixa — evita milhares de linhas SVG e freeze no browser. */
export const MAX_TACO_ROWS = 200;

/**
 * Ao reduzir tacos por gomo, aumenta fileiras (subindo) para manter o total.
 * Retorna nova altura do taco (cm inteiro), com teto de fileiras.
 */
export function alturaTacoToKeepTotal(
  partAlturaCm: number,
  totalTacos: number,
  tacosPorGomo: number
): number {
  const tpg = Math.max(1, Math.min(64, Math.floor(tacosPorGomo) || 1));
  const total = Math.max(tpg, Math.floor(totalTacos) || tpg);
  const desiredRows = Math.max(1, Math.round(total / tpg));
  const h = Math.max(1, partAlturaCm);
  // Nunca gerar mais que MAX_TACO_ROWS (performance) nem mais que a altura em cm
  const rows = Math.max(1, Math.min(desiredRows, MAX_TACO_ROWS, Math.floor(h)));
  const at = Math.max(1, Math.floor(h / rows));
  return at;
}

/**
 * Divide a secao principal por PESO (de cima para baixo).
 * Ex.: Bico pesos 60|40 → Bico 1 com 60% da altura, Bico 2 com 40%.
 */
export function expandSectionPartitions(
  secao: MoldSection,
  config: SectionTacoConfig
): Array<MoldSection & { partition: SectionPartition; flatConfig: FlatTacoConfig }> {
  const parts = config.partitions;
  if (parts.length === 0) {
    return [];
  }
  const n = parts.length;
  const weights = parts.map((p) => Math.max(0.01, Number(p.peso) || 1));
  const weightSum = weights.reduce((s, w) => s + w, 0) || 1;

  const hasManualTacos = parts.some((p) => p.tacosSubindo !== undefined);

  if (hasManualTacos) {
    let yBottom = secao.inicioCm;
    return parts.map((partition, index) => {
      const isLast = index === n - 1;
      const tacosSubindo = partition.tacosSubindo ?? 10;
      const alturaCm = round1(tacosSubindo * partition.alturaTacoCm);
      const inicioCm = round1(yBottom);
      
      let fimCm = round1(yBottom + alturaCm);
      if (isLast && fimCm >= secao.fimCm - partition.alturaTacoCm) {
        fimCm = secao.fimCm;
      } else {
        fimCm = round1(Math.min(secao.fimCm, fimCm));
      }
      yBottom = fimCm;

      return {
        ...secao,
        nome: n > 1 ? `${secao.nome} ${index + 1}` : secao.nome,
        cor: partition.cor || secao.cor,
        inicioCm,
        fimCm,
        alturaCm: round1(Math.max(0, fimCm - inicioCm)),
        partition,
        flatConfig: {
          tacosPorGomo: partition.tacosPorGomo,
          alturaTacoCm: partition.alturaTacoCm,
          bainhaCm: BAINHA_FINA_CM,
        },
      };
    });
  } else {
    let yTop = secao.fimCm;
    return parts.map((partition, index) => {
      const isLast = index === n - 1;
      const frac = weights[index] / weightSum;
      const alturaRaw = isLast ? yTop - secao.inicioCm : secao.alturaCm * frac;
      const alturaCm = round1(Math.max(0, isLast ? yTop - secao.inicioCm : alturaRaw));
      const fimCm = round1(yTop);
      const inicioCm = round1(isLast ? secao.inicioCm : yTop - alturaCm);
      yTop = inicioCm;

      const calculatedSubindo = Math.max(1, Math.floor(alturaCm / partition.alturaTacoCm));
      const partitionWithSubindo = { ...partition, tacosSubindo: calculatedSubindo };

      return {
        ...secao,
        nome: n > 1 ? `${secao.nome} ${index + 1}` : secao.nome,
        cor: partition.cor || secao.cor,
        inicioCm,
        fimCm,
        alturaCm: round1(Math.max(0, fimCm - inicioCm)),
        partition: partitionWithSubindo,
        flatConfig: {
          tacosPorGomo: partition.tacosPorGomo,
          alturaTacoCm: partition.alturaTacoCm,
          bainhaCm: BAINHA_FINA_CM,
        },
      };
    });
  }
}

/**
 * Converte totais de secao em novas fracoes de altura.
 * Boca↔Bojo se compensam; Bico usa o proprio total vs os demais (ou fica fixo se donor for bojo-only).
 */
export function ratiosFromSectionTotals(
  current: SectionRatios,
  sectionTotals: Record<MoldSection['id'], number>,
  changed: MoldSection['id'],
  donor: MoldSection['id'] = 'bojo'
): SectionRatios {
  const cur = normalizeSectionRatios(current);
  // Densidade relativa: usamos o total de tacos como proxy da "quantidade de tecido"
  // (cliente aumenta tacos da boca → boca fica maior).
  const totals: SectionRatios = {
    boca: Math.max(0, sectionTotals.boca),
    bojo: Math.max(0, sectionTotals.bojo),
    bico: Math.max(0, sectionTotals.bico),
  };

  if (changed === 'bico') {
    // Bico troca com bojo (bico sobe → bojo desce), boca fixa
    const fixed = cur.boca;
    const pool = 1 - fixed;
    const pairSum = totals.bico + totals.bojo;
    if (pairSum <= 0) {
      return cur;
    }
    const bicoShare = pool * (totals.bico / pairSum);
    return rebalanceSectionRatios(cur, 'bico', bicoShare, 'bojo');
  }

  // Boca ou Bojo: um muda, o outro compensa; bico fixo
  const fixed = cur.bico;
  const pool = 1 - fixed;
  const pairSum = totals.boca + totals.bojo;
  if (pairSum <= 0) {
    return cur;
  }
  if (changed === 'boca') {
    return rebalanceSectionRatios(
      { ...cur, bico: fixed },
      'boca',
      pool * (totals.boca / pairSum),
      donor === 'bico' ? 'bojo' : donor
    );
  }
  return rebalanceSectionRatios(
    { ...cur, bico: fixed },
    'bojo',
    pool * (totals.bojo / pairSum),
    'boca'
  );
}

export interface HemPolyline {
  points: Array<{ xCm: number; yCm: number }>;
  /** 0.5 = fina, 1 = grossa (esquerda). */
  espessuraCm: number;
}

export interface HemHorizontal {
  yCm: number;
  halfCm: number;
  espessuraCm: number;
}

export interface TacoDivisionLines {
  /** Linhas verticais que separam os tacos na largura do gomo (por secao). */
  verticals: Array<Array<{ xCm: number; yCm: number }>>;
  /** Linhas horizontais de altura de taco. */
  horizontals: Array<{ yCm: number; halfCm: number }>;
  /** Bainhas paralelas as verticais (offset). */
  verticalHems: HemPolyline[];
  /** Bainhas paralelas as horizontais. */
  horizontalHems: HemHorizontal[];
  quantidadeVertical: number;
  totalTacos: number;
}

/**
 * Calcula as linhas de tacos e bainhas de uma secao do gomo.
 *
 * Padrao de bainha (direita → esquerda no desenho):
 * - bainhas finas: 0,5 cm (cortes internos + borda direita)
 * - bainha grossa: 1 cm (borda esquerda / fecho)
 */
export function buildTacoDivisions(
  secao: MoldSection,
  config: FlatTacoConfig | SectionPartition,
  profile: ProfilePoint[]
): TacoDivisionLines {
  const tacosPorGomo = Math.max(1, Math.min(64, Math.floor(Number(config.tacosPorGomo)) || 1));
  // Altura do taco so em cm inteiros; evita taco=1cm em secoes enormes (freeze)
  let alturaTaco = Math.max(1, Math.floor(Number(config.alturaTacoCm)) || 1);
  const altura = Math.max(0, Number(secao.alturaCm) || 0);

  // Padrao do molde de referencia
  const bainhaFina = BAINHA_FINA_CM;
  const bainhaGrossa = BAINHA_GROSSA_CM;

  // A grade sobe ate onde a largura real ainda aguenta os tacos sem embolar
  // (minHalfForGrid abaixo). Nao ha mais corte fixo por cm — senao sobrava
  // ponta sem grade mesmo quando a largura ali ainda comportava taco.
  const moldTopCm = profile.length > 0 ? profile[profile.length - 1].yCm : secao.fimCm;
  const yTipLimit = moldTopCm;

  // Largura minima POR COLUNA de taco: as duas bainhas (0,5cm cada, uma de cada
  // lado do corte) nao podem se cruzar, entao precisa de pelo menos 2x bainha
  // + uma sobra pequena de tecido visivel entre elas. Isso ainda multiplica
  // pela quantidade de tacos por gomo (mais coluna = precisa de mais largura
  // total pra caber todo mundo sem embolar) — so o valor por coluna ficou
  // bem menor que antes, entao a grade sobe bem mais perto da ponta.
  const minCellCm = Math.max(1.3, bainhaFina * 2 + 0.3);
  // Piso FIXO independente da quantidade de tacos: a bainha grossa da esquerda
  // (1cm) e a bainha fina da direita (0,5cm) sao sempre as mesmas, entao com
  // poucos tacos por gomo (ex.: 2) a conta por coluna sozinha dava um minimo
  // menor que o espaco que essas duas bainhas de borda precisam pra nao se
  // cruzar — e era isso que embolava a ponta com poucos tacos.
  const edgeHemFloorCm = bainhaGrossa + bainhaFina + 0.3;
  const minHalfForGrid = Math.max(edgeHemFloorCm, (tacosPorGomo * minCellCm) / 2);

  // Passo de amostragem seguro (nunca 0/NaN — evita loop infinito e pontos demais)
  const sampleStep = Math.max(0.5, Number.isFinite(altura) && altura > 0 ? altura / 48 : 1);
  const verticals: Array<Array<{ xCm: number; yCm: number }>> = [];
  const verticalHems: HemPolyline[] = [];

  function halfAt(y: number): number {
    return interpolateHalfWidth(y, profile);
  }

  function resolveYMax(minHalf: number): number {
    const hardMax = Math.min(secao.fimCm, yTipLimit);
    let yMax = secao.inicioCm;
    const step = Math.max(0.5, sampleStep);
    // Teto de iteracoes — protege contra step invalido / altura absurda
    const maxIters = 256;
    let iters = 0;
    for (let y = secao.inicioCm; y <= hardMax + 0.0001 && iters < maxIters; y += step, iters += 1) {
      const yClamped = Math.min(y, hardMax);
      if (halfAt(yClamped) >= minHalf) {
        yMax = yClamped;
      }
    }
    return halfAt(yMax) >= minHalf * 0.95 ? yMax : secao.inicioCm;
  }

  /**
   * Espelho de resolveYMax pra quando a ponta livre fica EMBAIXO (ex.: a boca
   * de um molde que afina pra base, tipo o "Stilus") — desce de fimCm (junta,
   * de cima) ate onde a largura ainda aguenta, em vez de subir de inicioCm.
   */
  function resolveYMin(minHalf: number): number {
    const hardMin = Math.max(secao.inicioCm, 0);
    let yMin = secao.fimCm;
    const step = Math.max(0.5, sampleStep);
    const maxIters = 256;
    let iters = 0;
    for (let y = secao.fimCm; y >= hardMin - 0.0001 && iters < maxIters; y -= step, iters += 1) {
      const yClamped = Math.max(y, hardMin);
      if (halfAt(yClamped) >= minHalf) {
        yMin = yClamped;
      }
    }
    return halfAt(yMin) >= minHalf * 0.95 ? yMin : secao.fimCm;
  }

  /**
   * Bainha de junta 1 cm (parte de baixo): NAO diminui o tamanho do molde.
   * - Silhueta / altura da secao: intactas
   * - Contagem de tacos: usa a altura util INTEIRA (sem descontar 1 cm)
   * - So evita desenhar horizontal de taco em cima da linha da bainha (limpo na junta)
   * Taco de cima 5 cm fica sobre a bainha 1 cm no encontro (costura), sem encolher o gomo.
   */
  const hasJoinAtTop = secao.fimCm < moldTopCm - 0.2;
  const joinZoneStart = hasJoinAtTop ? secao.fimCm - BAINHA_JUNTA_CM : secao.fimCm + 10;

  /**
   * A grade so pode "encolher" pelo lado que e ponta LIVRE do molde (nao
   * encostado em outra secao) — o lado junto (encostado no vizinho) fica
   * sempre inteiro. Antes disso assumia que a ponta livre era sempre em
   * cima (certo pro bico) — quebrava a boca de moldes que tambem afinam
   * pra base (ai a grade "subia" contando com uma largura que so existia
   * perto do bojo, e a base ficava sem nenhuma linha, so cor solida).
   */
  const touchesMoldBase = secao.inicioCm <= 0.5;
  const touchesMoldTip = secao.fimCm >= moldTopCm - 0.5;

  let yVertBottom = secao.inicioCm;
  let yVertTop = secao.fimCm;

  if (touchesMoldTip && !touchesMoldBase) {
    // tipo bico: junta embaixo (com o bojo), ponta livre em cima — sobe ate onde aguenta.
    const rawYMax = resolveYMax(minHalfForGrid);
    yVertTop = rawYMax > secao.inicioCm + 0.5 ? Math.min(rawYMax, secao.fimCm) : secao.inicioCm;
  } else if (touchesMoldBase && !touchesMoldTip) {
    // tipo boca: junta em cima (com o bojo), ponta livre embaixo — desce ate onde aguenta.
    const rawYMin = resolveYMin(minHalfForGrid);
    yVertBottom = rawYMin < secao.fimCm - 0.5 ? Math.max(rawYMin, secao.inicioCm) : secao.fimCm;
  }
  // bojo (ou qualquer banda que nao toque nenhuma ponta livre): junta dos 2
  // lados, usa a faixa inteira — nunca precisa encolher.

  // Fileiras na altura util completa — NAO desconta a bainha de 1 cm do tamanho
  let usableForRows = Math.max(0, yVertTop - yVertBottom);
  if (alturaTaco > 0 && usableForRows / alturaTaco > MAX_TACO_ROWS) {
    // ceil (nao floor): senao a fileira ajustada podia continuar dando mais
    // linhas que o teto e a grade parava no meio, deixando o resto da secao
    // so com verticais (sem corte nenhum) ate o topo.
    alturaTaco = Math.max(1, Math.ceil(usableForRows / MAX_TACO_ROWS));
  }
  usableForRows = Math.max(0, yVertTop - yVertBottom);
  const rowsFinal =
    alturaTaco > 0 && usableForRows > 0.5
      ? Math.min(MAX_TACO_ROWS, Math.floor(usableForRows / alturaTaco))
      : 0;

  const yGridBottom = yVertBottom;
  const gridTop = yVertTop;

  /**
   * Amostra em proporcao de yStart ate yEnd.
   * - Cortes: fecham nos dois extremos (base e topo da grade).
   * - Bainhas: param se o offset sair da silhueta.
   */
  function sampleProportionalTo(
    yStart: number,
    yEnd: number,
    xAtHalf: (half: number) => number,
    minHalf: number,
    isCut: boolean
  ): Array<{ xCm: number; yCm: number }> {
    if (yEnd <= yStart + 0.05) {
      return [];
    }

    const poly: Array<{ xCm: number; yCm: number }> = [];
    const start = Math.max(secao.inicioCm, yStart);
    const end = Math.min(secao.fimCm, yEnd);
    const edgeMargin = isCut ? 0.06 : 0.14;
    const step = Math.max(0.5, sampleStep);
    const maxIters = 256;
    let iters = 0;

    function pushPoint(y: number, forceInside: boolean): boolean {
      const half = halfAt(y);
      if (half < minHalf * 0.9 && !forceInside) {
        return false;
      }
      if (half < 0.5) {
        return false;
      }
      let x = xAtHalf(half);
      const xMin = -half + edgeMargin;
      const xMax = half - edgeMargin;
      if (x < xMin || x > xMax) {
        if (!isCut && !forceInside) {
          return false;
        }
        x = Math.max(xMin, Math.min(xMax, x));
      }
      poly.push({ xCm: x, yCm: y });
      return true;
    }

    // Ponto inicial exato na base da grade (encosta na horizontal de baixo / divisao)
    if (isCut) {
      pushPoint(start, true);
    } else {
      pushPoint(start, false);
    }

    for (let y = start + step; y <= end + 0.0001 && iters < maxIters; y += step, iters += 1) {
      const yClamped = Math.min(y, end);
      if (Math.abs(yClamped - end) < step * 0.5) {
        continue; // topo tratado depois
      }
      if (Math.abs(yClamped - start) < step * 0.5) {
        continue;
      }

      const half = halfAt(yClamped);
      if (half < minHalf * 0.9) {
        if (poly.length >= 2 && !isCut) break;
        if (!isCut) continue;
      }

      const x = xAtHalf(half);
      const xMin = -half + edgeMargin;
      const xMax = half - edgeMargin;

      if (x < xMin || x > xMax) {
        if (!isCut) {
          if (poly.length >= 2) break;
          continue;
        }
        poly.push({
          xCm: Math.max(xMin, Math.min(xMax, x)),
          yCm: yClamped,
        });
        continue;
      }

      poly.push({ xCm: x, yCm: yClamped });
    }

    // Ponto final no topo da grade (fecho / divisao com a parte de cima)
    // Cortes sempre fecham; bainhas tambem fecham se a largura ainda comporta o offset
    // (senao fica o ultimo ponto valido — ponta estreita).
    if (isCut) {
      pushPoint(end, true);
    } else {
      const halfEnd = halfAt(end);
      const xEnd = xAtHalf(halfEnd);
      const xMin = -halfEnd + edgeMargin;
      const xMax = halfEnd - edgeMargin;
      if (halfEnd >= minHalf * 0.85 && xEnd >= xMin && xEnd <= xMax) {
        pushPoint(end, true);
      } else {
        pushPoint(end, false);
      }
    }

    // remove duplicatas consecutivas
    const cleaned: Array<{ xCm: number; yCm: number }> = [];
    for (const p of poly) {
      const prev = cleaned[cleaned.length - 1];
      if (prev && Math.abs(prev.yCm - p.yCm) < 0.02 && Math.abs(prev.xCm - p.xCm) < 0.02) {
        cleaned[cleaned.length - 1] = p;
      } else {
        cleaned.push(p);
      }
    }

    return cleaned.length >= 2 ? cleaned : [];
  }

  // Verticais em TODA a altura util (pe → topo), para nao criar faixa solida na junta
  if (gridTop > yGridBottom + 0.5 && (rowsFinal > 0 || usableForRows > 1)) {
    for (let i = 1; i < tacosPorGomo; i += 1) {
      const ratio = i / tacosPorGomo;
      const cut = sampleProportionalTo(
        yGridBottom,
        gridTop,
        (half) => -half + half * 2 * ratio,
        minHalfForGrid,
        true
      );
      if (cut.length >= 2) {
        verticals.push(cut);
      }

      const hem = sampleProportionalTo(
        yGridBottom,
        gridTop,
        (half) => -half + half * 2 * ratio - bainhaFina,
        minHalfForGrid,
        false
      );
      if (hem.length >= 2) {
        verticalHems.push({ points: hem, espessuraCm: bainhaFina });
      }
    }

    const right = sampleProportionalTo(
      yGridBottom,
      gridTop,
      (half) => half - bainhaFina,
      minHalfForGrid,
      false
    );
    if (right.length >= 2) {
      verticalHems.push({ points: right, espessuraCm: bainhaFina });
    }
    const left = sampleProportionalTo(
      yGridBottom,
      gridTop,
      (half) => -half + bainhaGrossa,
      minHalfForGrid,
      false
    );
    if (left.length >= 2) {
      verticalHems.push({ points: left, espessuraCm: bainhaGrossa });
    }
  }

  const horizontals: Array<{ yCm: number; halfCm: number }> = [];
  const horizontalHems: HemHorizontal[] = [];

  // Fileiras na altura completa do molde (sem encolher).
  // Se alguma horizontal cair em cima da bainha de junta (1 cm), nao desenha — so a bainha.
  for (let i = 1; i <= rowsFinal; i += 1) {
    const yCm = yGridBottom + i * alturaTaco;
    if (yCm > yVertTop + 0.05) {
      break;
    }
    // Zona da bainha de junta: sem outra horizontal (evita 3 linhas), molde do mesmo tamanho
    if (hasJoinAtTop && yCm >= joinZoneStart - 0.02) {
      continue;
    }
    const half = halfAt(yCm);
    if (half < 0.8) {
      continue;
    }

    horizontals.push({ yCm, halfCm: half });

    const yHem = yCm - bainhaFina;
    if (
      yHem > yGridBottom + 0.05 &&
      !(hasJoinAtTop && yHem >= joinZoneStart - 0.05) &&
      halfAt(yHem) >= 0.8
    ) {
      const prevY = yGridBottom + (i - 1) * alturaTaco;
      if (yHem > prevY + 0.15) {
        horizontalHems.push({
          yCm: yHem,
          halfCm: halfAt(yHem),
          espessuraCm: bainhaFina,
        });
      }
    }
  }

  return {
    verticals,
    horizontals,
    verticalHems,
    horizontalHems,
    quantidadeVertical: rowsFinal,
    totalTacos: rowsFinal * tacosPorGomo,
  };
}

export interface SeparatedPiece {
  id: string;
  sectionId: MoldSection['id'];
  label: string;
  color: string;
  alturaCm: number;
  larguraMaximaCm: number;
  tacosPorGomo: number;
  alturaTacoCm: number;
  totalTacos: number;
  /** Perfil so dessa peca, com y comecando em 0 na base — pronta pra desenhar sozinha. */
  profile: MoldProfile;
  tacoConfigs: SectionTacoConfigMap;
}

const SEPARATED_PIECE_ORDER: Array<MoldSection['id']> = ['bico', 'bojo', 'boca'];

/**
 * Corta o gomo inteiro em pecas independentes — uma por faixa/reparticao de taco
 * (Bico 1, Bico 2, Bojo, Boca...) — cada uma com y comecando em 0, pronta pra
 * desenhar e imprimir separada (igual sai numa plotagem real: cada faixa vira
 * um pedaco de tecido cortado a parte, nao um gomo inteiro so).
 */
export function buildSeparatedPieces(
  pontos: MoldPoint[],
  tacoConfigs: SectionTacoConfigMap,
  sectionRatios: SectionRatios,
  sectionColors?: Partial<Record<MoldSection['id'], string>>
): SeparatedPiece[] {
  const profile = buildMoldProfile(pontos, sectionRatios);
  if (!profile) {
    return [];
  }

  const pieces: SeparatedPiece[] = [];

  for (const sectionId of SEPARATED_PIECE_ORDER) {
    const secao = profile.secoes.find((item) => item.id === sectionId);
    if (!secao) {
      continue;
    }

    const coloredSecao: MoldSection = { ...secao, cor: sectionColors?.[sectionId] ?? secao.cor };
    const cfg = tacoConfigs[sectionId] ?? { partitions: [] };
    const bands = expandSectionPartitions(coloredSecao, cfg);

    for (const band of bands) {
      const alturaTotalCm = round1(Math.max(0, band.fimCm - band.inicioCm));
      if (alturaTotalCm <= 0.1) {
        continue;
      }

      const slice = sliceProfile(profile.points, band.inicioCm, band.fimCm);
      const localPoints: ProfilePoint[] = slice.map((point) => ({
        yCm: round1(point.yCm - band.inicioCm),
        halfWidthCm: point.halfWidthCm,
      }));
      const maxHalf = Math.max(...localPoints.map((point) => point.halfWidthCm), 0);

      const singleSecao: MoldSection = {
        id: sectionId,
        nome: band.nome,
        inicioCm: 0,
        fimCm: alturaTotalCm,
        alturaCm: alturaTotalCm,
        percentual: 100,
        cor: band.cor,
      };

      const singleProfile: MoldProfile = {
        points: localPoints,
        alturaTotalCm,
        larguraMaximaCm: round1(maxHalf * 2),
        larguraBocaCm: round1((localPoints[0]?.halfWidthCm ?? 0) * 2),
        secoes: [singleSecao],
      };

      const singleTacoConfigs: SectionTacoConfigMap = {
        boca: { partitions: [] },
        bojo: { partitions: [] },
        bico: { partitions: [] },
        [sectionId]: { partitions: [band.partition] },
      };

      // secao precisa estar no MESMO referencial (local, 0..alturaTotalCm) que localPoints —
      // usar "band" (que ainda tem inicioCm/fimCm globais) aqui faria a interpolacao de
      // largura cair fora do dominio de localPoints e zerar a grade/contagem de tacos.
      const divisions = buildTacoDivisions(singleSecao, band.flatConfig, localPoints);

      pieces.push({
        id: band.partition.id,
        sectionId,
        label: band.nome,
        color: band.cor,
        alturaCm: alturaTotalCm,
        larguraMaximaCm: round1(maxHalf * 2),
        tacosPorGomo: band.partition.tacosPorGomo,
        alturaTacoCm: band.partition.alturaTacoCm,
        totalTacos: divisions.totalTacos,
        profile: singleProfile,
        tacoConfigs: singleTacoConfigs,
      });
    }
  }

  return pieces;
}

/** Total de tacos por secao (Boca/Bojo/Bico), pra mostrar resumo em cards/listas. */
export function computeSectionTacoTotals(
  pontos: MoldPoint[],
  tacoConfigs: SectionTacoConfigMap,
  sectionRatios: SectionRatios
): Record<MoldSection['id'], number> | null {
  const profile = buildMoldProfile(pontos, sectionRatios);
  if (!profile) {
    return null;
  }

  const totals: Record<MoldSection['id'], number> = { boca: 0, bojo: 0, bico: 0 };
  for (const secao of profile.secoes) {
    const cfg = tacoConfigs[secao.id] ?? { partitions: [] };
    const bands = expandSectionPartitions(secao, cfg);
    totals[secao.id] = bands.reduce(
      (sum, band) => sum + buildTacoDivisions(band, band.flatConfig, profile.points).totalTacos,
      0
    );
  }
  return totals;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
