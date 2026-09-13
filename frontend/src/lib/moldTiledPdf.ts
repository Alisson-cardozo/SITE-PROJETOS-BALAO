import { jsPDF } from 'jspdf';
import {
  buildSeparatedPieces,
  buildTacoDivisions,
  expandSectionPartitions,
  interpolateHalfWidth,
  BAINHA_JUNTA_CM,
  type MoldProfile,
  type SectionTacoConfigMap,
  type SeparatedPiece,
} from './moldGeometry';
import type { MoldPlotterConfig, MoldPoint } from '../types';

/**
 * PDF do molde "fatiado" em folhas de impressora comum (A4/A3), tipo
 * quebra-cabeca — cada folha numerada, com seta de orientacao e aba
 * tracejada de sobreposicao pra colar na folha vizinha, pra quem nao tem
 * plotter conseguir montar o molde em tamanho real na mao. Reaproveita a
 * MESMA geometria do PDF de plotter (moldPdf.ts) — so a forma de paginar e
 * diferente (la e 1 pagina do tamanho exato do desenho; aqui e uma grade de
 * paginas pequenas e fixas).
 */

export type TiledPaperSize = 'a4' | 'a3';

export interface MoldTiledPdfOptions {
  nome: string;
  modelo: string;
  bainhaCm: number;
  pontos: MoldPoint[];
  plotterConfig: MoldPlotterConfig;
}

interface PaperVariant {
  w: number;
  h: number;
  label: string;
}

const PAPER_CM: Record<TiledPaperSize, PaperVariant> = {
  a4: { w: 21.0, h: 29.7, label: 'A4' },
  a3: { w: 29.7, h: 42.0, label: 'A3' },
};

/** Em pe (padrao) e deitada — pra cada peca, usa a que encaixa com menos
 * folhas (ex: peca bem mais larga que alta desperdica muito papel em pe). */
function paperVariants(paperSize: TiledPaperSize): PaperVariant[] {
  const base = PAPER_CM[paperSize];
  return [base, { w: base.h, h: base.w, label: `${base.label} (deitada)` }];
}

/** Margem segura de impressao — a maioria das impressoras domesticas nao
 * imprime borda a borda. */
const PAGE_MARGIN_CM = 1.0;
/** Faixa repetida na folha anterior, pra colar por baixo da proxima sem
 * precisar cortar com precisao milimetrica. */
const OVERLAP_CM = 1.8;
/** Espaco reservado pro cabecalho (nome/peca/numero da folha) no topo de
 * CADA folha. */
const CAPTION_H_CM = 1.6;
/** Folga ao redor do contorno de cada peca (o proprio contorno ja se
 * expande 1cm sozinho — essa e uma folga extra de seguranca). */
const CONTENT_PAD_CM = 1.5;

const CUT_COLOR: [number, number, number] = [19, 40, 63];
const HEM_COLOR: [number, number, number] = [120, 130, 145];
const OVERLAP_GUIDE_COLOR: [number, number, number] = [37, 99, 235];
const TEXT_MUTED: [number, number, number] = [107, 114, 128];
const BORDER_COLOR: [number, number, number] = [229, 231, 235];
const GRID_LINE_CM = 0.015;
const OUTLINE_LINE_CM = 0.035;
const HEM_LINE_CM = 0.015;

function drawPolyline(doc: jsPDF, pts: Array<[number, number]>, close = false): void {
  if (pts.length < 2) return;
  const lines = pts.slice(1).map((p, i) => {
    const prev = pts[i];
    return [p[0] - prev[0], p[1] - prev[1]] as [number, number];
  });
  doc.lines(lines, pts[0][0], pts[0][1], [1, 1], 'S', close);
}

/**
 * Desenha SO a forma da peca (contorno + grade de tacos + bainhas) — sem as
 * reguas/cotas do PDF de plotter (nao cabem/nao fazem sentido numa folha
 * pequena fatiada). `originXcm/originYcm` = canto superior esquerdo da
 * "caixa de conteudo" da peca (contorno + folga), NAO o canto do papel —
 * quem chama decide onde essa caixa cai na pagina (fora ou dentro da area
 * visivel, pra fatiar).
 */
function drawPieceShape(
  doc: jsPDF,
  profile: MoldProfile,
  tacoConfigs: SectionTacoConfigMap,
  originXcm: number,
  originYcm: number,
  bainhaCm: number
): void {
  const { points, alturaTotalCm, larguraMaximaCm, secoes } = profile;
  const maxHalf = Math.max(larguraMaximaCm / 2, 0.1);
  const contentOriginXcm = originXcm + CONTENT_PAD_CM;
  const contentOriginYcm = originYcm + CONTENT_PAD_CM;
  const centerXcm = contentOriginXcm + maxHalf;

  const mapXAbs = (xCm: number) => centerXcm + xCm;
  const mapY = (yCm: number) => contentOriginYcm + (alturaTotalCm - yCm);

  const BOUNDARY_EPS = BAINHA_JUNTA_CM + 0.15;

  const sectionBands = secoes.flatMap((secao) => {
    const cfg = tacoConfigs[secao.id] ?? { partitions: [] };
    const bands = expandSectionPartitions(secao, cfg, true);
    return bands.map((band) => {
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
      return { divisions };
    });
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

  doc.setDrawColor(...CUT_COLOR);
  doc.setLineWidth(OUTLINE_LINE_CM);
  const outline: Array<[number, number]> = [];
  for (let i = 0; i < points.length; i++) {
    outline.push([mapXAbs(-points[i].halfWidthCm - 1.0), mapY(points[i].yCm)]);
  }
  for (let i = points.length - 1; i >= 0; i--) {
    outline.push([mapXAbs(points[i].halfWidthCm), mapY(points[i].yCm)]);
  }
  drawPolyline(doc, outline, true);
}

/** Largura/altura totais da "caixa de conteudo" de uma peca (contorno + folga). */
function contentBoxSize(profile: MoldProfile): { widthCm: number; heightCm: number } {
  return {
    widthCm: profile.larguraMaximaCm + 1.0 + CONTENT_PAD_CM * 2,
    heightCm: profile.alturaTotalCm + CONTENT_PAD_CM * 2,
  };
}

interface TileGrid {
  cols: number;
  rows: number;
  stepWcm: number;
  stepHcm: number;
}

function computeTileGrid(boxWidthCm: number, boxHeightCm: number, paper: { w: number; h: number }): TileGrid {
  const usableW = paper.w - PAGE_MARGIN_CM * 2;
  const usableH = paper.h - PAGE_MARGIN_CM * 2 - CAPTION_H_CM;
  const stepWcm = Math.max(2, usableW - OVERLAP_CM);
  const stepHcm = Math.max(2, usableH - OVERLAP_CM);
  return {
    cols: Math.max(1, Math.ceil(boxWidthCm / stepWcm)),
    rows: Math.max(1, Math.ceil(boxHeightCm / stepHcm)),
    stepWcm,
    stepHcm,
  };
}

/**
 * Uma peca afunilada (tipo o bico, que fecha em ponta) deixa cantos vazios
 * na grade retangular de folhas — sem essa checagem, o cliente recebe folha
 * em branco pra imprimir/colar a toa. Amostra a largura do contorno em
 * varios pontos dentro da faixa vertical da folha e confere se em algum
 * deles o contorno (incluindo a expansao de 1cm da bainha externa) cruza a
 * faixa horizontal da folha.
 */
function tileHasContent(profile: MoldProfile, sliceX: number, sliceY: number, tileW: number, tileH: number): boolean {
  const maxHalf = Math.max(profile.larguraMaximaCm / 2, 0.1);
  // faixa X da folha, em "xCm relativo ao centro" (mesmo referencial do contorno)
  const xMin = sliceX - CONTENT_PAD_CM - maxHalf;
  const xMax = sliceX + tileW - CONTENT_PAD_CM - maxHalf;

  // faixa Y da folha, convertida de volta pra yCm real da peca
  const yTopCm = profile.alturaTotalCm - sliceY + CONTENT_PAD_CM;
  const yBottomCm = profile.alturaTotalCm - sliceY - tileH + CONTENT_PAD_CM;
  const yLo = Math.max(0, Math.min(yBottomCm, yTopCm));
  const yHi = Math.min(profile.alturaTotalCm, Math.max(yBottomCm, yTopCm));
  if (yHi < yLo) {
    return false;
  }

  const SAMPLES = 12;
  for (let i = 0; i <= SAMPLES; i += 1) {
    const yCm = yLo + ((yHi - yLo) * i) / SAMPLES;
    const half = interpolateHalfWidth(yCm, profile.points);
    const contourMin = -half - 1.0;
    const contourMax = half;
    if (contourMax >= xMin && contourMin <= xMax) {
      return true;
    }
  }
  return false;
}

function drawUpArrow(doc: jsPDF, xCm: number, yCm: number): void {
  doc.setDrawColor(...CUT_COLOR);
  doc.setFillColor(...CUT_COLOR);
  doc.setLineWidth(0.04);
  // haste
  doc.line(xCm, yCm + 0.65, xCm, yCm);
  // ponta (triangulo)
  doc.triangle(xCm - 0.22, yCm + 0.22, xCm + 0.22, yCm + 0.22, xCm, yCm - 0.05, 'FD');
}

/** Bolinha numerada (sequencia global de folhas) no canto da pagina. */
function drawSheetBadge(doc: jsPDF, xCm: number, yCm: number, n: number): void {
  doc.setFillColor(...OVERLAP_GUIDE_COLOR);
  doc.circle(xCm, yCm, 0.55, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text(String(n), xCm, yCm + 0.15, { align: 'center' });
}

function paperOrientation(w: number, h: number): 'p' | 'l' {
  return w >= h ? 'l' : 'p';
}

interface TileInfo {
  piece: SeparatedPiece;
  row: number;
  col: number;
  rows: number;
  cols: number;
  sheetNumber: number;
  pieceSheetIndex: number;
  pieceSheetTotal: number;
}

/**
 * Monta o "mapa de montagem" — 1 pagina com um diagraminha de cada peca
 * mostrando a grade de folhas e a numeracao, pra ver o quadro geral antes de
 * ir folha por folha (igual a pagina de notas do tutorial em video).
 */
function renderAssemblyMapPage(
  doc: jsPDF,
  pageWcm: number,
  options: MoldTiledPdfOptions,
  paperLabel: string,
  pieces: SeparatedPiece[],
  grids: TileGrid[],
  sheetStartIndex: number[],
  contentGrids: boolean[][][]
): void {
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  doc.setTextColor(17, 24, 39);
  doc.text('Notas de montagem', PAGE_MARGIN_CM, PAGE_MARGIN_CM + 0.7);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10.5);
  doc.setTextColor(55, 65, 81);
  const introLines = doc.splitTextToSize(
    `${options.nome} (${options.modelo}) — fatiado em folhas ${paperLabel}. Ao montar, siga a numeracao das folhas em ordem. A seta ` +
      'no topo de cada folha sempre aponta pra cima do molde. As bordas tracejadas azuis sao abas de sobreposicao: cole por baixo da ' +
      'proxima folha, alinhando o desenho — nao precisa cortar exatamente na linha, a aba cobre pequenas folgas de corte.',
    pageWcm - PAGE_MARGIN_CM * 2
  );
  doc.text(introLines, PAGE_MARGIN_CM, PAGE_MARGIN_CM + 1.3);

  let cursorY = PAGE_MARGIN_CM + 1.3 + introLines.length * 0.42 + 0.6;
  const thumbMaxWcm = Math.min(6.5, (pageWcm - PAGE_MARGIN_CM * 2 - 1) / 2);
  const thumbMaxHcm = 8.5;
  let colX = PAGE_MARGIN_CM;
  let rowStartY = cursorY;
  let tallestInRow = 0;

  pieces.forEach((piece, pieceIndex) => {
    const box = contentBoxSize(piece.profile);
    const grid = grids[pieceIndex];
    const scale = Math.min(thumbMaxWcm / box.widthCm, thumbMaxHcm / box.heightCm);
    const thumbW = box.widthCm * scale;
    const thumbH = box.heightCm * scale;

    if (colX + thumbW > pageWcm - PAGE_MARGIN_CM) {
      colX = PAGE_MARGIN_CM;
      rowStartY += tallestInRow + 1.3;
      tallestInRow = 0;
    }
    tallestInRow = Math.max(tallestInRow, thumbH + 0.9);

    const originXcm = colX;
    const originYcm = rowStartY + 0.5;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(17, 24, 39);
    doc.text(piece.label, originXcm, originYcm - 0.15);

    // contorno reduzido
    const maxHalf = Math.max(piece.profile.larguraMaximaCm / 2, 0.1);
    const centerX = originXcm + CONTENT_PAD_CM * scale + maxHalf * scale;
    const mapY = (yCm: number) => originYcm + (piece.profile.alturaTotalCm - yCm) * scale + CONTENT_PAD_CM * scale;
    const outline: Array<[number, number]> = [];
    for (const p of piece.profile.points) outline.push([centerX - (p.halfWidthCm + 1.0) * scale, mapY(p.yCm)]);
    for (let i = piece.profile.points.length - 1; i >= 0; i--) {
      outline.push([centerX + piece.profile.points[i].halfWidthCm * scale, mapY(piece.profile.points[i].yCm)]);
    }
    doc.setDrawColor(...CUT_COLOR);
    doc.setLineWidth(0.02);
    drawPolyline(doc, outline, true);

    // grade das folhas (tile grid) + numero — cada celula usa exatamente o
    // pedaco de conteudo que aquela folha real cobre (a ultima linha/coluna
    // encolhe em vez de "vazar" pra fora e sobrepor a vizinha).
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    const contentGrid = contentGrids[pieceIndex];
    let pieceCounter = 0;
    for (let r = 0; r < grid.rows; r += 1) {
      const sliceYLocal = r * grid.stepHcm;
      const cellHLocal = Math.min(grid.stepHcm, box.heightCm - sliceYLocal);
      const cellY0 = originYcm + sliceYLocal * scale;
      const cellH = cellHLocal * scale;
      for (let c = 0; c < grid.cols; c += 1) {
        // celula sem desenho nenhum (canto vazio de peca afunilada) — nem
        // vira folha de verdade, entao nem entra no mapa.
        if (!contentGrid[r][c]) {
          continue;
        }
        pieceCounter += 1;
        const sliceXLocal = c * grid.stepWcm;
        const cellWLocal = Math.min(grid.stepWcm, box.widthCm - sliceXLocal);
        const cellX0 = originXcm + sliceXLocal * scale;
        const cellW = cellWLocal * scale;
        doc.setDrawColor(180, 190, 205);
        doc.setLineWidth(0.01);
        doc.rect(cellX0, cellY0, cellW, cellH);
        const n = sheetStartIndex[pieceIndex] + pieceCounter;
        doc.setTextColor(37, 99, 235);
        doc.text(String(n), cellX0 + cellW / 2, cellY0 + cellH / 2 + 0.1, { align: 'center' });
      }
    }

    colX += thumbW + 1.0;
  });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...TEXT_MUTED);
  doc.text('Alisson Projetos', PAGE_MARGIN_CM, doc.internal.pageSize.getHeight() - 0.5);
}

/** Grade booleana (linha x coluna) de quais folhas realmente tem desenho —
 * uma peca afunilada (ex: bico fechando em ponta) deixa cantos vazios na
 * grade retangular, e essas folhas nem sao geradas. */
function computeContentGrid(piece: SeparatedPiece, grid: TileGrid, box: { widthCm: number; heightCm: number }): boolean[][] {
  const result: boolean[][] = [];
  for (let r = 0; r < grid.rows; r += 1) {
    const row: boolean[] = [];
    const sliceY = r * grid.stepHcm;
    const tileH = Math.min(grid.stepHcm + OVERLAP_CM, box.heightCm - sliceY);
    for (let c = 0; c < grid.cols; c += 1) {
      const sliceX = c * grid.stepWcm;
      const tileW = Math.min(grid.stepWcm + OVERLAP_CM, box.widthCm - sliceX);
      row.push(tileHasContent(piece.profile, sliceX, sliceY, tileW, tileH));
    }
    result.push(row);
  }
  return result;
}

interface PieceLayout {
  paper: PaperVariant;
  grid: TileGrid;
  contentGrid: boolean[][];
  contentTiles: number;
}

/**
 * Testa a folha em pe e deitada pra essa peca, e fica com a que usa MENOS
 * folhas de verdade (conta so as celulas com desenho, ja descontando os
 * cantos vazios) — uma peca bem mais larga que alta (ex: uma boca baixinha)
 * costuma precisar de bem menos folhas deitada.
 */
function pickBestLayout(piece: SeparatedPiece, paperSize: TiledPaperSize): PieceLayout {
  const box = contentBoxSize(piece.profile);
  const candidates = paperVariants(paperSize).map((paper) => {
    const grid = computeTileGrid(box.widthCm, box.heightCm, paper);
    const contentGrid = computeContentGrid(piece, grid, box);
    const contentTiles = contentGrid.reduce((sum, row) => sum + row.filter(Boolean).length, 0);
    return { paper, grid, contentGrid, contentTiles };
  });
  return candidates.reduce((best, cur) => (cur.contentTiles < best.contentTiles ? cur : best));
}

/** Gera o PDF fatiado (A4 ou A3), pronto pra imprimir em impressora comum. */
export function buildMoldTiledPdf(options: MoldTiledPdfOptions, paperSize: TiledPaperSize): Blob {
  const paper = PAPER_CM[paperSize];
  const pieces = buildSeparatedPieces(
    options.pontos,
    options.plotterConfig.taco_configs,
    options.plotterConfig.section_ratios,
    options.plotterConfig.section_colors,
    options.bainhaCm
  );

  const layouts = pieces.map((piece) => pickBestLayout(piece, paperSize));
  const grids = layouts.map((l) => l.grid);
  const contentGrids = layouts.map((l) => l.contentGrid);

  const sheetStartIndex: number[] = [];
  let running = 0;
  for (const layout of layouts) {
    sheetStartIndex.push(running);
    running += layout.contentTiles;
  }
  const totalSheets = running;

  const doc = new jsPDF({ unit: 'cm', format: [paper.w, paper.h], orientation: paperOrientation(paper.w, paper.h) });
  doc.setProperties({ title: `${options.nome} - Alisson Projetos (${paper.label})` });
  renderAssemblyMapPage(doc, paper.w, options, paper.label, pieces, grids, sheetStartIndex, contentGrids);

  pieces.forEach((piece, pieceIndex) => {
    const layout = layouts[pieceIndex];
    const grid = layout.grid;
    const piecePaper = layout.paper;
    const box = contentBoxSize(piece.profile);
    const contentGrid = layout.contentGrid;
    const pieceSheetTotal = layout.contentTiles;
    const tiles: TileInfo[] = [];
    let pieceCounter = 0;
    for (let r = 0; r < grid.rows; r += 1) {
      for (let c = 0; c < grid.cols; c += 1) {
        if (!contentGrid[r][c]) {
          continue;
        }
        pieceCounter += 1;
        tiles.push({
          piece,
          row: r,
          col: c,
          rows: grid.rows,
          cols: grid.cols,
          sheetNumber: sheetStartIndex[pieceIndex] + pieceCounter,
          pieceSheetIndex: pieceCounter,
          pieceSheetTotal,
        });
      }
    }

    for (const tile of tiles) {
      doc.addPage([piecePaper.w, piecePaper.h], paperOrientation(piecePaper.w, piecePaper.h));

      // cabecalho
      doc.setFillColor(249, 250, 251);
      doc.rect(0, 0, piecePaper.w, CAPTION_H_CM, 'F');
      doc.setDrawColor(...BORDER_COLOR);
      doc.setLineWidth(0.02);
      doc.line(0, CAPTION_H_CM, piecePaper.w, CAPTION_H_CM);

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.setTextColor(17, 24, 39);
      doc.text(`${options.nome} — ${tile.piece.label}`, PAGE_MARGIN_CM, 0.65);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8.5);
      doc.setTextColor(...TEXT_MUTED);
      doc.text(
        `Folha ${tile.sheetNumber} de ${totalSheets} · peca: ${tile.pieceSheetIndex} de ${tile.pieceSheetTotal} · papel ${piecePaper.label}`,
        PAGE_MARGIN_CM,
        1.15
      );

      const pageX0 = PAGE_MARGIN_CM;
      const pageY0 = CAPTION_H_CM + PAGE_MARGIN_CM * 0.4;
      const sliceX = tile.col * grid.stepWcm;
      const sliceY = tile.row * grid.stepHcm;
      const tileW = Math.min(grid.stepWcm + OVERLAP_CM, box.widthCm - sliceX);
      const tileH = Math.min(grid.stepHcm + OVERLAP_CM, box.heightCm - sliceY);

      doc.saveGraphicsState();
      // style=null e obrigatorio aqui: sem isso o jsPDF pinta e FECHA o
      // retangulo antes do clip() rodar (so em modo "compat", que e o
      // default), deixando o clip sem path nenhum pra usar — tudo depois
      // sumia da pagina inteira, nao so fora do retangulo.
      doc.rect(pageX0, pageY0, tileW, tileH, null);
      doc.clip();
      doc.discardPath();
      drawPieceShape(doc, tile.piece.profile, tile.piece.tacoConfigs, pageX0 - sliceX, pageY0 - sliceY, options.bainhaCm);
      doc.restoreGraphicsState();

      // seta de orientacao (sempre pra cima do molde) — canto sup. esquerdo da area de desenho
      drawUpArrow(doc, pageX0 + 0.35, pageY0 + 0.9);

      // aba de sobreposicao direita (cola por baixo da proxima folha da mesma linha)
      // — so mostra se a folha vizinha existir de verdade (peca afunilada
      // pode nao ter desenho nenhum do outro lado).
      if (tile.col < tile.cols - 1 && contentGrid[tile.row][tile.col + 1]) {
        const guideX = pageX0 + grid.stepWcm;
        doc.setDrawColor(...OVERLAP_GUIDE_COLOR);
        doc.setLineWidth(0.03);
        doc.setLineDashPattern([0.35, 0.2], 0);
        doc.line(guideX, pageY0, guideX, pageY0 + tileH);
        doc.setLineDashPattern([], 0);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(6.5);
        doc.setTextColor(...OVERLAP_GUIDE_COLOR);
        doc.text('cole por baixo da proxima folha →', guideX + 0.1, pageY0 + 0.35, { angle: 90 });
      }

      // aba de sobreposicao inferior (cola por baixo da folha de baixo)
      if (tile.row < tile.rows - 1 && contentGrid[tile.row + 1][tile.col]) {
        const guideY = pageY0 + grid.stepHcm;
        doc.setDrawColor(...OVERLAP_GUIDE_COLOR);
        doc.setLineWidth(0.03);
        doc.setLineDashPattern([0.35, 0.2], 0);
        doc.line(pageX0, guideY, pageX0 + tileW, guideY);
        doc.setLineDashPattern([], 0);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(6.5);
        doc.setTextColor(...OVERLAP_GUIDE_COLOR);
        doc.text('cole por baixo da folha de baixo ↓', pageX0 + 0.15, guideY + 0.3);
      }

      drawSheetBadge(doc, piecePaper.w - PAGE_MARGIN_CM - 0.1, 0.75, tile.sheetNumber);
    }
  });

  return doc.output('blob');
}
