import { jsPDF } from 'jspdf';

export interface BiscoitoPdfOptions {
  nome: string;
  diametroBiscoitoCm: number;
  diametroBocaCm: number;
  alturaBiscoitoCm: number;
  perimetroBiscoitoCm: number;
  larguraBordaCm: number;
  areaTotalCm2: number;
  tacoCm?: number;
  bainhaCm?: number;
}

export function buildBiscoitoPdf(options: BiscoitoPdfOptions): Blob {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const pw = 210;
  const ph = 297;
  const margin = 15;
  const tacoCm = Math.max(1, options.tacoCm || 5);
  const bainhaCm = Math.max(0, options.bainhaCm || 1);

  const tacosTampo = Math.ceil(options.diametroBiscoitoCm / tacoCm);
  const tacosFundo = Math.ceil(options.diametroBiscoitoCm / tacoCm);
  const tacosLateral = Math.ceil(options.perimetroBiscoitoCm / tacoCm);
  const tacosTotal = tacosTampo + tacosFundo + tacosLateral;

  // Capa / Relatorio Tecnico do Biscoito de Golfier
  doc.setFillColor(15, 23, 42); // slate-900
  doc.rect(0, 0, pw, ph, 'F');

  // Titulo
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(22);
  doc.setFont('helvetica', 'bold');
  doc.text('MOLDE DO BISCOITO DE GOLFIER', pw / 2, 25, { align: 'center' });

  doc.setFontSize(14);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(148, 163, 184); // slate-400
  doc.text(options.nome || 'Projeto Biscoito de Golfier', pw / 2, 33, { align: 'center' });

  // Linha divisoria
  doc.setDrawColor(59, 130, 246); // blue-500
  doc.setLineWidth(1);
  doc.line(margin, 40, pw - margin, 40);

  // Tabela de Medidas e Especificacoes
  doc.setFillColor(30, 41, 59); // slate-800
  doc.roundedRect(margin, 46, pw - margin * 2, 68, 4, 4, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text('Especificações Técnicas & Plotagem no Taco', margin + 10, 56);

  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(226, 232, 240);

  const rowY = 65;
  const stepY = 7;

  doc.text(`• Diâmetro do Biscoito: ${options.diametroBiscoitoCm.toFixed(1)} cm (Raio: ${(options.diametroBiscoitoCm / 2).toFixed(1)} cm)`, margin + 10, rowY);
  doc.text(`• Medida do Furo da Boca: ${options.diametroBocaCm.toFixed(1)} cm (Raio: ${(options.diametroBocaCm / 2).toFixed(1)} cm)`, margin + 10, rowY + stepY);
  doc.text(`• Altura da Parede Lateral: ${options.alturaBiscoitoCm.toFixed(1)} cm`, margin + 10, rowY + stepY * 2);
  doc.text(`• Perímetro da Faixa Lateral: ${options.perimetroBiscoitoCm.toFixed(1)} cm (Circunferência Exata)`, margin + 10, rowY + stepY * 3);
  doc.text(`• Largura da Borda de Fixação: ${options.larguraBordaCm.toFixed(1)} cm`, margin + 10, rowY + stepY * 4);
  doc.text(`• Tamanho do Taco Configurado: ${tacoCm} cm | Bainha de Junção: ${bainhaCm} cm`, margin + 10, rowY + stepY * 5);
  doc.text(`• Total de Tacos Calculados: ${tacosTotal} Tacos Quadriculados`, margin + 10, rowY + stepY * 6);

  // Instrucoes de Montagem das 3 Partes
  doc.setFillColor(30, 41, 59);
  doc.roundedRect(margin, 120, pw - margin * 2, 140, 4, 4, 'F');

  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(255, 255, 255);
  doc.text('Detalhamento das 3 Partes do Molde', margin + 10, 132);

  // Parte 1
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(59, 130, 246);
  doc.text('1. Tampo Superior (Círculo com Furo)', margin + 10, 143);
  doc.setFontSize(9.5);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(203, 213, 225);
  doc.text(`Círculo com diâmetro de ${options.diametroBiscoitoCm.toFixed(1)}cm e um furo central com diâmetro de ${options.diametroBocaCm.toFixed(1)}cm. Quadriculado em tacos de ${tacoCm}cm com bainha de ${bainhaCm}cm.`, margin + 14, 150, { maxWidth: 160 });

  // Parte 2
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(34, 197, 94);
  doc.text('2. Fundo Inferior (Círculo Maciço)', margin + 10, 168);
  doc.setFontSize(9.5);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(203, 213, 225);
  doc.text(`Círculo fechado sem furo com diâmetro de ${options.diametroBiscoitoCm.toFixed(1)}cm. Quadriculado em tacos de ${tacoCm}cm com bainha de ${bainhaCm}cm.`, margin + 14, 175, { maxWidth: 160 });

  // Parte 3
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(234, 179, 8);
  doc.text('3. Faixa Lateral (Parede do Biscoito)', margin + 10, 193);
  doc.setFontSize(9.5);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(203, 213, 225);
  doc.text(`Faixa retangular de ${options.alturaBiscoitoCm.toFixed(1)}cm x ${options.perimetroBiscoitoCm.toFixed(1)}cm. Quadriculada em tacos de ${tacoCm}cm com bainha de ${bainhaCm}cm.`, margin + 14, 200, { maxWidth: 160 });

  // Diagrama no PDF
  const drawY = 218;

  // Desenho Tampo
  doc.setDrawColor(59, 130, 246);
  doc.setLineWidth(0.8);
  doc.circle(margin + 30, drawY + 15, 15);
  doc.circle(margin + 30, drawY + 15, 15 * (options.diametroBocaCm / Math.max(1, options.diametroBiscoitoCm)));

  // Desenho Fundo
  doc.setDrawColor(34, 197, 94);
  doc.circle(margin + 80, drawY + 15, 15);

  // Desenho Lateral
  doc.setDrawColor(234, 179, 8);
  doc.rect(margin + 120, drawY + 5, 50, 20);

  // Legenda
  doc.setFontSize(8);
  doc.setTextColor(148, 163, 184);
  doc.text('Tampo (com Furo)', margin + 30, drawY + 36, { align: 'center' });
  doc.text('Fundo (Maciço)', margin + 80, drawY + 36, { align: 'center' });
  doc.text('Faixa Lateral', margin + 145, drawY + 36, { align: 'center' });

  // Rodape
  doc.setFontSize(9);
  doc.setTextColor(100, 116, 139);
  doc.text('Gerado pelo Sistema Cardozo Plotter - Módulo Biscoito de Golfier em Tacos', pw / 2, ph - 10, { align: 'center' });

  return doc.output('blob');
}

export function buildBiscoitoPlotterPdf(options: BiscoitoPdfOptions): Blob {
  const dExtCm = Math.max(1, options.diametroBiscoitoCm);
  const dBocaCm = Math.max(0.5, options.diametroBocaCm);
  const hCm = Math.max(0.5, options.alturaBiscoitoCm);
  const pCm = Math.max(1, options.perimetroBiscoitoCm);
  const tacoCm = Math.max(1, options.tacoCm || 5);
  const bainhaCm = Math.max(0, options.bainhaCm || 1);
  const bordaCm = (dExtCm - dBocaCm) / 2;

  // Margem de segurança em cm
  const mCm = 2;

  // Página 1: Tampo Superior 1:1 com Quadriculado de Tacos X e Y
  const p1W = Math.max(30, dExtCm + mCm * 2);
  const p1H = Math.max(30, dExtCm + mCm * 2 + 3);

  const doc = new jsPDF({
    unit: 'cm',
    format: [p1W, p1H],
    orientation: p1W > p1H ? 'l' : 'p',
  });

  const c1x = p1W / 2;
  const c1y = (p1H - 2) / 2;
  const rExtCm = dExtCm / 2;
  const rBocaCm = dBocaCm / 2;

  // Círculo Externo (Corte Tampo)
  doc.setLineWidth(0.08);
  doc.setDrawColor(59, 130, 246);
  doc.circle(c1x, c1y, rExtCm, 'S');

  // Círculo Interno (Furo da Boca)
  doc.setLineWidth(0.08);
  doc.setDrawColor(59, 130, 246);
  doc.circle(c1x, c1y, rBocaCm, 'S');

  // Linhas Guia de Centro
  doc.setLineWidth(0.04);
  doc.setDrawColor(148, 163, 184);
  doc.line(c1x - rExtCm - 1, c1y, c1x + rExtCm + 1, c1y);
  doc.line(c1x, c1y - rExtCm - 1, c1x, c1y + rExtCm + 1);

  // GRADE QUADRICULADA X e Y no Tampo
  doc.setLineWidth(0.03);
  doc.setDrawColor(6, 182, 212);
  const startX1 = c1x - rExtCm;
  const startY1 = c1y - rExtCm;

  for (let x = startX1; x <= c1x + rExtCm; x += tacoCm) {
    doc.line(x, c1y - rExtCm, x, c1y + rExtCm);
  }
  for (let y = startY1; y <= c1y + rExtCm; y += tacoCm) {
    doc.line(c1x - rExtCm, y, c1x + rExtCm, y);
  }

  // Linhas de BAINHA no Tampo (se configurada)
  if (bainhaCm > 0) {
    doc.setLineWidth(0.02);
    doc.setDrawColor(234, 179, 8);
    for (let x = startX1 + bainhaCm; x < c1x + rExtCm; x += tacoCm) {
      doc.line(x, c1y - rExtCm, x, c1y + rExtCm);
    }
    for (let y = startY1 + bainhaCm; y < c1y + rExtCm; y += tacoCm) {
      doc.line(c1x - rExtCm, y, c1x + rExtCm, y);
    }
  }

  // Legendas da Página 1
  doc.setFontSize(10);
  doc.setTextColor(30, 41, 59);
  doc.text(
    `PLOTTER - BISCOITO DE GOLFIER | PARTE 1: TAMPO SUPERIOR | TACO: ${tacoCm} CM | BAINHA: ${bainhaCm} CM`,
    p1W / 2,
    p1H - 1.2,
    { align: 'center' }
  );
  doc.setFontSize(8);
  doc.text(
    `Ø Total: ${dExtCm.toFixed(1)}cm | Ø Furo Boca: ${dBocaCm.toFixed(1)}cm | Borda: ${bordaCm.toFixed(1)}cm | Projeto: ${options.nome || 'Sem nome'}`,
    p1W / 2,
    p1H - 0.6,
    { align: 'center' }
  );

  // Página 2: Fundo Inferior 1:1 com Quadriculado X e Y
  const p2W = p1W;
  const p2H = p1H;
  doc.addPage([p2W, p2H], p2W > p2H ? 'l' : 'p');

  const c2x = p2W / 2;
  const c2y = (p2H - 2) / 2;

  doc.setLineWidth(0.08);
  doc.setDrawColor(34, 197, 94);
  doc.circle(c2x, c2y, rExtCm, 'S');

  doc.setLineWidth(0.04);
  doc.setDrawColor(148, 163, 184);
  doc.line(c2x - rExtCm - 1, c2y, c2x + rExtCm + 1, c2y);
  doc.line(c2x, c2y - rExtCm - 1, c2x, c2y + rExtCm + 1);

  // GRADE QUADRICULADA X e Y no Fundo
  doc.setLineWidth(0.03);
  doc.setDrawColor(34, 197, 94);
  const startX2 = c2x - rExtCm;
  const startY2 = c2y - rExtCm;

  for (let x = startX2; x <= c2x + rExtCm; x += tacoCm) {
    doc.line(x, c2y - rExtCm, x, c2y + rExtCm);
  }
  for (let y = startY2; y <= c2y + rExtCm; y += tacoCm) {
    doc.line(c2x - rExtCm, y, c2x + rExtCm, y);
  }

  // Linhas de BAINHA no Fundo
  if (bainhaCm > 0) {
    doc.setLineWidth(0.02);
    doc.setDrawColor(234, 179, 8);
    for (let x = startX2 + bainhaCm; x < c2x + rExtCm; x += tacoCm) {
      doc.line(x, c2y - rExtCm, x, c2y + rExtCm);
    }
    for (let y = startY2 + bainhaCm; y < c2y + rExtCm; y += tacoCm) {
      doc.line(c2x - rExtCm, y, c2x + rExtCm, y);
    }
  }

  doc.setFontSize(10);
  doc.setTextColor(30, 41, 59);
  doc.text(
    `PLOTTER - BISCOITO DE GOLFIER | PARTE 2: FUNDO INFERIOR (MACIÇO) | TACO: ${tacoCm} CM | BAINHA: ${bainhaCm} CM`,
    p2W / 2,
    p2H - 1.2,
    { align: 'center' }
  );
  doc.setFontSize(8);
  doc.text(
    `Círculo Maciço Ø ${dExtCm.toFixed(1)}cm | Raio: ${rExtCm.toFixed(1)}cm | Projeto: ${options.nome || 'Sem nome'}`,
    p2W / 2,
    p2H - 0.6,
    { align: 'center' }
  );

  // Página 3: Faixa Lateral (Parede) 1:1 com Quadriculado X e Y
  const p3W = Math.max(30, pCm + mCm * 2);
  const p3H = Math.max(15, hCm + mCm * 2 + 3);
  doc.addPage([p3W, p3H], p3W > p3H ? 'l' : 'p');

  const r3x = mCm;
  const r3y = mCm;

  doc.setLineWidth(0.08);
  doc.setDrawColor(234, 179, 8);
  doc.rect(r3x, r3y, pCm, hCm, 'S');

  // GRADE QUADRICULADA X e Y na Faixa Lateral
  doc.setLineWidth(0.03);
  doc.setDrawColor(234, 179, 8);
  for (let x = r3x; x <= r3x + pCm; x += tacoCm) {
    doc.line(x, r3y, x, r3y + hCm);
  }
  for (let y = r3y; y <= r3y + hCm; y += tacoCm) {
    doc.line(r3x, y, r3x + pCm, y);
  }

  // Linhas de BAINHA na Faixa Lateral
  if (bainhaCm > 0) {
    doc.setLineWidth(0.02);
    doc.setDrawColor(59, 130, 246);
    for (let x = r3x + bainhaCm; x < r3x + pCm; x += tacoCm) {
      doc.line(x, r3y, x, r3y + hCm);
    }
    for (let y = r3y + bainhaCm; y < r3y + hCm; y += tacoCm) {
      doc.line(r3x, y, r3x + pCm, y);
    }
  }

  doc.setFontSize(10);
  doc.setTextColor(30, 41, 59);
  doc.text(
    `PLOTTER - BISCOITO DE GOLFIER | PARTE 3: FAIXA LATERAL (PAREDE) | TACO: ${tacoCm} CM | BAINHA: ${bainhaCm} CM`,
    p3W / 2,
    p3H - 1.2,
    { align: 'center' }
  );
  doc.setFontSize(8);
  doc.text(
    `Comprimento (Perímetro): ${pCm.toFixed(1)}cm | Altura: ${hCm.toFixed(1)}cm | Projeto: ${options.nome || 'Sem nome'}`,
    p3W / 2,
    p3H - 0.6,
    { align: 'center' }
  );

  return doc.output('blob');
}
