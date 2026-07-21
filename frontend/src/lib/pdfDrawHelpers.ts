import { jsPDF } from 'jspdf';

/** Boilerplate 100% generico de desenho em PDF (jsPDF) — compartilhado entre
 * bandeiraPdf.ts e painelPdf.ts, sem nada especifico de bandeira ou painel. */

export function hexToRgb(hex: string): [number, number, number] {
  const match = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex.trim());
  if (!match) {
    return [200, 200, 200];
  }
  return [parseInt(match[1], 16), parseInt(match[2], 16), parseInt(match[3], 16)];
}

export function ptToCm(pt: number): number {
  return (pt / 72) * 2.54;
}

export function formatCm(value: number): string {
  const n = Number(value);
  const text = Number.isFinite(n) ? n.toFixed(1).replace(/\.0$/, '').replace('.', ',') : '0';
  return `${text} cm`;
}

export const TEXT_DARK: [number, number, number] = [17, 24, 39];
export const TEXT_BODY: [number, number, number] = [55, 65, 81];
export const TEXT_MUTED: [number, number, number] = [107, 114, 128];
export const BORDER_LIGHT: [number, number, number] = [229, 231, 235];
export const BG_LIGHT: [number, number, number] = [249, 250, 251];

export const MARGIN_CM = 1.4;

/** Legenda no topo da pagina de desenho: titulo a esquerda, subtitulo a
 * direita, linha divisoria embaixo. */
export function drawCaption(doc: jsPDF, pageWidthCm: number, title: string, subtitle: string): void {
  const contentX = MARGIN_CM;
  const contentW = pageWidthCm - MARGIN_CM * 2;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(...TEXT_DARK);
  doc.text(title, contentX, MARGIN_CM + 0.42);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(...TEXT_BODY);
  doc.text(subtitle, contentX + contentW, MARGIN_CM + 0.42, { align: 'right' });
  doc.setDrawColor(...BORDER_LIGHT);
  doc.setLineWidth(0.01);
  doc.line(contentX, MARGIN_CM + 0.6, contentX + contentW, MARGIN_CM + 0.6);
}
