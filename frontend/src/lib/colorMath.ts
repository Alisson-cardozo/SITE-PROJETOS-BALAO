export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export function hexToRgb(hex: string): Rgb {
  const value = hex.replace('#', '');
  return {
    r: Number.parseInt(value.slice(0, 2), 16) || 0,
    g: Number.parseInt(value.slice(2, 4), 16) || 0,
    b: Number.parseInt(value.slice(4, 6), 16) || 0,
  };
}

export function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
  return `#${[clamp(r), clamp(g), clamp(b)].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * "Redmean" — distancia ponderada (nao so euclidiana simples) que se aproxima
 * bem melhor da percepcao humana de cor sem precisar converter pra CIE Lab.
 * https://www.compuphase.com/cmetric.htm
 */
export function colorDistance(a: string, b: string): number {
  const colorA = hexToRgb(a);
  const colorB = hexToRgb(b);
  const rMean = (colorA.r + colorB.r) / 2;
  const dR = colorA.r - colorB.r;
  const dG = colorA.g - colorB.g;
  const dB = colorA.b - colorB.b;
  return Math.sqrt((2 + rMean / 256) * dR * dR + 4 * dG * dG + (2 + (255 - rMean) / 256) * dB * dB);
}

export function colorSaturation(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return max === 0 ? 0 : (max - min) / max;
}
