import { buildMoldPdf } from './moldPdf';
import { buildMoldTiledPdf, type TiledPaperSize } from './moldTiledPdf';
import { SECTION_COLORS } from './moldGeometry';
import type { MoldPoint, MoldPlotterConfig } from '../types';

/** Modelo base do catálogo (/data.json). */
export interface BaseModel {
  name?: string;
  perimeter: number[];
  heightAcum: number[];
  dist?: number[];
}

export interface ChatParte {
  tacosPorGomo: number;
  tacosSubindo: number;
  tamanhoTaco?: number;
}

const CORES = ['#f4e64a', '#77e6f2', '#f062b8', '#a78bfa', '#fb923c', '#34d399', '#60a5fa', '#f87171', '#facc15', '#4ade80'];
const DIV_CORES = ['#2563eb', '#dc2626', '#16a34a', '#9333ea', '#ea580c', '#0891b2', '#ca8a04', '#db2777', '#4f46e5', '#059669', '#b91c1c', '#7c3aed'];

/**
 * Calcula os pontos do molde (curva) a partir do modelo base do catálogo,
 * escalado para a altura/gomos/bainha — MESMA fórmula da aba "Escala do Molde".
 */
export function computePontos(base: BaseModel, alturaCm: number, gomos: number, bainhaCm: number): MoldPoint[] {
  const perimeter = base.perimeter;
  const heightAcum = base.heightAcum;
  if (!Array.isArray(perimeter) || perimeter.length < 2) return [];

  let dist: number[];
  if (base.dist && base.dist.length === perimeter.length) {
    dist = base.dist.slice();
  } else {
    dist = [0];
    for (let i = 1; i < heightAcum.length; i += 1) dist.push(heightAcum[i] - heightAcum[i - 1]);
  }

  const LargoBase = dist.reduce((s, v) => s + v, 0);
  if (LargoBase <= 0) return [];

  return dist.map((step, i) => {
    const dL = (step * alturaCm) / LargoBase;
    const widthHalf = ((perimeter[i] * alturaCm) / LargoBase) / (2 * gomos) + bainhaCm / 2;
    return {
      altura_cm: Math.round(dL * 10) / 10,
      largura_meia_cm: Math.round(widthHalf * 10) / 10,
    };
  });
}

/**
 * Monta a config do plotter a partir das partes do chat: cada parte vira uma
 * "partição" da seção que cobre o molde inteiro (as alturas das seções são
 * calculadas pelos tacos — ver buildMoldSections).
 */
export function buildPlotterConfig(partes: ChatParte[], tipo: 'unico' | 'progressivo', tamanhoUnico: number): MoldPlotterConfig {
  // O gerador posiciona a 1ª partição do array no FIM da seção (ponta/bico) e
  // vai descendo até a base (boca). Como o cliente começa pela BOCA (parte 1),
  // invertemos o array pra que a parte 1 caia na boca e a última no bico.
  const partitions = partes
    .map((p, i) => ({
      id: `p${i}`,
      tacosPorGomo: Math.max(1, Math.floor(p.tacosPorGomo) || 1),
      alturaTacoCm: Math.max(0.1, tipo === 'unico' ? tamanhoUnico : (p.tamanhoTaco ?? 1)),
      tacosSubindo: Math.max(1, Math.floor(p.tacosSubindo) || 1),
      peso: 1,
      cor: CORES[i % CORES.length],
      corDivisao: DIV_CORES[i % DIV_CORES.length],
    }))
    .reverse();

  return {
    section_colors: { boca: SECTION_COLORS.boca, bojo: SECTION_COLORS.bojo, bico: SECTION_COLORS.bico },
    // Uma seção só (boca) cobrindo 100% do molde — as partes do chat são as partições.
    section_ratios: { boca: 1, bojo: 0, bico: 0 },
    taco_configs: {
      boca: { partitions },
      bojo: { partitions: [] },
      bico: { partitions: [] },
    },
  };
}

export interface TaqueadoParams {
  base: BaseModel;
  alturaCm: number;
  gomos: number;
  bainhaCm: number;
  nome: string;
  modelo: string;
  partes: ChatParte[];
  tipo: 'unico' | 'progressivo';
  tamanhoUnico: number;
}

/** Calcula pontos + config do plotter a partir das medidas coletadas no chat. */
export function computeTaqueadoData(p: TaqueadoParams): { pontos: MoldPoint[]; plotterConfig: MoldPlotterConfig } {
  const pontos = computePontos(p.base, p.alturaCm, p.gomos, p.bainhaCm);
  if (pontos.length < 2) {
    throw new Error('Modelo sem curva válida para gerar o molde.');
  }
  const plotterConfig = buildPlotterConfig(p.partes, p.tipo, p.tamanhoUnico);
  return { pontos, plotterConfig };
}

/** Gera o PDF do taqueado real — MESMO modelo (peca por peca) da aba "Plotar Molde Taqueado". */
export function buildTaqueadoBlob(p: TaqueadoParams): Blob {
  const { pontos, plotterConfig } = computeTaqueadoData(p);
  return buildMoldPdf({
    nome: p.nome,
    modelo: p.modelo,
    quantidadeGomos: p.gomos,
    bainhaCm: p.bainhaCm,
    alturaTotalCm: p.alturaCm,
    pontos,
    plotterConfig,
    mode: 'pieces',
  });
}

/** Gera o PDF fatiado (A4 ou A3), numerado pra montar sem plotter. */
export function buildTaqueadoTiledBlob(p: TaqueadoParams, paper: TiledPaperSize): Blob {
  const { pontos, plotterConfig } = computeTaqueadoData(p);
  return buildMoldTiledPdf(
    { nome: p.nome, modelo: p.modelo, bainhaCm: p.bainhaCm, pontos, plotterConfig },
    paper
  );
}
