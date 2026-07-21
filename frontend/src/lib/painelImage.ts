import { readBandeiraPixelGrid, readImageNaturalSize, type BandeiraGridSize, type BandeiraPixelGrid } from './bandeiraImage';

/** Malhas disponiveis pro Painel (preset fixo, o cliente escolhe uma) — cada
 * uma e o tamanho real (cm) de 1 celula da grade final. */
export const MALHA_OPTIONS = [20, 25, 30] as const;
export type MalhaSize = (typeof MALHA_OPTIONS)[number];
export const DEFAULT_MALHA_CM: MalhaSize = 20;

export function computeMalhaGridSize(widthCm: number, heightCm: number, malhaCm: number): BandeiraGridSize {
  const safeMalha = malhaCm > 0 ? malhaCm : DEFAULT_MALHA_CM;
  return {
    widthPx: Math.max(1, Math.round(widthCm / safeMalha)),
    heightPx: Math.max(1, Math.round(heightCm / safeMalha)),
  };
}

/** Teto de seguranca da grade final de malha — painel de LED normalmente
 * tem malha bem mais grossa que o taco de bandeira (20-30cm), entao a grade
 * final fica bem menor em quantidade de celulas na pratica, mas o teto
 * existe pra nao aceitar um pedido absurdo (painel de dezenas de metros). */
export const MAX_MALHA_CELLS = 500_000;

export function malhaGridSizeExceedsLimit(size: BandeiraGridSize): boolean {
  return size.widthPx * size.heightPx > MAX_MALHA_CELLS;
}

/** Resolucao de trabalho da etapa "Vetorizar" — bem maior que a grade final
 * de malha (pra dar detalhe suficiente pra editar cor antes de taquear), mas
 * com teto pra nao travar o navegador decodificando uma foto de 12MP. */
const MAX_VETORIZAR_DIMENSION = 900;
const MAX_VETORIZAR_CELLS = 700_000;

export function suggestVetorizarSize(naturalWidthPx: number, naturalHeightPx: number): BandeiraGridSize {
  const areaScale = Math.sqrt(MAX_VETORIZAR_CELLS / (naturalWidthPx * naturalHeightPx));
  const sideScale = MAX_VETORIZAR_DIMENSION / Math.max(naturalWidthPx, naturalHeightPx);
  const scale = Math.min(1, areaScale, sideScale);
  return {
    widthPx: Math.max(1, Math.round(naturalWidthPx * scale)),
    heightPx: Math.max(1, Math.round(naturalHeightPx * scale)),
  };
}

/** Le a imagem enviada numa resolucao de trabalho alta (nao e uma grade final
 * ainda, e so pra editar cor com detalhe antes de taquear pra malha) —
 * reaproveita o mesmo box-filter (media de area) de `readBandeiraPixelGrid`,
 * so que com um teto de resolucao bem maior. */
export async function readPainelSourceImage(file: File): Promise<BandeiraPixelGrid> {
  const natural = await readImageNaturalSize(file);
  const target = suggestVetorizarSize(natural.widthPx, natural.heightPx);
  return readBandeiraPixelGrid(file, target.widthPx, target.heightPx);
}

/**
 * "Taquear": pixeliza a arte JA vetorizada (cores ja reduzidas/ajustadas)
 * pra grade final de malha — mas a origem aqui e um array de cores em
 * memoria (a arte vetorizada), nao um arquivo de imagem.
 *
 * Usa "cor mais frequente da area" (moda) em vez de media de RGB: a arte
 * vetorizada ja tem uma paleta pequena e fixa (o usuario reduziu pra N cores
 * antes de taquear), entao fazer media de RGB nos pixels de cada celula
 * inventa uma cor nova em toda borda entre 2 cores (mistura), explodindo a
 * paleta de volta pra milhares de tons. Pegando a cor que mais aparece em
 * cada celula, o resultado usa sempre uma cor que ja existia na paleta
 * reduzida — a contagem de cores distintas nao muda depois de taquear.
 */
export function downsampleColorGrid(
  sourceColors: string[],
  sourceWidth: number,
  sourceHeight: number,
  targetWidthPx: number,
  targetHeightPx: number
): string[] {
  const cellCount = targetWidthPx * targetHeightPx;
  const cellCounts: Array<Map<string, number> | undefined> = new Array(cellCount);

  for (let sy = 0; sy < sourceHeight; sy += 1) {
    const ty = Math.min(targetHeightPx - 1, Math.floor((sy * targetHeightPx) / sourceHeight));
    for (let sx = 0; sx < sourceWidth; sx += 1) {
      const tx = Math.min(targetWidthPx - 1, Math.floor((sx * targetWidthPx) / sourceWidth));
      const cell = ty * targetWidthPx + tx;
      const color = sourceColors[sy * sourceWidth + sx];
      let map = cellCounts[cell];
      if (!map) {
        map = new Map<string, number>();
        cellCounts[cell] = map;
      }
      map.set(color, (map.get(color) ?? 0) + 1);
    }
  }

  const result = new Array<string>(cellCount);
  for (let ty = 0; ty < targetHeightPx; ty += 1) {
    for (let tx = 0; tx < targetWidthPx; tx += 1) {
      const cell = ty * targetWidthPx + tx;
      const map = cellCounts[cell];
      if (map) {
        let bestColor = '';
        let bestCount = -1;
        for (const [color, n] of map) {
          if (n > bestCount) {
            bestCount = n;
            bestColor = color;
          }
        }
        result[cell] = bestColor;
      } else {
        // grade final maior que a arte vetorizada em algum eixo (upsample) —
        // essa celula nao recebeu nenhum pixel de origem, busca o mais
        // proximo pra nunca deixar buraco vazio na grade.
        const sx = Math.min(sourceWidth - 1, Math.floor((tx * sourceWidth) / targetWidthPx));
        const sy = Math.min(sourceHeight - 1, Math.floor((ty * sourceHeight) / targetHeightPx));
        result[cell] = sourceColors[sy * sourceWidth + sx];
      }
    }
  }
  return result;
}
