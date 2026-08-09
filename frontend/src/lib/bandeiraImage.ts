import { colorDistance, colorSaturation, hexToRgb, rgbToHex } from './colorMath';
import { findClosestCatalogColor } from './bandeiraColors';

/** 1 pixel da grade = 10cm no mundo real (espacamento padrao do taco fisico). */
export const CM_POR_PIXEL = 10;

/** Uma folha fisica e 70x50cm nominal, mas so uma area de 60x50cm entra na
 * contagem de tacos (os outros 10cm de largura sao reservados/perdidos —
 * nao contam). */
export const FOLHA_NOMINAL_LARGURA_CM = 70;
export const FOLHA_NOMINAL_ALTURA_CM = 50;
export const FOLHA_USAVEL_LARGURA_CM = 60;
export const FOLHA_USAVEL_ALTURA_CM = 50;

/** Quantos tacos do tamanho dado cabem na area USAVEL de 1 folha (60x50cm)
 * — conta por encaixe real (linhas x colunas cheias), nao por area/area,
 * senao contaria sobra de taco parcial que na pratica nao da pra cortar. */
export function computeTacosPerFolha(tacoSizeCm: number): number {
  if (tacoSizeCm <= 0) {
    return 0;
  }
  return Math.floor(FOLHA_USAVEL_LARGURA_CM / tacoSizeCm) * Math.floor(FOLHA_USAVEL_ALTURA_CM / tacoSizeCm);
}

/** Teto de seguranca pra grade nao travar o navegador (rects demais pra
 * desenhar/interagir). Bate na mesma ordem de grandeza que o modulo antigo. */
export const MAX_GRID_SIDE = 320;
export const MAX_GRID_CELLS = 45000;

/** Resolucao maxima de TRABALHO da imagem de origem (so pra nao decodificar
 * fotos gigantescas pixel a pixel em JS) — bem acima de qualquer grade final
 * razoavel, entao a media por celula continua fiel a imagem original. */
const MAX_SOURCE_DIMENSION = 2000;

export interface BandeiraGridSize {
  widthPx: number;
  heightPx: number;
}

export function computeGridSize(widthCm: number, heightCm: number): BandeiraGridSize {
  return {
    widthPx: Math.max(1, Math.round(widthCm / CM_POR_PIXEL)),
    heightPx: Math.max(1, Math.round(heightCm / CM_POR_PIXEL)),
  };
}

export function gridSizeExceedsLimit(_size: BandeiraGridSize): boolean {
  return false;
}

/** Teto da grade FINAL (ja expandida pro tamanho real, 1 celula = 1cm) — bem
 * maior que o teto da grade de trabalho, mas ainda existe pra nao travar o
 * navegador de vez com um pedido absurdo (tipo 50m x 50m). */
export const MAX_EXPANDED_CELLS = 300_000_000;

export function expandedSizeExceedsLimit(_widthCm: number, _heightCm: number): boolean {
  return false;
}

/**
 * Expande a grade pequena (usada pra taquear/reduzir cor rapido) pro tamanho
 * real em cm — cada celula pequena vira um bloco factor x factor identico na
 * grade final. Isso deixa o trabalho pesado (media de cor, k-means) rodando
 * numa grade pequena e rapida, mas o projeto final fica na resolucao real
 * (1 celula = 1cm de verdade), com precisao total pra grade de folhas/tacos.
 */
export function expandGrid(smallColors: string[], smallWidth: number, smallHeight: number, factor: number): BandeiraPixelGrid {
  const widthPx = smallWidth * factor;
  const heightPx = smallHeight * factor;
  const colors = new Array<string>(widthPx * heightPx);

  for (let sy = 0; sy < smallHeight; sy += 1) {
    for (let sx = 0; sx < smallWidth; sx += 1) {
      const color = smallColors[sy * smallWidth + sx];
      const startX = sx * factor;
      const startY = sy * factor;
      for (let dy = 0; dy < factor; dy += 1) {
        const rowOffset = (startY + dy) * widthPx;
        for (let dx = 0; dx < factor; dx += 1) {
          colors[rowOffset + startX + dx] = color;
        }
      }
    }
  }

  return { widthPx, heightPx, colors, originalWidthPx: 0, originalHeightPx: 0 };
}

/** So le o tamanho nativo do arquivo (rapido, sem processar pixel nenhum) —
 * usado assim que o usuario escolhe a imagem, pra sugerir a grade/tamanho
 * automaticamente em vez de pedir pra ele digitar antes. */
export async function readImageNaturalSize(file: File): Promise<BandeiraGridSize> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const nextImage = new Image();
      nextImage.onload = () => resolve(nextImage);
      nextImage.onerror = () => reject(new Error('Nao foi possivel ler a imagem.'));
      nextImage.src = objectUrl;
    });
    return { widthPx: Math.max(1, image.naturalWidth), heightPx: Math.max(1, image.naturalHeight) };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

/**
 * Sugere a grade de trabalho a partir do tamanho nativo da imagem — usa 1
 * pixel de imagem = 1 celula da grade quando da, ou escala pra baixo mantendo
 * a proporcao se passar do teto de seguranca (MAX_GRID_SIDE/MAX_GRID_CELLS).
 */
export function suggestGridFromImage(naturalWidthPx: number, naturalHeightPx: number): BandeiraGridSize {
  const areaScale = Math.sqrt(MAX_GRID_CELLS / (naturalWidthPx * naturalHeightPx));
  const sideScale = MAX_GRID_SIDE / Math.max(naturalWidthPx, naturalHeightPx);
  const scale = Math.min(1, areaScale, sideScale);
  return {
    widthPx: Math.max(1, Math.round(naturalWidthPx * scale)),
    heightPx: Math.max(1, Math.round(naturalHeightPx * scale)),
  };
}

export interface BandeiraPixelGrid {
  widthPx: number;
  heightPx: number;
  /** Uma cor hex por celula, linha a linha (index = y * widthPx + x). */
  colors: string[];
  /** Tamanho nativo do arquivo enviado (antes de qualquer redimensionamento). */
  originalWidthPx: number;
  originalHeightPx: number;
}

/**
 * Redimensiona a imagem carregada pra grade final fazendo MEDIA de area (box
 * filter) — cada celula final vira a media de todos os pixels de origem que
 * caem nela, em vez de so "pular" pixels (vizinho mais proximo). Isso evita
 * ruido/serrilhado e preserva a cor real da imagem bem melhor ao reduzir uma
 * foto grande pra uma grade pequena.
 */
export async function readBandeiraPixelGrid(file: File, targetWidthPx: number, targetHeightPx: number): Promise<BandeiraPixelGrid> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const nextImage = new Image();
      nextImage.onload = () => resolve(nextImage);
      nextImage.onerror = () => reject(new Error('Nao foi possivel ler a imagem.'));
      nextImage.src = objectUrl;
    });

    const naturalWidth = Math.max(1, image.naturalWidth);
    const naturalHeight = Math.max(1, image.naturalHeight);
    const capScale = Math.min(1, MAX_SOURCE_DIMENSION / Math.max(naturalWidth, naturalHeight));
    const sourceWidth = Math.max(targetWidthPx, Math.round(naturalWidth * capScale));
    const sourceHeight = Math.max(targetHeightPx, Math.round(naturalHeight * capScale));

    const sourceCanvas = document.createElement('canvas');
    sourceCanvas.width = sourceWidth;
    sourceCanvas.height = sourceHeight;
    const sourceCtx = sourceCanvas.getContext('2d', { willReadFrequently: true })!;
    sourceCtx.imageSmoothingEnabled = true;
    sourceCtx.imageSmoothingQuality = 'high';
    sourceCtx.drawImage(image, 0, 0, sourceWidth, sourceHeight);

    const sourceData = sourceCtx.getImageData(0, 0, sourceWidth, sourceHeight).data;

    const sumR = new Float64Array(targetWidthPx * targetHeightPx);
    const sumG = new Float64Array(targetWidthPx * targetHeightPx);
    const sumB = new Float64Array(targetWidthPx * targetHeightPx);
    const sumWeight = new Float64Array(targetWidthPx * targetHeightPx);

    for (let sy = 0; sy < sourceHeight; sy += 1) {
      const ty = Math.min(targetHeightPx - 1, Math.floor((sy * targetHeightPx) / sourceHeight));
      for (let sx = 0; sx < sourceWidth; sx += 1) {
        const tx = Math.min(targetWidthPx - 1, Math.floor((sx * targetWidthPx) / sourceWidth));
        const offset = (sy * sourceWidth + sx) * 4;
        const alpha = sourceData[offset + 3] / 255;
        if (alpha <= 0) {
          continue;
        }
        const cell = ty * targetWidthPx + tx;
        // pixels transparentes contam menos (fundo vira branco por baixo, nao
        // "suja" a cor media da celula com pixels quase invisiveis)
        sumR[cell] += sourceData[offset] * alpha;
        sumG[cell] += sourceData[offset + 1] * alpha;
        sumB[cell] += sourceData[offset + 2] * alpha;
        sumWeight[cell] += alpha;
      }
    }

    const colors = new Array<string>(targetWidthPx * targetHeightPx);
    for (let cell = 0; cell < colors.length; cell += 1) {
      const weight = sumWeight[cell];
      colors[cell] = weight > 0 ? rgbToHex(sumR[cell] / weight, sumG[cell] / weight, sumB[cell] / weight) : '#ffffff';
    }

    return {
      widthPx: targetWidthPx,
      heightPx: targetHeightPx,
      colors,
      originalWidthPx: naturalWidth,
      originalHeightPx: naturalHeight,
    };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export interface BandeiraColorSummaryEntry {
  hex: string;
  name: string;
  count: number;
}

export function buildColorSummary(colors: string[]): BandeiraColorSummaryEntry[] {
  const counts = new Map<string, number>();
  for (const color of colors) {
    counts.set(color, (counts.get(color) ?? 0) + 1);
  }

  return Array.from(counts.entries())
    .map(([hex, count]) => ({ hex, name: findClosestCatalogColor(hex).name, count }))
    .sort((a, b) => b.count - a.count);
}

/**
 * Reduz a paleta pra no maximo `maxColors` cores, agrupando por proximidade
 * (k-means ponderado por frequencia + saturacao, com sementes escolhidas pelo
 * ponto mais distante dos centros ja escolhidos - determinístico, sem
 * aleatoriedade). Cada centro final e "encaixado" na cor real mais proxima
 * que existia na imagem, pra nunca inventar uma cor que nao estava la.
 */
export function reduceBandeiraPalette(colors: string[], maxColors: number): string[] {
  const counts = new Map<string, number>();
  for (const color of colors) {
    counts.set(color, (counts.get(color) ?? 0) + 1);
  }

  const distinct = Array.from(counts.entries()).map(([hex, count]) => {
    const rgb = hexToRgb(hex);
    const saturation = colorSaturation(hex);
    return { hex, count, r: rgb.r, g: rgb.g, b: rgb.b, saturation, score: count * (1 + saturation * 3.2) };
  });

  if (distinct.length <= maxColors) {
    return colors;
  }

  const ranked = [...distinct].sort((a, b) => b.score - a.score);
  const centers: Array<{ r: number; g: number; b: number }> = [{ r: ranked[0].r, g: ranked[0].g, b: ranked[0].b }];

  while (centers.length < maxColors) {
    let bestCandidate = ranked[0];
    let bestScore = -Infinity;
    for (const candidate of ranked) {
      let minDistance = Infinity;
      for (const center of centers) {
        const distance = colorDistance(candidate.hex, rgbToHex(center.r, center.g, center.b));
        if (distance < minDistance) {
          minDistance = distance;
        }
      }
      const candidateScore = minDistance * (1 + candidate.saturation * 0.6) * Math.sqrt(candidate.count);
      if (candidateScore > bestScore) {
        bestScore = candidateScore;
        bestCandidate = candidate;
      }
    }
    centers.push({ r: bestCandidate.r, g: bestCandidate.g, b: bestCandidate.b });
  }

  for (let iteration = 0; iteration < 8; iteration += 1) {
    const buckets = centers.map(() => ({ weight: 0, r: 0, g: 0, b: 0 }));
    for (const color of distinct) {
      let bestIndex = 0;
      let bestDistance = Infinity;
      centers.forEach((center, index) => {
        const distance = colorDistance(color.hex, rgbToHex(center.r, center.g, center.b));
        if (distance < bestDistance) {
          bestDistance = distance;
          bestIndex = index;
        }
      });
      const weight = color.count * (1 + color.saturation * 0.5);
      buckets[bestIndex].weight += weight;
      buckets[bestIndex].r += color.r * weight;
      buckets[bestIndex].g += color.g * weight;
      buckets[bestIndex].b += color.b * weight;
    }
    centers.forEach((center, index) => {
      const bucket = buckets[index];
      if (bucket.weight > 0) {
        center.r = bucket.r / bucket.weight;
        center.g = bucket.g / bucket.weight;
        center.b = bucket.b / bucket.weight;
      }
    });
  }

  // encaixa cada centro calculado na cor REAL mais proxima que existia na imagem
  const representativeHex = centers.map((center) => {
    const centerHex = rgbToHex(center.r, center.g, center.b);
    let best = ranked[0].hex;
    let bestDistance = Infinity;
    for (const candidate of ranked) {
      const distance = colorDistance(candidate.hex, centerHex);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = candidate.hex;
      }
    }
    return best;
  });

  const mapToFinal = new Map<string, string>();
  for (const color of distinct) {
    let bestIndex = 0;
    let bestDistance = Infinity;
    centers.forEach((center, index) => {
      const distance = colorDistance(color.hex, rgbToHex(center.r, center.g, center.b));
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    });
    mapToFinal.set(color.hex, representativeHex[bestIndex]);
  }

  return colors.map((color) => mapToFinal.get(color) ?? color);
}

/** Troca em massa: toda celula com `fromHex` passa a ter `toHex`. */
export function replaceColorInGrid(colors: string[], fromHex: string, toHex: string): string[] {
  return colors.map((color) => (color === fromHex ? toHex : color));
}

/** Abaixo desse teto (por canal), a cor e tratada como "preto" — na pratica
 * o taco preto e sempre o mesmo material, entao nao faz sentido a imagem
 * (por causa de compressao/ruido/anti-aliasing) gerar 2+ tons quase-pretos
 * como se fossem cores diferentes. */
const NEAR_BLACK_MAX_CHANNEL = 30;

/** Funde qualquer cor bem escura (quase sem luz em nenhum canal) num preto
 * puro so — chamada assim que a imagem e taqueada, antes de contar/reduzir
 * cores, pra nunca aparecer "Preto Suave" e "Preto Carvao" como se fossem 2
 * materiais na tabela de cores. */
export function snapNearBlackToBlack(colors: string[]): string[] {
  return colors.map((hex) => {
    const { r, g, b } = hexToRgb(hex);
    return Math.max(r, g, b) <= NEAR_BLACK_MAX_CHANNEL ? '#000000' : hex;
  });
}

/** [cor, quantas vezes seguidas]. */
export type BandeiraGridRun = [string, number];

/**
 * Comprime a grade (RLE) antes de mandar pro servidor — bandeira/pixel-art
 * tem blocos grandes de cor solida (ainda mais depois de expandir pro
 * tamanho real, onde cada celula pequena virou um bloco 10x10 identico), en
 * tao isso reduz MUITO o tamanho do payload (as vezes 50-100x menor),
 * independente de qualquer limite de post_max_size do servidor.
 */
export function encodeGridRuns(colors: string[]): BandeiraGridRun[] {
  const runs: BandeiraGridRun[] = [];
  for (const color of colors) {
    const last = runs[runs.length - 1];
    if (last && last[0] === color) {
      last[1] += 1;
    } else {
      runs.push([color, 1]);
    }
  }
  return runs;
}

export function decodeGridRuns(runs: BandeiraGridRun[]): string[] {
  const colors: string[] = [];
  for (const [color, count] of runs) {
    for (let i = 0; i < count; i += 1) {
      colors.push(color);
    }
  }
  return colors;
}

/** Le uma imagem na sua resolucao nativa sem taquear ou reduzir cores.
 * Usado por "Importar Projeto Pronto" pra pular a parte de tamanho/quantidade de cores. */
export async function readBandeiraNativePixelGrid(
  file: File,
  maxDim: number = 2000
): Promise<{ widthPx: number; heightPx: number; colors: string[] }> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const nextImage = new Image();
      nextImage.onload = () => resolve(nextImage);
      nextImage.onerror = () => reject(new Error('Nao foi possivel ler a imagem.'));
      nextImage.src = objectUrl;
    });

    let w = img.naturalWidth || img.width || 100;
    let h = img.naturalHeight || img.height || 100;

    if (w > maxDim || h > maxDim) {
      const scale = Math.min(maxDim / w, maxDim / h);
      w = Math.max(1, Math.round(w * scale));
      h = Math.max(1, Math.round(h * scale));
    }

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Nao foi possivel criar o canvas de leitura.');

    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, 0, 0, w, h);

    const imageData = ctx.getImageData(0, 0, w, h);
    const data = imageData.data;
    const rawColors: string[] = [];

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const a = data[i + 3];

      if (a < 128) {
        rawColors.push('#ffffff');
      } else {
        const hex = '#' + [r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('');
        rawColors.push(hex);
      }
    }

    return { widthPx: w, heightPx: h, colors: snapNearBlackToBlack(rawColors) };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

