import { jsPDF } from 'jspdf';
import { buildBalaoConeModel, buildConeFan, type ConeFan, type Pt } from './coneGeometry';
import type { MoldPoint } from '../types';

export interface RiscadoPdfOptions {
  nome: string;
  modelo: string;
  quantidadeGomosTotal: number;
  modo: 'individual' | 'repeticao';
  repeticoes: number;
  /** Quantos gomos o cliente desenha de fato — tambem quantos entram no leque desenhado. */
  desenhosUnicos: number;
  pontos: MoldPoint[];
}

function formatCm(value: number): string {
  const n = Number(value);
  const text = Number.isFinite(n) ? n.toFixed(1).replace(/\.0$/, '').replace('.', ',') : '0';
  return `${text} cm`;
}

function ptToCm(pt: number): number {
  return (pt / 72) * 2.54;
}

const OUTLINE_COLOR: [number, number, number] = [37, 99, 235];
const DIVISOR_COLOR: [number, number, number] = [148, 163, 184];
const SEAM_COLOR: [number, number, number] = [240, 98, 184];
const DIM_TEXT_COLOR: [number, number, number] = [107, 114, 128];
const TEXT_DARK: [number, number, number] = [17, 24, 39];
const TEXT_BODY: [number, number, number] = [55, 65, 81];
const TEXT_MUTED: [number, number, number] = [107, 114, 128];
const BORDER_LIGHT: [number, number, number] = [229, 231, 235];
const BG_LIGHT: [number, number, number] = [249, 250, 251];
const JOIN_COLOR: [number, number, number] = [37, 99, 235];

const MARGIN_CM = 1.4;
const MIN_WIDTH_CM = 19;
const OUTLINE_LINE_CM = 0.03;
const DIVISOR_LINE_CM = 0.012;
const CAPTION_H_CM = 1.3;
/** Formato PDF nao aceita pagina com mais de ~508cm (14400pt) de largura ou altura. */
const MAX_PAGE_CM = 500;

function drawPolyline(doc: jsPDF, pts: Pt[], close = false): void {
  if (pts.length < 2) return;
  for (let i = 1; i < pts.length; i += 1) {
    doc.line(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]);
  }
  if (close) {
    doc.line(pts[pts.length - 1][0], pts[pts.length - 1][1], pts[0][0], pts[0][1]);
  }
}

function drawFan(doc: jsPDF, fan: ConeFan): void {
  doc.setDrawColor(...OUTLINE_COLOR);
  doc.setLineWidth(OUTLINE_LINE_CM);
  drawPolyline(doc, fan.outlinePoints, true);

  doc.setDrawColor(...DIVISOR_COLOR);
  doc.setLineWidth(DIVISOR_LINE_CM);
  fan.divisoriasPoints.forEach((pts) => {
    drawPolyline(doc, pts, false);
  });
}

function drawCaption(doc: jsPDF, pageWidthCm: number, title: string, subtitle: string): void {
  const contentX = MARGIN_CM;
  const contentW = pageWidthCm - MARGIN_CM * 2;
  doc.setFillColor(...JOIN_COLOR);
  doc.circle(contentX + 0.1, MARGIN_CM + 0.35, 0.08, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(...TEXT_DARK);
  doc.text(title, contentX + 0.32, MARGIN_CM + 0.42);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(...TEXT_BODY);
  doc.text(subtitle, contentX + contentW, MARGIN_CM + 0.42, { align: 'right' });
  doc.setDrawColor(...BORDER_LIGHT);
  doc.setLineWidth(0.01);
  doc.line(contentX, MARGIN_CM + 0.6, contentX + contentW, MARGIN_CM + 0.6);
}

/** Cota vertical do lado direito, com setas nas pontas e o valor em cm. */
function drawHeightDimension(doc: jsPDF, xLine: number, topY: number, bottomY: number, label: string): void {
  doc.setDrawColor(...DIM_TEXT_COLOR);
  doc.setLineWidth(0.012);
  doc.line(xLine, topY, xLine, bottomY);
  doc.line(xLine - 0.12, topY, xLine + 0.12, topY);
  doc.line(xLine - 0.12, bottomY, xLine + 0.12, bottomY);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(...DIM_TEXT_COLOR);
  doc.text(label, xLine + 0.15, (topY + bottomY) / 2, { angle: 90 });
}

function renderInfoPage(
  doc: jsPDF,
  options: RiscadoPdfOptions,
  pageWidthCm: number,
  larguraEncontroCm: number,
  alturaTotalLeqCm: number
): number {
  const { nome, modelo, quantidadeGomosTotal, modo, repeticoes, desenhosUnicos } = options;
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
  doc.text(`${nome} — Risco do balao`, contentX, y + ptToCm(19));
  y += ptToCm(19) + 0.15;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  doc.setTextColor(...TEXT_BODY);
  doc.text(modelo, contentX, y + ptToCm(11));
  y += ptToCm(11) + 0.5;

  const statBoxH = 1.7;
  const statGap = 0.25;
  const statBoxW = (contentW - statGap * 5) / 6;
  const stats: Array<[string, string]> = [
    ['ALTURA DO LEQUE', formatCm(alturaTotalLeqCm)],
    ['LARGURA NO ENCONTRO', formatCm(larguraEncontroCm)],
    ['GOMOS DO MOLDE', String(quantidadeGomosTotal)],
    ['MODO', modo === 'individual' ? 'Individual' : 'Repeticao'],
    ['REPETICOES', modo === 'individual' ? '—' : `${repeticoes}x`],
    ['GOMOS A DESENHAR', String(desenhosUnicos)],
  ];
  stats.forEach(([label, value], index) => {
    const boxX = contentX + index * (statBoxW + statGap);
    doc.setFillColor(...BG_LIGHT);
    doc.setDrawColor(...BORDER_LIGHT);
    doc.setLineWidth(0.01);
    doc.roundedRect(boxX, y, statBoxW, statBoxH, 0.08, 0.08, 'FD');
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(...TEXT_MUTED);
    doc.text(label, boxX + 0.25, y + 0.55);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(...TEXT_DARK);
    doc.text(value, boxX + 0.25, y + 1.25);
  });
  y += statBoxH + 0.6;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(...TEXT_BODY);
  const explain =
    modo === 'individual'
      ? `O balao e feito de 2 pecas planificadas: o cone do bico (fecha na ponta) e o cone da boca (abre embaixo), encostando no ponto mais largo do molde. A pagina a seguir mostra os dois com a linha de cada um dos ${quantidadeGomosTotal} gomos — desenhe cada um diferente.`
      : `Desenhe o leque inteiro mostrado a seguir (${desenhosUnicos} gomos) — ele se repete ${repeticoes}x ao redor do balao ate fechar os ${quantidadeGomosTotal} gomos (${repeticoes} × ${desenhosUnicos} = ${quantidadeGomosTotal}).`;
  const lines = doc.splitTextToSize(explain, contentW) as string[];
  for (const line of lines) {
    doc.text(line, contentX, y + ptToCm(9.5));
    y += ptToCm(9.5) * 1.4;
  }
  y += ptToCm(9.5) * 0.6;

  doc.setFont('helvetica', 'italic');
  doc.setFontSize(8);
  doc.setTextColor(...TEXT_MUTED);
  const nota = doc.splitTextToSize(
    'O cone do bico e o cone da boca sao desenvolvimentos planificados (a mesma logica de abrir um cone de papel numa folha plana) — cada linha reta e uma divisoria de gomo, calculada com a largura real medida em cada altura do molde.',
    contentW
  ) as string[];
  for (const line of nota) {
    doc.text(line, contentX, y + ptToCm(8));
    y += ptToCm(8) * 1.35;
  }

  y += MARGIN_CM - 0.4;
  return y;
}

/** Mesmo limite usado no resto do sistema (Plotter de Tacos) pra quando um desenho passa do tamanho fisico de uma folha de PDF. */
const MAX_DRAWABLE_CM = 480;

/**
 * PDF do Plotter Riscado: 1a pagina = resumo, depois o cone do bico + cone
 * da boca planificados (leque, nao gomo-lente), tocando no ponto mais largo
 * do molde, em escala real, com a linha de cada gomo. Se a altura combinada
 * dos 2 leques passar do limite fisico de uma folha de PDF (~4,8m), divide
 * em varias folhas AINDA em escala real — a mesma logica de "desliza o
 * desenho e deixa a borda da pagina cortar o resto" usada no Plotter de
 * Tacos pra pecas grandes. Se for a LARGURA que passar do limite (leque
 * abrindo muito), ainda nao tem um jeito de dividir isso (precisaria de um
 * corte radial) — nesse caso lanca um erro explicando.
 */
export function buildRiscadoPdf(options: RiscadoPdfOptions): Blob {
  const model = buildBalaoConeModel(options.pontos, options.quantidadeGomosTotal);
  if (!model) {
    throw new Error('Molde sem pontos suficientes pra gerar o risco.');
  }

  const numGomos = options.desenhosUnicos;

  const bicoTopoWidth =
    2 *
    Math.max(...model.bico.slices.map((s) => s.s * Math.sin((s.larguraCm / Math.max(s.s, 0.0001) / 2) * numGomos)), 0.1);
  const bocaTopoWidth =
    2 *
    Math.max(...model.boca.slices.map((s) => s.s * Math.sin((s.larguraCm / Math.max(s.s, 0.0001) / 2) * numGomos)), 0.1);
  const larguraMaximaCm = Math.max(bicoTopoWidth, bocaTopoWidth, model.larguraNoEncontroCm);

  const drawingWidthCm = Math.max(MIN_WIDTH_CM, larguraMaximaCm + MARGIN_CM * 2 + 2.5);
  const alturaTotalLeqCm = model.bico.raioTotalCm + model.boca.raioTotalCm;

  if (drawingWidthCm > MAX_PAGE_CM) {
    throw new Error(
      `Esse leque abriu largo demais pra uma folha so (${formatCm(drawingWidthCm)}) — tente aumentar as repeticoes (reduz quantos gomos entram em cada leque).`
    );
  }

  const orientationFor = (w: number, h: number) => (w >= h ? 'l' : 'p');

  const measureDoc = new jsPDF({ unit: 'cm', format: [MIN_WIDTH_CM, 200], orientation: 'p' });
  const infoHeightCm = renderInfoPage(measureDoc, options, MIN_WIDTH_CM, model.larguraNoEncontroCm, alturaTotalLeqCm);

  const doc = new jsPDF({
    unit: 'cm',
    format: [MIN_WIDTH_CM, infoHeightCm],
    orientation: orientationFor(MIN_WIDTH_CM, infoHeightCm),
  });
  doc.setProperties({ title: `${options.nome} - Risco - Alisson Projetos` });
  renderInfoPage(doc, options, MIN_WIDTH_CM, model.larguraNoEncontroCm, alturaTotalLeqCm);

  // Coordenada global ao longo da altura combinada: 0 = ponta do bico, ate
  // alturaTotalLeqCm = ponta da boca. O encontro (bocas se tocando) fica em
  // model.bico.raioTotalCm. Cada folha "recorta" uma faixa [bandTop,
  // bandBottom] dessa coordenada global.
  const bands: Array<[number, number]> = [];
  if (alturaTotalLeqCm <= MAX_DRAWABLE_CM) {
    bands.push([0, alturaTotalLeqCm]);
  } else {
    let cursor = 0;
    while (cursor < alturaTotalLeqCm) {
      const bandBottom = Math.min(alturaTotalLeqCm, cursor + MAX_DRAWABLE_CM);
      bands.push([cursor, bandBottom]);
      cursor = bandBottom;
    }
  }

  const apiceX = drawingWidthCm / 2;
  const seamYGlobal = model.bico.raioTotalCm;

  bands.forEach(([bandTop, bandBottom], index) => {
    const pageHeightCm = bandBottom - bandTop + MARGIN_CM * 2 + CAPTION_H_CM;
    doc.addPage([drawingWidthCm, pageHeightCm], orientationFor(drawingWidthCm, pageHeightCm));

    const subtitle =
      bands.length === 1
        ? `Escala real · ${numGomos} gomo${numGomos === 1 ? '' : 's'} no leque`
        : `Escala real · folha ${index + 1} de ${bands.length} · ${numGomos} gomo${numGomos === 1 ? '' : 's'} no leque`;
    drawCaption(doc, drawingWidthCm, 'Cone do bico + cone da boca', subtitle);

    // originY e onde a coordenada global 0 (ponta do bico) cairia NESSA pagina —
    // fica fora da folha (Y negativo) pras faixas que nao comecam no topo, o
    // que e exatamente o efeito desejado: o proprio limite da pagina corta o
    // que nao pertence a essa folha.
    const originY = MARGIN_CM + CAPTION_H_CM - bandTop;
    const apiceYBico = originY;
    const apiceYBoca = originY + alturaTotalLeqCm;
    const seamY = originY + seamYGlobal;

    const bicoFan = buildConeFan(model.bico, numGomos, false, apiceX, apiceYBico);
    const bocaFan = buildConeFan(model.boca, numGomos, true, apiceX, apiceYBoca);

    drawFan(doc, bicoFan);
    drawFan(doc, bocaFan);

    if (seamY >= MARGIN_CM + CAPTION_H_CM && seamY <= pageHeightCm - MARGIN_CM) {
      doc.setDrawColor(...SEAM_COLOR);
      doc.setLineWidth(0.02);
      doc.setLineDashPattern([0.3, 0.2], 0);
      doc.line(MARGIN_CM, seamY, drawingWidthCm - MARGIN_CM, seamY);
      doc.setLineDashPattern([], 0);
    }

    // A cota de altura total so faz sentido numa folha so — em varias folhas
    // cada uma mostra so um pedaco, uma cota parcial ali confundiria mais do
    // que ajudaria (o total ja esta nos stats da pagina de resumo).
    if (bands.length === 1) {
      drawHeightDimension(doc, drawingWidthCm - MARGIN_CM + 0.5, apiceYBico, apiceYBoca, formatCm(alturaTotalLeqCm));
    }
  });

  return doc.output('blob');
}
