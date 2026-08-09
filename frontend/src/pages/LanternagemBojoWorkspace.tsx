import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BoxSelect,
  Check,
  Circle,
  ClipboardPaste,
  Copy,
  CopyPlus,
  Download,
  Droplet,
  FileImage,
  Grid3x3,
  Hand,
  Loader2,
  Maximize2,
  Pencil,
  Save,
  Square,
  Undo2,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import {
  buildColorSummary,
  reduceBandeiraPalette,
  replaceColorInGrid,
  snapNearBlackToBlack,
  type BandeiraColorSummaryEntry,
} from '../lib/bandeiraImage';
import {
  computeLanternaGridSize,
  lanternaGridSizeExceedsLimit,
  MAX_LANTERNA_CELLS,
  MAX_LANTERNA_SIDE,
  readLanternaPixelGridFromFile,
} from '../lib/lanternaGrid';
import { renderFileToImageFile } from '../lib/pdfToImage';
import { hexToRgb } from '../lib/colorMath';
import { buildLanternaPdf } from '../lib/lanternaPdf';
import { downloadBlob, downloadCanvasAsPng, slugifyFilename } from '../lib/pdfExport';
import { numericFieldProps } from '../lib/numericInput';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import type { LanternaProjectState } from '../types';

const CELL_BASE_PX_DEFAULT = 14;
const MAX_CANVAS_DIMENSION_PX = 14000;
const ZOOM_MIN = 25;
const ZOOM_MAX = 400;
const ZOOM_STEP = 25;
// Claro (nao escuro) de proposito -- o fundo da grade e preto por padrao,
// uma linha escura ficaria invisivel em cima dele.
const DEFAULT_FINE_GRID_COLOR = '#94a3b8';
const DEFAULT_GOMO_LINE_COLOR = '#2563eb';
const DEFAULT_DIVISAO_LINE_COLOR = '#dc2626';
/** Fundo comeca preto (= "sem lanterna aqui", nunca entra na contagem) — so
 * vira uma cor de verdade (inclusive branco) quando o cliente pinta ali. */
const DEFAULT_CELL_COLOR = '#000000';
const LANTERNA_BLACK_HEX = '#000000';
const MAX_UNDO_STEPS = 3;

type Tool = 'mover' | 'lapis' | 'contagotas' | 'selecao';
type SidebarTab = 'cores' | 'numerar' | 'grades' | 'contagem' | 'exportar';

/** Retangulo de selecao, em celulas da grade — sempre normalizado (x0<=x1, y0<=y1). */
interface SelectionRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

interface Clipboard {
  width: number;
  height: number;
  cells: string[];
}

/** Colagem "flutuante", ainda nao gravada na grade de verdade — o cliente
 * arrasta ou usa as setas do teclado pra ajustar a posicao exata antes de
 * confirmar (Enter) ou cancelar (Esc). */
interface PendingPaste {
  x: number;
  y: number;
  width: number;
  height: number;
  cells: string[];
}

function computeCellBasePx(gridWidth: number, gridHeight: number): number {
  const maxDim = Math.max(gridWidth, gridHeight, 1);
  const maxCellPxAtMaxZoom = MAX_CANVAS_DIMENSION_PX / (maxDim * (ZOOM_MAX / 100));
  return Math.max(1, Math.min(CELL_BASE_PX_DEFAULT, maxCellPxAtMaxZoom));
}

interface LanternagemBojoWorkspaceProps {
  /** Abre direto um projeto salvo (ex: Meus Projetos > Lanternagem de Bojo). */
  projectId?: number | null;
}

export function LanternagemBojoWorkspace({ projectId = null }: LanternagemBojoWorkspaceProps) {
  const { token, user } = useAuth();
  
  // Estado para armazenar e carregar o rascunho temporario da lanternagem
  const draftData = (() => {
    try {
      const activeProjId = window.localStorage.getItem('sistema-novo:user-area:lanterna-project-id');
      const resolvedProjId = activeProjId ? Number(activeProjId) : projectId;
      const key = user ? `sistema-novo:draft:user-${user.id}:lanterna:project-${resolvedProjId || 'new'}` : '';
      const saved = key ? window.localStorage.getItem(key) : null;
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  })();

  const [gomos, setGomos] = useState(() => draftData?.gomos ?? 32);
  const [lanternasPorGomo, setLanternasPorGomo] = useState(() => draftData?.lanternasPorGomo ?? 2);
  const [lanternasSubindo, setLanternasSubindo] = useState(() => draftData?.lanternasSubindo ?? 16);

  const [gridWidth, setGridWidth] = useState(() => draftData?.gridWidth ?? 0);
  const [gridHeight, setGridHeight] = useState(() => draftData?.gridHeight ?? 0);
  const [colors, setColors] = useState<string[] | null>(() => draftData?.colors ?? null);
  /** Lanternas por gomo "travadas" na grade atual (pode ser diferente do
   * campo acima se o usuario mudar o numero DEPOIS de ja ter criado a grade
   * — a linha de gomo sempre usa o valor de quando a grade foi criada). */
  const [gridLanternasPorGomo, setGridLanternasPorGomo] = useState(() => draftData?.gridLanternasPorGomo ?? 0);
  const [gridGomos, setGridGomos] = useState(() => draftData?.gridGomos ?? 0);
  const [gridLanternasSubindo, setGridLanternasSubindo] = useState(() => draftData?.gridLanternasSubindo ?? 0);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [targetColorCount, setTargetColorCount] = useState(() => draftData?.targetColorCount ?? 8);
  const [reducing, setReducing] = useState(false);

  const [selectedColor, setSelectedColor] = useState<string | null>(null);
  const [replaceTarget, setReplaceTarget] = useState('#ff0000');
  const [customColor, setCustomColor] = useState(() => draftData?.customColor ?? '#ff0000');
  const [borderThickness, setBorderThickness] = useState(() => draftData?.borderThickness ?? 1);
  const [tool, setTool] = useState<Tool>(() => draftData?.tool ?? 'lapis');
  /** Retangulo marcado com a ferramenta Selecao — copia/cola trabalha em
   * cima dele (ex.: desenhar 1 gomo e repetir pros outros). */
  const [selection, setSelection] = useState<SelectionRect | null>(null);
  const [clipboard, setClipboard] = useState<Clipboard | null>(null);
  const selectionDragRef = useRef<{ startX: number; startY: number } | null>(null);
  const [pendingPaste, setPendingPaste] = useState<PendingPaste | null>(null);
  const pasteDragRef = useRef<{ startClientX: number; startClientY: number; startX: number; startY: number } | null>(null);
  const [zoom, setZoom] = useState(100);
  const [showFineGrid, setShowFineGrid] = useState(true);
  const [fineGridColor, setFineGridColor] = useState(DEFAULT_FINE_GRID_COLOR);
  const [showGomoLines, setShowGomoLines] = useState(true);
  const [gomoLineColor, setGomoLineColor] = useState(DEFAULT_GOMO_LINE_COLOR);
  /** Linha de divisao: corta o balao INTEIRO (todas as colunas) em N partes
   * iguais, numa cor diferente da linha de gomo — pra o cliente ver de longe
   * onde o balao se divide (ex.: 64 lanternas / 4 partes = 1 linha a cada
   * 16 colunas), sem confundir com a linha fina de cada gomo. */
  const [showDivisaoLines, setShowDivisaoLines] = useState(true);
  const [divisaoCount, setDivisaoCount] = useState(4);
  const [divisaoLineColor, setDivisaoLineColor] = useState(DEFAULT_DIVISAO_LINE_COLOR);
  const [bolinha, setBolinha] = useState(true);
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>('cores');
  const [showNumbers, setShowNumbers] = useState(false);

  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);

  const [nome, setNome] = useState(() => draftData?.nome ?? '');

  /** Projeto que "Salvar projeto" vai atualizar -- comeca com `projectId`
   * (vindo de Meus Projetos), mas depois do primeiro "Salvar" de um projeto
   * novo passa a apontar pro id recem-criado (senao salvaria duplicado). */
  const [currentProjectId, setCurrentProjectId] = useState<number | null>(() => draftData?.currentProjectId ?? projectId);
  const [loadingProject, setLoadingProject] = useState(false);
  const [savingProject, setSavingProject] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  const draftKey = useMemo(() => {
    if (!user) return '';
    return `sistema-novo:draft:user-${user.id}:lanterna:project-${currentProjectId || 'new'}`;
  }, [user, currentProjectId]);

  const [hasDraftLoaded, setHasDraftLoaded] = useState(false);
  const [reloadTrigger, setReloadTrigger] = useState(0);

  const [importingImage, setImportingImage] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const paintingRef = useRef(false);
  const panRef = useRef<{
    active: boolean;
    pointerId: number | null;
    startX: number;
    startY: number;
    scrollLeft: number;
    scrollTop: number;
  }>({ active: false, pointerId: null, startX: 0, startY: 0, scrollLeft: 0, scrollTop: 0 });
  const workingColorsRef = useRef<string[] | null>(null);
  const paintedDuringGestureRef = useRef(false);
  const historyRef = useRef<string[][]>([]);
  const [undoCount, setUndoCount] = useState(0);

  const cellBasePx = useMemo(() => computeCellBasePx(gridWidth, gridHeight), [gridWidth, gridHeight]);

  const fineGridStrokeStyle = useMemo(() => {
    const { r, g, b } = hexToRgb(fineGridColor);
    return `rgba(${r}, ${g}, ${b}, 0.35)`;
  }, [fineGridColor]);

  /** A cada quantas colunas cai 1 linha de divisao (largura total / N partes). */
  const divisaoInterval = useMemo(
    () => (gridWidth > 0 ? Math.max(1, Math.round(gridWidth / Math.max(1, divisaoCount))) : 0),
    [gridWidth, divisaoCount]
  );

  const fitZoomToStage = useCallback((widthPx: number, heightPx: number) => {
    const stage = stageRef.current;
    const availableWidth = (stage?.clientWidth ?? 800) - 32;
    const availableHeight = Math.max(320, window.innerHeight * 0.6) - 32;
    const cellBase = computeCellBasePx(widthPx, heightPx);
    const fitByWidth = (availableWidth / (widthPx * cellBase)) * 100;
    const fitByHeight = (availableHeight / (heightPx * cellBase)) * 100;
    const fit = Math.min(fitByWidth, fitByHeight, ZOOM_MAX);
    const snapped = fit >= 5 ? Math.floor(fit / 5) * 5 : fit;
    setZoom(Math.max(ZOOM_MIN, Math.round(snapped * 100) / 100));
  }, []);

  useEffect(() => {
    workingColorsRef.current = colors ? colors.slice() : null;
  }, [colors]);

  // Hook de Auto-salvamento silencioso da lanternagem
  useEffect(() => {
    if (loading || loadingProject || !colors || !draftKey) return;
    try {
      const draft = {
        gomos,
        lanternasPorGomo,
        lanternasSubindo,
        gridWidth,
        gridHeight,
        colors,
        gridGomos,
        gridLanternasPorGomo,
        gridLanternasSubindo,
        bolinha,
        showFineGrid,
        fineGridColor,
        showGomoLines,
        gomoLineColor,
        showDivisaoLines,
        divisaoCount,
        divisaoLineColor,
        showNumbers,
        nome,
        currentProjectId
      };
      window.localStorage.setItem(draftKey, JSON.stringify(draft));
    } catch {}
  }, [
    colors, gridWidth, gridHeight, gomos, lanternasPorGomo, lanternasSubindo,
    gridGomos, gridLanternasPorGomo, gridLanternasSubindo, bolinha, showFineGrid,
    fineGridColor, showGomoLines, gomoLineColor, showDivisaoLines, divisaoCount,
    divisaoLineColor, showNumbers, nome, loading, loadingProject, draftKey, currentProjectId
  ]);

  // Funcao de descarte manual do rascunho
  const handleDiscardDraft = useCallback(() => {
    if (draftKey) {
      try {
        window.localStorage.removeItem(draftKey);
      } catch {}
    }
    setHasDraftLoaded(false);
    setSaveMsg(null);
    setColors(null);
    setGridWidth(0);
    setGridHeight(0);
    setReloadTrigger(prev => prev + 1);
  }, [draftKey]);

  const gridSize = useMemo(() => computeLanternaGridSize(gomos, lanternasPorGomo, lanternasSubindo), [gomos, lanternasPorGomo, lanternasSubindo]);
  const exceedsLimit = lanternaGridSizeExceedsLimit(gridSize);

  const colorSummary: BandeiraColorSummaryEntry[] = useMemo(() => (colors ? buildColorSummary(colors) : []), [colors]);
  /** Sem o preto (fundo/"sem lanterna aqui") — usada pra numerar, contar e
   * no PDF. O preto so aparece na aba Cores (pra editar), nunca conta como
   * lanterna de verdade. */
  const countableColorSummary = useMemo(
    () => colorSummary.filter((entry) => entry.hex.toLowerCase() !== LANTERNA_BLACK_HEX),
    [colorSummary]
  );

  const colorNumberMap = useMemo(() => {
    const map = new Map<string, number>();
    countableColorSummary.forEach((entry, index) => map.set(entry.hex, index + 1));
    return map;
  }, [countableColorSummary]);

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

  /** Cria a grade em branco (1 celula = 1 lanterna) no tamanho pedido —
   * diferente de Bandeiras/Painel, nao ha imagem nenhuma pra ler: comeca
   * tudo numa cor so e o cliente desenha do zero. */
  function handleCreateGrid() {
    if (!gomos || !lanternasPorGomo || !lanternasSubindo || exceedsLimit || loading) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const total = gridSize.widthPx * gridSize.heightPx;
      setGridWidth(gridSize.widthPx);
      setGridHeight(gridSize.heightPx);
      setColors(new Array(total).fill(DEFAULT_CELL_COLOR));
      setGridLanternasPorGomo(lanternasPorGomo);
      setGridGomos(gomos);
      setGridLanternasSubindo(lanternasSubindo);
      setSelectedColor(null);
      historyRef.current = [];
      setUndoCount(0);
      requestAnimationFrame(() => fitZoomToStage(gridSize.widthPx, gridSize.heightPx));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nao foi possivel criar a grade.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setCurrentProjectId(projectId);
  }, [projectId]);

  /** Abre projeto salvo vindo de Meus Projetos > Lanternagem de Bojo — recarrega
   * a grade e todas as opcoes de exibicao exatamente como foram salvas. */
  useEffect(() => {
    // Primeiro verifica se ha rascunho local
    const savedDraftRaw = draftKey ? window.localStorage.getItem(draftKey) : null;
    if (savedDraftRaw) {
      try {
        const draft = JSON.parse(savedDraftRaw);
        setNome(draft.nome);
        setGomos(draft.gomos);
        setLanternasPorGomo(draft.lanternasPorGomo);
        setLanternasSubindo(draft.lanternasSubindo);
        setGridWidth(draft.gridWidth);
        setGridHeight(draft.gridHeight);
        setColors(draft.colors);
        setGridGomos(draft.gridGomos);
        setGridLanternasPorGomo(draft.gridLanternasPorGomo);
        setGridLanternasSubindo(draft.gridLanternasSubindo);
        setBolinha(draft.bolinha);
        setShowFineGrid(draft.showFineGrid);
        setFineGridColor(draft.fineGridColor);
        setShowGomoLines(draft.showGomoLines);
        setGomoLineColor(draft.gomoLineColor);
        setShowDivisaoLines(draft.showDivisaoLines);
        setDivisaoCount(draft.divisaoCount);
        setDivisaoLineColor(draft.divisaoLineColor);
        setShowNumbers(draft.showNumbers);
        setSelectedColor(null);
        setSelection(null);
        setClipboard(null);
        setPendingPaste(null);
        historyRef.current = [];
        setUndoCount(0);
        setHasDraftLoaded(true);
        setSaveMsg('Rascunho nao salvo recuperado do seu navegador.');
        requestAnimationFrame(() => fitZoomToStage(draft.gridWidth, draft.gridHeight));
        return; // Pula a request de carregar do banco
      } catch {}
    }

    if (!token || !projectId) {
      return;
    }
    let cancelled = false;
    setLoadingProject(true);
    setError(null);
    (async () => {
      try {
        const res = await api.getLanternaProject(projectId, token);
        if (cancelled) {
          return;
        }
        const project = res.data;
        const state = project.state;
        setNome(project.nome);
        setGomos(project.gomos);
        setLanternasPorGomo(project.lanternas_por_gomo);
        setLanternasSubindo(project.lanternas_subindo);
        setGridWidth(state.gridWidth);
        setGridHeight(state.gridHeight);
        setColors(state.colors);
        setGridGomos(state.gridGomos);
        setGridLanternasPorGomo(state.gridLanternasPorGomo);
        setGridLanternasSubindo(state.gridLanternasSubindo);
        if (state.bolinha != null) setBolinha(state.bolinha);
        if (state.showFineGrid != null) setShowFineGrid(state.showFineGrid);
        if (state.fineGridColor) setFineGridColor(state.fineGridColor);
        if (state.showGomoLines != null) setShowGomoLines(state.showGomoLines);
        if (state.gomoLineColor) setGomoLineColor(state.gomoLineColor);
        if (state.showDivisaoLines != null) setShowDivisaoLines(state.showDivisaoLines);
        if (state.divisaoCount != null) setDivisaoCount(state.divisaoCount);
        if (state.divisaoLineColor) setDivisaoLineColor(state.divisaoLineColor);
        if (state.showNumbers != null) setShowNumbers(state.showNumbers);
        setSelectedColor(null);
        setSelection(null);
        setClipboard(null);
        setPendingPaste(null);
        historyRef.current = [];
        setUndoCount(0);
        requestAnimationFrame(() => fitZoomToStage(state.gridWidth, state.gridHeight));
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : 'Nao foi possivel abrir o projeto.');
        }
      } finally {
        if (!cancelled) {
          setLoadingProject(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, token, reloadTrigger, draftKey]);

  /** Salva a grade como arquivo editavel (NAO imagem) em Meus Projetos >
   * Lanternagem de Bojo — primeiro save cria o projeto, os seguintes
   * atualizam o mesmo registro (currentProjectId ja aponta pra ele). */
  async function handleSaveProject() {
    if (!token || !colors || gridWidth === 0 || gridHeight === 0 || savingProject) {
      return;
    }
    setSavingProject(true);
    setSaveError(null);
    setSaveMsg(null);
    const state: LanternaProjectState = {
      colors,
      gridWidth,
      gridHeight,
      gridGomos,
      gridLanternasPorGomo,
      gridLanternasSubindo,
      bolinha,
      showFineGrid,
      fineGridColor,
      showGomoLines,
      gomoLineColor,
      showDivisaoLines,
      divisaoCount,
      divisaoLineColor,
      showNumbers,
    };
    const payload = {
      nome: nome.trim() || 'Lanternagem de bojo',
      gomos: gridGomos,
      lanternas_por_gomo: gridLanternasPorGomo,
      lanternas_subindo: gridLanternasSubindo,
      state,
    };
    try {
      const res = currentProjectId != null
        ? await api.updateLanternaProject(currentProjectId, payload, token)
        : await api.createLanternaProject(payload, token);
      setCurrentProjectId(res.data.id);
      setNome(res.data.nome);
      setSaveMsg(`Projeto "${res.data.nome}" salvo em Meus Projetos -> Lanternagem de Bojo.`);
      
      // Limpa rascunho local ao salvar com sucesso
      if (draftKey) {
        try {
          window.localStorage.removeItem(draftKey);
        } catch {}
      }
      setHasDraftLoaded(false);

    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : 'Nao foi possivel salvar o projeto.');
    } finally {
      setSavingProject(false);
    }
  }

  function handleReduceColors() {
    if (!colors || reducing) {
      return;
    }
    pushHistory(colors);
    setReducing(true);
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

  function handleUseCustomColor() {
    setSelectedColor(customColor);
    setReplaceTarget(customColor);
    setTool('lapis');
  }

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

  /** Copia o retangulo selecionado pra memoria — pra colar do lado depois
   * (ex.: desenhar 1 gomo e repetir pros outros, sem redesenhar na mao). */
  function handleCopySelection() {
    if (!selection || !colors || gridWidth === 0) {
      return;
    }
    const width = selection.x1 - selection.x0 + 1;
    const height = selection.y1 - selection.y0 + 1;
    const cells: string[] = [];
    for (let y = selection.y0; y <= selection.y1; y += 1) {
      for (let x = selection.x0; x <= selection.x1; x += 1) {
        cells.push(colors[y * gridWidth + x]);
      }
    }
    setClipboard({ width, height, cells });
  }

  /** Aplica o clipboard em cima de `base` (retorna uma copia nova, nao muda
   * o array recebido) — recortado nas bordas da grade se nao couber inteiro. */
  function pasteClipboardInto(base: string[], clip: Clipboard, targetX: number, targetY: number): string[] {
    const next = base.slice();
    for (let dy = 0; dy < clip.height; dy += 1) {
      const ty = targetY + dy;
      if (ty < 0 || ty >= gridHeight) {
        continue;
      }
      for (let dx = 0; dx < clip.width; dx += 1) {
        const tx = targetX + dx;
        if (tx < 0 || tx >= gridWidth) {
          continue;
        }
        next[ty * gridWidth + tx] = clip.cells[dy * clip.width + dx];
      }
    }
    return next;
  }

  /** Poe 1 copia flutuante logo a direita da selecao atual — ainda NAO grava
   * na grade: o cliente arrasta ou usa as setas do teclado pra ajustar a
   * posicao exata, depois confirma (Enter / botao) ou cancela (Esc). */
  function handlePasteBeside() {
    if (!clipboard || !selection) {
      return;
    }
    setPendingPaste({
      x: selection.x1 + 1,
      y: selection.y0,
      width: clipboard.width,
      height: clipboard.height,
      cells: clipboard.cells,
    });
  }

  function handleConfirmPaste() {
    if (!pendingPaste || !colors) {
      return;
    }
    pushHistory(colors);
    const next = pasteClipboardInto(
      colors,
      { width: pendingPaste.width, height: pendingPaste.height, cells: pendingPaste.cells },
      pendingPaste.x,
      pendingPaste.y
    );
    setColors(next);
    setSelection({
      x0: pendingPaste.x,
      y0: pendingPaste.y,
      x1: Math.min(gridWidth - 1, pendingPaste.x + pendingPaste.width - 1),
      y1: Math.min(gridHeight - 1, pendingPaste.y + pendingPaste.height - 1),
    });
    setPendingPaste(null);
  }

  function handleCancelPaste() {
    setPendingPaste(null);
  }

  /** Enquanto tem uma colagem flutuante: setas movem 1 celula por vez (pra
   * posicionar exato), Enter confirma, Esc cancela. */
  useEffect(() => {
    if (!pendingPaste) {
      return;
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Enter') {
        event.preventDefault();
        handleConfirmPaste();
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        handleCancelPaste();
        return;
      }
      const deltas: Record<string, [number, number]> = {
        ArrowUp: [0, -1],
        ArrowDown: [0, 1],
        ArrowLeft: [-1, 0],
        ArrowRight: [1, 0],
      };
      const delta = deltas[event.key];
      if (!delta) {
        return;
      }
      event.preventDefault();
      setPendingPaste((prev) => (prev ? { ...prev, x: prev.x + delta[0], y: prev.y + delta[1] } : prev));
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [pendingPaste]);

  /** Repete o clipboard lado a lado ate acabar a largura da grade — util pra
   * preencher todos os gomos de uma vez a partir de 1 gomo desenhado. */
  function handleRepeatToEnd() {
    if (!clipboard || !selection || !colors) {
      return;
    }
    pushHistory(colors);
    let next = colors.slice();
    let targetX = selection.x1 + 1;
    const targetY = selection.y0;
    while (targetX < gridWidth) {
      next = pasteClipboardInto(next, clipboard, targetX, targetY);
      targetX += clipboard.width;
    }
    setColors(next);
  }

  function drawCell(ctx: CanvasRenderingContext2D, x: number, y: number, cellPx: number, color: string) {
    if (bolinha) {
      const cx = x * cellPx + cellPx / 2;
      const cy = y * cellPx + cellPx / 2;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(cx, cy, Math.max(0.5, cellPx * 0.42), 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillStyle = color;
      ctx.fillRect(x * cellPx, y * cellPx, cellPx + 0.5, cellPx + 0.5);
    }
  }

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
    if (bolinha) {
      // celula redonda: preenche de PRETO antes (fundo padrao), senao a cor
      // antiga fica "vazando" nos cantos que o circulo novo nao cobre.
      ctx.fillStyle = '#000000';
      ctx.fillRect(x * cellPx, y * cellPx, cellPx + 1, cellPx + 1);
    }
    drawCell(ctx, x, y, cellPx, color);
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
    // Colagem flutuante tem prioridade sobre qualquer ferramenta — arrastar
    // em QUALQUER lugar do canvas move ela, pra posicionar exato antes de
    // confirmar (nao pinta nem mexe em selecao enquanto ela existir).
    if (pendingPaste) {
      pasteDragRef.current = {
        startClientX: event.clientX,
        startClientY: event.clientY,
        startX: pendingPaste.x,
        startY: pendingPaste.y,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }

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
    const cellX = index % gridWidth;
    const cellY = Math.floor(index / gridWidth);

    if (tool === 'selecao') {
      selectionDragRef.current = { startX: cellX, startY: cellY };
      setSelection({ x0: cellX, y0: cellY, x1: cellX, y1: cellY });
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }

    if (tool === 'contagotas') {
      sampleColorAt(index);
      return;
    }

    if (tool === 'lapis') {
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
    if (pendingPaste && pasteDragRef.current) {
      const cellPx = cellBasePx * (zoom / 100);
      const drag = pasteDragRef.current;
      const dx = Math.round((event.clientX - drag.startClientX) / cellPx);
      const dy = Math.round((event.clientY - drag.startClientY) / cellPx);
      setPendingPaste((prev) => (prev ? { ...prev, x: drag.startX + dx, y: drag.startY + dy } : prev));
      return;
    }

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

    if (tool === 'selecao' && selectionDragRef.current) {
      const index = cellFromEvent(event);
      if (index === null || gridWidth === 0) {
        return;
      }
      const cellX = index % gridWidth;
      const cellY = Math.floor(index / gridWidth);
      const { startX, startY } = selectionDragRef.current;
      setSelection({
        x0: Math.min(startX, cellX),
        y0: Math.min(startY, cellY),
        x1: Math.max(startX, cellX),
        y1: Math.max(startY, cellY),
      });
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
    selectionDragRef.current = null;
    pasteDragRef.current = null;
    if (paintedDuringGestureRef.current && workingColorsRef.current) {
      paintedDuringGestureRef.current = false;
      pushHistory(colors);
      setColors(workingColorsRef.current.slice());
    }
  }

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
    // Fundo preto sempre por baixo — no modo bolinha, os espacos entre os
    // circulos mostram isso (nao a cor de fundo do palco).
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, width, height);

    for (let y = 0; y < gridHeight; y += 1) {
      for (let x = 0; x < gridWidth; x += 1) {
        drawCell(ctx, x, y, cellPx, colors[y * gridWidth + x]);
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

    if (showGomoLines && gridLanternasPorGomo > 0) {
      ctx.strokeStyle = gomoLineColor;
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let x = 0; x <= gridWidth; x += gridLanternasPorGomo) {
        ctx.moveTo(Math.round(x * cellPx), 0);
        ctx.lineTo(Math.round(x * cellPx), height);
      }
      ctx.stroke();
    }

    // Linha de divisao: corta o balao INTEIRO em N partes iguais, numa cor
    // diferente da linha de gomo — desenhada por cima pra nunca ficar
    // escondida atras dela.
    if (showDivisaoLines && divisaoInterval > 0) {
      ctx.strokeStyle = divisaoLineColor;
      ctx.lineWidth = 3;
      ctx.beginPath();
      for (let x = 0; x <= gridWidth; x += divisaoInterval) {
        ctx.moveTo(Math.round(x * cellPx), 0);
        ctx.lineTo(Math.round(x * cellPx), height);
      }
      ctx.stroke();
    }

    if (showNumbers && cellPx >= 18) {
      ctx.font = `${Math.max(9, Math.floor(cellPx * 0.4))}px sans-serif`;
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

    if (selection && !pendingPaste) {
      const sx = selection.x0 * cellPx;
      const sy = selection.y0 * cellPx;
      const sw = (selection.x1 - selection.x0 + 1) * cellPx;
      const sh = (selection.y1 - selection.y0 + 1) * cellPx;
      ctx.save();
      ctx.strokeStyle = '#22d3ee';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.strokeRect(sx + 1, sy + 1, Math.max(0, sw - 2), Math.max(0, sh - 2));
      ctx.restore();
    }

    // Colagem flutuante: desenha por cima de tudo, ainda sem gravar na
    // grade — o cliente arrasta ou usa as setas do teclado pra ajustar antes
    // de confirmar.
    if (pendingPaste) {
      for (let dy = 0; dy < pendingPaste.height; dy += 1) {
        const ty = pendingPaste.y + dy;
        if (ty < 0 || ty >= gridHeight) {
          continue;
        }
        for (let dx = 0; dx < pendingPaste.width; dx += 1) {
          const tx = pendingPaste.x + dx;
          if (tx < 0 || tx >= gridWidth) {
            continue;
          }
          drawCell(ctx, tx, ty, cellPx, pendingPaste.cells[dy * pendingPaste.width + dx]);
        }
      }
      ctx.save();
      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(
        pendingPaste.x * cellPx + 1,
        pendingPaste.y * cellPx + 1,
        Math.max(0, pendingPaste.width * cellPx - 2),
        Math.max(0, pendingPaste.height * cellPx - 2)
      );
      ctx.restore();
    }
  }, [
    colors,
    gridWidth,
    gridHeight,
    zoom,
    cellBasePx,
    showFineGrid,
    fineGridStrokeStyle,
    showGomoLines,
    gridLanternasPorGomo,
    gomoLineColor,
    showDivisaoLines,
    divisaoInterval,
    divisaoLineColor,
    showNumbers,
    colorNumberMap,
    bolinha,
    selection,
    pendingPaste,
  ]);

  function buildCurrentPdfBlob() {
    return buildLanternaPdf({
      nome: nome.trim() || 'Lanternagem de bojo',
      gomos: gridGomos,
      lanternasPorGomo: gridLanternasPorGomo,
      lanternasSubindo: gridLanternasSubindo,
      gridWidth,
      gridHeight,
      colors: colors ?? [],
      colorSummary: countableColorSummary,
      bolinha,
      showFineGrid,
      fineGridColor,
      showGomoLines,
      gomoLineColor,
      showDivisaoLines,
      divisaoInterval,
      divisaoLineColor,
    });
  }

  function handleDownloadPdf() {
    if (!colors || gridWidth === 0 || gridHeight === 0 || downloadingPdf) {
      return;
    }
    setDownloadingPdf(true);
    setPdfError(null);
    setTimeout(() => {
      try {
        const blob = buildCurrentPdfBlob();
        downloadBlob(blob, `${slugifyFilename(nome || 'lanternagem-bojo')}.pdf`);
      } catch (err) {
        setPdfError(err instanceof Error ? err.message : 'Nao foi possivel gerar o PDF.');
      } finally {
        setDownloadingPdf(false);
      }
    }, 30);
  }

  function handleDownloadPng() {
    const canvas = canvasRef.current;
    if (!canvas || !colors) return;
    const filename = `${slugifyFilename(nome || 'lanternagem-bojo')}.png`;
    downloadCanvasAsPng(canvas, filename);
  }

  /** Converte um arquivo enviado (PNG/JPG ou PDF) direto na grade, no lugar de
   * desenhar do zero — fundo preto OU transparente do arquivo vira "sem
   * lanterna" automaticamente (mesma regra do preto desenhado a mao). Ainda
   * da pra editar/pintar por cima depois, igual qualquer grade criada em
   * branco. */
  async function handleImportImage(file: File) {
    if (!gomos || !lanternasPorGomo || !lanternasSubindo || exceedsLimit || importingImage) {
      return;
    }
    setImportingImage(true);
    setImportError(null);
    setError(null);
    try {
      const imageFile = await renderFileToImageFile(file);
      const rawColors = await readLanternaPixelGridFromFile(imageFile, gridSize.widthPx, gridSize.heightPx);
      const snapped = snapNearBlackToBlack(rawColors);
      setGridWidth(gridSize.widthPx);
      setGridHeight(gridSize.heightPx);
      setColors(snapped);
      setGridLanternasPorGomo(lanternasPorGomo);
      setGridGomos(gomos);
      setGridLanternasSubindo(lanternasSubindo);
      setSelectedColor(null);
      setCurrentProjectId(null);
      setSaveMsg(null);
      setSaveError(null);
      historyRef.current = [];
      setUndoCount(0);
      requestAnimationFrame(() => fitZoomToStage(gridSize.widthPx, gridSize.heightPx));
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Nao foi possivel importar o arquivo.');
    } finally {
      setImportingImage(false);
    }
  }

  function handleImageInputChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) {
      void handleImportImage(file);
    }
  }

  return (
    <div className="bandeira-workspace">
      <div className="bandeira-main-panel">
        <div className="bandeira-panel-header">
          <h2>Lanternagem de Bojo</h2>
          <p>Escolha quantos gomos o balao tem, quantas lanternas por gomo e quantas lanternas subindo — depois
            desenhe o padrao direto na grade, igual um Paint.</p>
        </div>

        {loadingProject ? (
          <div className="bandeira-upload-card">
            <p className="bandeira-size-hint">
              <Loader2 size={14} className="mold-import-spinner" /> Carregando projeto...
            </p>
          </div>
        ) : !colors ? (
          <div className="bandeira-upload-card">
            <div className="bandeira-create-panel">
              <div className="bandeira-size-fields">
                <label className="auth-field">
                  <span>Quantidade de gomos</span>
                  <input type="number" min={1} {...numericFieldProps(gomos, setGomos, 1)} placeholder="Ex: 32" />
                </label>
                <label className="auth-field">
                  <span>Lanternas por gomo</span>
                  <input type="number" min={1} {...numericFieldProps(lanternasPorGomo, setLanternasPorGomo, 1)} placeholder="Ex: 2" />
                </label>
                <label className="auth-field">
                  <span>Lanternas subindo (altura)</span>
                  <input type="number" min={1} {...numericFieldProps(lanternasSubindo, setLanternasSubindo, 1)} placeholder="Ex: 16" />
                </label>
              </div>
              <p className="bandeira-size-hint">
                A grade fica com <strong>{gridSize.widthPx} colunas</strong> ({gomos} gomos x {lanternasPorGomo}{' '}
                lanternas cada) e <strong>{gridSize.heightPx} linhas</strong> — total de{' '}
                <strong>{(gridSize.widthPx * gridSize.heightPx).toLocaleString('pt-BR')} lanternas</strong>. Uma
                linha grossa separa cada gomo, pra ficar claro o padrao que se repete ao redor do balao.
              </p>
              {exceedsLimit ? (
                <p className="mold-import-error">
                  Grade grande demais (maximo {MAX_LANTERNA_SIDE}px de lado ou {MAX_LANTERNA_CELLS} lanternas no
                  total). Reduza os valores.
                </p>
              ) : null}
              {error ? <p className="mold-import-error">{error}</p> : null}
              <button
                type="button"
                className="mold-save-button"
                onClick={handleCreateGrid}
                disabled={!gomos || !lanternasPorGomo || !lanternasSubindo || exceedsLimit || loading}
              >
                {loading ? <Loader2 size={16} className="mold-import-spinner" /> : <Grid3x3 size={16} />}
                {loading ? 'Criando...' : 'Criar grade em branco'}
              </button>

              <div className="bandeira-upload-divider">ou</div>

              <label className="auth-field">
                <span>
                  <FileImage size={14} /> Subir imagem ou PDF pra converter na grade
                </span>
                <input
                  type="file"
                  accept="image/*,application/pdf,.pdf"
                  onChange={handleImageInputChange}
                  disabled={!gomos || !lanternasPorGomo || !lanternasSubindo || exceedsLimit || importingImage}
                />
              </label>
              <p className="bandeira-hint">
                Aceita PNG, JPG ou PDF. Fundo preto ou transparente do arquivo vira automaticamente "sem lanterna" —
                so a arte aparece na grade, do mesmo jeito que desenhando a mao. Da pra editar/pintar por cima
                depois de importar.
              </p>
              {importingImage ? (
                <p className="bandeira-size-hint">
                  <Loader2 size={14} className="mold-import-spinner" /> Convertendo arquivo pra grade...
                </p>
              ) : null}
              {importError ? <p className="mold-import-error">{importError}</p> : null}
            </div>
          </div>
        ) : (
          <>
            <div className="bandeira-toolbar">
              <div className="bandeira-toolbar-group">
                <button type="button" className={tool === 'mover' ? 'active' : ''} onClick={() => setTool('mover')} title="Mover (arrastar pra navegar)">
                  <Hand size={15} />
                  Mover
                </button>
                <button type="button" className={tool === 'lapis' ? 'active' : ''} onClick={() => setTool('lapis')} title="Lapis: clique esquerdo pinta com a cor selecionada, clique direito copia a cor da lanterna">
                  <Pencil size={15} />
                  Lapis
                </button>
                <button type="button" className={tool === 'contagotas' ? 'active' : ''} onClick={() => setTool('contagotas')} title="Conta-gotas: clique numa lanterna pra selecionar a cor dela">
                  <Droplet size={15} />
                  Conta-gotas
                </button>
                <button type="button" className={tool === 'selecao' ? 'active' : ''} onClick={() => setTool('selecao')} title="Selecao: arraste pra marcar uma area, copia e cola do lado">
                  <BoxSelect size={15} />
                  Selecao
                </button>
              </div>

              {pendingPaste ? (
                <div className="bandeira-toolbar-group">
                  <button type="button" onClick={handleConfirmPaste} title="Confirmar colagem nessa posicao (Enter)">
                    <Check size={15} />
                    Confirmar (Enter)
                  </button>
                  <button type="button" onClick={handleCancelPaste} title="Cancelar colagem (Esc)">
                    <X size={15} />
                    Cancelar (Esc)
                  </button>
                  <span className="bandeira-zoom-label">Arraste ou use as setas do teclado pra posicionar</span>
                </div>
              ) : (
                <div className="bandeira-toolbar-group">
                  <button type="button" onClick={handleCopySelection} disabled={!selection} title="Copiar a area selecionada">
                    <Copy size={15} />
                    Copiar
                  </button>
                  <button type="button" onClick={handlePasteBeside} disabled={!clipboard || !selection} title="Colar 1 copia logo a direita da selecao — depois arraste ou use as setas pra posicionar exato">
                    <ClipboardPaste size={15} />
                    Colar do lado
                  </button>
                  <button type="button" onClick={handleRepeatToEnd} disabled={!clipboard || !selection} title="Repetir a copia lado a lado ate o fim da grade (ex.: preencher todos os gomos)">
                    <CopyPlus size={15} />
                    Repetir ate o fim
                  </button>
                </div>
              )}

              <div className="bandeira-toolbar-group">
                <button type="button" onClick={handleUndo} disabled={undoCount === 0} title={undoCount > 0 ? `Desfazer (${undoCount} passo${undoCount > 1 ? 's' : ''} disponivel)` : 'Nada pra desfazer'}>
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

            <div className="bandeira-actions-row">
              <button
                type="button"
                className="mold-import-button"
                onClick={() => {
                  setColors(null);
                  setGridWidth(0);
                  setGridHeight(0);
                  setCurrentProjectId(null);
                  setSaveMsg(null);
                  setSaveError(null);
                }}
              >
                Trocar grade
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
              <span>Grade (colunas x linhas)</span>
              <strong>{gridWidth} x {gridHeight}</strong>
            </div>
            <div>
              <span>Cores de lanterna</span>
              <strong>{countableColorSummary.length}</strong>
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
              Contagem
            </button>
            <button type="button" className={sidebarTab === 'exportar' ? 'active' : ''} onClick={() => setSidebarTab('exportar')}>
              Exportar
            </button>
          </div>

          {sidebarTab === 'cores' ? (
            <>
              <h3>Reduzir cores</h3>
              <div className="bandeira-reduce-row">
                <input type="number" min={2} max={countableColorSummary.length || 2} {...numericFieldProps(targetColorCount, setTargetColorCount, 2)} />
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
              <p className="bandeira-hint">Escolha qualquer cor pra desenhar ou criar a moldura abaixo.</p>

              <div className="bandeira-border-row">
                <input type="number" min={1} {...numericFieldProps(borderThickness, setBorderThickness, 1)} />
                <span>lanternas de espessura</span>
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
                    <input type="color" value={replaceTarget} onChange={(e) => setReplaceTarget(e.target.value)} />
                    <button type="button" className="mold-import-button" onClick={handleReplaceSelected}>
                      Trocar todas por essa cor
                    </button>
                  </div>
                  <p className="bandeira-hint">
                    Modo <strong>Lapis</strong>: clique esquerdo pinta com essa cor, clique direito numa outra
                    lanterna copia uma cor nova.
                  </p>
                </>
              ) : null}

              <h3>
                Tabela de cores <span className="bandeira-count-badge">{countableColorSummary.length}</span>
              </h3>
              <p className="bandeira-hint">O preto (fundo/sem lanterna) nao aparece aqui — nunca conta como cor de verdade.</p>
              <div className="bandeira-color-list">
                {countableColorSummary.map((entry) => (
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
                Cada cor da tabela recebe um numero — aparece escrito em cima das lanternas dela na grade (so em
                zoom alto o bastante pra ficar legivel).
              </p>

              <h3>
                Legenda <span className="bandeira-count-badge">{countableColorSummary.length}</span>
              </h3>
              <div className="bandeira-color-list">
                {countableColorSummary.map((entry, index) => (
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
              <h3>Formato da lanterna</h3>
              <label className="bandeira-toolbar-check">
                <input type="checkbox" checked={bolinha} onChange={(e) => setBolinha(e.target.checked)} />
                {bolinha ? <Circle size={14} /> : <Square size={14} />}
                Mostrar cada lanterna como bolinha (redonda)
              </label>
              <p className="bandeira-hint">Desmarcado, cada lanterna vira um quadrado (igual Painel/Bandeiras).</p>

              <h3>Grade fina</h3>
              <label className="bandeira-toolbar-check">
                <input type="checkbox" checked={showFineGrid} onChange={(e) => setShowFineGrid(e.target.checked)} />
                Mostrar 1 linha por lanterna
              </label>
              <label className="auth-field bandeira-grid-color-field">
                <span>Cor da grade fina</span>
                <input type="color" value={fineGridColor} onChange={(e) => setFineGridColor(e.target.value)} />
              </label>

              <h3>Linha de gomo</h3>
              <label className="bandeira-toolbar-check">
                <input type="checkbox" checked={showGomoLines} onChange={(e) => setShowGomoLines(e.target.checked)} />
                <Grid3x3 size={14} />
                Mostrar linha separando cada gomo
              </label>
              <p className="bandeira-hint">
                Linha grossa a cada <strong>{gridLanternasPorGomo} lanternas</strong> — mostra onde 1 gomo acaba e o
                proximo comeca ({gridGomos} gomos no total).
              </p>
              <label className="auth-field bandeira-grid-color-field">
                <span>Cor da linha de gomo</span>
                <input type="color" value={gomoLineColor} onChange={(e) => setGomoLineColor(e.target.value)} />
              </label>

              <h3>Linha de divisao</h3>
              <label className="bandeira-toolbar-check">
                <input type="checkbox" checked={showDivisaoLines} onChange={(e) => setShowDivisaoLines(e.target.checked)} />
                <Grid3x3 size={14} />
                Mostrar linha dividindo o balao inteiro
              </label>
              <div className="bandeira-border-row">
                <input type="number" min={1} {...numericFieldProps(divisaoCount, setDivisaoCount, 1)} />
                <span>partes iguais</span>
              </div>
              <p className="bandeira-hint">
                {gridWidth} lanternas / {divisaoCount} partes = uma linha a cada{' '}
                <strong>{divisaoInterval} lanternas</strong> — mostra pro cliente que o balao esta dividido em{' '}
                {divisaoCount}.
              </p>
              <label className="auth-field bandeira-grid-color-field">
                <span>Cor da linha de divisao</span>
                <input type="color" value={divisaoLineColor} onChange={(e) => setDivisaoLineColor(e.target.value)} />
              </label>
            </>
          ) : null}

          {sidebarTab === 'contagem' ? (
            <>
              <h3>Contagem de lanternas</h3>
              <p className="bandeira-hint">
                Quantas lanternas de cada cor voce precisa comprar/separar — o preto (fundo, sem lanterna) nunca
                entra nessa conta.
              </p>
              <div className="bandeira-info-grid">
                <div>
                  <span>Total de lanternas</span>
                  <strong>{countableColorSummary.reduce((sum, entry) => sum + entry.count, 0).toLocaleString('pt-BR')}</strong>
                </div>
                <div>
                  <span>Gomos</span>
                  <strong>{gridGomos}</strong>
                </div>
              </div>
              <div className="bandeira-color-list">
                {countableColorSummary.map((entry, index) => (
                  <div key={entry.hex} className="bandeira-color-row bandeira-number-row">
                    <span className="bandeira-number-badge">{index + 1}</span>
                    <span className="bandeira-swatch" style={{ background: entry.hex }} />
                    <span className="bandeira-color-name">{entry.name}</span>
                    <span className="bandeira-color-count">{entry.count.toLocaleString('pt-BR')} lanternas</span>
                  </div>
                ))}
              </div>
            </>
          ) : null}

          {sidebarTab === 'exportar' ? (
            <>
              <label className="auth-field">
                <span>Nome do projeto</span>
                <input type="text" value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex: Balao Santos - Lanternagem" />
              </label>

              <h3>Salvar projeto</h3>
              <p className="bandeira-hint">
                Salva como arquivo editavel em <strong>Meus Projetos → Lanternagem de Bojo</strong> (nao e imagem) —
                pode reabrir e continuar desenhando depois.
              </p>
              {saveError ? <p className="mold-import-error">{saveError}</p> : null}
              {saveMsg ? (
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  background: 'rgba(59,130,246,0.1)',
                  padding: '8px 12px',
                  borderRadius: '6px',
                  border: '1px solid rgba(59,130,246,0.3)',
                  marginBottom: '10px'
                }}>
                  <p className="bandeira-hint" style={{ margin: 0, flex: 1, padding: 0 }}>{saveMsg}</p>
                  {hasDraftLoaded && (
                    <button
                      type="button"
                      onClick={handleDiscardDraft}
                      style={{
                        background: '#e53e3e',
                        color: '#fff',
                        border: 'none',
                        padding: '4px 8px',
                        borderRadius: '4px',
                        cursor: 'pointer',
                        fontSize: '11px',
                        fontWeight: 600,
                        whiteSpace: 'nowrap'
                      }}
                    >
                      Descartar Rascunho
                    </button>
                  )}
                </div>
              ) : null}
              <button type="button" className="mold-save-button" onClick={() => void handleSaveProject()} disabled={savingProject}>
                {savingProject ? <Loader2 size={16} className="mold-import-spinner" /> : <Save size={16} />}
                {savingProject ? 'Salvando...' : currentProjectId != null ? 'Salvar alteracoes' : 'Salvar projeto'}
              </button>

              <h3>Exportar PDF</h3>
              <p className="bandeira-hint">
                Gera um PDF de referencia pra contar/montar — capa com a contagem de cores numerada, e o desenho da
                lanternagem com a linha de gomo e o numero de cada cor em cima.
              </p>
              {pdfError ? <p className="mold-import-error">{pdfError}</p> : null}
              <button type="button" className="mold-save-button" onClick={handleDownloadPdf} disabled={downloadingPdf}>
                {downloadingPdf ? <Loader2 size={16} className="mold-import-spinner" /> : <Download size={16} />}
                {downloadingPdf ? 'Gerando PDF...' : 'Baixar PDF'}
              </button>
              <button type="button" className="mold-secondary-button" onClick={handleDownloadPng}>
                <FileImage size={16} />
                Baixar Imagem (PNG)
              </button>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
