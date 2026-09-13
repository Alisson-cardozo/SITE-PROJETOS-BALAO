import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, Download, Droplet, FileImage, FolderOpen, Grid3x3, Hand, Hash, ImagePlus, Layers, Loader2, Maximize2, Palette, Pencil, Send, Undo2, ZoomIn, ZoomOut } from 'lucide-react';
import { downloadBlob, downloadCanvasAsPng, slugifyFilename } from '../lib/pdfExport';
import {
  buildColorSummary,
  CM_POR_PIXEL,
  computeGridSize,
  computeTacosPerFolha,
  expandedSizeExceedsLimit,
  expandGrid,
  FOLHA_NOMINAL_ALTURA_CM,
  FOLHA_NOMINAL_LARGURA_CM,
  FOLHA_USAVEL_ALTURA_CM,
  FOLHA_USAVEL_LARGURA_CM,
  gridSizeExceedsLimit,
  readBandeiraNativePixelGrid,
  readBandeiraPixelGrid,
  reduceBandeiraPalette,
  renderGridToAnnotatedCanvas,
  renderGridToCleanCanvas,
  replaceColorInGrid,
  snapNearBlackToBlack,
  type BandeiraColorSummaryEntry,
} from '../lib/bandeiraImage';
import { hexToRgb } from '../lib/colorMath';
import { buildBandeiraPdf, type BandeiraDivisionMode } from '../lib/bandeiraPdf';
import { SendBandeiraEmailModal } from '../components/SendBandeiraEmailModal';
import { ImageCropModal } from '../components/ImageCropModal';
import { numericFieldProps } from '../lib/numericInput';

/** Tamanho base (px de tela, antes do zoom) de cada celula. Grades muito
 * grandes (depois de expandir pro tamanho real) usam um valor menor, senao o
 * canvas passaria do limite que os navegadores aceitam em zoom alto. */
const CELL_BASE_PX_DEFAULT = 10;
const MAX_CANVAS_DIMENSION_PX = 14000;
const ZOOM_MIN = 1;
const ZOOM_MAX = 400;
const ZOOM_STEP = 25;
/** Uma folha/taco fisico e 7 tacos de largura x 5 de altura (70x50cm, ja que
 * 1 taco = 10cm) — os numeros aqui sao em TACOS (celulas da grade de
 * trabalho), nao em cm; viram cm de verdade so depois de expandir pro
 * tamanho real (ao salvar). */
const DEFAULT_COARSE_COLS = 7;
const DEFAULT_COARSE_ROWS = 5;
const DEFAULT_FINE_GRID_COLOR = '#0f172a';
/** Quantos passos o Desfazer guarda (reducao de cor, trocar cor, moldura,
 * pintura com o lapis). */
const MAX_UNDO_STEPS = 3;
const DEFAULT_COARSE_GRID_COLOR = '#2563eb';

type Tool = 'mover' | 'lapis' | 'contagotas';
type SidebarTab = 'cores' | 'numerar' | 'grades' | 'contagem' | 'dividir';

function formatCm(value: number): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return '0';
  return n % 1 === 0 ? String(n) : n.toFixed(1).replace('.', ',');
}

/** Grades grandes (depois de expandir pro tamanho real) precisam de um
 * tamanho de celula menor, senao o canvas passaria do limite de dimensao que
 * os navegadores aceitam quando o usuario da zoom no maximo. */
function computeCellBasePx(gridWidth: number, gridHeight: number): number {
  const maxDim = Math.max(gridWidth, gridHeight, 1);
  const maxCellPxAtMaxZoom = MAX_CANVAS_DIMENSION_PX / (maxDim * (ZOOM_MAX / 100));
  return Math.max(1, Math.min(CELL_BASE_PX_DEFAULT, maxCellPxAtMaxZoom));
}

interface BandeiraWorkspaceProps {
  /** Imagem vinda de outra aba (ex: "Reduzir Imagem HD" → "Usar na aba
   * Bandeira") — entra direto no recorte, como se o cliente tivesse acabado
   * de escolher esse arquivo. So usada 1x, no primeiro mount. */
  initialFile?: File | null;
  onInitialFileConsumed?: () => void;
}

export function BandeiraWorkspace({ initialFile, onInitialFileConsumed }: BandeiraWorkspaceProps = {}) {
  const draftData = (() => {
    try {
      const saved = window.localStorage.getItem('sistema-novo:draft:bandeira');
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  })();

  const [larguraCm, setLarguraCm] = useState(() => draftData?.larguraCm ?? '');
  const [alturaCm, setAlturaCm] = useState(() => draftData?.alturaCm ?? '');
  const [file, setFile] = useState<File | null>(null);
  /** Arquivo recem-escolhido, aguardando o recorte (ver ImageCropModal) antes
   * de virar `file` de verdade e liberar o painel "Criar projeto". */
  const [pendingCropFile, setPendingCropFile] = useState<File | null>(() => initialFile ?? null);

  useEffect(() => {
    if (initialFile) onInitialFileConsumed?.();
    // so na 1a montagem — initialFile e "consumido" 1x so.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [showCreatePanel, setShowCreatePanel] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [gridWidth, setGridWidth] = useState(() => draftData?.gridWidth ?? 0);
  const [gridHeight, setGridHeight] = useState(() => draftData?.gridHeight ?? 0);
  const [colors, setColors] = useState<string[] | null>(() => draftData?.colors ?? null);
  /** Se a grade atual ja esta no tamanho real (1 celula = 1cm). Comeca falsa
   * (grade pequena de trabalho, "sem 1 0", rapida pra taquear/editar) — so
   * vira real quando o usuario liga a grade de folhas/tacos ou salva. */
  const [isRealScale, setIsRealScale] = useState(() => draftData?.isRealScale ?? false);

  const [targetColorCount, setTargetColorCount] = useState(() => draftData?.targetColorCount ?? 16);
  const [reducing, setReducing] = useState(false);

  const [selectedColor, setSelectedColor] = useState<string | null>(null);
  const [replaceTarget, setReplaceTarget] = useState('#ff0000');
  /** Cor nova escolhida pelo usuario, que nao precisa existir na imagem —
   * usada pra desenhar (Lapis) ou criar a moldura. */
  const [customColor, setCustomColor] = useState('#ff0000');
  const [borderThickness, setBorderThickness] = useState(2);
  const [tool, setTool] = useState<Tool>('mover');
  const [zoom, setZoom] = useState(100);
  const [showFineGrid, setShowFineGrid] = useState(false);
  const [fineGridColor, setFineGridColor] = useState(DEFAULT_FINE_GRID_COLOR);
  const [showCoarseGrid, setShowCoarseGrid] = useState(false);
  const [coarseCols, setCoarseCols] = useState(DEFAULT_COARSE_COLS);
  const [coarseRows, setCoarseRows] = useState(DEFAULT_COARSE_ROWS);
  const [coarseGridColor, setCoarseGridColor] = useState(DEFAULT_COARSE_GRID_COLOR);
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>('cores');
  const [showNumbers, setShowNumbers] = useState(false);

  /** Tamanho do taco (cm) usado so pra calcular a contagem de tacos/folhas
   * por cor (aba Contagem de folha) — independente do fator fixo de
   * expansao da grade (CM_POR_PIXEL), que nunca muda. */
  const [tacoSizeCm, setTacoSizeCm] = useState(() => draftData?.tacoSizeCm ?? CM_POR_PIXEL);

  const [divisionMode, setDivisionMode] = useState<BandeiraDivisionMode>('inteira');
  /** Independentes do toggle de preview da aba Grades — o PDF e um guia de
   * montagem/contagem, entao as grades vem ligadas por padrao, nao dependem
   * do usuario ja ter ativado a preview em outra aba. */
  const [pdfShowFineGrid, setPdfShowFineGrid] = useState(true);
  const [pdfShowGrid, setPdfShowGrid] = useState(true);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [showEmailModal, setShowEmailModal] = useState(false);

  const [nome, setNome] = useState(() => draftData?.nome ?? '');

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const rulerTopRef = useRef<HTMLCanvasElement>(null);
  const rulerLeftRef = useRef<HTMLCanvasElement>(null);
  const paintingRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const panRef = useRef<{
    active: boolean;
    pointerId: number | null;
    startX: number;
    startY: number;
    scrollLeft: number;
    scrollTop: number;
  }>({ active: false, pointerId: null, startX: 0, startY: 0, scrollLeft: 0, scrollTop: 0 });
  /** Copia mutavel dos pixels — o Lapis escreve direto aqui (e direto no
   * canvas) durante o arraste, sem copiar o array inteiro a cada movimento do
   * mouse. So sincroniza pro estado do React (1 copia so) quando solta o
   * botao — senao uma grade de milhoes de celulas travaria a cada pixel. */
  const workingColorsRef = useRef<string[] | null>(null);
  const paintedDuringGestureRef = useRef(false);
  /** Pilha de ate MAX_UNDO_STEPS grades anteriores (reducao de cor, trocar
   * cor, moldura, pintura com o lapis) — sempre no MESMO tamanho da grade
   * atual, por isso e limpa toda vez que a grade muda de dimensao (novo
   * taqueamento ou expansao pro tamanho real ao salvar). */
  const historyRef = useRef<string[][]>([]);
  const [undoCount, setUndoCount] = useState(0);

  /** Grade base (cores originais, sem reduzir) usada so pro preview em tempo
   * real do painel "Criar projeto" — numa resolucao pequena e fixa (bem menor
   * que a grade final), pra recalcular a reducao de cor a cada digito sem
   * travar. Refeita so quando o arquivo ou o tamanho mudam. */
  const [previewBase, setPreviewBase] = useState<{ widthPx: number; heightPx: number; colors: string[] } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);

  const cellBasePx = useMemo(() => computeCellBasePx(gridWidth, gridHeight), [gridWidth, gridHeight]);

  /** Cor da grade fina com transparencia fixa (contorno sutil, nao pode
   * competir visualmente com a cor de cada pixel). */
  const fineGridStrokeStyle = useMemo(() => {
    const { r, g, b } = hexToRgb(fineGridColor);
    return `rgba(${r}, ${g}, ${b}, 0.35)`;
  }, [fineGridColor]);

  /** Calcula um zoom que faz a grade inteira caber na area visivel do palco,
   * pra nao comecar com uma imagem minuscula perdida num fundo preto gigante. */
  const fitZoomToStage = useCallback((widthPx: number, heightPx: number) => {
    const stage = stageRef.current;
    const availableWidth = (stage?.clientWidth ?? 800) - 32;
    const availableHeight = Math.max(320, window.innerHeight * 0.6) - 32;
    const cellBase = computeCellBasePx(widthPx, heightPx);
    const fitByWidth = (availableWidth / (widthPx * cellBase)) * 100;
    const fitByHeight = (availableHeight / (heightPx * cellBase)) * 100;
    const fit = Math.min(fitByWidth, fitByHeight, ZOOM_MAX);
    // Arredonda pra baixo (nunca pra cima — senao o projeto volta a nao
    // caber inteiro na tela) em passos de 5 quando da, mas sem impedir zooms
    // bem pequenos em projetos gigantes (grade real 1:1 pode precisar de <1%).
    const snapped = fit >= 5 ? Math.floor(fit / 5) * 5 : fit;
    setZoom(Math.max(ZOOM_MIN, Math.round(snapped * 100) / 100));
  }, []);

  useEffect(() => {
    workingColorsRef.current = colors ? colors.slice() : null;
  }, [colors]);

  // Hook de Auto-salvamento do rascunho local da bandeira
  useEffect(() => {
    if (!colors || gridWidth === 0 || gridHeight === 0) return;
    try {
      const draft = {
        colors,
        gridWidth,
        gridHeight,
        larguraCm,
        alturaCm,
        nome,
        isRealScale,
        targetColorCount,
        tacoSizeCm
      };
      window.localStorage.setItem('sistema-novo:draft:bandeira', JSON.stringify(draft));
    } catch {}
  }, [colors, gridWidth, gridHeight, larguraCm, alturaCm, nome, isRealScale, targetColorCount, tacoSizeCm]);

  // Restaurar zoom inicial na montagem caso o rascunho seja carregado
  useEffect(() => {
    if (draftData?.gridWidth && draftData?.gridHeight) {
      requestAnimationFrame(() => fitZoomToStage(draftData.gridWidth, draftData.gridHeight));
    }
  }, [fitZoomToStage]);

  const gridSize = useMemo(
    () => computeGridSize(Number(larguraCm) || 0, Number(alturaCm) || 0),
    [larguraCm, alturaCm]
  );
  const exceedsLimit = gridSizeExceedsLimit(gridSize);
  const exceedsExpandedLimit = expandedSizeExceedsLimit(Number(larguraCm) || 0, Number(alturaCm) || 0);

  // Recarrega a grade base do preview (resolucao pequena e fixa) quando o
  // arquivo ou o tamanho mudam — com um pequeno debounce pra nao reprocessar
  // a cada tecla digitada em largura/altura.
  useEffect(() => {
    if (!file || !showCreatePanel || !larguraCm || !alturaCm) {
      setPreviewBase(null);
      return;
    }
    let cancelled = false;
    const previewMaxSide = 80;
    const scale = Math.min(1, previewMaxSide / Math.max(gridSize.widthPx, gridSize.heightPx, 1));
    const previewWidthPx = Math.max(1, Math.round(gridSize.widthPx * scale));
    const previewHeightPx = Math.max(1, Math.round(gridSize.heightPx * scale));
    setPreviewLoading(true);
    const timer = setTimeout(() => {
      readBandeiraPixelGrid(file, previewWidthPx, previewHeightPx)
        .then((grid) => {
          if (!cancelled) setPreviewBase(grid);
        })
        .catch(() => {
          if (!cancelled) setPreviewBase(null);
        })
        .finally(() => {
          if (!cancelled) setPreviewLoading(false);
        });
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      setPreviewLoading(false);
    };
  }, [file, showCreatePanel, larguraCm, alturaCm, gridSize.widthPx, gridSize.heightPx]);

  /** Aplica a mesma reducao de cor que "Taquear imagem" vai usar, mas em cima
   * da grade pequena do preview — reage na hora a quantidade de cores, sem
   * precisar clicar em nada. */
  const previewColors = useMemo(() => {
    if (!previewBase) {
      return null;
    }
    const distinctCount = buildColorSummary(previewBase.colors).length;
    return targetColorCount > 0 && targetColorCount < distinctCount
      ? reduceBandeiraPalette(previewBase.colors, targetColorCount)
      : previewBase.colors;
  }, [previewBase, targetColorCount]);

  // Desenha o preview num canvas pequeno, celula a celula (igual a grade
  // principal, so que numa caixa fixa de ate 220px).
  useEffect(() => {
    const canvas = previewCanvasRef.current;
    if (!canvas) {
      return;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return;
    }
    if (!previewBase || !previewColors) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }
    const boxSize = 220;
    const cellPx = Math.max(1, Math.min(boxSize / previewBase.widthPx, boxSize / previewBase.heightPx));
    const width = Math.max(1, Math.round(previewBase.widthPx * cellPx));
    const height = Math.max(1, Math.round(previewBase.heightPx * cellPx));
    canvas.width = width;
    canvas.height = height;
    for (let y = 0; y < previewBase.heightPx; y += 1) {
      for (let x = 0; x < previewBase.widthPx; x += 1) {
        ctx.fillStyle = previewColors[y * previewBase.widthPx + x];
        ctx.fillRect(x * cellPx, y * cellPx, cellPx + 0.5, cellPx + 0.5);
      }
    }
  }, [previewBase, previewColors]);

  const colorSummary: BandeiraColorSummaryEntry[] = useMemo(() => (colors ? buildColorSummary(colors) : []), [colors]);

  /** Numero de cada cor (1, 2, 3...) na ordem da tabela — pra desenhar em
   * cima da grade (estilo pintura numerada) e servir de legenda. */
  const colorNumberMap = useMemo(() => {
    const map = new Map<string, number>();
    colorSummary.forEach((entry, index) => map.set(entry.hex, index + 1));
    return map;
  }, [colorSummary]);

  /** Quantos tacos do tamanho escolhido cabem na area usavel de 1 folha
   * (60x50cm, dentro da folha nominal de 70x50cm). */
  const tacosPerFolha = computeTacosPerFolha(tacoSizeCm);

  /** Tacos/folhas de cada cor. A quantidade de tacos e SEMPRE no taco padrao
   * (10cm, a mesma unidade da grade de trabalho) — nao muda com o tamanho do
   * taco escolhido aqui. So a quantidade de FOLHAS muda, porque um taco
   * escolhido menor cabe mais vezes numa folha (mais tacos-padrao por
   * folha). `entry.count` esta na escala atual da grade (pequena/taco ou
   * real/cm), entao converte pra cm² real antes de dividir pela area do
   * taco padrao, sem precisar expandir a grade so pra essa conta. */
  const tacoCountByColor = useMemo(() => {
    const tacoPadraoAreaCm2 = CM_POR_PIXEL * CM_POR_PIXEL;
    return colorSummary.map((entry) => {
      const areaCm2 = isRealScale ? entry.count : entry.count * CM_POR_PIXEL * CM_POR_PIXEL;
      const tacos = Math.round(areaCm2 / tacoPadraoAreaCm2);
      const folhas = tacosPerFolha > 0 ? Math.ceil(tacos / tacosPerFolha) : 0;
      return { ...entry, tacos, folhas };
    });
  }, [colorSummary, isRealScale, tacosPerFolha]);

  /** Aplica o resultado da pixelizacao no estado + ajusta o zoom pra caber.
   * Sempre a grade pequena de trabalho ("sem 1 0") — a expansao pro tamanho
   * real (1 celula = 1cm) so acontece na hora de gerar o PDF/email. */
  function applyGridResult(grid: { widthPx: number; heightPx: number }, finalColors: string[]) {
    setGridWidth(grid.widthPx);
    setGridHeight(grid.heightPx);
    setColors(snapNearBlackToBlack(finalColors));
    setIsRealScale(false);
    setCoarseCols(DEFAULT_COARSE_COLS);
    setCoarseRows(DEFAULT_COARSE_ROWS);
    setSelectedColor(null);
    // grade nova (outro tamanho) — historico antigo nao serve mais.
    historyRef.current = [];
    setUndoCount(0);
    if (!nome && file) {
      setNome(file.name.replace(/\.[^.]+$/, ''));
    }
    // espera o palco renderizar (com o novo tamanho de grade) antes de medir
    requestAnimationFrame(() => fitZoomToStage(grid.widthPx, grid.heightPx));
  }

  /** Guarda a grade ATUAL (antes da mutacao que esta prestes a acontecer) na
   * pilha de desfazer — chamada no comeco de cada acao que muda os pixels
   * (reduzir cores, trocar cor, moldura, pintura com o lapis). */
  function pushHistory(snapshot: string[] | null) {
    if (!snapshot) {
      return;
    }
    historyRef.current = [...historyRef.current, snapshot].slice(-MAX_UNDO_STEPS);
    setUndoCount(historyRef.current.length);
  }

  function handleUndo() {
    const history = historyRef.current;
    const previous = history[history.length - 1];
    if (!previous) {
      return;
    }
    historyRef.current = history.slice(0, -1);
    setUndoCount(historyRef.current.length);
    setColors(previous);
    setSelectedColor(null);
  }

  /** 1a pixelizacao, no painel "Criar projeto": taqueia e reduz cor numa
   * grade pequena e rapida (o "menos 1 zero") — fica nesse tamanho durante
   * toda a edicao (leve e rapido). So expande pro tamanho real ao salvar. */
  async function handleCreateProject() {
    if (!file || !larguraCm || !alturaCm || exceedsLimit || exceedsExpandedLimit || loading) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const grid = await readBandeiraPixelGrid(file, gridSize.widthPx, gridSize.heightPx);
      const distinctCount = buildColorSummary(grid.colors).length;
      const finalColors =
        targetColorCount > 0 && targetColorCount < distinctCount
          ? reduceBandeiraPalette(grid.colors, targetColorCount)
          : grid.colors;
      applyGridResult(grid, finalColors);
      setShowCreatePanel(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nao foi possivel taquear a imagem.');
    } finally {
      setLoading(false);
    }
  }

  /** Importa um projeto pronto (imagem ou JSON) diretamente sem passar por
   * tamanho ou taqueamento de cores. Exibe direto as cores na tabela. */
  async function handleImportReadyProject(importedFile: File) {
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      if (importedFile.name.endsWith('.json')) {
        const text = await importedFile.text();
        const project = JSON.parse(text);
        if (project.gridWidth && project.gridHeight && Array.isArray(project.colors)) {
          applyGridResult({ widthPx: project.gridWidth, heightPx: project.gridHeight }, project.colors);
          if (project.nome) setNome(project.nome);
          setShowCreatePanel(false);
          return;
        }
      }

      const grid = await readBandeiraNativePixelGrid(importedFile);
      applyGridResult(grid, grid.colors);
      setShowCreatePanel(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nao foi possivel importar o projeto pronto.');
    } finally {
      setLoading(false);
    }
  }

  function handleReduceColors() {
    if (!colors || reducing) {
      return;
    }
    pushHistory(colors);
    setReducing(true);
    // roda no proximo tick pra nao travar o clique (grades grandes podem
    // levar uns instantes no k-means)
    setTimeout(() => {
      setColors((current) => (current ? reduceBandeiraPalette(current, Math.max(2, targetColorCount)) : current));
      setReducing(false);
    }, 30);
  }

  function handleReplaceSelected() {
    if (!colors || !selectedColor) {
      return;
    }
    pushHistory(colors);
    setColors(replaceColorInGrid(colors, selectedColor, replaceTarget));
    setSelectedColor(replaceTarget);
  }

  /** Arma a cor customizada (escolhida no seletor, nao precisa existir na
   * imagem) como a cor ativa pro Lapis desenhar. */
  function handleUseCustomColor() {
    setSelectedColor(customColor);
    setReplaceTarget(customColor);
    setTool('lapis');
  }

  /** Pinta uma moldura (borda) ao redor de toda a grade com a cor
   * customizada — a cor nova entra na grade e aparece na tabela de cores
   * automaticamente, junto com as outras. */
  function handleCreateBorder() {
    if (!colors || gridWidth === 0 || gridHeight === 0) {
      return;
    }
    pushHistory(colors);
    const thickness = Math.max(1, Math.min(borderThickness, Math.floor(Math.min(gridWidth, gridHeight) / 2)));
    const next = colors.slice();
    for (let y = 0; y < gridHeight; y += 1) {
      for (let x = 0; x < gridWidth; x += 1) {
        if (x < thickness || x >= gridWidth - thickness || y < thickness || y >= gridHeight - thickness) {
          next[y * gridWidth + x] = customColor;
        }
      }
    }
    setColors(next);
    setSelectedColor(customColor);
    setReplaceTarget(customColor);
  }

  /** Pinta 1 celula direto no array de trabalho + direto no canvas (sem
   * copiar o array nem re-renderizar o React) — o que deixa o Lapis liso
   * mesmo numa grade de milhoes de celulas. O estado do React so e
   * atualizado 1 vez, quando o usuario solta o botao (ver stopPainting). */
  function paintCellDirect(index: number, color: string) {
    const working = workingColorsRef.current;
    if (!working || working[index] === color) {
      return;
    }
    working[index] = color;
    paintedDuringGestureRef.current = true;

    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!ctx) {
      return;
    }
    const cellPx = cellBasePx * (zoom / 100);
    const x = index % gridWidth;
    const y = Math.floor(index / gridWidth);
    ctx.fillStyle = color;
    ctx.fillRect(x * cellPx, y * cellPx, cellPx + 0.5, cellPx + 0.5);
    if (showFineGrid && cellPx >= 3) {
      ctx.strokeStyle = fineGridStrokeStyle;
      ctx.lineWidth = 1;
      ctx.strokeRect(Math.round(x * cellPx) + 0.5, Math.round(y * cellPx) + 0.5, cellPx, cellPx);
    }
  }

  function cellFromEvent(event: { clientX: number; clientY: number }): number | null {
    const canvas = canvasRef.current;
    if (!canvas || !colors) {
      return null;
    }
    const rect = canvas.getBoundingClientRect();
    const cellPx = cellBasePx * (zoom / 100);
    const x = Math.floor((event.clientX - rect.left) / cellPx);
    const y = Math.floor((event.clientY - rect.top) / cellPx);
    if (x < 0 || y < 0 || x >= gridWidth || y >= gridHeight) {
      return null;
    }
    return y * gridWidth + x;
  }

  function sampleColorAt(index: number) {
    const source = workingColorsRef.current ?? colors;
    if (!source) {
      return;
    }
    setSelectedColor(source[index]);
    setReplaceTarget(source[index]);
  }

  function handleCanvasPointerDown(event: React.PointerEvent<HTMLCanvasElement>) {
    if (tool === 'mover') {
      const stage = stageRef.current;
      if (!stage) {
        return;
      }
      panRef.current = {
        active: true,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        scrollLeft: stage.scrollLeft,
        scrollTop: stage.scrollTop,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }

    const index = cellFromEvent(event);
    if (index === null || !colors) {
      return;
    }

    if (tool === 'contagotas') {
      sampleColorAt(index);
      return;
    }

    if (tool === 'lapis') {
      // botao direito (ou sem cor ainda selecionada) copia a cor do pixel;
      // botao esquerdo com uma cor ja selecionada pinta.
      if (event.button === 2 || !selectedColor) {
        sampleColorAt(index);
        return;
      }
      paintingRef.current = true;
      event.currentTarget.setPointerCapture(event.pointerId);
      paintCellDirect(index, selectedColor);
    }
  }

  function handleCanvasPointerMove(event: React.PointerEvent<HTMLCanvasElement>) {
    const pan = panRef.current;
    if (tool === 'mover' && pan.active && pan.pointerId === event.pointerId) {
      const stage = stageRef.current;
      if (!stage) {
        return;
      }
      stage.scrollLeft = pan.scrollLeft - (event.clientX - pan.startX);
      stage.scrollTop = pan.scrollTop - (event.clientY - pan.startY);
      return;
    }

    if (tool !== 'lapis' || !paintingRef.current || !selectedColor) {
      return;
    }
    const index = cellFromEvent(event);
    if (index !== null) {
      paintCellDirect(index, selectedColor);
    }
  }

  function stopPainting() {
    paintingRef.current = false;
    panRef.current.active = false;
    // so agora (1 vez, ao soltar o botao) sincroniza o array pintado pro
    // estado do React — mantem a contagem/tabela de cores e o "Salvar" corretos.
    if (paintedDuringGestureRef.current && workingColorsRef.current) {
      paintedDuringGestureRef.current = false;
      pushHistory(colors);
      setColors(workingColorsRef.current.slice());
    }
  }

  // desenha a grade inteira no canvas (bem mais rapido que 1 <rect> React por
  // celula quando a grade tem dezenas de milhares de pixels)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !colors || gridWidth === 0 || gridHeight === 0) {
      return;
    }
    const cellPx = cellBasePx * (zoom / 100);
    const width = Math.max(1, Math.round(gridWidth * cellPx));
    const height = Math.max(1, Math.round(gridHeight * cellPx));
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return;
    }

    for (let y = 0; y < gridHeight; y += 1) {
      for (let x = 0; x < gridWidth; x += 1) {
        ctx.fillStyle = colors[y * gridWidth + x];
        ctx.fillRect(x * cellPx, y * cellPx, cellPx + 0.5, cellPx + 0.5);
      }
    }

    if (showFineGrid && cellPx >= 3) {
      ctx.strokeStyle = fineGridStrokeStyle;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = 0; x <= gridWidth; x += 1) {
        ctx.moveTo(Math.round(x * cellPx) + 0.5, 0);
        ctx.lineTo(Math.round(x * cellPx) + 0.5, height);
      }
      for (let y = 0; y <= gridHeight; y += 1) {
        ctx.moveTo(0, Math.round(y * cellPx) + 0.5);
        ctx.lineTo(width, Math.round(y * cellPx) + 0.5);
      }
      ctx.stroke();
    }

    if (showCoarseGrid && coarseCols > 0 && coarseRows > 0) {
      ctx.strokeStyle = coarseGridColor;
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let x = 0; x <= gridWidth; x += coarseCols) {
        ctx.moveTo(Math.round(x * cellPx), 0);
        ctx.lineTo(Math.round(x * cellPx), height);
      }
      for (let y = 0; y <= gridHeight; y += coarseRows) {
        ctx.moveTo(0, Math.round(y * cellPx));
        ctx.lineTo(width, Math.round(y * cellPx));
      }
      ctx.stroke();
    }

    // numero de cada cor em cima da celula (estilo pintura numerada) — so
    // desenha se a celula tiver tamanho suficiente pra ficar legivel.
    if (showNumbers && cellPx >= 18) {
      ctx.font = `${Math.max(9, Math.floor(cellPx * 0.45))}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (let y = 0; y < gridHeight; y += 1) {
        for (let x = 0; x < gridWidth; x += 1) {
          const hex = colors[y * gridWidth + x];
          const number = colorNumberMap.get(hex);
          if (number == null) {
            continue;
          }
          const { r, g, b } = hexToRgb(hex);
          const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
          ctx.fillStyle = luminance > 140 ? '#111111' : '#ffffff';
          ctx.fillText(String(number), x * cellPx + cellPx / 2, y * cellPx + cellPx / 2);
        }
      }
    }
  }, [
    colors,
    gridWidth,
    gridHeight,
    zoom,
    cellBasePx,
    showFineGrid,
    fineGridStrokeStyle,
    showCoarseGrid,
    coarseCols,
    coarseRows,
    coarseGridColor,
    showNumbers,
    colorNumberMap,
  ]);

  /** Desenha a regua de cima (colunas) e da lateral (linhas) — numera as
   * celulas, acompanhando o scroll/zoom do palco (redesenha a cada scroll,
   * resize da janela ou mudanca de zoom/grade). */
  const RULER_SIZE = 22;
  /** Mesmo valor do `padding` de `.bandeira-canvas-stage` no CSS — o canvas
   * comeca depois desse respiro, entao a regua precisa somar isso pra alinhar
   * os tracinhos com as celulas de verdade. */
  const STAGE_PADDING_PX = 16;
  const drawRulers = useCallback(() => {
    const stage = stageRef.current;
    const topCanvas = rulerTopRef.current;
    const leftCanvas = rulerLeftRef.current;
    if (!stage || !topCanvas || !leftCanvas) {
      return;
    }
    const viewWidth = stage.clientWidth;
    const viewHeight = stage.clientHeight;
    topCanvas.width = viewWidth;
    topCanvas.height = RULER_SIZE;
    leftCanvas.width = RULER_SIZE;
    leftCanvas.height = viewHeight;
    const topCtx = topCanvas.getContext('2d');
    const leftCtx = leftCanvas.getContext('2d');
    if (!topCtx || !leftCtx) {
      return;
    }
    topCtx.clearRect(0, 0, viewWidth, RULER_SIZE);
    leftCtx.clearRect(0, 0, RULER_SIZE, viewHeight);
    if (gridWidth === 0 || gridHeight === 0) {
      return;
    }
    const cellPx = cellBasePx * (zoom / 100);
    const scrollLeft = stage.scrollLeft;
    const scrollTop = stage.scrollTop;

    // passo adaptativo pro numero nao ficar espremido/sobreposto em zoom baixo
    const niceSteps = [1, 2, 5, 10, 20, 25, 50, 100, 200, 500];
    const minStep = Math.max(1, 42 / Math.max(cellPx, 0.01));
    const step = niceSteps.find((s) => s >= minStep) ?? niceSteps[niceSteps.length - 1];

    topCtx.font = '10px sans-serif';
    topCtx.textBaseline = 'top';
    const firstCol = Math.max(0, Math.floor((scrollLeft - STAGE_PADDING_PX) / cellPx));
    const lastCol = Math.min(gridWidth, Math.ceil((scrollLeft - STAGE_PADDING_PX + viewWidth) / cellPx));
    for (let col = firstCol; col <= lastCol; col += 1) {
      const x = Math.round(col * cellPx - scrollLeft + STAGE_PADDING_PX);
      const major = col % step === 0;
      topCtx.strokeStyle = major ? '#8fa3bd' : '#3a4d6b';
      topCtx.beginPath();
      topCtx.moveTo(x + 0.5, RULER_SIZE - (major ? 9 : 4));
      topCtx.lineTo(x + 0.5, RULER_SIZE);
      topCtx.stroke();
      if (major) {
        topCtx.fillStyle = '#b7c6db';
        topCtx.fillText(String(col), x + 2, 1);
      }
    }

    leftCtx.font = '10px sans-serif';
    leftCtx.textBaseline = 'top';
    const firstRow = Math.max(0, Math.floor((scrollTop - STAGE_PADDING_PX) / cellPx));
    const lastRow = Math.min(gridHeight, Math.ceil((scrollTop - STAGE_PADDING_PX + viewHeight) / cellPx));
    for (let row = firstRow; row <= lastRow; row += 1) {
      const y = Math.round(row * cellPx - scrollTop + STAGE_PADDING_PX);
      const major = row % step === 0;
      leftCtx.strokeStyle = major ? '#8fa3bd' : '#3a4d6b';
      leftCtx.beginPath();
      leftCtx.moveTo(RULER_SIZE - (major ? 9 : 4), y + 0.5);
      leftCtx.lineTo(RULER_SIZE, y + 0.5);
      leftCtx.stroke();
      if (major) {
        leftCtx.save();
        leftCtx.translate(2, y + 2);
        leftCtx.fillStyle = '#b7c6db';
        leftCtx.fillText(String(row), 0, 0);
        leftCtx.restore();
      }
    }
  }, [gridWidth, gridHeight, zoom, cellBasePx]);

  useEffect(() => {
    drawRulers();
  }, [drawRulers]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) {
      return;
    }
    const onScroll = () => drawRulers();
    stage.addEventListener('scroll', onScroll);
    window.addEventListener('resize', onScroll);
    return () => {
      stage.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, [drawRulers]);

  const handleFileChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const next = event.target.files?.[0] ?? null;
    setError(null);
    setShowCreatePanel(false);
    // o tamanho fica em branco de proposito — o usuario tem que digitar o
    // tamanho real da bandeira, nunca fica com um valor sugerido por engano.
    setLarguraCm('');
    setAlturaCm('');
    setFile(null);
    // antes de liberar o "Criar projeto", abre o recorte — so vira `file` de
    // verdade depois que o usuario confirma o recorte (ou escolhe usar a
    // imagem inteira). Imagem grande demais pra bandeira pode ser recortada
    // aqui antes de escolher tamanho/cores.
    setPendingCropFile(next);
  }, []);

  function handleCropConfirm(croppedFile: File) {
    setFile(croppedFile);
    setPendingCropFile(null);
  }

  function handleCropUseWhole() {
    setFile(pendingCropFile);
    setPendingCropFile(null);
  }

  function handleCropCancel() {
    setPendingCropFile(null);
    setFile(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  /** Monta o PDF (capa com tabela de cores numerada + folha inteira/dividida)
   * sempre no tamanho real, mesmo que a edicao tenha ficado na grade pequena
   * de trabalho — usada tanto pelo "Baixar PDF" quanto pelo "Enviar por
   * email" (o email so anexa o mesmo arquivo). */
  function buildCurrentPdfBlob(): Blob {
    const real = isRealScale || !colors
      ? { widthPx: gridWidth, heightPx: gridHeight, colors: colors ?? [] }
      : expandGrid(colors, gridWidth, gridHeight, CM_POR_PIXEL);
    const realCoarseCols = isRealScale ? coarseCols : coarseCols * CM_POR_PIXEL;
    const realCoarseRows = isRealScale ? coarseRows : coarseRows * CM_POR_PIXEL;
    return buildBandeiraPdf({
      nome: nome.trim() || 'Bandeira',
      larguraCm: Number(larguraCm) || real.widthPx,
      alturaCm: Number(alturaCm) || real.heightPx,
      gridWidth: real.widthPx,
      gridHeight: real.heightPx,
      colors: real.colors,
      colorSummary: buildColorSummary(real.colors),
      divisionMode,
      showFineGrid: pdfShowFineGrid,
      fineGridColor,
      showCoarseGrid: pdfShowGrid,
      coarseGridColor,
      coarseCols: realCoarseCols,
      coarseRows: realCoarseRows,
      tacoSizeCm,
      showNumbers,
    });
  }

  /** Roda num setTimeout pra dar tempo do spinner aparecer antes de travar a
   * thread com a expansao/desenho. */
  function handleDownloadPdf() {
    if (!colors || gridWidth === 0 || gridHeight === 0 || downloadingPdf) {
      return;
    }
    setDownloadingPdf(true);
    setPdfError(null);
    setTimeout(() => {
      try {
        const blob = buildCurrentPdfBlob();
        downloadBlob(blob, `${slugifyFilename(nome || 'bandeira')}.pdf`);
      } catch (err) {
        setPdfError(err instanceof Error ? err.message : 'Nao foi possivel gerar o PDF.');
      } finally {
        setDownloadingPdf(false);
      }
    }, 30);
  }

  function handleDownloadPng() {
    if (!colors || gridWidth === 0 || gridHeight === 0) return;
    const hasOverlay = showFineGrid || showCoarseGrid || showNumbers;
    const canvas = hasOverlay
      ? renderGridToAnnotatedCanvas(colors, gridWidth, gridHeight, {
          showFineGrid,
          fineGridColor,
          showCoarseGrid,
          coarseCols,
          coarseRows,
          coarseGridColor,
          showNumbers,
          colorNumberMap,
        })
      : renderGridToCleanCanvas(colors, gridWidth, gridHeight);
    const filename = `${slugifyFilename(nome || 'bandeira')}.png`;
    downloadCanvasAsPng(canvas, filename);
  }

  return (
    <div className="bandeira-workspace">
      <div className="bandeira-main-panel">
        <div className="bandeira-panel-header">
          <h2>Bandeiras — Taqueamento de Imagem</h2>
          <p>Carregue uma imagem, escolha o tamanho e a quantidade de cores, e crie o projeto pixelado.</p>
        </div>

        {!colors ? (
          <div className="bandeira-upload-card">
            <div className="bandeira-upload-options">
              <label className={`bandeira-upload-option bandeira-upload-option-primary${file ? ' has-file' : ''}`}>
                <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFileChange} className="bandeira-file-input-hidden" />
                <span className="bandeira-upload-option-icon">
                  {file ? <CheckCircle2 size={20} /> : <ImagePlus size={20} />}
                </span>
                <span className="bandeira-upload-option-text">
                  <strong>{file ? file.name : 'Escolher imagem'}</strong>
                  <small>{file ? 'Clique pra trocar a imagem' : 'Carregue uma foto ou desenho pra taquear'}</small>
                </span>
              </label>

              <label className="bandeira-upload-option" title="Pula tamanho e quantidade de cores — abre direto a tabela de cores pra editar">
                <input
                  type="file"
                  accept="image/*,.json"
                  onChange={(e) => {
                    const selected = e.target.files?.[0];
                    if (selected) void handleImportReadyProject(selected);
                  }}
                  className="bandeira-file-input-hidden"
                />
                <span className="bandeira-upload-option-icon">
                  <FolderOpen size={20} />
                </span>
                <span className="bandeira-upload-option-text">
                  <strong>Importe seu projeto pronto</strong>
                  <small>Veja a tabela de cores, numere as cores e organize por grades</small>
                </span>
              </label>
            </div>

            {error ? <p className="mold-import-error">{error}</p> : null}

            {file && !showCreatePanel ? (
              <button type="button" className="mold-save-button" onClick={() => setShowCreatePanel(true)}>
                <ImagePlus size={16} />
                Criar projeto
              </button>
            ) : null}

            {file && showCreatePanel ? (
              <div className="bandeira-create-panel">
                <div className="bandeira-size-fields">
                  <label className="auth-field">
                    <span>Largura (pixel)</span>
                    <input
                      type="number"
                      min={1}
                      placeholder="Obrigatorio"
                      value={larguraCm === '' ? '' : Math.round(Number(larguraCm) / CM_POR_PIXEL)}
                      onChange={(e) => {
                        const raw = e.target.value;
                        setLarguraCm(raw === '' ? '' : String(Math.max(1, Number(raw) || 1) * CM_POR_PIXEL));
                      }}
                    />
                  </label>
                  <label className="auth-field">
                    <span>Altura (pixel)</span>
                    <input
                      type="number"
                      min={1}
                      placeholder="Obrigatorio"
                      value={alturaCm === '' ? '' : Math.round(Number(alturaCm) / CM_POR_PIXEL)}
                      onChange={(e) => {
                        const raw = e.target.value;
                        setAlturaCm(raw === '' ? '' : String(Math.max(1, Number(raw) || 1) * CM_POR_PIXEL));
                      }}
                    />
                  </label>
                </div>
                {larguraCm === '' || alturaCm === '' ? (
                  <p className="bandeira-size-hint">
                    Cada pixel da grade equivale a <strong>{CM_POR_PIXEL}cm</strong> reais (1 metro = 10 pixels).
                    Informe a largura e a altura em pixel pra continuar — ex: <strong>100 x 150</strong> pixels vira
                    uma bandeira de <strong>10 x 15 metros</strong>.
                  </p>
                ) : (
                  <p className="bandeira-size-hint">
                    Cada pixel da grade equivale a <strong>{CM_POR_PIXEL}cm</strong> reais (1 metro = 10 pixels). Para
                    criar uma bandeira de <strong>{formatCm(Number(larguraCm) / 100)} metros</strong> de largura
                    por <strong>{formatCm(Number(alturaCm) / 100)} metros</strong> de comprimento, coloque{' '}
                    <strong>
                      {Math.round(Number(larguraCm) / CM_POR_PIXEL)} x {Math.round(Number(alturaCm) / CM_POR_PIXEL)}
                    </strong>{' '}
                    — os valores ja preenchidos acima.
                  </p>
                )}
                <div className="bandeira-preview-box">
                  <canvas ref={previewCanvasRef} className="bandeira-preview-canvas" />
                  {previewLoading ? (
                    <div className="bandeira-preview-loading">
                      <Loader2 size={16} className="mold-import-spinner" />
                    </div>
                  ) : null}
                  {!previewBase && !previewLoading ? (
                    <p className="bandeira-preview-empty">Preencha largura e altura pra ver o preview</p>
                  ) : null}
                </div>

                <label className="auth-field">
                  <span>Quantidade de cores desejada</span>
                  <input type="number" min={2} {...numericFieldProps(targetColorCount, setTargetColorCount, 2)} />
                </label>
                <p className="bandeira-hint">O preview acima muda em tempo real conforme vc ajusta a quantidade de cores.</p>

                <button
                  type="button"
                  className="mold-save-button"
                  onClick={() => void handleCreateProject()}
                  disabled={!larguraCm || !alturaCm || loading}
                >
                  {loading ? <Loader2 size={16} className="mold-import-spinner" /> : <ImagePlus size={16} />}
                  {loading ? 'Taqueando...' : 'Taquear imagem'}
                </button>
              </div>
            ) : null}
          </div>
        ) : (
          <>
            <div className="bandeira-toolbar">
              <div className="bandeira-toolbar-group bandeira-tools-group">
                <button
                  type="button"
                  className={tool === 'mover' ? 'active' : ''}
                  onClick={() => setTool('mover')}
                  title="Mover (arrastar pra navegar)"
                >
                  <Hand size={15} />
                  Mover
                </button>
                <button
                  type="button"
                  className={tool === 'lapis' ? 'active' : ''}
                  onClick={() => setTool('lapis')}
                  title="Lapis: clique esquerdo pinta com a cor selecionada, clique direito copia a cor do pixel"
                >
                  <Pencil size={15} />
                  Lapis
                </button>
                <button
                  type="button"
                  className={tool === 'contagotas' ? 'active' : ''}
                  onClick={() => setTool('contagotas')}
                  title="Conta-gotas: clique numa celula pra selecionar a cor dela"
                >
                  <Droplet size={15} />
                  Conta-gotas
                </button>
              </div>

              <div className="bandeira-toolbar-group">
                <button
                  type="button"
                  onClick={handleUndo}
                  disabled={undoCount === 0}
                  title={undoCount > 0 ? `Desfazer (${undoCount} passo${undoCount > 1 ? 's' : ''} disponivel)` : 'Nada pra desfazer'}
                >
                  <Undo2 size={15} />
                  Desfazer{undoCount > 0 ? ` (${undoCount})` : ''}
                </button>
              </div>

              <div className="bandeira-toolbar-group">
                <button type="button" onClick={() => setZoom((z) => Math.max(ZOOM_MIN, z - ZOOM_STEP))} title="Diminuir zoom">
                  <ZoomOut size={15} />
                </button>
                <span className="bandeira-zoom-label">{zoom}%</span>
                <button type="button" onClick={() => setZoom((z) => Math.min(ZOOM_MAX, z + ZOOM_STEP))} title="Aumentar zoom">
                  <ZoomIn size={15} />
                </button>
                <button type="button" onClick={() => fitZoomToStage(gridWidth, gridHeight)} title="Ajustar pra caber na tela">
                  <Maximize2 size={15} />
                </button>
              </div>
            </div>

            <div className="bandeira-canvas-area">
              <div className="bandeira-ruler-corner" />
              <canvas ref={rulerTopRef} className="bandeira-ruler bandeira-ruler-top" />
              <canvas ref={rulerLeftRef} className="bandeira-ruler bandeira-ruler-left" />
              <div className="bandeira-canvas-stage" ref={stageRef}>
                <canvas
                  ref={canvasRef}
                  className={`bandeira-canvas tool-${tool}`}
                  onPointerDown={handleCanvasPointerDown}
                  onPointerMove={handleCanvasPointerMove}
                  onPointerUp={stopPainting}
                  onContextMenu={(event) => event.preventDefault()}
                />
              </div>
            </div>

            <div className="bandeira-actions-row">
              <button
                type="button"
                className="mold-import-button"
                onClick={() => {
                  try {
                    window.localStorage.removeItem('sistema-novo:draft:bandeira');
                  } catch {}
                  setColors(null);
                  setGridWidth(0);
                  setGridHeight(0);
                  setFile(null);
                  setShowCreatePanel(false);
                  if (fileInputRef.current) fileInputRef.current.value = '';
                }}
              >
                Trocar Imagem
              </button>
            </div>
          </>
        )}
      </div>

      {colors ? (
        <div className="bandeira-side-panel">
          <h3>Informacoes</h3>
          <div className="bandeira-info-grid">
            <div>
              <span>{isRealScale ? 'Grade real (1px = 1cm)' : 'Grade de trabalho'}</span>
              <strong>{gridWidth} x {gridHeight} px</strong>
            </div>
            <div>
              <span>Cores distintas</span>
              <strong>{colorSummary.length}</strong>
            </div>
          </div>

          <div className="auth-tabs bandeira-sidebar-tabs" role="tablist">
            <button type="button" className={sidebarTab === 'cores' ? 'active' : ''} onClick={() => setSidebarTab('cores')}>
              Cores
            </button>
            <button type="button" className={sidebarTab === 'numerar' ? 'active' : ''} onClick={() => setSidebarTab('numerar')}>
              Numerar
            </button>
            <button type="button" className={sidebarTab === 'grades' ? 'active' : ''} onClick={() => setSidebarTab('grades')}>
              Grades
            </button>
            <button type="button" className={sidebarTab === 'contagem' ? 'active' : ''} onClick={() => setSidebarTab('contagem')}>
              Contagem de folha
            </button>
            <button type="button" className={sidebarTab === 'dividir' ? 'active' : ''} onClick={() => setSidebarTab('dividir')}>
              Dividir folha
            </button>
          </div>

          {sidebarTab === 'cores' ? (
            <>
              <h3>Reduzir cores</h3>
              <div className="bandeira-reduce-row">
                <input
                  type="number"
                  min={2}
                  max={colorSummary.length || 2}
                  {...numericFieldProps(targetColorCount, setTargetColorCount, 2)}
                />
                <button type="button" className="mold-import-button" onClick={handleReduceColors} disabled={reducing}>
                  {reducing ? <Loader2 size={15} className="mold-import-spinner" /> : null}
                  Reduzir para {targetColorCount} cores
                </button>
              </div>

              <h3>Cor personalizada</h3>
              <div className="bandeira-custom-color-row">
                <input type="color" value={customColor} onChange={(e) => setCustomColor(e.target.value)} />
                <button type="button" className="mold-import-button" onClick={handleUseCustomColor}>
                  Usar essa cor no Lapis
                </button>
              </div>
              <p className="bandeira-hint">Escolha qualquer cor nova (nao precisa existir na imagem) pra desenhar ou criar a moldura abaixo.</p>

              <div className="bandeira-border-row">
                <input type="number" min={1} {...numericFieldProps(borderThickness, setBorderThickness, 1)} />
                <span>px de espessura</span>
              </div>
              <button type="button" className="mold-import-button" onClick={handleCreateBorder}>
                Criar moldura com essa cor
              </button>

              {selectedColor ? (
                <>
                  <h3>Cor selecionada</h3>
                  <div className="bandeira-replace-row">
                    <span className="bandeira-swatch" style={{ background: selectedColor }} />
                    <code>{selectedColor}</code>
                  </div>

                  {colorSummary.some((entry) => entry.hex !== selectedColor) ? (
                    <>
                      <p className="bandeira-hint">Trocar por uma cor que ja existe no projeto:</p>
                      <div className="bandeira-existing-colors-list">
                        {colorSummary
                          .filter((entry) => entry.hex !== selectedColor)
                          .map((entry) => (
                            <button
                              type="button"
                              key={entry.hex}
                              className={`bandeira-existing-color-swatch ${replaceTarget === entry.hex ? 'active' : ''}`}
                              title={entry.name}
                              onClick={() => setReplaceTarget(entry.hex)}
                            >
                              <span className="bandeira-swatch" style={{ background: entry.hex }} />
                            </button>
                          ))}
                      </div>
                    </>
                  ) : null}

                  <p className="bandeira-hint">Ou escolha outra cor:</p>
                  <div className="bandeira-replace-row">
                    <input type="color" value={replaceTarget} onChange={(e) => setReplaceTarget(e.target.value)} />
                    <button type="button" className="mold-import-button" onClick={handleReplaceSelected}>
                      Trocar todas por essa cor
                    </button>
                  </div>
                  <p className="bandeira-hint">
                    Modo <strong>Lapis</strong>: clique esquerdo pinta com essa cor, clique direito num outro pixel
                    copia uma cor nova.
                  </p>
                </>
              ) : null}

              <h3>
                Tabela de cores <span className="bandeira-count-badge">{colorSummary.length}</span>
              </h3>
              <div className="bandeira-color-list">
                {colorSummary.map((entry) => (
                  <button
                    type="button"
                    key={entry.hex}
                    className={`bandeira-color-row ${selectedColor === entry.hex ? 'selected' : ''}`}
                    onClick={() => {
                      setSelectedColor(entry.hex);
                      setReplaceTarget(entry.hex);
                    }}
                  >
                    <span className="bandeira-swatch" style={{ background: entry.hex }} />
                    <span className="bandeira-color-name">{entry.name}</span>
                    <span className="bandeira-color-count">{entry.count.toLocaleString('pt-BR')}</span>
                  </button>
                ))}
              </div>
            </>
          ) : null}

          {sidebarTab === 'numerar' ? (
            <>
              <h3>Numerar cores</h3>
              <label className="bandeira-toolbar-check">
                <input type="checkbox" checked={showNumbers} onChange={(e) => setShowNumbers(e.target.checked)} />
                Mostrar numero de cada cor na grade
              </label>
              <p className="bandeira-hint">
                Cada cor da tabela recebe um numero — aparece escrito em cima dos pixels dela na grade (so em zoom
                alto o bastante pra ficar legivel), estilo pintura numerada. Use como legenda pra separar/contar os
                papeis por cor.
              </p>

              <h3>
                Legenda <span className="bandeira-count-badge">{colorSummary.length}</span>
              </h3>
              <div className="bandeira-color-list">
                {colorSummary.map((entry, index) => (
                  <div key={entry.hex} className="bandeira-color-row bandeira-number-row">
                    <span className="bandeira-number-badge">{index + 1}</span>
                    <span className="bandeira-swatch" style={{ background: entry.hex }} />
                    <span className="bandeira-color-name">{entry.name}</span>
                    <span className="bandeira-color-count">{entry.count.toLocaleString('pt-BR')}</span>
                  </div>
                ))}
              </div>
            </>
          ) : null}

          {sidebarTab === 'grades' ? (
            <>
              <h3>Grade fina</h3>
              <label className="bandeira-toolbar-check">
                <input type="checkbox" checked={showFineGrid} onChange={(e) => setShowFineGrid(e.target.checked)} />
                Mostrar 1 linha por pixel
              </label>
              <p className="bandeira-hint">Contorno fino em volta de cada pixel individual da grade.</p>
              <label className="auth-field bandeira-grid-color-field">
                <span>Cor da grade fina</span>
                <input type="color" value={fineGridColor} onChange={(e) => setFineGridColor(e.target.value)} />
              </label>

              <h3>Grade de folhas/tacos</h3>
              <label className="bandeira-toolbar-check">
                <input type="checkbox" checked={showCoarseGrid} onChange={(e) => setShowCoarseGrid(e.target.checked)} />
                <Grid3x3 size={14} />
                Mostrar divisao em folhas/tacos
              </label>
              {showCoarseGrid ? (
                <div className="bandeira-border-row">
                  <input
                    type="number"
                    min={1}
                    {...numericFieldProps(coarseCols, setCoarseCols, 1)}
                    title={isRealScale ? 'Colunas (cm) por folha/taco' : 'Colunas (tacos) por folha/taco'}
                  />
                  <span>x</span>
                  <input
                    type="number"
                    min={1}
                    {...numericFieldProps(coarseRows, setCoarseRows, 1)}
                    title={isRealScale ? 'Linhas (cm) por folha/taco' : 'Linhas (tacos) por folha/taco'}
                  />
                </div>
              ) : null}
              <p className="bandeira-hint">
                Linha grossa a cada <strong>{coarseCols} colunas</strong> e <strong>{coarseRows} linhas</strong>{' '}
                {isRealScale ? (
                  'de pixel (1px = 1cm) — mostra onde cada folha/taco fisico comeca e termina.'
                ) : (
                  <>
                    de taco — equivale a <strong>{coarseCols * CM_POR_PIXEL} x {coarseRows * CM_POR_PIXEL} cm</strong>{' '}
                    por folha/taco fisico.
                  </>
                )}
              </p>
              <label className="auth-field bandeira-grid-color-field">
                <span>Cor da grade de folhas/tacos</span>
                <input type="color" value={coarseGridColor} onChange={(e) => setCoarseGridColor(e.target.value)} />
              </label>
            </>
          ) : null}

          {sidebarTab === 'contagem' ? (
            <>
              <h3>Contagem de folha</h3>
              <p className="bandeira-hint">
                A quantidade de tacos de cada cor e sempre no taco padrao ({CM_POR_PIXEL}cm, o mesmo da grade de
                trabalho) e nao muda. O tamanho escolhido abaixo so afeta quantas folhas sao necessarias — um taco
                menor cabe mais vezes numa folha, entao precisa de menos folhas.
              </p>
              <label className="auth-field">
                <span>Tamanho do taco pra cortar (cm)</span>
                <input type="number" min={1} {...numericFieldProps(tacoSizeCm, setTacoSizeCm, 1)} />
              </label>
              <p className="bandeira-hint">
                Uma folha tem <strong>{FOLHA_NOMINAL_LARGURA_CM}x{FOLHA_NOMINAL_ALTURA_CM}cm</strong>, mas so a area
                util de <strong>{FOLHA_USAVEL_LARGURA_CM}x{FOLHA_USAVEL_ALTURA_CM}cm</strong> entra na contagem —
                entao cabem <strong>{tacosPerFolha} tacos</strong> de {tacoSizeCm}cm por folha.
              </p>

              <h3>
                Tacos e folhas por cor <span className="bandeira-count-badge">{tacoCountByColor.length}</span>
              </h3>
              <div className="bandeira-color-list">
                {tacoCountByColor.map((entry) => (
                  <div key={entry.hex} className="bandeira-color-row bandeira-number-row">
                    <span className="bandeira-swatch" style={{ background: entry.hex }} />
                    <span className="bandeira-color-name">{entry.name}</span>
                    <span className="bandeira-color-count">{entry.tacos.toLocaleString('pt-BR')} tacos ({CM_POR_PIXEL}cm)</span>
                    <span className="bandeira-color-count">{entry.folhas.toLocaleString('pt-BR')} folhas</span>
                  </div>
                ))}
              </div>
              <p className="bandeira-hint">Essa tabela sai junto com a tabela de cores no PDF (aba Dividir folha).</p>
            </>
          ) : null}

          {sidebarTab === 'dividir' ? (
            <>
              <h3>Dividir folha</h3>
              <p className="bandeira-hint">
                Gera um PDF de referencia pra contar/montar (estilo pintura numerada) — capa com a tabela de cores
                numerada, e depois o desenho da bandeira com a grade de folhas/tacos e o numero de cada cor em cima
                dos blocos, inteira ou dividida em partes.
              </p>
              <label className="auth-field">
                <span>Nome da bandeira</span>
                <input type="text" value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex: Bandeira Santos" />
              </label>
              <div className="bandeira-division-options">
                <label className="bandeira-division-option">
                  <input type="radio" name="division-mode" checked={divisionMode === 'inteira'} onChange={() => setDivisionMode('inteira')} />
                  Inteira (1 folha)
                </label>
                <label className="bandeira-division-option">
                  <input type="radio" name="division-mode" checked={divisionMode === '2'} onChange={() => setDivisionMode('2')} />
                  Dividir em 2 (topo/base)
                </label>
                <label className="bandeira-division-option">
                  <input type="radio" name="division-mode" checked={divisionMode === '4'} onChange={() => setDivisionMode('4')} />
                  Dividir em 4 (2x2)
                </label>
              </div>
              <label className="bandeira-toolbar-check">
                <input type="checkbox" checked={pdfShowFineGrid} onChange={(e) => setPdfShowFineGrid(e.target.checked)} />
                Mostrar contorno de cada taco no PDF
              </label>
              <label className="bandeira-toolbar-check">
                <input type="checkbox" checked={pdfShowGrid} onChange={(e) => setPdfShowGrid(e.target.checked)} />
                <Grid3x3 size={14} />
                Mostrar grade de folhas/tacos no PDF ({coarseCols}x{coarseRows} tacos por folha)
              </label>

              <h3>
                Tabela de cores <span className="bandeira-count-badge">{colorSummary.length}</span>
              </h3>
              <div className="bandeira-color-list">
                {colorSummary.map((entry, index) => (
                  <div key={entry.hex} className="bandeira-color-row bandeira-number-row">
                    <span className="bandeira-number-badge">{index + 1}</span>
                    <span className="bandeira-swatch" style={{ background: entry.hex }} />
                    <span className="bandeira-color-name">{entry.name}</span>
                    <span className="bandeira-color-count">{entry.count.toLocaleString('pt-BR')}</span>
                  </div>
                ))}
              </div>

              {pdfError ? <p className="mold-import-error">{pdfError}</p> : null}
              <button type="button" className="mold-save-button" onClick={handleDownloadPdf} disabled={downloadingPdf}>
                {downloadingPdf ? <Loader2 size={16} className="mold-import-spinner" /> : <Download size={16} />}
                {downloadingPdf ? 'Gerando PDF...' : 'Baixar PDF'}
              </button>
              <button type="button" className="mold-secondary-button" onClick={handleDownloadPng}>
                <FileImage size={16} />
                Baixar Imagem (PNG)
              </button>
              <button type="button" className="mold-secondary-button" onClick={() => setShowEmailModal(true)}>
                <Send size={16} />
                Enviar por email
              </button>
            </>
          ) : null}
        </div>
      ) : null}

      {showEmailModal ? (
        <SendBandeiraEmailModal
          nome={nome.trim() || 'Bandeira'}
          larguraCm={Number(larguraCm) || gridWidth}
          alturaCm={Number(alturaCm) || gridHeight}
          coresDistintas={colorSummary.length}
          buildPdfBlob={buildCurrentPdfBlob}
          onClose={() => setShowEmailModal(false)}
        />
      ) : null}

      {pendingCropFile ? (
        <ImageCropModal
          file={pendingCropFile}
          onConfirm={handleCropConfirm}
          onUseWhole={handleCropUseWhole}
          onCancel={handleCropCancel}
        />
      ) : null}

      {colors && (
        <nav className="bandeira-mobile-bottom-bar" aria-label="Navegação inferior móvel">
          <button
            type="button"
            className={`mobile-bar-btn ${tool === 'mover' ? 'active' : ''}`}
            onClick={() => setTool('mover')}
            title="Ferramenta Mover"
          >
            <Hand size={18} />
            <span>Mover</span>
          </button>
          <button
            type="button"
            className={`mobile-bar-btn ${tool === 'lapis' ? 'active' : ''}`}
            onClick={() => setTool('lapis')}
            title="Ferramenta Lápis"
          >
            <Pencil size={18} />
            <span>Lápis</span>
          </button>
          <button
            type="button"
            className={`mobile-bar-btn ${tool === 'contagotas' ? 'active' : ''}`}
            onClick={() => setTool('contagotas')}
            title="Conta-gotas"
          >
            <Droplet size={18} />
            <span>Gotas</span>
          </button>
          <button
            type="button"
            className={`mobile-bar-btn ${sidebarTab === 'cores' ? 'active' : ''}`}
            onClick={() => {
              setSidebarTab('cores');
              document.querySelector('.bandeira-side-panel')?.scrollIntoView({ behavior: 'smooth' });
            }}
            title="Aba de Cores"
          >
            <Palette size={18} />
            <span>Cores</span>
          </button>
          <button
            type="button"
            className={`mobile-bar-btn ${sidebarTab === 'numerar' ? 'active' : ''}`}
            onClick={() => {
              setSidebarTab('numerar');
              document.querySelector('.bandeira-side-panel')?.scrollIntoView({ behavior: 'smooth' });
            }}
            title="Aba Numerar"
          >
            <Hash size={18} />
            <span>Numerar</span>
          </button>
          <button
            type="button"
            className={`mobile-bar-btn ${sidebarTab === 'grades' ? 'active' : ''}`}
            onClick={() => {
              setSidebarTab('grades');
              document.querySelector('.bandeira-side-panel')?.scrollIntoView({ behavior: 'smooth' });
            }}
            title="Aba Grades"
          >
            <Grid3x3 size={18} />
            <span>Grades</span>
          </button>
          <button
            type="button"
            className={`mobile-bar-btn ${sidebarTab === 'dividir' || sidebarTab === 'contagem' ? 'active' : ''}`}
            onClick={() => {
              setSidebarTab('dividir');
              document.querySelector('.bandeira-side-panel')?.scrollIntoView({ behavior: 'smooth' });
            }}
            title="Aba Exportar"
          >
            <Layers size={18} />
            <span>Exportar</span>
          </button>
        </nav>
      )}
    </div>
  );
}
