/**
 * Grade de lanternagem de bojo: cada CELULA da grade e 1 lanterna de verdade
 * (nao tem conversao de cm/taco/folha, ao contrario de bandeiraImage.ts) —
 * largura = gomos x lanternas por gomo (o balao INTEIRO, gomo a gomo, lado a
 * lado), altura = lanternas subindo.
 */

/** Teto de seguranca (mesma ordem de grandeza do limite de bandeira/painel)
 * pra nao travar o navegador com uma grade gigante. */
export const MAX_LANTERNA_SIDE = 320;
export const MAX_LANTERNA_CELLS = 45000;

export interface LanternaGridSize {
  widthPx: number;
  heightPx: number;
}

export function computeLanternaGridSize(gomos: number, lanternasPorGomo: number, lanternasSubindo: number): LanternaGridSize {
  const widthPx = Math.max(0, Math.floor(gomos) || 0) * Math.max(0, Math.floor(lanternasPorGomo) || 0);
  const heightPx = Math.max(0, Math.floor(lanternasSubindo) || 0);
  return { widthPx, heightPx };
}

export function lanternaGridSizeExceedsLimit(size: LanternaGridSize): boolean {
  if (size.widthPx <= 0 || size.heightPx <= 0) {
    return false;
  }
  return size.widthPx > MAX_LANTERNA_SIDE || size.heightPx > MAX_LANTERNA_SIDE || size.widthPx * size.heightPx > MAX_LANTERNA_CELLS;
}

/** Resolucao maxima de TRABALHO da imagem de origem antes de amostrar pra
 * grade (mesma ideia de bandeiraImage.ts — nao decodifica foto gigante pixel
 * a pixel em JS). */
const MAX_SOURCE_DIMENSION = 2000;

/**
 * Le um arquivo de imagem (PNG/JPG/etc — PDF ja deve ter sido convertido antes
 * via pdfToImage.ts) e amostra pra grade final (gomos x lanternas por gomo de
 * largura, lanternas subindo de altura) fazendo MEDIA de area, igual
 * bandeiraImage.ts. Diferenca de proposito: pixel TRANSPARENTE (alpha 0) vira
 * PRETO aqui (nao branco) — preto e o "sem lanterna" padrao dessa grade, entao
 * fundo transparente do arquivo enviado vira automaticamente fundo sem
 * lanterna, do jeito que o cliente pediu.
 */
export async function readLanternaPixelGridFromFile(file: File, targetWidthPx: number, targetHeightPx: number): Promise<string[]> {
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
        sumR[cell] += sourceData[offset] * alpha;
        sumG[cell] += sourceData[offset + 1] * alpha;
        sumB[cell] += sourceData[offset + 2] * alpha;
        sumWeight[cell] += alpha;
      }
    }

    const colors = new Array<string>(targetWidthPx * targetHeightPx);
    for (let cell = 0; cell < colors.length; cell += 1) {
      const weight = sumWeight[cell];
      if (weight <= 0) {
        colors[cell] = '#000000';
        continue;
      }
      const r = Math.round(sumR[cell] / weight);
      const g = Math.round(sumG[cell] / weight);
      const b = Math.round(sumB[cell] / weight);
      colors[cell] = `#${[r, g, b].map((n) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, '0')).join('')}`;
    }

    return colors;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

/** Upscale de trabalho pro PNG gerado a partir da grade — 1 lanterna = 1px
 * ficaria borrado/serrilhado demais como textura enrolada num balao 3D. */
const RENDER_TARGET_LONG_SIDE = 1024;

/**
 * Rasteriza a grade de lanternagem (colors/gridWidth/gridHeight, ja salva ou
 * ainda na tela) num PNG — usado pra "Usar Lanternagem de Bojo" no preview 3D
 * (3D e Fotos), pendurada como franja separada embaixo do bojo. Preto nunca e
 * desenhado (nem opaco nem transparente-alpha) — com `transparentBackground`
 * o pixel fica com alpha 0 de verdade (canvas comeca transparente por
 * padrao), pra a franja deixar ver o fundo escuro entre as lanternas em vez
 * de aparecer como um pano solido preto colado no balao.
 */
export async function renderLanternaGridToImageFile(
  colors: string[],
  gridWidth: number,
  gridHeight: number,
  options: { bolinha?: boolean; filename?: string; transparentBackground?: boolean } = {}
): Promise<File> {
  if (gridWidth <= 0 || gridHeight <= 0) {
    throw new Error('Grade de lanternagem vazia.');
  }
  const scale = Math.max(1, Math.min(10, Math.round(RENDER_TARGET_LONG_SIDE / Math.max(gridWidth, gridHeight))));
  const canvas = document.createElement('canvas');
  canvas.width = gridWidth * scale;
  canvas.height = gridHeight * scale;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Nao foi possivel preparar a imagem da lanternagem.');
  }
  if (!options.transparentBackground) {
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  for (let y = 0; y < gridHeight; y += 1) {
    for (let x = 0; x < gridWidth; x += 1) {
      const hex = colors[y * gridWidth + x];
      if (!hex || hex.toLowerCase() === '#000000') {
        continue;
      }
      ctx.fillStyle = hex;
      if (options.bolinha) {
        const cx = x * scale + scale / 2;
        const cy = y * scale + scale / 2;
        ctx.beginPath();
        ctx.arc(cx, cy, Math.max(0.5, scale * 0.42), 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillRect(x * scale, y * scale, scale, scale);
      }
    }
  }

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) {
    throw new Error('Nao foi possivel gerar a imagem da lanternagem.');
  }
  return new File([blob], options.filename || 'lanternagem-de-bojo.png', { type: 'image/png' });
}
