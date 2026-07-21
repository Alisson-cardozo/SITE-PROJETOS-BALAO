import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Circle, Download, Droplet, Hand, ImagePlus, Loader2, Maximize2, Palette, Pencil, Send, Square, Undo2, ZoomIn, ZoomOut } from 'lucide-react';
import { buildColorSummary, CM_POR_PIXEL, replaceColorInGrid, snapNearBlackToBlack, type BandeiraColorSummaryEntry } from '../lib/bandeiraImage';
import { reduceBandeiraPalette } from '../lib/bandeiraImage';
import { findClosestCatalogColor } from '../lib/bandeiraColors';
import { hexToRgb } from '../lib/colorMath';
import {
  computeMalhaGridSize,
  DEFAULT_MALHA_CM,
  downsampleColorGrid,
  MALHA_OPTIONS,
  malhaGridSizeExceedsLimit,
  readPainelSourceImage,
  type MalhaSize,
} from '../lib/painelImage';
import { buildPainelPdf, type PainelDisplayMode, type PainelDivisionMode } from '../lib/painelPdf';
import { downloadBlob, slugifyFilename } from '../lib/pdfExport';
import { SendPainelEmailModal } from '../components/SendPainelEmailModal';

/** Preto e tratado como "modulo apagado/fundo" — nunca entra na numeracao ou
 * na contagem de modulos (nao se compra modulo preto). */
const PAINEL_BLACK_HEX = '#000000';

/** Tamanho base (px de tela, antes do zoom) de cada celula. Grades muito
 * grandes usam um valor menor, senao o canvas passaria do limite que os
 * navegadores aceitam em zoom alto. */
const CELL_BASE_PX_DEFAULT = 10;
const MAX_CANVAS_DIMENSION_PX = 14000;
const ZOOM_MIN = 1;
const ZOOM_MAX = 400;
const ZOOM_STEP = 25;
const DEFAULT_FINE_GRID_COLOR = '#0f172a';
const BOLINHA_BG_CSS = 'rgb(8, 16, 11)';
/** Grade de divisoes: o usuario escolhe de quantos em quantos modulos entra
 * uma linha grossa (ex: 5x5) — so organizacao visual, sem relacao com
 * corte/contagem. */
const DEFAULT_DIVISION_COLS = 5;
const DEFAULT_DIVISION_ROWS = 5;
const DEFAULT_DIVISION_GRID_COLOR = '#2563eb';
/** Quantos passos o Desfazer guarda. */
const MAX_UNDO_STEPS = 3;

type Tool = 'mover' | 'lapis' | 'contagotas';
type SidebarTab = 'cores' | 'numerar' | 'grades' | 'contagem' | 'exportar';

function formatCm(value: number): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return '0';
  return n % 1 === 0 ? String(n) : n.toFixed(1).replace('.', ',');
}

function computeCellBasePx(gridWidth: number, gridHeight: number): number {
  const maxDim = Math.max(gridWidth, gridHeight, 1);
  const maxCellPxAtMaxZoom = MAX_CANVAS_DIMENSION_PX / (maxDim * (ZOOM_MAX / 100));
  return Math.max(1, Math.min(CELL_BASE_PX_DEFAULT, maxCellPxAtMaxZoom));
}

export function PainelWorkspace() {
  const [file, setFile] = useState<File | null>(null);
  const [showCreatePanel, setShowCreatePanel] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [gridWidth, setGridWidth] = useState(0);
  const [gridHeight, setGridHeight] = useState(0);
  const [colors, setColors] = useState<string[] | null>(null);
  /** false = ainda vetorizando (alta resolucao, malha nao escolhida) — true =
   * ja taqueado pra grade final de malha. */
  const [taqueado, setTaqueado] = useState(false);

  const [targetColorCount, setTargetColorCount] = useState(16);
  const [reducing, setReducing] = useState(false);

  const [selectedColor, setSelectedColor] = useState<string | null>(null);
  const [replaceTarget, setReplaceTarget] = useState('#ff0000');
  const [customColor, setCustomColor] = useState('#ff0000');
  const [borderThickness, setBorderThickness] = useState(2);

  const [tool, setTool] = useState<Tool>('mover');
  const [zoom, setZoom] = useState(100);
  const [showFineGrid, setShowFineGrid] = useState(true);
  const [fineGridColor, setFineGridColor] = useState(DEFAULT_FINE_GRID_COLOR);
  const [showDivisionGrid, setShowDivisionGrid] = useState(false);
  const [divisionCols, setDivisionCols] = useState(DEFAULT_DIVISION_COLS);
  const [divisionRows, setDivisionRows] = useState(DEFAULT_DIVISION_ROWS);
  const [divisionGridColor, setDivisionGridColor] = useState(DEFAULT_DIVISION_GRID_COLOR);
  const [displayMode, setDisplayMode] = useState<PainelDisplayMode>('quadrado');
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>('cores');
  const [showNumbers, setShowNumbers] = useState(false);

  const [malhaCm, setMalhaCm] = useState<MalhaSize>(DEFAULT_MALHA_CM);
  const [larguraCm, setLarguraCm] = useState('');
  const [alturaCm, setAlturaCm] = useState('');

  const [divisionMode, setDivisionMode] = useState<PainelDivisionMode>('inteira');
  /** Independentes do toggle de preview da aba Grades — o PDF e um guia de
   * montagem/contagem, entao as grades vem ligadas por padrao, nao dependem
   * do usuario ja ter ativado a preview em outra aba. */
  const [pdfShowFineGrid, setPdfShowFineGrid] = useState(true);
  const [pdfShowDivisionGrid, setPdfShowDivisionGrid] = useState(true);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [showEmailModal, setShowEmailModal] = useState(false);

  const [nome, setNome] = useState('');

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
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
  const workingColorsRef = useRef<string[] | null>(null);
  const paintedDuringGestureRef = useRef(false);
  const historyRef = useRef<string[][]>([]);
  const [undoCount, setUndoCount] = useState(0);
  /** Grade vetorizada (antes do taqueamento pra malha) — congelada no momento
   * do "Taquear", pra dar pra voltar e reajustar malha/tamanho sem perder o
   * trabalho de reducao/ajuste de cor feito na vetorizacao. */
  const vetorSnapshotRef = useRef<{ colors: string[]; width: number; height: number } | null>(null);

  const cellBasePx = useMemo(() => computeCellBasePx(gridWidth, gridHeight), [gridWidth, gridHeight]);

  const fineGridStrokeStyle = useMemo(() => {
    const { r, g, b } = hexToRgb(fineGridColor);
    return `rgba(${r}, ${g}, ${b}, 0.35)`;
  }, [fineGridColor]);

  useEffect(() => {
    workingColorsRef.current = colors ? colors.slice() : null;
  }, [colors]);

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

  const malhaGridSize = useMemo(
    () => computeMalhaGridSize(Number(larguraCm) || 0, Number(alturaCm) || 0, malhaCm),
    [larguraCm, alturaCm, malhaCm]
  );
  const exceedsMalhaLimit = malhaGridSizeExceedsLimit(malhaGridSize);

  /** Todas as cores da grade (inclui preto) — usada pra editar (Cores). */
  const colorSummary: BandeiraColorSummaryEntry[] = useMemo(() => (colors ? buildColorSummary(colors) : []), [colors]);
  /** Sem preto (modulo apagado/fundo nao se numera nem se conta). */
  const countableColorSummary = useMemo(() => colorSummary.filter((entry) => entry.hex.toLowerCase() !== PAINEL_BLACK_HEX), [colorSummary]);

  const colorNumberMap = useMemo(() => {
    const map = new Map<string, number>();
    countableColorSummary.forEach((entry, index) => map.set(entry.hex, index + 1));
    return map;
  }, [countableColorSummary]);

  /** Guarda a grade ATUAL na pilha de desfazer, antes da mutacao. */
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

  const handleFileChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const next = event.target.files?.[0] ?? null;
    setFile(next);
    setError(null);
    setShowCreatePanel(false);
    setLarguraCm('');
    setAlturaCm('');
  }, []);

  /** Le a imagem numa resolucao de trabalho alta (nao e a grade final ainda)
   * — malha e tamanho real ja foram escolhidos no painel "Criar projeto", a
   * partir daqui o usuario so reduz/ajusta cor antes de taquear. */
  async function handleVetorizar() {
    if (!file || !larguraCm || !alturaCm || exceedsMalhaLimit || loading) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const grid = await readPainelSourceImage(file);
      const distinctCount = buildColorSummary(grid.colors).length;
      const finalColors =
        targetColorCount > 0 && targetColorCount < distinctCount
          ? reduceBandeiraPalette(grid.colors, targetColorCount)
          : grid.colors;
      setGridWidth(grid.widthPx);
      setGridHeight(grid.heightPx);
      setColors(snapNearBlackToBlack(finalColors));
      setTaqueado(false);
      setSelectedColor(null);
      setShowCreatePanel(false);
      historyRef.current = [];
      setUndoCount(0);
      if (!nome) {
        setNome(file.name.replace(/\.[^.]+$/, ''));
      }
      requestAnimationFrame(() => fitZoomToStage(grid.widthPx, grid.heightPx));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nao foi possivel vetorizar a imagem.');
    } finally {
      setLoading(false);
    }
  }

  /** "Taquear": pixeliza a arte vetorizada (ja editada) pra grade final de
   * malha — congela a vetorizada num snapshot antes, pra dar pra voltar. */
  function handleTaquear() {
    if (!colors || !larguraCm || !alturaCm || exceedsMalhaLimit || gridWidth === 0 || gridHeight === 0) {
      return;
    }
    vetorSnapshotRef.current = { colors, width: gridWidth, height: gridHeight };
    const target = malhaGridSize;
    const final = downsampleColorGrid(colors, gridWidth, gridHeight, target.widthPx, target.heightPx);
    setGridWidth(target.widthPx);
    setGridHeight(target.heightPx);
    setColors(snapNearBlackToBlack(final));
    setTaqueado(true);
    setSelectedColor(null);
    historyRef.current = [];
    setUndoCount(0);
    requestAnimationFrame(() => fitZoomToStage(target.widthPx, target.heightPx));
  }

  /** Volta pra etapa de vetorizacao (sem perder o trabalho de cor feito la),
   * pra reajustar malha/tamanho sem taquear de novo do zero. */
  function handleVoltarParaVetorizar() {
    const snap = vetorSnapshotRef.current;
    if (!snap) {
      return;
    }
    setGridWidth(snap.width);
    setGridHeight(snap.height);
    setColors(snap.colors);
    setTaqueado(false);
    setSelectedColor(null);
    historyRef.current = [];
    setUndoCount(0);
    requestAnimationFrame(() => fitZoomToStage(snap.width, snap.height));
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

  /** Ajusta cada cor da imagem pra cor nomeada mais proxima do catalogo —
   * uniformiza tonalidades proximas antes de taquear. */
  function handleToneCorrection() {
    if (!colors) {
      return;
    }
    pushHistory(colors);
    const cache = new Map<string, string>();
    const next = colors.map((hex) => {
      let mapped = cache.get(hex);
      if (!mapped) {
        mapped = findClosestCatalogColor(hex).hex;
        cache.set(hex, mapped);
      }
      return mapped;
    });
    setColors(next);
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

  /** Pinta 1 celula direto no array de trabalho + direto no canvas (sem
   * copiar o array nem re-renderizar o React). */
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
    if (taqueado && displayMode === 'bolinha') {
      ctx.fillStyle = BOLINHA_BG_CSS;
      ctx.fillRect(x * cellPx, y * cellPx, cellPx + 0.5, cellPx + 0.5);
      if (color.toLowerCase() !== PAINEL_BLACK_HEX) {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(x * cellPx + cellPx / 2, y * cellPx + cellPx / 2, Math.max(1, cellPx * 0.32), 0, Math.PI * 2);
        ctx.fill();
      }
      return;
    }
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
    if (paintedDuringGestureRef.current && workingColorsRef.current) {
      paintedDuringGestureRef.current = false;
      pushHistory(colors);
      setColors(workingColorsRef.current.slice());
    }
  }

  // desenha a grade inteira no canvas
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

    const bolinha = taqueado && displayMode === 'bolinha';

    if (bolinha) {
      ctx.fillStyle = BOLINHA_BG_CSS;
      ctx.fillRect(0, 0, width, height);
      const radius = Math.max(1, cellPx * 0.32);
      for (let y = 0; y < gridHeight; y += 1) {
        for (let x = 0; x < gridWidth; x += 1) {
          const hex = colors[y * gridWidth + x];
          if (hex.toLowerCase() === PAINEL_BLACK_HEX) {
            continue;
          }
          ctx.fillStyle = hex;
          ctx.beginPath();
          ctx.arc(x * cellPx + cellPx / 2, y * cellPx + cellPx / 2, radius, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    } else {
      for (let y = 0; y < gridHeight; y += 1) {
        for (let x = 0; x < gridWidth; x += 1) {
          ctx.fillStyle = colors[y * gridWidth + x];
          ctx.fillRect(x * cellPx, y * cellPx, cellPx + 0.5, cellPx + 0.5);
        }
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

    if (showDivisionGrid && divisionCols > 0 && divisionRows > 0) {
      ctx.strokeStyle = divisionGridColor;
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let x = 0; x <= gridWidth; x += divisionCols) {
        ctx.moveTo(Math.round(x * cellPx), 0);
        ctx.lineTo(Math.round(x * cellPx), height);
      }
      for (let y = 0; y <= gridHeight; y += divisionRows) {
        ctx.moveTo(0, Math.round(y * cellPx));
        ctx.lineTo(width, Math.round(y * cellPx));
      }
      ctx.stroke();
    }

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
          ctx.fillStyle = bolinha ? '#f4f4f4' : luminance > 140 ? '#111111' : '#ffffff';
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
    showDivisionGrid,
    divisionCols,
    divisionRows,
    divisionGridColor,
    taqueado,
    displayMode,
    showNumbers,
    colorNumberMap,
  ]);

  /** Monta o PDF (capa com tabela numerada, sem preto + folha inteira/
   * dividida no modo quadrado ou bolinha) — usado pelo "Baixar PDF" e pelo
   * "Enviar por email". */
  function buildCurrentPdfBlob(): Blob {
    return buildPainelPdf({
      nome: nome.trim() || 'Painel',
      larguraCm: Number(larguraCm) || gridWidth * malhaCm,
      alturaCm: Number(alturaCm) || gridHeight * malhaCm,
      malhaCm,
      gridWidth,
      gridHeight,
      colors: colors ?? [],
      colorSummary: countableColorSummary,
      divisionMode,
      displayMode,
      showFineGrid: pdfShowFineGrid,
      fineGridColor,
      showDivisionGrid: pdfShowDivisionGrid,
      divisionGridColor,
      divisionCols,
      divisionRows,
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
        downloadBlob(blob, `${slugifyFilename(nome || 'painel')}.pdf`);
      } catch (err) {
        setPdfError(err instanceof Error ? err.message : 'Nao foi possivel gerar o PDF.');
      } finally {
        setDownloadingPdf(false);
      }
    }, 30);
  }

  return (
    <div className="bandeira-workspace">
      <div className="bandeira-main-panel">
        <div className="bandeira-panel-header">
          <h2>Painel — Vetorizacao e Taqueamento</h2>
          <p>Carregue uma imagem, ajuste as cores em alta resolucao, escolha a malha e taqueie o projeto.</p>
        </div>

        {!colors ? (
          <div className="bandeira-upload-card">
            <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFileChange} className="bandeira-file-input" />

            {error ? <p className="mold-import-error">{error}</p> : null}

            {file && !showCreatePanel ? (
              <button type="button" className="mold-save-button" onClick={() => setShowCreatePanel(true)}>
                <ImagePlus size={16} />
                Criar projeto
              </button>
            ) : null}

            {file && showCreatePanel ? (
              <div className="bandeira-create-panel">
                <h3>Malha</h3>
                <div className="painel-malha-switch">
                  {MALHA_OPTIONS.map((value) => (
                    <button key={value} type="button" className={malhaCm === value ? 'active' : ''} onClick={() => setMalhaCm(value)}>
                      {value}cm
                    </button>
                  ))}
                </div>

                <div className="bandeira-size-fields">
                  <label className="auth-field">
                    <span>Largura</span>
                    <input
                      type="number"
                      min={1}
                      placeholder="Obrigatorio"
                      value={larguraCm === '' ? '' : Number(larguraCm) / CM_POR_PIXEL}
                      onChange={(e) => {
                        const raw = e.target.value;
                        setLarguraCm(raw === '' ? '' : String(Math.max(1, Number(raw) || 1) * CM_POR_PIXEL));
                      }}
                    />
                  </label>
                  <label className="auth-field">
                    <span>Altura</span>
                    <input
                      type="number"
                      min={1}
                      placeholder="Obrigatorio"
                      value={alturaCm === '' ? '' : Number(alturaCm) / CM_POR_PIXEL}
                      onChange={(e) => {
                        const raw = e.target.value;
                        setAlturaCm(raw === '' ? '' : String(Math.max(1, Number(raw) || 1) * CM_POR_PIXEL));
                      }}
                    />
                  </label>
                </div>
                <p className="bandeira-size-hint">
                  Cada unidade equivale a <strong>{CM_POR_PIXEL}cm</strong> reais (1 metro = 10 unidades).
                </p>
                {larguraCm !== '' && alturaCm !== '' ? (
                  <p className="bandeira-size-hint">
                    Malha de <strong>{malhaCm}cm</strong> em <strong>{formatCm(Number(larguraCm))} x {formatCm(Number(alturaCm))} cm</strong> vira
                    uma grade de <strong>{malhaGridSize.widthPx} x {malhaGridSize.heightPx}</strong> modulos.
                  </p>
                ) : (
                  <p className="bandeira-size-hint">Informe a malha e o tamanho real antes de vetorizar.</p>
                )}
                {exceedsMalhaLimit ? <p className="mold-import-error">Grade grande demais pra essa malha. Aumente a malha ou reduza o tamanho.</p> : null}

                <label className="auth-field">
                  <span>Quantidade de cores desejada</span>
                  <input
                    type="number"
                    min={2}
                    value={targetColorCount}
                    onChange={(e) => setTargetColorCount(Math.max(2, Number(e.target.value) || 2))}
                  />
                </label>
                <p className="bandeira-hint">Da pra ajustar a quantidade de cores de novo depois de vetorizar.</p>

                <button
                  type="button"
                  className="mold-save-button"
                  onClick={() => void handleVetorizar()}
                  disabled={!larguraCm || !alturaCm || exceedsMalhaLimit || loading}
                >
                  {loading ? <Loader2 size={16} className="mold-import-spinner" /> : <Palette size={16} />}
                  {loading ? 'Vetorizando...' : 'Vetorizar imagem'}
                </button>
              </div>
            ) : null}
          </div>
        ) : (
          <>
            <div className="bandeira-toolbar">
              <div className="bandeira-toolbar-group">
                <button type="button" className={tool === 'mover' ? 'active' : ''} onClick={() => setTool('mover')} title="Mover (arrastar pra navegar)">
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

              {taqueado ? (
                <div className="bandeira-toolbar-group">
                  <button type="button" className={displayMode === 'quadrado' ? 'active' : ''} onClick={() => setDisplayMode('quadrado')} title="Amostra em pixel quadrado">
                    <Square size={15} />
                    Quadrado
                  </button>
                  <button type="button" className={displayMode === 'bolinha' ? 'active' : ''} onClick={() => setDisplayMode('bolinha')} title="Amostra em bolinha (visual de LED)">
                    <Circle size={15} />
                    Bolinha
                  </button>
                </div>
              ) : null}

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
                  setFile(null);
                  setShowCreatePanel(false);
                  setTaqueado(false);
                  vetorSnapshotRef.current = null;
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
              <span>{taqueado ? `Grade final (malha ${malhaCm}cm)` : 'Vetorizando (alta resolucao)'}</span>
              <strong>{gridWidth} x {gridHeight} px</strong>
            </div>
            <div>
              <span>Cores distintas</span>
              <strong>{countableColorSummary.length}</strong>
            </div>
          </div>
          {!taqueado ? (
            <p className="bandeira-size-hint">
              Essa e a resolucao de trabalho so pra editar as cores — nao e o tamanho final do painel. O tamanho real ({malhaCm}cm por malha) so vira grade quando voce clicar em "Taquear pra malha".
            </p>
          ) : null}

          {!taqueado ? (
            <>
              <h3>Reduzir cores</h3>
              <div className="bandeira-reduce-row">
                <input
                  type="number"
                  min={2}
                  max={countableColorSummary.length || 2}
                  value={targetColorCount}
                  onChange={(e) => setTargetColorCount(Math.max(2, Number(e.target.value) || 2))}
                />
                <button type="button" className="mold-import-button" onClick={handleReduceColors} disabled={reducing}>
                  {reducing ? <Loader2 size={15} className="mold-import-spinner" /> : null}
                  Reduzir para {targetColorCount} cores
                </button>
              </div>
              <button type="button" className="mold-import-button" onClick={handleToneCorrection}>
                Ajustar tons com a paleta nomeada
              </button>
              <p className="bandeira-hint">Uniformiza tons proximos pra cor nomeada mais parecida do catalogo.</p>

              <h3>Cor personalizada</h3>
              <div className="bandeira-custom-color-row">
                <input type="color" value={customColor} onChange={(e) => setCustomColor(e.target.value)} />
                <button type="button" className="mold-import-button" onClick={handleUseCustomColor}>
                  Usar essa cor no Lapis
                </button>
              </div>
              <p className="bandeira-hint">Escolha qualquer cor nova (nao precisa existir na imagem) pra desenhar ou criar a moldura abaixo.</p>

              <div className="bandeira-border-row">
                <input type="number" min={1} value={borderThickness} onChange={(e) => setBorderThickness(Math.max(1, Number(e.target.value) || 1))} />
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
                    <input type="color" value={replaceTarget} onChange={(e) => setReplaceTarget(e.target.value)} />
                    <button type="button" className="mold-import-button" onClick={handleReplaceSelected}>
                      Trocar todas por essa cor
                    </button>
                  </div>
                  <p className="bandeira-hint">
                    Modo <strong>Lapis</strong>: clique esquerdo pinta com essa cor, clique direito num outro pixel copia uma cor nova.
                  </p>
                </>
              ) : null}

              <h3>
                Tabela de cores <span className="bandeira-count-badge">{countableColorSummary.length}</span>
              </h3>
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

              <h3>Malha e tamanho real</h3>
              <p className="bandeira-hint">Escolha a malha e o tamanho real — depois de taquear, isso vira a grade final do painel.</p>
              <div className="painel-malha-switch">
                {MALHA_OPTIONS.map((value) => (
                  <button key={value} type="button" className={malhaCm === value ? 'active' : ''} onClick={() => setMalhaCm(value)}>
                    {value}cm
                  </button>
                ))}
              </div>
              <div className="bandeira-size-fields">
                <label className="auth-field">
                  <span>Largura</span>
                  <input
                    type="number"
                    min={1}
                    placeholder="Obrigatorio"
                    value={larguraCm === '' ? '' : Number(larguraCm) / CM_POR_PIXEL}
                    onChange={(e) => {
                      const raw = e.target.value;
                      setLarguraCm(raw === '' ? '' : String(Math.max(1, Number(raw) || 1) * CM_POR_PIXEL));
                    }}
                  />
                </label>
                <label className="auth-field">
                  <span>Altura</span>
                  <input
                    type="number"
                    min={1}
                    placeholder="Obrigatorio"
                    value={alturaCm === '' ? '' : Number(alturaCm) / CM_POR_PIXEL}
                    onChange={(e) => {
                      const raw = e.target.value;
                      setAlturaCm(raw === '' ? '' : String(Math.max(1, Number(raw) || 1) * CM_POR_PIXEL));
                    }}
                  />
                </label>
              </div>
              <p className="bandeira-hint">
                Cada unidade equivale a <strong>{CM_POR_PIXEL}cm</strong> reais (1 metro = 10 unidades).
              </p>
              {larguraCm !== '' && alturaCm !== '' ? (
                <p className="bandeira-hint">
                  Malha de <strong>{malhaCm}cm</strong> em <strong>{formatCm(Number(larguraCm))} x {formatCm(Number(alturaCm))} cm</strong> vira uma
                  grade de <strong>{malhaGridSize.widthPx} x {malhaGridSize.heightPx}</strong> modulos.
                </p>
              ) : null}
              {exceedsMalhaLimit ? <p className="mold-import-error">Grade grande demais pra essa malha. Aumente a malha ou reduza o tamanho.</p> : null}

              <button
                type="button"
                className="mold-save-button"
                onClick={handleTaquear}
                disabled={!larguraCm || !alturaCm || exceedsMalhaLimit}
              >
                <ImagePlus size={16} />
                Taquear pra malha
              </button>
            </>
          ) : (
            <>
              <button type="button" className="mold-import-button" onClick={handleVoltarParaVetorizar}>
                <ArrowLeft size={15} />
                Voltar pra vetorizacao (ajustar malha/tamanho)
              </button>

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
                    <input
                      type="number"
                      min={2}
                      max={countableColorSummary.length || 2}
                      value={targetColorCount}
                      onChange={(e) => setTargetColorCount(Math.max(2, Number(e.target.value) || 2))}
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

                  <div className="bandeira-border-row">
                    <input type="number" min={1} value={borderThickness} onChange={(e) => setBorderThickness(Math.max(1, Number(e.target.value) || 1))} />
                    <span>modulos de espessura</span>
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
                    </>
                  ) : null}

                  <h3>
                    Tabela de cores <span className="bandeira-count-badge">{countableColorSummary.length}</span>
                  </h3>
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
                    Cada cor recebe um numero (preto fica de fora, e o modulo apagado/fundo) — aparece em cima dos
                    modulos na grade, estilo pintura numerada.
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
                  <h3>Grade fina</h3>
                  <label className="bandeira-toolbar-check">
                    <input type="checkbox" checked={showFineGrid} onChange={(e) => setShowFineGrid(e.target.checked)} />
                    Mostrar 1 linha por modulo
                  </label>
                  <p className="bandeira-hint">Contorno fino em volta de cada modulo.</p>
                  <label className="auth-field bandeira-grid-color-field">
                    <span>Cor da grade fina</span>
                    <input type="color" value={fineGridColor} onChange={(e) => setFineGridColor(e.target.value)} />
                  </label>

                  <h3>Grade de divisoes</h3>
                  <label className="bandeira-toolbar-check">
                    <input type="checkbox" checked={showDivisionGrid} onChange={(e) => setShowDivisionGrid(e.target.checked)} />
                    Mostrar divisao em blocos
                  </label>
                  {showDivisionGrid ? (
                    <div className="bandeira-border-row">
                      <input
                        type="number"
                        min={1}
                        value={divisionCols}
                        onChange={(e) => setDivisionCols(Math.max(1, Number(e.target.value) || 1))}
                        title="Colunas por divisao"
                      />
                      <span>x</span>
                      <input
                        type="number"
                        min={1}
                        value={divisionRows}
                        onChange={(e) => setDivisionRows(Math.max(1, Number(e.target.value) || 1))}
                        title="Linhas por divisao"
                      />
                    </div>
                  ) : null}
                  <p className="bandeira-hint">
                    Linha grossa a cada <strong>{divisionCols} colunas</strong> e <strong>{divisionRows} linhas</strong> de modulo —
                    separa o painel em blocos, pra organizar montagem/instalacao.
                  </p>
                  <label className="auth-field bandeira-grid-color-field">
                    <span>Cor da grade de divisoes</span>
                    <input type="color" value={divisionGridColor} onChange={(e) => setDivisionGridColor(e.target.value)} />
                  </label>
                </>
              ) : null}

              {sidebarTab === 'contagem' ? (
                <>
                  <h3>Contagem de modulos</h3>
                  <p className="bandeira-hint">
                    Quantidade de modulos de malha ({malhaCm}cm) de cada cor. O preto (modulo apagado/fundo) nao
                    entra na contagem.
                  </p>
                  <div className="bandeira-color-list">
                    {countableColorSummary.map((entry) => (
                      <div key={entry.hex} className="bandeira-color-row bandeira-number-row">
                        <span className="bandeira-swatch" style={{ background: entry.hex }} />
                        <span className="bandeira-color-name">{entry.name}</span>
                        <span className="bandeira-color-count">{entry.count.toLocaleString('pt-BR')} modulos</span>
                      </div>
                    ))}
                  </div>
                  <p className="bandeira-hint">Essa tabela sai junto com a tabela de cores no PDF (aba Exportar).</p>
                </>
              ) : null}

              {sidebarTab === 'exportar' ? (
                <>
                  <h3>Exportar</h3>
                  <label className="auth-field">
                    <span>Nome do painel</span>
                    <input type="text" value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex: Painel Loja Centro" />
                  </label>

                  <h3>Amostra</h3>
                  <div className="bandeira-division-options">
                    <label className="bandeira-division-option">
                      <input type="radio" name="display-mode" checked={displayMode === 'quadrado'} onChange={() => setDisplayMode('quadrado')} />
                      Quadrado (padrao)
                    </label>
                    <label className="bandeira-division-option">
                      <input type="radio" name="display-mode" checked={displayMode === 'bolinha'} onChange={() => setDisplayMode('bolinha')} />
                      Bolinha (visual de LED)
                    </label>
                  </div>

                  <h3>Dividir folha</h3>
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
                    Mostrar contorno de cada modulo no PDF
                  </label>
                  <label className="bandeira-toolbar-check">
                    <input type="checkbox" checked={pdfShowDivisionGrid} onChange={(e) => setPdfShowDivisionGrid(e.target.checked)} />
                    Mostrar grade de divisoes no PDF ({divisionCols}x{divisionRows} modulos por bloco)
                  </label>

                  <h3>
                    Tabela de cores <span className="bandeira-count-badge">{countableColorSummary.length}</span>
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

                  {pdfError ? <p className="mold-import-error">{pdfError}</p> : null}
                  <button type="button" className="mold-save-button" onClick={handleDownloadPdf} disabled={downloadingPdf}>
                    {downloadingPdf ? <Loader2 size={16} className="mold-import-spinner" /> : <Download size={16} />}
                    {downloadingPdf ? 'Gerando PDF...' : 'Baixar PDF'}
                  </button>
                  <button type="button" className="mold-secondary-button" onClick={() => setShowEmailModal(true)}>
                    <Send size={16} />
                    Enviar por email
                  </button>
                </>
              ) : null}
            </>
          )}
        </div>
      ) : null}

      {showEmailModal ? (
        <SendPainelEmailModal
          nome={nome.trim() || 'Painel'}
          larguraCm={Number(larguraCm) || gridWidth * malhaCm}
          alturaCm={Number(alturaCm) || gridHeight * malhaCm}
          coresDistintas={countableColorSummary.length}
          buildPdfBlob={buildCurrentPdfBlob}
          onClose={() => setShowEmailModal(false)}
        />
      ) : null}
    </div>
  );
}
