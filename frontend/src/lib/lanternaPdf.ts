import { jsPDF } from 'jspdf';
import type { BandeiraColorSummaryEntry } from './bandeiraImage';
import { BG_LIGHT, BORDER_LIGHT, drawCaption, hexToRgb, MARGIN_CM, ptToCm, TEXT_BODY, TEXT_DARK, TEXT_MUTED } from './pdfDrawHelpers';

export interface LanternaPdfOptions {
  nome: string;
  gomos: number;
  lanternasPorGomo: number;
  lanternasSubindo: number;
  /** Linha a linha, index = y * gridWidth + x. */
  colors: string[];
  gridWidth: number;
  gridHeight: number;
  /** Ja ordenada (define o numero de cada cor: indice + 1). */
  colorSummary: BandeiraColorSummaryEntry[];
  /** Cada lanterna desenhada como circulo (fiel ao objeto real) em vez de quadrado. */
  bolinha: boolean;
  showFineGrid: boolean;
  fineGridColor: string;
  showGomoLines: boolean;
  gomoLineColor: string;
  showDivisaoLines: boolean;
  /** A cada quantas colunas cai 1 linha de divisao (largura total / N partes). */
  divisaoInterval: number;
  divisaoLineColor: string;
}

const INFO_WIDTH_CM = 19;
const CAPTION_H_CM = 1.3;
/** Tamanho "de papel" de cada lanterna desenhada — folha de referencia pra
 * contar/montar, nao um recorte fisico em escala real. */
const DEFAULT_CELL_CM = 0.8;
/** Nunca deixa uma pagina passar disso — grades grandes desenham as
 * lanternas menores, mas sempre cabem numa pagina so. */
const MAX_PAGE_DIM_CM = 220;
const MIN_CELL_CM_FOR_NUMBER = 0.34;

function computeCellRenderCm(gridWidth: number, gridHeight: number): number {
  const naturalW = gridWidth * DEFAULT_CELL_CM;
  const naturalH = gridHeight * DEFAULT_CELL_CM;
  const scale = Math.min(1, MAX_PAGE_DIM_CM / Math.max(naturalW, naturalH, 0.001));
  return DEFAULT_CELL_CM * scale;
}

/** Desenha os pixels — quadrados (RLE horizontal, mescla celulas iguais
 * seguidas numa linha num retangulo so) ou circulos (1 por celula, sem RLE
 * — cada lanterna e um circulo separado, com espaco branco entre elas). */
function drawGridPixels(
  doc: jsPDF,
  colors: string[],
  gridWidth: number,
  gridHeight: number,
  cellCm: number,
  originXcm: number,
  originYcm: number,
  bolinha: boolean
): void {
  if (!bolinha) {
    for (let y = 0; y < gridHeight; y += 1) {
      let runStart = 0;
      let runColor = colors[y * gridWidth];
      for (let x = 1; x <= gridWidth; x += 1) {
        const current = x < gridWidth ? colors[y * gridWidth + x] : null;
        if (current !== runColor) {
          doc.setFillColor(...hexToRgb(runColor));
          doc.rect(originXcm + runStart * cellCm, originYcm + y * cellCm, (x - runStart) * cellCm, cellCm, 'F');
          runStart = x;
          runColor = current as string;
        }
      }
    }
    return;
  }

  const radius = cellCm * 0.42;
  for (let y = 0; y < gridHeight; y += 1) {
    for (let x = 0; x < gridWidth; x += 1) {
      const hex = colors[y * gridWidth + x];
      doc.setFillColor(...hexToRgb(hex));
      doc.circle(originXcm + x * cellCm + cellCm / 2, originYcm + y * cellCm + cellCm / 2, radius, 'F');
    }
  }
}

function drawFineGridOverlay(doc: jsPDF, gridWidth: number, gridHeight: number, colorHex: string, cellCm: number, originXcm: number, originYcm: number): void {
  const width = gridWidth * cellCm;
  const height = gridHeight * cellCm;
  doc.setDrawColor(...hexToRgb(colorHex));
  doc.setLineWidth(0.008);
  for (let x = 0; x <= gridWidth; x += 1) {
    const rel = x * cellCm;
    doc.line(originXcm + rel, originYcm, originXcm + rel, originYcm + height);
  }
  for (let y = 0; y <= gridHeight; y += 1) {
    const rel = y * cellCm;
    doc.line(originXcm, originYcm + rel, originXcm + width, originYcm + rel);
  }
}

/** Linha grossa a cada N colunas (lanternas por gomo) — marca onde 1 gomo
 * acaba e o proximo comeca, pra ficar claro o padrao que se repete. */
function drawGomoLines(doc: jsPDF, gridWidth: number, gridHeight: number, lanternasPorGomo: number, colorHex: string, cellCm: number, originXcm: number, originYcm: number): void {
  if (lanternasPorGomo <= 0) {
    return;
  }
  const height = gridHeight * cellCm;
  doc.setDrawColor(...hexToRgb(colorHex));
  doc.setLineWidth(0.035);
  for (let x = 0; x <= gridWidth; x += lanternasPorGomo) {
    const rel = x * cellCm;
    doc.line(originXcm + rel, originYcm, originXcm + rel, originYcm + height);
  }
}

/** Linha grossa a cada N colunas (largura total / partes) — corta o balao
 * INTEIRO em partes iguais, cor diferente da linha de gomo. */
function drawDivisaoLines(doc: jsPDF, gridWidth: number, gridHeight: number, divisaoInterval: number, colorHex: string, cellCm: number, originXcm: number, originYcm: number): void {
  if (divisaoInterval <= 0) {
    return;
  }
  const height = gridHeight * cellCm;
  doc.setDrawColor(...hexToRgb(colorHex));
  doc.setLineWidth(0.05);
  for (let x = 0; x <= gridWidth; x += divisaoInterval) {
    const rel = x * cellCm;
    doc.line(originXcm + rel, originYcm, originXcm + rel, originYcm + height);
  }
}

function drawCellNumbers(doc: jsPDF, colors: string[], gridWidth: number, gridHeight: number, colorNumberMap: Map<string, number>, cellCm: number, originXcm: number, originYcm: number): void {
  if (cellCm < MIN_CELL_CM_FOR_NUMBER) {
    return;
  }
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(Math.max(5, Math.min(24, cellCm * 28.35 * 0.42)));
  for (let y = 0; y < gridHeight; y += 1) {
    for (let x = 0; x < gridWidth; x += 1) {
      const hex = colors[y * gridWidth + x];
      const number = colorNumberMap.get(hex);
      if (number == null) {
        continue;
      }
      const [r, g, b] = hexToRgb(hex);
      const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
      doc.setTextColor(luminance > 140 ? 30 : 245, luminance > 140 ? 30 : 245, luminance > 140 ? 30 : 245);
      const cx = originXcm + x * cellCm + cellCm / 2;
      const cy = originYcm + y * cellCm + cellCm / 2;
      doc.text(String(number), cx, cy, { align: 'center', baseline: 'middle' });
    }
  }
}

function addLanternaPage(doc: jsPDF, options: LanternaPdfOptions, colorNumberMap: Map<string, number>): void {
  const cellCm = computeCellRenderCm(options.gridWidth, options.gridHeight);
  const width = options.gridWidth * cellCm;
  const height = options.gridHeight * cellCm;
  const pageWidthCm = Math.max(width + MARGIN_CM * 2, MARGIN_CM * 2 + 3);
  const pageHeightCm = height + MARGIN_CM * 2 + CAPTION_H_CM;
  doc.addPage([pageWidthCm, pageHeightCm], pageWidthCm >= pageHeightCm ? 'l' : 'p');
  drawCaption(
    doc,
    pageWidthCm,
    options.nome,
    `${options.gomos} gomos x ${options.lanternasPorGomo} lanternas/gomo x ${options.lanternasSubindo} subindo`
  );
  const originX = MARGIN_CM;
  const originY = MARGIN_CM + CAPTION_H_CM;
  // Fundo preto (mesma logica do canvas na tela): so aparece cor onde o
  // cliente realmente colocou uma lanterna — precisa disso pro modo bolinha,
  // onde os espacos entre os circulos senao ficariam brancos (cor do papel).
  doc.setFillColor(0, 0, 0);
  doc.rect(originX, originY, width, height, 'F');
  drawGridPixels(doc, options.colors, options.gridWidth, options.gridHeight, cellCm, originX, originY, options.bolinha);
  if (options.showFineGrid) {
    drawFineGridOverlay(doc, options.gridWidth, options.gridHeight, options.fineGridColor, cellCm, originX, originY);
  }
  if (options.showGomoLines) {
    drawGomoLines(doc, options.gridWidth, options.gridHeight, options.lanternasPorGomo, options.gomoLineColor, cellCm, originX, originY);
  }
  if (options.showDivisaoLines) {
    drawDivisaoLines(doc, options.gridWidth, options.gridHeight, options.divisaoInterval, options.divisaoLineColor, cellCm, originX, originY);
  }
  drawCellNumbers(doc, options.colors, options.gridWidth, options.gridHeight, colorNumberMap, cellCm, originX, originY);
}

function renderInfoPage(doc: jsPDF, options: LanternaPdfOptions, pageWidthCm: number): number {
  const { nome, gomos, lanternasPorGomo, lanternasSubindo, colorSummary } = options;
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

  // So conta lanterna de verdade (preto = fundo/vazio, ja vem excluido de
  // colorSummary — ver LanternagemBojoWorkspace.tsx).
  const totalLanternas = colorSummary.reduce((sum, entry) => sum + entry.count, 0);
  const statBoxH = 1.7;
  const statGap = 0.3;
  const statBoxW = (contentW - statGap * 3) / 4;
  const stats: Array<[string, string]> = [
    ['GOMOS', String(gomos)],
    ['LANTERNAS/GOMO', String(lanternasPorGomo)],
    ['LANTERNAS SUBINDO', String(lanternasSubindo)],
    ['TOTAL DE LANTERNAS', totalLanternas.toLocaleString('pt-BR')],
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
  doc.text('Contagem de lanternas por cor', contentX, y + ptToCm(9.5));
  y += ptToCm(9.5) + 0.3;

  const numColW = 0.9;
  const swatchColW = 1.1;
  const qtdColW = 3;
  const nameColW = contentW - numColW - swatchColW - qtdColW;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(...TEXT_MUTED);
  doc.text('#', contentX, y + ptToCm(7.5));
  doc.text('NOME', contentX + numColW + swatchColW, y + ptToCm(7.5));
  doc.text('LANTERNAS', contentX + numColW + swatchColW + nameColW, y + ptToCm(7.5));
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
 * Gera o PDF de referencia da lanternagem (estilo pintura numerada, pra
 * contar/montar as lanternas) — capa com stats + contagem de cores numerada,
 * depois 1 pagina com o desenho inteiro (quadrados ou bolinhas), a linha de
 * grade fina e a linha grossa de gomo desenhadas em cima.
 */
export function buildLanternaPdf(options: LanternaPdfOptions): Blob {
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

  addLanternaPage(doc, options, colorNumberMap);

  return doc.output('blob');
}
