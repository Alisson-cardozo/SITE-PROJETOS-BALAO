import { buildProfilePoints, type ProfilePoint } from './moldGeometry';
import type { MoldPoint } from '../types';

/**
 * Planificacao de cone (o mesmo principio de abrir um cone de sorvete ou um
 * chapeu de aniversario numa folha plana) — usado pro Plotter Riscado do
 * balao junino. Diferente do gomo "lente" (largura como offset reto), aqui a
 * largura de cada altura vira um ANGULO (arco/raio), porque a peca de
 * verdade e um leque que fecha em cone, nao uma tira reta.
 */
export interface ConeSlice {
  /** Distancia radial acumulada desde o apice (real ou virtual), em cm — e o "raio" desse ponto no leque plano. */
  s: number;
  /** Largura real de UM gomo naquela altura (o dobro da meia-largura cadastrada), em cm. */
  larguraCm: number;
  /** Altura original no perfil do molde (cm) — so referencia/rotulo. */
  yCm: number;
}

export interface ConeDevelopment {
  slices: ConeSlice[];
  /** Distancia do apice virtual ate o 1o ponto do trecho (0 quando o trecho ja comeca numa ponta de verdade). */
  apiceExtensaoCm: number;
  /** Raio total do leque (distancia do apice ate a borda mais larga). */
  raioTotalCm: number;
}

/**
 * Acha o indice do ponto mais largo do perfil — e o "meio do molde" (o pico
 * do bojo), onde o cone do bico e o cone da boca se encontram.
 */
export function indiceMaisLargo(points: ProfilePoint[]): number {
  let best = 0;
  for (let i = 1; i < points.length; i += 1) {
    if (points[i].halfWidthCm > points[best].halfWidthCm) best = i;
  }
  return best;
}

/**
 * `pontosDaPonta` tem que vir ORDENADO da extremidade mais estreita pra mais
 * larga (ex.: do bico pro meio, ou da boca pro meio). Se a extremidade nao
 * for um bico de verdade (largura > 0, tipo a boca de um balao que abre),
 * estende virtualmente o 1o trecho ate achar onde a largura chegaria a
 * zero — assim o leque sai com o angulo certo mesmo pra um tronco-de-cone.
 *
 * `quantidadeGomos` e necessario pra achar o raio VERDADEIRO do balao em
 * cada altura (raio = quantidadeGomos * meiaLargura / pi — a largura de UM
 * gomo e so 1/N da circunferencia real) — a distancia percorrida ao longo
 * da geratriz do cone (o "s" acumulado) tem que seguir esse raio real, nao
 * a largura do gomo direto, senao o angulo do leque sai errado (foi um bug
 * real: dava um leque bem mais aberto do que devia).
 */
export function developCone(pontosDaPonta: ProfilePoint[], quantidadeGomos: number): ConeDevelopment {
  if (pontosDaPonta.length === 0) {
    return { slices: [], apiceExtensaoCm: 0, raioTotalCm: 0 };
  }

  const K = quantidadeGomos / Math.PI;
  const raioVerdadeiro = (halfWidthCm: number) => halfWidthCm * K;

  const first = pontosDaPonta[0];
  let apiceExtensaoCm = 0;

  const r0 = raioVerdadeiro(first.halfWidthCm);
  if (r0 > 0.01 && pontosDaPonta.length > 1) {
    const second = pontosDaPonta[1];
    const deltaY = second.yCm - first.yCm;
    const deltaR = raioVerdadeiro(second.halfWidthCm) - r0;
    const segLen = Math.sqrt(deltaY * deltaY + deltaR * deltaR);
    if (Math.abs(deltaR) > 0.0001) {
      apiceExtensaoCm = Math.max(0, (segLen * r0) / deltaR);
    }
  }

  const slices: ConeSlice[] = [{ s: apiceExtensaoCm, larguraCm: first.halfWidthCm * 2, yCm: first.yCm }];

  let s = apiceExtensaoCm;
  for (let i = 1; i < pontosDaPonta.length; i += 1) {
    const prev = pontosDaPonta[i - 1];
    const curr = pontosDaPonta[i];
    const deltaY = curr.yCm - prev.yCm;
    const deltaR = raioVerdadeiro(curr.halfWidthCm) - raioVerdadeiro(prev.halfWidthCm);
    s += Math.sqrt(deltaY * deltaY + deltaR * deltaR);
    slices.push({ s, larguraCm: curr.halfWidthCm * 2, yCm: curr.yCm });
  }

  return { slices, apiceExtensaoCm, raioTotalCm: s };
}

/** Angulo (radianos) de UM gomo naquela fatia — arco (largura real) dividido pelo raio. No proprio apice (s=0) e 0. */
export function anguloPorGomo(slice: ConeSlice): number {
  if (slice.s <= 0.0001) return 0;
  return slice.larguraCm / slice.s;
}

export type Pt = [number, number];

export interface ConeFan {
  slices: ConeSlice[];
  raioTotalCm: number;
  /** Contorno fechado do leque (esquerda de cima a baixo + direita de baixo a cima), em pontos crus [x,y] cm. */
  outlinePoints: Pt[];
  /** Uma polyline (lista de pontos, apice ate a borda) por linha divisoria entre o gomo k e k+1. */
  divisoriasPoints: Pt[][];
}

/** SVG `<path>` `d=` fechado a partir de pontos crus. */
export function pointsToClosedPathD(points: Pt[]): string {
  if (points.length === 0) return '';
  return `M ${points.map(([x, y]) => `${x},${y}`).join(' L ')} Z`;
}

/** SVG `<polyline>` `points=` a partir de pontos crus (sem "L" — e uma lista de coordenadas, nao um path). */
export function pointsToPolylineAttr(points: Pt[]): string {
  return points.map(([x, y]) => `${x},${y}`).join(' ');
}

/**
 * Monta o leque completo pra `numGomos` gomos (pode ser o total do balao ou
 * so a fatia que vai ser desenhada), com `flip=false` abrindo pra BAIXO
 * (apice em cima — cone do bico) ou `flip=true` abrindo pra CIMA (apice
 * embaixo — cone da boca). Coordenadas em cm, prontas pra desenhar tanto
 * num SVG (viewBox em cm) quanto num jsPDF (unit:'cm').
 */
export function buildConeFan(
  development: ConeDevelopment,
  numGomos: number,
  flip: boolean,
  apiceX: number,
  apiceY: number
): ConeFan {
  const { slices, raioTotalCm } = development;

  const point = (s: number, anguloRad: number): Pt => {
    const x = apiceX + s * Math.sin(anguloRad);
    const y = flip ? apiceY - s * Math.cos(anguloRad) : apiceY + s * Math.cos(anguloRad);
    return [x, y];
  };

  const left = slices.map((slice) => point(slice.s, -(anguloPorGomo(slice) * numGomos) / 2));
  const right = [...slices].reverse().map((slice) => point(slice.s, (anguloPorGomo(slice) * numGomos) / 2));
  const outlinePoints = [...left, ...right];

  const divisoriasPoints: Pt[][] = [];
  for (let k = 1; k < numGomos; k += 1) {
    divisoriasPoints.push(
      slices.map((slice) => point(slice.s, -(anguloPorGomo(slice) * numGomos) / 2 + anguloPorGomo(slice) * k))
    );
  }

  return { slices, raioTotalCm, outlinePoints, divisoriasPoints };
}

export interface BalaoConeModel {
  /** Cone superior — fecha na ponta do bico. */
  bico: ConeDevelopment;
  /** Cone inferior — abre (ou converge) na boca. */
  boca: ConeDevelopment;
  /** Largura real (cm) no ponto mais largo — onde os 2 cones se encontram. */
  larguraNoEncontroCm: number;
}

/** A partir dos pontos crus do molde, monta os 2 desenvolvimentos de cone (bico e boca), divididos no ponto mais largo. */
export function buildBalaoConeModel(pontos: MoldPoint[], quantidadeGomos: number): BalaoConeModel | null {
  const points = buildProfilePoints(pontos);
  if (points.length < 2 || quantidadeGomos <= 0) return null;

  const splitIndex = indiceMaisLargo(points);
  const bicoPontos = [...points.slice(splitIndex)].reverse(); // do bico (ponta) pro encontro
  const bocaPontos = points.slice(0, splitIndex + 1); // da boca pro encontro

  return {
    bico: developCone(bicoPontos, quantidadeGomos),
    boca: developCone(bocaPontos, quantidadeGomos),
    larguraNoEncontroCm: points[splitIndex].halfWidthCm * 2,
  };
}
