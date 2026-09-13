import { jsPDF } from 'jspdf';
import type { BandeiraColorSummaryEntry } from './bandeiraImage';
import { BG_LIGHT, BORDER_LIGHT, drawCaption, formatCm, hexToRgb, MARGIN_CM, ptToCm, TEXT_BODY, TEXT_DARK, TEXT_MUTED } from './pdfDrawHelpers';

export type PainelDivisionMode = 'inteira' | '2' | '4';
export type PainelDisplayMode = 'quadrado' | 'bolinha';

/** Preto e tratado como "modulo apagado/fundo" no Painel — nao entra na
 * tabela de cores/contagem (nao se compra modulo preto). */
const PAINEL_BLACK_HEX = '#000000';

export interface PainelPdfOptions {
  nome: string;
  larguraCm: number;
  alturaCm: number;
  malhaCm: number;
  gridWidth: number;
  gridHeight: number;
  /** Linha a linha, index = y * gridWidth + x. */
  colors: string[];
  /** Ja ordenada (define o numero de cada cor: indice + 1) — sem preto. */
  colorSummary: BandeiraColorSummaryEntry[];
  divisionMode: PainelDivisionMode;
  displayMode: PainelDisplayMode;
  showFineGrid: boolean;
  fineGridColor: string;
  /** Grade de divisoes (ex: 5x5 modulos) — so organizacao visual, sem
   * relacao com corte/contagem de material. */
  showDivisionGrid: boolean;
  divisionGridColor: string;
  divisionCols: number;
  divisionRows: number;
  /** Desenha o numero de cada cor em cima das celulas (aba Numerar). Quando
   * false, o desenho sai limpo, sem numeros. */
  showNumbers: boolean;
}

const INFO_WIDTH_CM = 19;
const CAPTION_H_CM = 1.3;
/** Tamanho "de papel" de cada malha desenhada no PDF — folha de referencia
 * pra contar/montar, nao um recorte fisico em escala 1:1. */
const DEFAULT_CELL_RENDER_CM = 0.6;
/** Nunca deixa uma pagina passar disso (bem abaixo do limite tecnico do
 * jsPDF, ~480cm) — paineis grandes desenham as malhas menores, mas sempre
 * cabem numa pagina so. */
const MAX_PAGE_DIM_CM = 220;
const MIN_CELL_CM_FOR_NUMBER = 0.32;
/** Fundo escuro atras das bolinhas — visual de painel de LED apagado. */
const BOLINHA_BG_RGB: [number, number, number] = [8, 16, 11];
const BOLINHA_RADIUS_RATIO = 0.32;

interface PixelRegion {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  label: string;
}

/** Divide o painel nas partes pedidas (inteira / 2 = metade horizontal,
 * empilhadas / 4 = grade 2x2) — cada parte vira exatamente 1 pagina. */
function buildRegions(gridWidth: number, gridHeight: number, mode: PainelDivisionMode): PixelRegion[] {
  if (mode === 'inteira') {
    return [{ x0: 0, y0: 0, x1: gridWidth, y1: gridHeight, label: 'Painel inteiro' }];
  }
  if (mode === '2') {
    const midY = Math.round(gridHeight / 2);
    return [
      { x0: 0, y0: 0, x1: gridWidth, y1: midY, label: 'Parte 1 de 2 (topo)' },
      { x0: 0, y0: midY, x1: gridWidth, y1: gridHeight, label: 'Parte 2 de 2 (base)' },
    ];
  }
  const midX = Math.round(gridWidth / 2);
  const midY = Math.round(gridHeight / 2);
  return [
    { x0: 0, y0: 0, x1: midX, y1: midY, label: 'Parte 1 de 4 (topo-esquerda)' },
    { x0: midX, y0: 0, x1: gridWidth, y1: midY, label: 'Parte 2 de 4 (topo-direita)' },
    { x0: 0, y0: midY, x1: midX, y1: gridHeight, label: 'Parte 3 de 4 (base-esquerda)' },
    { x0: midX, y0: midY, x1: gridWidth, y1: gridHeight, label: 'Parte 4 de 4 (base-direita)' },
  ];
}

/** Tamanho de celula (em cm de papel) que faz essa regiao caber em
 * MAX_PAGE_DIM_CM — nunca maior que DEFAULT_CELL_RENDER_CM. */
function computeCellRenderCm(region: PixelRegion): number {
  const cellsWide = region.x1 - region.x0;
  const cellsTall = region.y1 - region.y0;
  const naturalW = cellsWide * DEFAULT_CELL_RENDER_CM;
  const naturalH = cellsTall * DEFAULT_CELL_RENDER_CM;
  const scale = Math.min(1, MAX_PAGE_DIM_CM / Math.max(naturalW, naturalH, 0.001));
  return DEFAULT_CELL_RENDER_CM * scale;
}

/** Modo quadrado: mescla celulas iguais seguidas em CADA linha num unico
 * retangulo (RLE horizontal), senao um painel de milhares de celulas geraria
 * milhares de retangulos. */
function drawRegionSquares(doc: jsPDF, colors: string[], gridWidth: number, region: PixelRegion, cellCm: number, originXcm: number, originYcm: number): void {
  const { x0, y0, x1 } = region;
  for (let y = y0; y < region.y1; y += 1) {
    let runStart = x0;
    let runColor = colors[y * gridWidth + runStart];
    for (let x = x0 + 1; x <= x1; x += 1) {
      const current = x < x1 ? colors[y * gridWidth + x] : null;
      if (current !== runColor) {
        doc.setFillColor(...hexToRgb(runColor));
        doc.rect(originXcm + (runStart - x0) * cellCm, originYcm + (y - y0) * cellCm, (x - runStart) * cellCm, cellCm, 'F');
        runStart = x;
        runColor = current as string;
      }
    }
  }
}

/** Modo bolinha: fundo escuro (1 retangulo so pra regiao inteira) + 1 circulo
 * colorido por celula — visual de painel de LED. */
function drawRegionDots(doc: jsPDF, colors: string[], gridWidth: number, region: PixelRegion, cellCm: number, originXcm: number, originYcm: number): void {
  const width = (region.x1 - region.x0) * cellCm;
  const height = (region.y1 - region.y0) * cellCm;
  doc.setFillColor(...BOLINHA_BG_RGB);
  doc.rect(originXcm, originYcm, width, height, 'F');

  const radius = Math.max(0.02, cellCm * BOLINHA_RADIUS_RATIO);
  for (let y = region.y0; y < region.y1; y += 1) {
    for (let x = region.x0; x < region.x1; x += 1) {
      const hex = colors[y * gridWidth + x];
      if (hex === PAINEL_BLACK_HEX) {
        continue;
      }
      const cx = originXcm + (x - region.x0) * cellCm + cellCm / 2;
      const cy = originYcm + (y - region.y0) * cellCm + cellCm / 2;
      doc.setFillColor(...hexToRgb(hex));
      doc.circle(cx, cy, radius, 'F');
    }
  }
}

/** 1 numero por celula de malha — pula a numeracao de celulas pretas (fundo
 * apagado, nao e um modulo real). */
function drawCellNumbers(doc: jsPDF, colors: string[], gridWidth: number, region: PixelRegion, colorNumberMap: Map<string, number>, cellCm: number, originXcm: number, originYcm: number): void {
  if (cellCm < MIN_CELL_CM_FOR_NUMBER) {
    return;
  }
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(Math.max(5, Math.min(24, cellCm * 28.35 * 0.42)));
  for (let y = region.y0; y < region.y1; y += 1) {
    for (let x = region.x0; x < region.x1; x += 1) {
      const hex = colors[y * gridWidth + x];
      const number = colorNumberMap.get(hex);
      if (number == null) {
        continue;
      }
      const [r, g, b] = hexToRgb(hex);
      const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
      doc.setTextColor(luminance > 140 ? 30 : 245, luminance > 140 ? 30 : 245, luminance > 140 ? 30 : 245);
      const cx = originXcm + (x - region.x0) * cellCm + cellCm / 2;
      const cy = originYcm + (y - region.y0) * cellCm + cellCm / 2;
      doc.text(String(number), cx, cy, { align: 'center', baseline: 'middle' });
    }
  }
}

function drawFineGridOverlay(doc: jsPDF, region: PixelRegion, colorHex: string, cellCm: number, originXcm: number, originYcm: number): void {
  const width = (region.x1 - region.x0) * cellCm;
  const height = (region.y1 - region.y0) * cellCm;
  doc.setDrawColor(...hexToRgb(colorHex));
  doc.setLineWidth(0.008);
  for (let x = region.x0; x <= region.x1; x += 1) {
    const rel = (x - region.x0) * cellCm;
    doc.line(originXcm + rel, originYcm, originXcm + rel, originYcm + height);
  }
  for (let y = region.y0; y <= region.y1; y += 1) {
    const rel = (y - region.y0) * cellCm;
    doc.line(originXcm, originYcm + rel, originXcm + width, originYcm + rel);
  }
}

/** Grade de divisoes (ex: 5x5 modulos), alinhada com a grade GLOBAL (nao
 * reinicia do zero em cada regiao/pagina) — so organizacao visual. */
function drawDivisionGridOverlay(doc: jsPDF, region: PixelRegion, divisionCols: number, divisionRows: number, colorHex: string, cellCm: number, originXcm: number, originYcm: number): void {
  const width = (region.x1 - region.x0) * cellCm;
  const height = (region.y1 - region.y0) * cellCm;
  doc.setDrawColor(...hexToRgb(colorHex));
  doc.setLineWidth(0.035);
  const firstX = Math.ceil(region.x0 / divisionCols) * divisionCols;
  for (let x = firstX; x <= region.x1; x += divisionCols) {
    const rel = (x - region.x0) * cellCm;
    doc.line(originXcm + rel, originYcm, originXcm + rel, originYcm + height);
  }
  const firstY = Math.ceil(region.y0 / divisionRows) * divisionRows;
  for (let y = firstY; y <= region.y1; y += divisionRows) {
    const rel = (y - region.y0) * cellCm;
    doc.line(originXcm, originYcm + rel, originXcm + width, originYcm + rel);
  }
}

function addPainelPage(doc: jsPDF, options: PainelPdfOptions, region: PixelRegion, colorNumberMap: Map<string, number>): void {
  const cellCm = computeCellRenderCm(region);
  const width = (region.x1 - region.x0) * cellCm;
  const height = (region.y1 - region.y0) * cellCm;
  const pageWidthCm = Math.max(width + MARGIN_CM * 2, MARGIN_CM * 2 + 3);
  const pageHeightCm = height + MARGIN_CM * 2 + CAPTION_H_CM;
  doc.addPage([pageWidthCm, pageHeightCm], pageWidthCm >= pageHeightCm ? 'l' : 'p');
  drawCaption(doc, pageWidthCm, options.nome, region.label);
  const originX = MARGIN_CM;
  const originY = MARGIN_CM + CAPTION_H_CM;
  if (options.displayMode === 'bolinha') {
    drawRegionDots(doc, options.colors, options.gridWidth, region, cellCm, originX, originY);
  } else {
    drawRegionSquares(doc, options.colors, options.gridWidth, region, cellCm, originX, originY);
  }
  if (options.showFineGrid) {
    drawFineGridOverlay(doc, region, options.fineGridColor, cellCm, originX, originY);
  }
  if (options.showDivisionGrid && options.divisionCols > 0 && options.divisionRows > 0) {
    drawDivisionGridOverlay(doc, region, options.divisionCols, options.divisionRows, options.divisionGridColor, cellCm, originX, originY);
  }
  if (options.showNumbers) {
    drawCellNumbers(doc, options.colors, options.gridWidth, region, colorNumberMap, cellCm, originX, originY);
  }
}

/** Desenha o cabecalho + stats + tabela de cores (numerada, sem preto) na
 * pagina de capa. Devolve a altura usada — chamada 1x numa pagina "de sobra"
 * so pra medir, e 1x na pagina de verdade (ja no tamanho exato) pra desenhar. */
function renderInfoPage(doc: jsPDF, options: PainelPdfOptions, pageWidthCm: number): number {
  const { nome, larguraCm, alturaCm, colorSummary } = options;
  const contentX = MARGIN_CM;
  const contentW = pageWidthCm - MARGIN_CM * 2;
  let y = MARGIN_CM;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(...TEXT_MUTED);
  doc.text('CARDOZO PROJETOS', contentX, y + ptToCm(9));
  doc.setFont('helvetica', 'normal');
  doc.text(new Date().toLocaleDateString('pt-BR'), contentX + contentW, y + ptToCm(9), { align: 'right' });
  y += ptToCm(9) + 0.25;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(19);
  doc.setTextColor(...TEXT_DARK);
  doc.text(nome, contentX, y + ptToCm(19));
  y += ptToCm(19) + 0.5;

  const statBoxH = 1.7;
  const statGap = 0.3;
  const statBoxW = (contentW - statGap * 2) / 3;
  const stats: Array<[string, string]> = [
    ['TAMANHO REAL', `${formatCm(larguraCm)} x ${formatCm(alturaCm)}`],
    ['MALHA', `${options.malhaCm}cm`],
    ['CORES DISTINTAS', String(colorSummary.length)],
  ];
  stats.forEach(([label, value], index) => {
    const boxX = contentX + index * (statBoxW + statGap);
    doc.setFillColor(...BG_LIGHT);
    doc.setDrawColor(...BORDER_LIGHT);
    doc.setLineWidth(0.01);
    doc.roundedRect(boxX, y, statBoxW, statBoxH, 0.08, 0.08, 'FD');
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...TEXT_MUTED);
    doc.text(label, boxX + 0.3, y + 0.55);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.setTextColor(...TEXT_DARK);
    doc.text(value, boxX + 0.3, y + 1.25);
  });
  y += statBoxH + 0.6;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(...TEXT_DARK);
  doc.text('Tabela de cores (modulos)', contentX, y + ptToCm(9.5));
  y += ptToCm(9.5) + 0.3;

  const numColW = 0.9;
  const swatchColW = 1.1;
  const qtyColW = 4.5;
  const nameColW = contentW - numColW - swatchColW - qtyColW;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(...TEXT_MUTED);
  doc.text('#', contentX, y + ptToCm(7.5));
  doc.text('NOME', contentX + numColW + swatchColW, y + ptToCm(7.5));
  doc.text(`MODULOS (${options.malhaCm}cm)`, contentX + numColW + swatchColW + nameColW, y + ptToCm(7.5));
  y += ptToCm(7.5) + 0.12;
  doc.setDrawColor(...BORDER_LIGHT);
  doc.setLineWidth(0.015);
  doc.line(contentX, y, contentX + contentW, y);
  y += 0.4;

  colorSummary.forEach((entry, index) => {
    const rowY = y;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(...TEXT_DARK);
    doc.text(String(index + 1), contentX, rowY);
    doc.setFillColor(...hexToRgb(entry.hex));
    doc.setDrawColor(...BORDER_LIGHT);
    doc.setLineWidth(0.01);
    doc.roundedRect(contentX + numColW, rowY - 0.32, 0.7, 0.42, 0.05, 0.05, 'FD');
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...TEXT_BODY);
    doc.text(entry.name, contentX + numColW + swatchColW, rowY);
    doc.setFont('helvetica', 'bold');
    doc.text(entry.count.toLocaleString('pt-BR'), contentX + numColW + swatchColW + nameColW, rowY);
    y += 0.55;
    doc.setDrawColor(...BORDER_LIGHT);
    doc.setLineWidth(0.008);
    doc.line(contentX, y - 0.2, contentX + contentW, y - 0.2);
  });
  y += 0.2 + MARGIN_CM - 0.4;
  return y;
}

/**
 * Gera o PDF de referencia do painel (estilo pintura numerada, pra
 * contar/montar os modulos de malha). Sem conceito de "folha de material" —
 * a cor preta (modulo apagado/fundo) nao entra na tabela/contagem. Estrutura:
 * 1a pagina = capa (stats + tabela de cores numerada, sem preto), depois 1
 * pagina por parte (inteira, ou 2 = topo/base, ou 4 = grade 2x2), no modo
 * quadrado ou bolinha.
 */
export function buildPainelPdf(rawOptions: PainelPdfOptions): Blob {
  // preto e modulo apagado/fundo — nunca entra na tabela/contagem/numeracao,
  // mesmo que o chamador tenha esquecido de filtrar.
  const options: PainelPdfOptions = {
    ...rawOptions,
    colorSummary: rawOptions.colorSummary.filter((entry) => entry.hex.toLowerCase() !== PAINEL_BLACK_HEX),
  };
  const regions = buildRegions(options.gridWidth, options.gridHeight, options.divisionMode);
  const colorNumberMap = new Map<string, number>();
  options.colorSummary.forEach((entry, index) => colorNumberMap.set(entry.hex, index + 1));

  const infoWidthCm = INFO_WIDTH_CM;
  const measureDoc = new jsPDF({ unit: 'cm', format: [infoWidthCm, 400], orientation: 'p' });
  const infoHeightCm = renderInfoPage(measureDoc, options, infoWidthCm);

  const doc = new jsPDF({
    unit: 'cm',
    format: [infoWidthCm, infoHeightCm],
    orientation: infoWidthCm >= infoHeightCm ? 'l' : 'p',
  });
  doc.setProperties({ title: `${options.nome} - Alisson Projetos` });
  renderInfoPage(doc, options, infoWidthCm);

  for (const region of regions) {
    addPainelPage(doc, options, region, colorNumberMap);
  }

  return doc.output('blob');
}
