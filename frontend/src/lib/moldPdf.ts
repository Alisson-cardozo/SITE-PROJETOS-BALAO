import { jsPDF } from 'jspdf';
import {
  buildMoldProfile,
  buildSeparatedPieces,
  buildTacoDivisions,
  computeSectionTacoTotals,
  expandSectionPartitions,
  interpolateHalfWidth,
  BAINHA_JUNTA_CM,
  SECTION_LABELS,
  SECTION_ORDER,
  type MoldProfile,
  type ProfilePoint,
  type SeparatedPiece,
  type SectionTacoConfigMap,
} from './moldGeometry';
import type { MoldPlotterConfig, MoldPoint } from '../types';

export type MoldExportMode = 'pieces' | 'whole' | 'both';

export interface MoldPdfOptions {
  nome: string;
  modelo: string;
  quantidadeGomos: number;
  bainhaCm: number;
  alturaTotalCm: number;
  pontos: MoldPoint[];
  plotterConfig: MoldPlotterConfig;
  mode: MoldExportMode;
  clientName?: string;
  message?: string;
}

function formatCm(value: number): string {
  const n = Number(value);
  const text = Number.isFinite(n) ? n.toFixed(1).replace(/\.0$/, '').replace('.', ',') : '0';
  return `${text} cm`;
}

function hexToRgb(hex: string): [number, number, number] {
  const match = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex.trim());
  if (!match) {
    return [37, 99, 235];
  }
  return [parseInt(match[1], 16), parseInt(match[2], 16), parseInt(match[3], 16)];
}

function ptToCm(pt: number): number {
  return (pt / 72) * 2.54;
}

const CUT_COLOR: [number, number, number] = [19, 40, 63];
/** Cinza — mais claro que a grade principal (navy escuro) de proposito, pra
 * ler como "marcacao auxiliar" (bainha) e nao como mais uma linha de corte. */
const HEM_COLOR: [number, number, number] = [120, 130, 145];
const JOIN_COLOR: [number, number, number] = [37, 99, 235];
const TEXT_DARK: [number, number, number] = [17, 24, 39];
const TEXT_BODY: [number, number, number] = [55, 65, 81];
const TEXT_MUTED: [number, number, number] = [107, 114, 128];
const BORDER_LIGHT: [number, number, number] = [229, 231, 235];
const BG_LIGHT: [number, number, number] = [249, 250, 251];

const MARGIN_CM = 1.4;
const MIN_WIDTH_CM = 19;
const GRID_LINE_CM = 0.015;
const OUTLINE_LINE_CM = 0.035;
/** Bainha fina (cortes internos + borda direita) e bainha grossa (fechamento,
 * borda esquerda) de CADA taco — usa a mesma espessura da grade principal
 * (ja comprovada visivel), so muda a cor pra ficar clara a diferenca. */
const HEM_LINE_CM = 0.015;
/** Bem mais grossa que a grade (0,015) — senao passa despercebida, ainda mais
 * caindo em cima de uma linha de corte normal (a quebra de pagina e alinhada
 * numa fileira de taco de proposito). Testado visualmente: 0,06 ainda sumia,
 * so ficou visivel de verdade a partir de ~0,15. */
const JOIN_LINE_CM = 0.18;
/**
 * Espaco reservado pra legenda no topo de CADA pagina de desenho (molde
 * inteiro ou peca). Fica sempre perto do topo, com Y pequeno relativo aquela
 * pagina — nunca em cima de uma coordenada absoluta gigante (foi isso que
 * fazia o texto sumir quando tudo ficava numa pagina so de varios metros:
 * confirmado com pdftotext, o desenho/linhas em Y grande funcionam, mas o
 * TEXTO do jsPDF some silenciosamente acima de uma certa altura de pagina).
 */
const CAPTION_H_CM = 1.3;
/** Largura reservada do lado direito do desenho pra regua de cada reparticao
 * (tacos subindo, altura do taco, metragem da parte, tacos/gomo). */
const RULER_EXTRA_CM = 6.5;

/**
 * Desenha o contorno + grade de tacos + bainhas de UM perfil (molde inteiro OU
 * uma peca separada — a mesma estrutura MoldProfile/SectionTacoConfigMap serve
 * pros dois) direto como linhas vetoriais no PDF, 1 unidade jsPDF (cm) = 1cm
 * real. Sem screenshot/raster no meio — por isso nao tem limite de tamanho.
 */
function drawProfile(
  doc: jsPDF,
  profile: MoldProfile,
  tacoConfigs: SectionTacoConfigMap,
  originXcm: number,
  originYcm: number,
  bainhaCm: number = 1.0
): void {
  const { points, alturaTotalCm, larguraMaximaCm, secoes } = profile;
  const maxHalf = Math.max(larguraMaximaCm / 2, 0.1);
  const centerXcm = originXcm + maxHalf;

  const mapXAbs = (xCm: number) => centerXcm + xCm;
  const mapY = (yCm: number) => originYcm + (alturaTotalCm - yCm);

  const BOUNDARY_EPS = BAINHA_JUNTA_CM + 0.15;

  const sectionBands = secoes.flatMap((secao) => {
    const cfg = tacoConfigs[secao.id] ?? { partitions: [] };
    const bands = expandSectionPartitions(secao, cfg);
    return bands.map((band, bandIndexInParent) => {
      const raw = buildTacoDivisions(band, band.flatConfig, points, bainhaCm);
      const divisions = {
        ...raw,
        horizontals: raw.horizontals.filter(
          (line) => Math.abs(line.yCm - band.inicioCm) > BOUNDARY_EPS && Math.abs(line.yCm - band.fimCm) > BOUNDARY_EPS
        ),
        horizontalHems: raw.horizontalHems.filter(
          (line) => Math.abs(line.yCm - band.inicioCm) > BOUNDARY_EPS && Math.abs(line.yCm - band.fimCm) > BOUNDARY_EPS
        ),
      };
      return { secao: band, parentId: secao.id, bandIndexInParent, divisions, config: band.partition };
    });
  });

  // Uma linha por juncao (entre secoes tipo Boca/Bojo/Bico, ou entre reparticoes
  // tipo Bico 1/Bico 2) — igual ao PDF de referencia do plotter: 1 linha de
  // destaque por juncao, sem bainha tracejada por fileira (isso so poluia a
  // grade real sem casar com o formato de referencia).
  const divisionBoundaries = sectionBands
    .filter((band) => Math.abs(band.secao.fimCm - alturaTotalCm) > 0.05)
    .map((band) => {
      const yCm = band.secao.fimCm;
      const half = interpolateHalfWidth(yCm, points);
      const isPartitionSplit = band.bandIndexInParent > 0;
      const parentBands = sectionBands.filter((b) => b.parentId === band.parentId);
      const upperBand = isPartitionSplit ? parentBands[band.bandIndexInParent - 1] : null;
      const colorHex = isPartitionSplit ? upperBand?.config.corDivisao || band.config.corDivisao || null : null;
      return {
        yCm,
        halfCm: half,
        colorRgb: colorHex ? hexToRgb(colorHex) : JOIN_COLOR,
      };
    });

  doc.setDrawColor(...CUT_COLOR);
  doc.setLineWidth(GRID_LINE_CM);
  for (const { divisions } of sectionBands) {
    for (const line of divisions.horizontals) {
      doc.line(mapXAbs(-line.halfCm), mapY(line.yCm), mapXAbs(line.halfCm), mapY(line.yCm));
    }
    for (const poly of divisions.verticals) {
      drawPolyline(
        doc,
        poly.map((p) => [mapXAbs(p.xCm), mapY(p.yCm)] as [number, number])
      );
    }
  }

  // Bainha fina (cortes internos + borda direita, 0,5cm) e bainha grossa
  // (fechamento na borda esquerda, 1cm) de cada taco.
  doc.setDrawColor(...HEM_COLOR);
  doc.setLineWidth(HEM_LINE_CM);
  for (const { divisions } of sectionBands) {
    for (const line of divisions.horizontalHems) {
      doc.line(mapXAbs(-line.halfCm), mapY(line.yCm), mapXAbs(line.halfCm), mapY(line.yCm));
    }
    for (const hem of divisions.verticalHems) {
      drawPolyline(
        doc,
        hem.points.map((p) => [mapXAbs(p.xCm), mapY(p.yCm)] as [number, number])
      );
    }
  }

  // Silhueta de corte externa expandida
  doc.setDrawColor(...CUT_COLOR);
  doc.setLineWidth(OUTLINE_LINE_CM);

  const outline: Array<[number, number]> = [];
  // Lado esquerdo (da boca ate a ponta)
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    outline.push([mapXAbs(-p.halfWidthCm - 1.0), mapY(p.yCm)]);
  }
  // Lado direito (da ponta ate a boca)
  for (let i = points.length - 1; i >= 0; i--) {
    const p = points[i];
    outline.push([mapXAbs(p.halfWidthCm), mapY(p.yCm)]);
  }

  drawPolyline(doc, outline, true);

  for (const boundary of divisionBoundaries) {
    doc.setDrawColor(...boundary.colorRgb);
    doc.setLineWidth(JOIN_LINE_CM);
    doc.line(mapXAbs(-boundary.halfCm), mapY(boundary.yCm), mapXAbs(boundary.halfCm), mapY(boundary.yCm));
  }

  // Regua lateral por reparticao (direita do molde): qt de tacos subindo,
  // altura do taco, metragem dessa parte e tacos/gomo — mesma info da tela.
  {
    const rulerX = centerXcm + maxHalf + 1.2;
    const tickLen = 0.35;
    const textX = rulerX + tickLen + 0.15;
    const lineGap = 0.34;

    for (const band of sectionBands) {
      if (band.divisions.totalTacos <= 0) {
        continue;
      }
      const yTop = mapY(band.secao.fimCm);
      const yBottom = mapY(band.secao.inicioCm);

      doc.setDrawColor(30, 41, 59);
      doc.setLineWidth(GRID_LINE_CM);
      doc.line(rulerX, yTop, rulerX, yBottom);
      doc.line(rulerX - tickLen, yTop, rulerX, yTop);
      doc.line(rulerX - tickLen, yBottom, rulerX, yBottom);

      const yMid = (yTop + yBottom) / 2;
      let ty = yMid - lineGap;
      doc.setTextColor(30, 41, 59);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.5);
      doc.text(`${band.divisions.quantidadeVertical} tacos subindo`, textX, ty);
      doc.setFont('helvetica', 'normal');
      ty += lineGap;
      doc.text(`Taco: ${formatCm(band.config.alturaTacoCm)} altura`, textX, ty);
      ty += lineGap;
      doc.text(`${formatCm(band.secao.alturaCm)} nesta parte`, textX, ty);
      ty += lineGap;
      doc.text(`${band.config.tacosPorGomo} tacos/gomo`, textX, ty);
    }
  }

  // Desenha as réguas na base (Y = 0)
  const halfBase = points[0]?.halfWidthCm ?? 0;
  if (halfBase > 0.1) {
    const wBaseReal = halfBase * 2;
    const wBaseTotal = wBaseReal + 1.0;

    // 1. Régua Interna (Molde Útil) - Verde Escuro [61, 122, 77]
    doc.setDrawColor(61, 122, 77);
    doc.setLineWidth(GRID_LINE_CM);
    // Linhas de chamada
    doc.line(mapXAbs(-halfBase), mapY(0), mapXAbs(-halfBase), mapY(-1.8));
    doc.line(mapXAbs(halfBase), mapY(0), mapXAbs(halfBase), mapY(-1.8));
    // Linha de cota
    doc.line(mapXAbs(-halfBase), mapY(-1.5), mapXAbs(halfBase), mapY(-1.5));
    // Ticks
    doc.line(mapXAbs(-halfBase), mapY(-1.8), mapXAbs(-halfBase), mapY(-1.2));
    doc.line(mapXAbs(halfBase), mapY(-1.8), mapXAbs(halfBase), mapY(-1.2));
    // Texto
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(61, 122, 77);
    doc.text(`${formatCm(wBaseReal)} (Molde util)`, centerXcm, mapY(-1.5) - 0.15, { align: 'center' });

    // 2. Régua Externa (Corte Total com Bainhas) - Azul Escuro [30, 64, 175]
    doc.setDrawColor(30, 64, 175);
    // Linhas de chamada
    doc.line(mapXAbs(-halfBase - 1.0), mapY(0), mapXAbs(-halfBase - 1.0), mapY(-3.3));
    doc.line(mapXAbs(halfBase), mapY(0), mapXAbs(halfBase), mapY(-3.3));
    // Linha de cota
    doc.line(mapXAbs(-halfBase - 1.0), mapY(-3.0), mapXAbs(halfBase), mapY(-3.0));
    // Ticks
    doc.line(mapXAbs(-halfBase - 1.0), mapY(-3.3), mapXAbs(-halfBase - 1.0), mapY(-2.7));
    doc.line(mapXAbs(halfBase), mapY(-3.3), mapXAbs(halfBase), mapY(-2.7));
    // Texto
    doc.setTextColor(30, 64, 175);
    doc.text(`${formatCm(wBaseTotal)} (Corte total)`, centerXcm - 0.25, mapY(-3.0) - 0.15, { align: 'center' });
  }
}

function drawPolyline(doc: jsPDF, pts: Array<[number, number]>, close = false): void {
  if (pts.length < 2) {
    return;
  }
  for (let i = 1; i < pts.length; i += 1) {
    doc.line(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]);
  }
  if (close) {
    doc.line(pts[pts.length - 1][0], pts[pts.length - 1][1], pts[0][0], pts[0][1]);
  }
}

/**
 * O formato PDF proibe paginas com mais de 14400 "user units" (200 polegadas,
 * ~508cm) de largura OU altura (jsPDF avisa e recusa acima disso). Pecas reais
 * podem passar disso (ex.: um Bojo de 539,8cm) — quando passa, a peca e
 * espalhada em varias paginas, cada uma ainda em escala real, deslocando o
 * desenho pra cima a cada pagina e deixando o resto ser cortado pela propria
 * borda da pagina (mesma logica de qualquer visualizador de PDF: nada alem do
 * MediaBox aparece).
 */
const MAX_DRAWABLE_CM = 480;

/** Legenda no topo da pagina do desenho — sempre com Y pequeno (perto de 0), nunca acumulado. */
function drawCaption(doc: jsPDF, pageWidthCm: number, color: string, title: string, subtitle?: string): void {
  const contentX = MARGIN_CM;
  const contentW = pageWidthCm - MARGIN_CM * 2;
  doc.setFillColor(...hexToRgb(color));
  doc.circle(contentX + 0.1, MARGIN_CM + 0.35, 0.08, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(...TEXT_DARK);
  doc.text(title, contentX + 0.32, MARGIN_CM + 0.42);
  if (subtitle) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(...TEXT_BODY);
    doc.text(subtitle, contentX + contentW, MARGIN_CM + 0.42, { align: 'right' });
  }
  doc.setDrawColor(...BORDER_LIGHT);
  doc.setLineWidth(0.01);
  doc.line(contentX, MARGIN_CM + 0.6, contentX + contentW, MARGIN_CM + 0.6);
}

function pieceSubtitle(piece: SeparatedPiece): string {
  return `${formatCm(piece.alturaCm)} · ${piece.tacosPorGomo} tacos/gomo · taco ${Math.floor(piece.alturaTacoCm)} cm · total ${piece.totalTacos} tacos`;
}

/**
 * Desenha o cabecalho + tabelas na PRIMEIRA pagina (info) e devolve a altura
 * total usada. Chamada 1x numa pagina "de sobra" so pra medir, e 1x na pagina
 * de verdade (ja no tamanho exato) pra desenhar de fato.
 */
function renderInfoPage(
  doc: jsPDF,
  options: MoldPdfOptions,
  pageWidthCm: number,
  totals: Record<string, number> | null,
  pieces: SeparatedPiece[],
  showPartsTable: boolean
): number {
  const { nome, modelo, quantidadeGomos, bainhaCm, alturaTotalCm, clientName, message } = options;

  const contentX = MARGIN_CM;
  const contentW = pageWidthCm - MARGIN_CM * 2;
  let y = MARGIN_CM;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(...TEXT_MUTED);
  doc.text('CARDOZO PROJETOS', contentX, y + ptToCm(9));
  doc.setFont('helvetica', 'normal');
  const dateStr = new Date().toLocaleDateString('pt-BR');
  doc.text(dateStr, contentX + contentW, y + ptToCm(9), { align: 'right' });
  y += ptToCm(9) + 0.25;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(19);
  doc.setTextColor(...TEXT_DARK);
  doc.text(nome, contentX, y + ptToCm(19));
  y += ptToCm(19) + 0.15;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  doc.setTextColor(...TEXT_BODY);
  doc.text(modelo, contentX, y + ptToCm(11));
  y += ptToCm(11) + 0.5;

  if (clientName) {
    doc.setFontSize(10.5);
    doc.setTextColor(...TEXT_BODY);
    doc.text(`Prezado(a) ${clientName},`, contentX, y + ptToCm(10.5));
    y += ptToCm(10.5) + 0.2;
  }
  if (message) {
    doc.setFontSize(9.5);
    doc.setTextColor(...TEXT_BODY);
    const lines = doc.splitTextToSize(message, contentW) as string[];
    for (const line of lines) {
      doc.text(line, contentX, y + ptToCm(9.5));
      y += ptToCm(9.5) * 1.35;
    }
    y += 0.2;
  }
  y += 0.15;

  const statBoxH = 1.7;
  const statGap = 0.3;
  const statBoxW = (contentW - statGap * 2) / 3;
  const stats: Array<[string, string]> = [
    ['TAMANHO', formatCm(alturaTotalCm)],
    ['GOMOS', String(quantidadeGomos)],
    ['BAINHA', formatCm(bainhaCm)],
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

  if (totals) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(...TEXT_DARK);
    doc.text('Quantidade de tacos por parte', contentX, y + ptToCm(9.5));
    y += ptToCm(9.5) + 0.25;

    const colW = contentW / SECTION_ORDER.length;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...TEXT_MUTED);
    SECTION_ORDER.forEach((id, index) => {
      doc.text(SECTION_LABELS[id].toUpperCase(), contentX + index * colW, y + ptToCm(7.5));
    });
    y += ptToCm(7.5) + 0.12;
    doc.setDrawColor(...BORDER_LIGHT);
    doc.setLineWidth(0.015);
    doc.line(contentX, y, contentX + contentW, y);
    y += 0.25;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(...TEXT_DARK);
    SECTION_ORDER.forEach((id, index) => {
      doc.text(`${totals[id]} tacos`, contentX + index * colW, y + ptToCm(9.5));
    });
    y += ptToCm(9.5) + 0.5;
  }

  if (showPartsTable && pieces.length > 0) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(...TEXT_DARK);
    doc.text('Detalhes de cada parte', contentX, y + ptToCm(9.5));
    y += ptToCm(9.5) + 0.3;

    const headers = ['PARTE', 'ALTURA', 'TACOS/GOMO', 'ALTURA DO TACO', 'TOTAL'];
    const colW = contentW / headers.length;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...TEXT_MUTED);
    headers.forEach((label, index) => {
      doc.text(label, contentX + index * colW, y + ptToCm(7.5));
    });
    y += ptToCm(7.5) + 0.12;
    doc.setDrawColor(...BORDER_LIGHT);
    doc.setLineWidth(0.015);
    doc.line(contentX, y, contentX + contentW, y);
    y += 0.35;

    for (const piece of pieces) {
      const rowY = y;
      doc.setFillColor(...hexToRgb(piece.color));
      doc.circle(contentX + 0.08, rowY - 0.1, 0.08, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      doc.setTextColor(...TEXT_DARK);
      doc.text(piece.label, contentX + 0.3, rowY);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(...TEXT_BODY);
      doc.text(formatCm(piece.alturaCm), contentX + colW, rowY);
      doc.text(String(piece.tacosPorGomo), contentX + colW * 2, rowY);
      doc.text(`${Math.floor(piece.alturaTacoCm)} cm`, contentX + colW * 3, rowY);
      doc.setFont('helvetica', 'bold');
      doc.text(`${piece.totalTacos} tacos`, contentX + colW * 4, rowY);
      y += 0.55;
      doc.setDrawColor(...BORDER_LIGHT);
      doc.setLineWidth(0.008);
      doc.line(contentX, y - 0.2, contentX + contentW, y - 0.2);
    }
    y += 0.2;
  }

  y += MARGIN_CM - 0.4;
  return y;
}

/**
 * Marca de uniao entre 2 folhas separadas (quebra forcada pelo limite de
 * pagina do PDF DENTRO da mesma peca, OU 2 pecas vizinhas na sequencia do
 * molde tipo Bico 1/Bico 2/Bojo/Boca) — so a bainha de 1cm do lado de baixo
 * (a folha que "recebe" a uniao), igual a qualquer outro corte interno — sem
 * essa bainha a peca fica "sem fechamento" ali e as folhas nao tem como saber
 * quanto sobrepor sem perder tamanho ao juntar. Sem linha de corte extra: o
 * proprio contorno da peca + a quebra de pagina ja marcam onde uma folha
 * acaba e a outra comeca.
 */
/** A bainha normal (0,015) fica invisivel numa marca de uniao — precisa se
 * destacar sozinha aqui, sem uma linha de corte ao lado pra dar contraste.
 * Mais grossa e tracejada (differente do traco solido dos cortes) deixa
 * inconfundivel que e uma bainha, nao mais uma linha de corte comum. */
const JUNCTION_HEM_LINE_CM = 0.09;
const JUNCTION_HEM_DASH_CM: [number, number] = [0.4, 0.25];

function drawJunctionMark(
  doc: jsPDF,
  points: ProfilePoint[],
  centerXcm: number,
  mapY: (yCm: number) => number,
  yCm: number,
  mode: 'upper-cut' | 'lower-overlap'
): void {
  const half = interpolateHalfWidth(yCm, points);
  
  if (mode === 'upper-cut') {
    // Linha de corte sólida cinza clara na base da página de cima
    doc.setDrawColor(180, 180, 180);
    doc.setLineWidth(0.015);
    doc.line(centerXcm - half, mapY(yCm), centerXcm + half, mapY(yCm));
    
    // Texto explicativo pequeno
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.5);
    doc.setTextColor(140, 140, 140);
    doc.text("CORTE AQUI PARA JUNTAR AS PAGINAS", centerXcm, mapY(yCm) - 0.15, { align: 'center' });
  } else {
    // Linha sólida cinza de encontro no topo da página de baixo
    doc.setDrawColor(180, 180, 180);
    doc.setLineWidth(0.015);
    doc.line(centerXcm - half, mapY(yCm), centerXcm + half, mapY(yCm));
    
    // Linha tracejada da bainha de junta (limite da sobreposição a 1cm do topo)
    const yHemCm = Math.max(0, yCm - BAINHA_JUNTA_CM);
    const halfHem = interpolateHalfWidth(yHemCm, points);
    const yHem = mapY(yHemCm);
    
    doc.setDrawColor(...HEM_COLOR);
    doc.setLineWidth(JUNCTION_HEM_LINE_CM);
    doc.setLineDashPattern(JUNCTION_HEM_DASH_CM, 0);
    doc.line(centerXcm - halfHem, yHem, centerXcm + halfHem, yHem);
    doc.setLineDashPattern([], 0);
    
    // Texto de guia
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.5);
    doc.setTextColor(...HEM_COLOR);
    doc.text("LINHA DE SOBREPOSICAO (COLE A FOLHA DE CIMA ATE AQUI)", centerXcm, yHem - 0.15, { align: 'center' });
  }
}

/**
 * Adiciona a(s) pagina(s) de desenho de UM perfil (molde inteiro ou peca).
 * Se a altura real couber dentro do limite de pagina do PDF, e 1 pagina so.
 * Se passar do limite, tila em varias paginas — cada uma AINDA em escala
 * real — deslocando a origem do desenho pra cima a cada pagina, deixando o
 * que ja foi mostrado (ou o que falta mostrar) cair fora do MediaBox daquela
 * pagina (onde nenhum visualizador de PDF renderiza nada).
 *
 * Quando precisa dividir, a quebra e alinhada num multiplo de `rowHeightCm`
 * (a altura do taco daquela peca) sempre que possivel, pra cair numa linha
 * de corte que ja existe — nunca no meio de uma fileira de taco — e ganha
 * uma marca de uniao (corte + bainha) nas 2 folhas que se encontram ali.
 */
function addDrawingPages(
  doc: jsPDF,
  profile: MoldProfile,
  tacoConfigs: SectionTacoConfigMap,
  pageWidthCm: number,
  orientationFor: (w: number, h: number) => 'p' | 'l',
  color: string,
  label: string,
  subtitle: string,
  rowHeightCm: number | null,
  bainhaCm: number = 1.0,
  onFirstPageTop?: (mapY: (yCm: number) => number, centerXcm: number) => void,
  onLastPageBottom?: (mapY: (yCm: number) => number, centerXcm: number) => void
): void {
  const totalH = profile.alturaTotalCm;
  // Centraliza o molde no espaco disponivel MENOS a faixa reservada da regua
  // lateral (senao a regua ficaria espremida ou cortada do lado direito).
  const drawX = MARGIN_CM + (pageWidthCm - MARGIN_CM * 2 - RULER_EXTRA_CM - profile.larguraMaximaCm) / 2;
  const maxHalf = Math.max(profile.larguraMaximaCm / 2, 0.1);
  const centerXcm = drawX + maxHalf;

  if (totalH <= MAX_DRAWABLE_CM) {
    // Adiciona 3.5cm extras para as réguas e cota da base não serem cortadas na impressão
    const pageH = totalH + MARGIN_CM * 2 + CAPTION_H_CM + 3.5;
    doc.addPage([pageWidthCm, pageH], orientationFor(pageWidthCm, pageH));
    drawCaption(doc, pageWidthCm, color, label, subtitle);
    drawProfile(doc, profile, tacoConfigs, drawX, MARGIN_CM + CAPTION_H_CM, bainhaCm);
    const mapY = (yCm: number) => MARGIN_CM + CAPTION_H_CM + (totalH - yCm);
    onFirstPageTop?.(mapY, centerXcm);
    onLastPageBottom?.(mapY, centerXcm);
    return;
  }

  // Pontos de corte de cima pra baixo. Arredonda pra cima (pagina fica um
  // pouco menor, nunca maior que o limite) ate o multiplo de rowHeightCm
  // mais proximo, pra bater com uma linha de taco de verdade.
  const breakpoints: number[] = [totalH];
  let cursor = totalH;
  while (cursor > MAX_DRAWABLE_CM) {
    const rawNext = cursor - MAX_DRAWABLE_CM;
    let next = rowHeightCm && rowHeightCm > 0 ? Math.ceil(rawNext / rowHeightCm) * rowHeightCm : rawNext;
    if (!(next > 0) || next >= cursor) {
      next = Math.max(0.1, rawNext);
    }
    breakpoints.push(next);
    cursor = next;
  }
  breakpoints.push(0);

  const totalPages = breakpoints.length - 1;
  for (let index = 0; index < totalPages; index += 1) {
    const spanTop = breakpoints[index];
    const spanBottom = breakpoints[index + 1];
    
    // Se for a última página do desenho (onde spanBottom === 0, ou seja, a base física),
    // adicionamos 3.5cm extras de espaço no rodapé para as réguas e cota da base.
    const isBasePage = spanBottom === 0;
    const extraBottomCm = isBasePage ? 3.5 : 0;
    
    const pageH = spanTop - spanBottom + MARGIN_CM * 2 + CAPTION_H_CM + extraBottomCm;
    doc.addPage([pageWidthCm, pageH], orientationFor(pageWidthCm, pageH));
    drawCaption(doc, pageWidthCm, color, label, `${subtitle} · parte ${index + 1} de ${totalPages}`);
    const originY = MARGIN_CM + CAPTION_H_CM - (totalH - spanTop);
    const mapY = (yCm: number) => originY + (totalH - yCm);
    drawProfile(doc, profile, tacoConfigs, drawX, originY, bainhaCm);

    if (index < totalPages - 1) {
      drawJunctionMark(doc, profile.points, centerXcm, mapY, spanBottom, 'upper-cut');
    }
    if (index > 0) {
      drawJunctionMark(doc, profile.points, centerXcm, mapY, spanTop, 'lower-overlap');
    }
    if (index === 0) {
      onFirstPageTop?.(mapY, centerXcm);
    }
    if (index === totalPages - 1) {
      onLastPageBottom?.(mapY, centerXcm);
    }
  }
}

/**
 * Gera o PDF do molde em escala real (vetor puro, sem screenshot) — sem
 * limite de tamanho fisico, funciona igual pra um gomo de 50cm ou 12 metros.
 *
 * Estrutura em varias paginas: 1a pagina = texto (cabecalho/stats/tabelas),
 * depois 1 pagina por desenho (molde inteiro e/ou cada peca separada), cada
 * uma do tamanho EXATO daquele desenho. Isso garante que uma peca NUNCA fica
 * cortada ao meio por uma quebra de pagina, e evita colocar texto em cima de
 * uma coordenada Y acumulada gigante (jsPDF some com o texto nesse caso,
 * mesmo desenhando as linhas certinho — confirmado com pdftotext).
 */
export function buildMoldPdf(options: MoldPdfOptions): Blob {
  const showWhole = options.mode === 'whole' || options.mode === 'both';
  const showPieces = options.mode === 'pieces' || options.mode === 'both';
  const pieces = buildSeparatedPieces(
    options.pontos,
    options.plotterConfig.taco_configs,
    options.plotterConfig.section_ratios,
    options.plotterConfig.section_colors,
    options.bainhaCm
  );
  const fullProfile = showWhole ? buildMoldProfile(options.pontos, options.plotterConfig.section_ratios, options.plotterConfig.taco_configs) : null;
  const totals = computeSectionTacoTotals(
    options.pontos,
    options.plotterConfig.taco_configs,
    options.plotterConfig.section_ratios,
    options.bainhaCm
  );

  const widestPiece = Math.max(0, ...pieces.map((p) => p.larguraMaximaCm + 1.5));
  const widestWhole = fullProfile ? fullProfile.larguraMaximaCm + 1.5 : 0;
  const infoWidthCm = MIN_WIDTH_CM;
  const drawingWidthCm = Math.max(
    MIN_WIDTH_CM,
    Math.max(widestPiece, widestWhole) + MARGIN_CM * 2 + 3 + RULER_EXTRA_CM
  );

  // jsPDF troca largura/altura sozinho se width > height e a orientacao nao for
  // dita explicitamente como 'l' (o padrao 'p'/portrait exige altura >= largura)
  // — foi isso que deixava a pagina de info (mais larga que alta quando so tem
  // cabecalho+stats, sem tabela de pecas) com o conteudo cortado.
  const orientationFor = (w: number, h: number) => (w >= h ? 'l' : 'p');

  const measureDoc = new jsPDF({ unit: 'cm', format: [infoWidthCm, 200], orientation: 'p' });
  const infoHeightCm = renderInfoPage(measureDoc, options, infoWidthCm, totals, pieces, showPieces);

  const doc = new jsPDF({
    unit: 'cm',
    format: [infoWidthCm, infoHeightCm],
    orientation: orientationFor(infoWidthCm, infoHeightCm),
  });
  doc.setProperties({ title: `${options.nome} - Alisson Projetos` });
  renderInfoPage(doc, options, infoWidthCm, totals, pieces, showPieces);

  if (showWhole && fullProfile) {
    addDrawingPages(
      doc,
      fullProfile,
      options.plotterConfig.taco_configs,
      drawingWidthCm,
      orientationFor,
      '#2563eb',
      'Molde inteiro',
      formatCm(fullProfile.alturaTotalCm),
      null,
      options.bainhaCm
    );
  }

  if (showPieces) {
    // Pecas vizinhas na sequencia do molde (Bico 1 -> Bico 2 -> Bojo -> Boca)
    // se juntam fisicamente uma na outra quando montadas — sejam elas
    // reparticoes da mesma secao (Bico 1/Bico 2) ou secoes diferentes
    // (Bojo/Boca). Toda fronteira entre 2 pecas consecutivas ganha a marca
    // de uniao (bainha), exceto a ponta da primeira e a base da ultima, que
    // nao encostam em mais nada.
    pieces.forEach((piece, index) => {
      const prev = pieces[index - 1];
      const next = pieces[index + 1];
      const joinsWithPrev = Boolean(prev);
      const joinsWithNext = Boolean(next);

      addDrawingPages(
        doc,
        piece.profile,
        piece.tacoConfigs,
        drawingWidthCm,
        orientationFor,
        piece.color,
        piece.label,
        pieceSubtitle(piece),
        piece.alturaTacoCm,
        options.bainhaCm,
        joinsWithPrev
          ? (mapY, centerXcm) => drawJunctionMark(doc, piece.profile.points, centerXcm, mapY, piece.alturaCm, 'lower-overlap')
          : undefined,
        joinsWithNext
          ? (mapY, centerXcm) => drawJunctionMark(doc, piece.profile.points, centerXcm, mapY, 0, 'upper-cut')
          : undefined
      );
    });
  }

  return doc.output('blob');
}
