import { jsPDF } from 'jspdf';
import { CM_POR_PIXEL, computeTacosPerFolha, type BandeiraColorSummaryEntry } from './bandeiraImage';
import { BG_LIGHT, BORDER_LIGHT, drawCaption, formatCm, hexToRgb, MARGIN_CM, ptToCm, TEXT_BODY, TEXT_DARK, TEXT_MUTED } from './pdfDrawHelpers';

export type BandeiraDivisionMode = 'inteira' | '2' | '4';

export interface BandeiraPdfOptions {
  nome: string;
  larguraCm: number;
  alturaCm: number;
  /** Sempre em escala real (1 celula = 1cm). */
  gridWidth: number;
  gridHeight: number;
  /** Linha a linha, index = y * gridWidth + x. */
  colors: string[];
  /** Ja ordenada (define o numero de cada cor: indice + 1). */
  colorSummary: BandeiraColorSummaryEntry[];
  divisionMode: BandeiraDivisionMode;
  /** Linha fina em volta de CADA taco (bloco de 10x10cm reais) — mesma
   * granularidade da numeracao, senao os blocos da mesma cor ficam sem
   * separacao visivel entre si. */
  showFineGrid: boolean;
  fineGridColor: string;
  showCoarseGrid: boolean;
  coarseGridColor: string;
  /** Tamanho da folha/taco em cm reais (ex: 70 x 50). */
  coarseCols: number;
  coarseRows: number;
  /** Tamanho do taco (cm) usado pra calcular a coluna de tacos/folhas por
   * cor na tabela da capa (aba Contagem de folha). */
  tacoSizeCm: number;
}

const INFO_WIDTH_CM = 19;
const CAPTION_H_CM = 1.3;
/** Tamanho "de papel" de cada TACO desenhado no PDF — isso e uma folha de
 * REFERENCIA pra contar/montar (estilo pintura numerada), nao um recorte
 * fisico em escala 1:1 (isso e a Fase 2, fora do escopo atual). Cada taco
 * (bloco de 10x10cm reais) vira um quadradinho de 0,6cm no papel. */
const DEFAULT_TACO_RENDER_CM = 0.6;
/** Nunca deixa uma pagina passar disso (bem abaixo do limite tecnico do
 * jsPDF, ~480cm) — bandeiras grandes desenham os tacos menores, mas sempre
 * cabem numa pagina so, sem tilar em "monte de partes". */
const MAX_PAGE_DIM_CM = 220;
/** Abaixo disso o numero fica ilegivel — pula a numeracao nesse caso. */
const MIN_TACO_CM_FOR_NUMBER = 0.32;

interface PixelRegion {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  label: string;
}

/** Divide a bandeira nas partes pedidas pelo usuario (inteira / 2 = metade
 * horizontal, empilhadas / 4 = grade 2x2) — cada parte vira exatamente 1
 * pagina de desenho. */
function buildRegions(gridWidth: number, gridHeight: number, mode: BandeiraDivisionMode): PixelRegion[] {
  if (mode === 'inteira') {
    return [{ x0: 0, y0: 0, x1: gridWidth, y1: gridHeight, label: 'Bandeira inteira' }];
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

/** Tamanho de taco (em cm de papel) que faz essa regiao caber em
 * MAX_PAGE_DIM_CM — nunca maior que DEFAULT_TACO_RENDER_CM. */
function computeTacoRenderCm(region: PixelRegion): number {
  const tacosWide = (region.x1 - region.x0) / CM_POR_PIXEL;
  const tacosTall = (region.y1 - region.y0) / CM_POR_PIXEL;
  const naturalW = tacosWide * DEFAULT_TACO_RENDER_CM;
  const naturalH = tacosTall * DEFAULT_TACO_RENDER_CM;
  const scale = Math.min(1, MAX_PAGE_DIM_CM / Math.max(naturalW, naturalH, 0.001));
  return DEFAULT_TACO_RENDER_CM * scale;
}

/** Desenha os pixels de uma regiao como blocos vetoriais — mescla celulas
 * iguais seguidas em CADA linha num unico retangulo (RLE horizontal), senao
 * uma bandeira de milhoes de celulas geraria milhoes de retangulos. */
function drawRegionPixels(doc: jsPDF, colors: string[], gridWidth: number, region: PixelRegion, cellCm: number, originXcm: number, originYcm: number): void {
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

/** 1 numero por TACO (bloco de 10x10cm reais) — e a unidade fisica que o
 * time monta/conta, numerar por cm real ficaria ilegivel e nao bate com o
 * jeito que a bandeira e montada de verdade. */
function drawTacoNumbers(
  doc: jsPDF,
  colors: string[],
  gridWidth: number,
  region: PixelRegion,
  colorNumberMap: Map<string, number>,
  cellCm: number,
  originXcm: number,
  originYcm: number
): void {
  const tacoCm = cellCm * CM_POR_PIXEL;
  if (tacoCm < MIN_TACO_CM_FOR_NUMBER) {
    return;
  }
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(Math.max(5, Math.min(24, tacoCm * 28.35 * 0.42)));
  doc.setLineWidth(0.001);
  for (let y = region.y0; y < region.y1; y += CM_POR_PIXEL) {
    for (let x = region.x0; x < region.x1; x += CM_POR_PIXEL) {
      const hex = colors[y * gridWidth + x];
      const number = colorNumberMap.get(hex);
      if (number == null) {
        continue;
      }
      const [r, g, b] = hexToRgb(hex);
      const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
      doc.setTextColor(luminance > 140 ? 30 : 245, luminance > 140 ? 30 : 245, luminance > 140 ? 30 : 245);
      const cx = originXcm + (x - region.x0) * cellCm + tacoCm / 2;
      const cy = originYcm + (y - region.y0) * cellCm + tacoCm / 2;
      doc.text(String(number), cx, cy, { align: 'center', baseline: 'middle' });
    }
  }
}

/** Linha fina em volta de CADA taco (bloco de 10x10cm reais) — mesma
 * granularidade da numeracao, senao 2 blocos vizinhos da mesma cor ficam
 * grudados sem separacao visivel. */
function drawFineGridOverlay(doc: jsPDF, region: PixelRegion, colorHex: string, cellCm: number, originXcm: number, originYcm: number): void {
  const width = (region.x1 - region.x0) * cellCm;
  const height = (region.y1 - region.y0) * cellCm;
  doc.setDrawColor(...hexToRgb(colorHex));
  doc.setLineWidth(0.008);
  for (let x = region.x0; x <= region.x1; x += CM_POR_PIXEL) {
    const rel = (x - region.x0) * cellCm;
    doc.line(originXcm + rel, originYcm, originXcm + rel, originYcm + height);
  }
  for (let y = region.y0; y <= region.y1; y += CM_POR_PIXEL) {
    const rel = (y - region.y0) * cellCm;
    doc.line(originXcm, originYcm + rel, originXcm + width, originYcm + rel);
  }
}

/** Linhas da grade de folhas/tacos, alinhadas com a grade GLOBAL (nao
 * reinicia do zero em cada regiao/pagina). */
function drawCoarseGridOverlay(doc: jsPDF, region: PixelRegion, coarseCols: number, coarseRows: number, colorHex: string, cellCm: number, originXcm: number, originYcm: number): void {
  const width = (region.x1 - region.x0) * cellCm;
  const height = (region.y1 - region.y0) * cellCm;
  doc.setDrawColor(...hexToRgb(colorHex));
  doc.setLineWidth(0.035);
  const firstX = Math.ceil(region.x0 / coarseCols) * coarseCols;
  for (let x = firstX; x <= region.x1; x += coarseCols) {
    const rel = (x - region.x0) * cellCm;
    doc.line(originXcm + rel, originYcm, originXcm + rel, originYcm + height);
  }
  const firstY = Math.ceil(region.y0 / coarseRows) * coarseRows;
  for (let y = firstY; y <= region.y1; y += coarseRows) {
    const rel = (y - region.y0) * cellCm;
    doc.line(originXcm, originYcm + rel, originXcm + width, originYcm + rel);
  }
}

function addBandeiraPage(doc: jsPDF, options: BandeiraPdfOptions, region: PixelRegion, colorNumberMap: Map<string, number>): void {
  const cellCm = computeTacoRenderCm(region) / CM_POR_PIXEL;
  const width = (region.x1 - region.x0) * cellCm;
  const height = (region.y1 - region.y0) * cellCm;
  const pageWidthCm = Math.max(width + MARGIN_CM * 2, MARGIN_CM * 2 + 3);
  const pageHeightCm = height + MARGIN_CM * 2 + CAPTION_H_CM;
  doc.addPage([pageWidthCm, pageHeightCm], pageWidthCm >= pageHeightCm ? 'l' : 'p');
  drawCaption(doc, pageWidthCm, options.nome, region.label);
  const originX = MARGIN_CM;
  const originY = MARGIN_CM + CAPTION_H_CM;
  drawRegionPixels(doc, options.colors, options.gridWidth, region, cellCm, originX, originY);
  if (options.showFineGrid) {
    drawFineGridOverlay(doc, region, options.fineGridColor, cellCm, originX, originY);
  }
  if (options.showCoarseGrid && options.coarseCols > 0 && options.coarseRows > 0) {
    drawCoarseGridOverlay(doc, region, options.coarseCols, options.coarseRows, options.coarseGridColor, cellCm, originX, originY);
  }
  drawTacoNumbers(doc, options.colors, options.gridWidth, region, colorNumberMap, cellCm, originX, originY);
}

/** Desenha o cabecalho + stats + tabela de cores (com o numero de cada cor,
 * igual a legenda da aba Numerar) na pagina de capa. Devolve a altura usada —
 * chamada 1x numa pagina "de sobra" so pra medir, e 1x na pagina de verdade
 * (ja no tamanho exato) pra desenhar de fato. */
function renderInfoPage(doc: jsPDF, options: BandeiraPdfOptions, pageWidthCm: number): number {
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
  const tacosPorFolhaInfo = computeTacosPerFolha(options.tacoSizeCm);
  const stats: Array<[string, string]> = [
    ['TAMANHO REAL', `${formatCm(larguraCm)} x ${formatCm(alturaCm)}`],
    ['TAMANHO DO TACO SOLICITADO', `${options.tacoSizeCm}cm (${tacosPorFolhaInfo}/folha)`],
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
  doc.text('Tabela de cores', contentX, y + ptToCm(9.5));
  y += ptToCm(9.5) + 0.3;

  const numColW = 0.9;
  const swatchColW = 1.1;
  const pixelsColW = 2.7;
  const tacosColW = 2.1;
  const folhasColW = 2.1;
  const nameColW = contentW - numColW - swatchColW - pixelsColW - tacosColW - folhasColW;
  // A quantidade de tacos e sempre no taco PADRAO (CM_POR_PIXEL) — nao muda
  // com o tamanho escolhido pra cortar. So a quantidade de folhas muda.
  const tacoPadraoAreaCm2 = CM_POR_PIXEL * CM_POR_PIXEL;
  const tacosPerFolha = computeTacosPerFolha(options.tacoSizeCm);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(...TEXT_MUTED);
  doc.text('#', contentX, y + ptToCm(7.5));
  doc.text('NOME', contentX + numColW + swatchColW, y + ptToCm(7.5));
  doc.text('PIXELS', contentX + numColW + swatchColW + nameColW, y + ptToCm(7.5));
  doc.text(`TACOS (${CM_POR_PIXEL}cm)`, contentX + numColW + swatchColW + nameColW + pixelsColW, y + ptToCm(7.5));
  doc.text(`FOLHAS (${options.tacoSizeCm}cm)`, contentX + numColW + swatchColW + nameColW + pixelsColW + tacosColW, y + ptToCm(7.5));
  y += ptToCm(7.5) + 0.12;
  doc.setDrawColor(...BORDER_LIGHT);
  doc.setLineWidth(0.015);
  doc.line(contentX, y, contentX + contentW, y);
  y += 0.4;

  colorSummary.forEach((entry, index) => {
    const rowY = y;
    const tacos = Math.round(entry.count / tacoPadraoAreaCm2);
    const folhas = tacosPerFolha > 0 ? Math.ceil(tacos / tacosPerFolha) : 0;
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
    doc.text(entry.count.toLocaleString('pt-BR'), contentX + numColW + swatchColW + nameColW, rowY);
    doc.setFont('helvetica', 'bold');
    doc.text(tacos.toLocaleString('pt-BR'), contentX + numColW + swatchColW + nameColW + pixelsColW, rowY);
    doc.text(folhas.toLocaleString('pt-BR'), contentX + numColW + swatchColW + nameColW + pixelsColW + tacosColW, rowY);
    y += 0.55;
    doc.setDrawColor(...BORDER_LIGHT);
    doc.setLineWidth(0.008);
    doc.line(contentX, y - 0.2, contentX + contentW, y - 0.2);
  });
  y += 0.2 + MARGIN_CM - 0.4;
  return y;
}

/**
 * Gera o PDF de referencia da bandeira (estilo pintura numerada, pra
 * contar/montar os tacos) — NAO e um arquivo de corte em escala fisica 1:1
 * (isso ficou pra Fase 2). Estrutura: 1a pagina = capa (stats + tabela de
 * cores numerada), depois 1 pagina por parte (inteira, ou 2 = topo/base, ou
 * 4 = grade 2x2), cada uma com a grade de folhas/tacos e o numero de cada
 * cor desenhados em cima dos blocos.
 */
export function buildBandeiraPdf(options: BandeiraPdfOptions): Blob {
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
    addBandeiraPage(doc, options, region, colorNumberMap);
  }

  return doc.output('blob');
}
