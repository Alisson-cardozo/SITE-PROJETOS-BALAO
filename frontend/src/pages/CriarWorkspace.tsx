import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Circle,
  Cloud,
  CloudOff,
  Download,
  Droplets,
  Eraser,
  FlipHorizontal2,
  Hand,
  ImagePlus,
  Loader2,
  Minus,
  MousePointer2,
  PaintBucket,
  Pencil,
  Redo2,
  Save,
  Square,
  Trash2,
  Triangle,
  Type,
  Undo2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import {
  isLocalDraftNewer,
  loadRiscadoLocalDraft,
  saveRiscadoLocalDraft,
} from '../lib/riscadoAutosave';
import type { MoldLineColors, MoldMaskData, RiscadoProject, RiscadoProjectState } from '../types';

const DEFAULT_LINE_COLORS: MoldLineColors = {
  gomo: '#1a5276',
  guide: '#c0392b',
  equator: '#f1c40f',
  mouth: '#e67e22',
  outline: '#111111',
};

type Tool =
  | 'select'
  | 'pan'
  | 'brush'
  | 'eraser'
  | 'line'
  | 'rect'
  | 'ellipse'
  | 'triangle'
  | 'text'
  | 'fill'
  | 'eyedropper';

type Point = { x: number; y: number };

type StrokeObj = {
  id: string;
  kind: 'stroke';
  points: Point[];
  color: string;
  width: number;
  opacity: number;
  erase?: boolean;
};

type ShapeObj = {
  id: string;
  kind: 'line' | 'rect' | 'ellipse' | 'triangle';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  stroke: string;
  fill: string;
  width: number;
  opacity: number;
  filled: boolean;
};

type ImageObj = {
  id: string;
  kind: 'image';
  src: string;
  x: number;
  y: number;
  w: number;
  h: number;
  opacity: number;
  /** Nome do arquivo (ex: molde-gk1.png) — aparece na lista de Arquivos */
  name?: string;
  /** mold = veio do Lek; upload = botao Imagens */
  fileKind?: 'mold' | 'upload';
  /**
   * Imagens de overlay: so aparecem DENTRO do cone e wrap L↔R
   * (o que sai na esquerda reaparece na direita).
   */
  wrapOnMold?: boolean;
};

type TextObj = {
  id: string;
  kind: 'text';
  text: string;
  x: number;
  y: number;
  size: number;
  color: string;
  opacity: number;
};

type CanvasObj = StrokeObj | ShapeObj | ImageObj | TextObj;

const CANVAS_W = 1600;
const CANVAS_H = 1100;
const MAX_HISTORY = 40;
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 3;

function uid() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}

function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full, 16);
  if (!Number.isFinite(n)) return `rgba(0,0,0,${alpha})`;
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}

function hitTest(obj: CanvasObj, p: Point): boolean {
  if (obj.kind === 'stroke') {
    for (const pt of obj.points) {
      const d = Math.hypot(pt.x - p.x, pt.y - p.y);
      if (d <= Math.max(obj.width, 8)) return true;
    }
    return false;
  }
  if (obj.kind === 'image') {
    return p.x >= obj.x && p.x <= obj.x + obj.w && p.y >= obj.y && p.y <= obj.y + obj.h;
  }
  if (obj.kind === 'text') {
    const w = obj.text.length * obj.size * 0.55;
    const h = obj.size * 1.2;
    return p.x >= obj.x && p.x <= obj.x + w && p.y >= obj.y - h && p.y <= obj.y;
  }
  const minX = Math.min(obj.x1, obj.x2);
  const maxX = Math.max(obj.x1, obj.x2);
  const minY = Math.min(obj.y1, obj.y2);
  const maxY = Math.max(obj.y1, obj.y2);
  const pad = Math.max(obj.width, 6);
  return p.x >= minX - pad && p.x <= maxX + pad && p.y >= minY - pad && p.y <= maxY + pad;
}

function drawShape(ctx: CanvasRenderingContext2D, obj: ShapeObj) {
  ctx.save();
  ctx.globalAlpha = obj.opacity;
  ctx.strokeStyle = obj.stroke;
  ctx.fillStyle = obj.fill;
  ctx.lineWidth = obj.width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  if (obj.kind === 'line') {
    ctx.beginPath();
    ctx.moveTo(obj.x1, obj.y1);
    ctx.lineTo(obj.x2, obj.y2);
    ctx.stroke();
  } else if (obj.kind === 'rect') {
    const x = Math.min(obj.x1, obj.x2);
    const y = Math.min(obj.y1, obj.y2);
    const w = Math.abs(obj.x2 - obj.x1);
    const h = Math.abs(obj.y2 - obj.y1);
    if (obj.filled) ctx.fillRect(x, y, w, h);
    ctx.strokeRect(x, y, w, h);
  } else if (obj.kind === 'ellipse') {
    const cx = (obj.x1 + obj.x2) / 2;
    const cy = (obj.y1 + obj.y2) / 2;
    const rx = Math.abs(obj.x2 - obj.x1) / 2;
    const ry = Math.abs(obj.y2 - obj.y1) / 2;
    ctx.beginPath();
    ctx.ellipse(cx, cy, Math.max(rx, 0.5), Math.max(ry, 0.5), 0, 0, Math.PI * 2);
    if (obj.filled) ctx.fill();
    ctx.stroke();
  } else if (obj.kind === 'triangle') {
    const midX = (obj.x1 + obj.x2) / 2;
    ctx.beginPath();
    ctx.moveTo(midX, obj.y1);
    ctx.lineTo(obj.x2, obj.y2);
    ctx.lineTo(obj.x1, obj.y2);
    ctx.closePath();
    if (obj.filled) ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

function drawStroke(ctx: CanvasRenderingContext2D, obj: StrokeObj) {
  if (obj.points.length < 2) return;
  ctx.save();
  if (obj.erase) {
    ctx.globalCompositeOperation = 'destination-out';
    ctx.strokeStyle = 'rgba(0,0,0,1)';
  } else {
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = hexToRgba(obj.color, obj.opacity);
  }
  ctx.lineWidth = obj.width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(obj.points[0].x, obj.points[0].y);
  for (let i = 1; i < obj.points.length; i++) {
    ctx.lineTo(obj.points[i].x, obj.points[i].y);
  }
  ctx.stroke();
  ctx.restore();
}

const imageCache = new Map<string, HTMLImageElement>();

function getCachedImage(src: string): HTMLImageElement | null {
  const cached = imageCache.get(src);
  if (cached?.complete) return cached;
  if (!cached) {
    const img = new Image();
    img.src = src;
    imageCache.set(src, img);
  }
  return null;
}

/** Mapeia ponto cm do export do Lek → canvas, usando o arquivo molde no papel. */
function worldToCanvas(
  wx: number,
  wy: number,
  mold: ImageObj,
  mask: MoldMaskData
): { x: number; y: number } {
  const ew = Math.max(mask.export_w, 0.0001);
  const eh = Math.max(mask.export_h, 0.0001);
  return {
    x: mold.x + ((wx - mask.export_min_x) / ew) * mold.w,
    y: mold.y + ((wy - mask.export_min_y) / eh) * mold.h,
  };
}

/**
 * Silhueta CONTINUA do molde (um poligono so) — evita furo no equador.
 * Prefere silhouette precomputada no export do Lek.
 */
function buildMoldSilhouettePath(mold: ImageObj, mask: MoldMaskData): Path2D | null {
  const sil = mask.silhouette;
  if (sil?.left?.length && sil?.right?.length && sil.left.length >= 3) {
    const path = new Path2D();
    const l0 = worldToCanvas(sil.left[0][0], sil.left[0][1], mold, mask);
    path.moveTo(l0.x, l0.y);
    for (let i = 1; i < sil.left.length; i++) {
      const p = worldToCanvas(sil.left[i][0], sil.left[i][1], mold, mask);
      path.lineTo(p.x, p.y);
    }
    for (let i = sil.right.length - 1; i >= 0; i--) {
      const p = worldToCanvas(sil.right[i][0], sil.right[i][1], mold, mask);
      path.lineTo(p.x, p.y);
    }
    path.closePath();
    return path;
  }

  if (!mask.paths?.length) return null;
  const y0 = mask.content_min_y;
  const y1 = mask.content_max_y;
  if (!Number.isFinite(y0) || !Number.isFinite(y1) || y1 - y0 < 0.5) return null;

  const samples = 200;
  const padCm = 0.4;
  const left: Point[] = [];
  const right: Point[] = [];
  const rawL: Array<Point | null> = [];
  const rawR: Array<Point | null> = [];

  for (let i = 0; i <= samples; i++) {
    const y = y0 + ((y1 - y0) * i) / samples;
    let minX = Infinity;
    let maxX = -Infinity;
    for (const poly of mask.paths) {
      if (!poly || poly.length < 2) continue;
      for (let j = 0; j < poly.length; j++) {
        const a = poly[j];
        const b = poly[(j + 1) % poly.length];
        const yA = a[1];
        const yB = b[1];
        if ((yA <= y && yB >= y) || (yB <= y && yA >= y)) {
          const dy = yB - yA;
          if (Math.abs(dy) < 1e-9) {
            minX = Math.min(minX, a[0], b[0]);
            maxX = Math.max(maxX, a[0], b[0]);
          } else {
            const u = (y - yA) / dy;
            if (u >= -1e-6 && u <= 1 + 1e-6) {
              const x = a[0] + u * (b[0] - a[0]);
              minX = Math.min(minX, x);
              maxX = Math.max(maxX, x);
            }
          }
        }
      }
    }
    if (Number.isFinite(minX) && Number.isFinite(maxX) && maxX >= minX) {
      rawL.push(worldToCanvas(minX - padCm, y, mold, mask));
      rawR.push(worldToCanvas(maxX + padCm, y, mold, mask));
    } else {
      rawL.push(null);
      rawR.push(null);
    }
  }

  // preenche buracos (equador)
  const fill = (arr: Array<Point | null>, out: Point[]) => {
    for (let i = 0; i < arr.length; i++) {
      if (arr[i]) {
        out.push(arr[i]!);
        continue;
      }
      let p = i - 1;
      let n = i + 1;
      while (p >= 0 && !arr[p]) p--;
      while (n < arr.length && !arr[n]) n++;
      if (p >= 0 && n < arr.length) {
        const t = (i - p) / (n - p);
        out.push({
          x: arr[p]!.x + (arr[n]!.x - arr[p]!.x) * t,
          y: arr[p]!.y + (arr[n]!.y - arr[p]!.y) * t,
        });
      } else if (p >= 0) out.push({ ...arr[p]! });
      else if (n < arr.length) out.push({ ...arr[n]! });
    }
  };
  fill(rawL, left);
  fill(rawR, right);
  if (left.length < 3) return null;

  const path = new Path2D();
  path.moveTo(left[0].x, left[0].y);
  for (let i = 1; i < left.length; i++) path.lineTo(left[i].x, left[i].y);
  for (let i = right.length - 1; i >= 0; i--) path.lineTo(right[i].x, right[i].y);
  path.closePath();
  return path;
}

function drawSegCm(
  ctx: CanvasRenderingContext2D,
  mold: ImageObj,
  mask: MoldMaskData,
  a: number[],
  b: number[],
  color: string,
  width: number,
  dash?: number[]
) {
  const p1 = worldToCanvas(a[0], a[1], mold, mask);
  const p2 = worldToCanvas(b[0], b[1], mold, mask);
  ctx.beginPath();
  ctx.moveTo(p1.x, p1.y);
  ctx.lineTo(p2.x, p2.y);
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.setLineDash(dash || []);
  ctx.stroke();
  ctx.setLineDash([]);
}

/** Linhas do molde POR CIMA da arte (gomos, guias, equador, boca). */
function drawMoldLinesOnTop(
  ctx: CanvasRenderingContext2D,
  mold: ImageObj,
  mask: MoldMaskData,
  colors: MoldLineColors
) {
  ctx.save();
  // contorno silhueta
  const sil = buildMoldSilhouettePath(mold, mask);
  if (sil) {
    ctx.strokeStyle = colors.outline;
    ctx.lineWidth = 1.6;
    ctx.stroke(sil);
  }

  // estacoes (perfil)
  (mask.stations || []).forEach((seg) => {
    if (seg?.length >= 2) drawSegCm(ctx, mold, mask, seg[0], seg[1], colors.gomo, 0.7, [3, 3]);
  });

  // costuras / divisao de gomos
  (mask.seams || []).forEach((seg) => {
    if (seg?.length >= 2) drawSegCm(ctx, mold, mask, seg[0], seg[1], colors.gomo, 1.1, [5, 4]);
  });

  // guias / grade
  (mask.guides || []).forEach((seg) => {
    if (seg?.length >= 2) drawSegCm(ctx, mold, mask, seg[0], seg[1], colors.guide, 1.4);
  });

  // equador
  if (mask.equator_y != null && Number.isFinite(mask.equator_y)) {
    const y = mask.equator_y;
    drawSegCm(
      ctx,
      mold,
      mask,
      [mask.content_min_x, y],
      [mask.content_max_x, y],
      colors.equator,
      2
    );
  }

  // boca
  (mask.mouth_edges || []).forEach((seg) => {
    if (seg?.length >= 2) drawSegCm(ctx, mold, mask, seg[0], seg[1], colors.mouth, 2.2);
  });

  // label BOCA
  if (mask.mouth_edges?.length || (mask.equator_y != null && mask.content_max_y > (mask.equator_y || 0))) {
    const mid = worldToCanvas(
      (mask.content_min_x + mask.content_max_x) / 2,
      mask.content_max_y + 3.5,
      mold,
      mask
    );
    ctx.fillStyle = colors.mouth;
    ctx.font = '700 13px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('BOCA', mid.x, mid.y);
    ctx.textAlign = 'start';
  }

  ctx.restore();
}

/** Largura maxima do conteudo do molde em px de canvas — periodo do wrap L↔R. */
function moldWrapPeriodX(mold: ImageObj, mask: MoldMaskData): number {
  const ew = Math.max(mask.export_w, 0.0001);
  const contentW = Math.max(mask.content_max_x - mask.content_min_x, 1);
  return (contentW / ew) * mold.w;
}

/**
 * Contorno EXATO do molde pro recorte da arte — cada poligono real
 * (mask.paths) vira um subpath do mesmo Path2D. Ao contrario da silhueta
 * aproximada (buildMoldSilhouettePath, que estima min/max X por linha e
 * pode "colar" vazios como se fossem molde), isto nunca deixa a arte
 * vazar pra fora do molde real.
 */
function buildMoldClipPath(mold: ImageObj, mask: MoldMaskData): Path2D | null {
  if (!mask.paths?.length) return null;
  const clip = new Path2D();
  let any = false;
  for (const poly of mask.paths) {
    if (!poly || poly.length < 3) continue;
    const p0 = worldToCanvas(poly[0][0], poly[0][1], mold, mask);
    clip.moveTo(p0.x, p0.y);
    for (let i = 1; i < poly.length; i++) {
      const p = worldToCanvas(poly[i][0], poly[i][1], mold, mask);
      clip.lineTo(p.x, p.y);
    }
    clip.closePath();
    any = true;
  }
  return any ? clip : null;
}

/**
 * Desenha imagem recortada no cone + wrap horizontal:
 * o pedaco que sai pela esquerda reaparece na direita (e vice-versa),
 * colado na borda do molde — sem perder a arte.
 */
function drawImageClippedWrapped(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  obj: ImageObj,
  mold: ImageObj,
  mask: MoldMaskData
) {
  const clip = buildMoldClipPath(mold, mask);
  const period = moldWrapPeriodX(mold, mask);
  if (!clip || period < 2) {
    ctx.drawImage(img, obj.x, obj.y, obj.w, obj.h);
    return;
  }

  const moldLeft =
    mold.x + ((mask.content_min_x - mask.export_min_x) / Math.max(mask.export_w, 0.0001)) * mold.w;
  const moldRight =
    mold.x + ((mask.content_max_x - mask.export_min_x) / Math.max(mask.export_w, 0.0001)) * mold.w;
  const baseX = obj.x;
  // copias suficientes pra cobrir o molde inteiro + wrap L/R
  const kMin = Math.floor((moldLeft - obj.w - baseX) / period) - 1;
  const kMax = Math.ceil((moldRight + obj.w - baseX) / period) + 1;

  ctx.save();
  ctx.clip(clip);
  for (let k = kMin; k <= kMax; k++) {
    ctx.drawImage(img, baseX + k * period, obj.y, obj.w, obj.h);
  }
  ctx.restore();
}

function drawObject(
  ctx: CanvasRenderingContext2D,
  obj: CanvasObj,
  moldCtx?: { mold: ImageObj; mask: MoldMaskData } | null
) {
  if (obj.kind === 'stroke') {
    drawStroke(ctx, obj);
    return;
  }
  if (obj.kind === 'image') {
    const img = getCachedImage(obj.src);
    ctx.save();
    ctx.globalAlpha = obj.opacity;

    const isOverlay = obj.fileKind !== 'mold' && obj.wrapOnMold !== false;
    const canClip = isOverlay && !!moldCtx?.mask && !!moldCtx.mold;

    if (img && canClip) {
      drawImageClippedWrapped(ctx, img, obj, moldCtx!.mold, moldCtx!.mask);
      ctx.restore();
      return;
    }

    if (img) {
      ctx.drawImage(img, obj.x, obj.y, obj.w, obj.h);
    } else {
      ctx.fillStyle = 'rgba(100,120,160,0.25)';
      ctx.fillRect(obj.x, obj.y, obj.w, obj.h);
      ctx.strokeStyle = 'rgba(150,180,220,0.5)';
      ctx.strokeRect(obj.x, obj.y, obj.w, obj.h);
    }
    ctx.restore();
    return;
  }
  if (obj.kind === 'text') {
    ctx.save();
    ctx.globalAlpha = obj.opacity;
    if (moldCtx?.mask && moldCtx.mold) {
      const clip = buildMoldSilhouettePath(moldCtx.mold, moldCtx.mask);
      const period = moldWrapPeriodX(moldCtx.mold, moldCtx.mask);
      if (clip && period > 1) {
        ctx.clip(clip);
        ctx.fillStyle = obj.color;
        ctx.font = `600 ${obj.size}px "Segoe UI", system-ui, sans-serif`;
        for (let k = -3; k <= 3; k++) {
          ctx.fillText(obj.text, obj.x + k * period, obj.y);
        }
        ctx.restore();
        return;
      }
    }
    ctx.fillStyle = obj.color;
    ctx.font = `600 ${obj.size}px "Segoe UI", system-ui, sans-serif`;
    ctx.fillText(obj.text, obj.x, obj.y);
    ctx.restore();
    return;
  }
  drawShape(ctx, obj);
}

function floodFill(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  fillColor: string,
  tolerance = 28
) {
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  if (ix < 0 || iy < 0 || ix >= w || iy >= h) return;

  const image = ctx.getImageData(0, 0, w, h);
  const data = image.data;
  const idx = (iy * w + ix) * 4;
  const tr = data[idx];
  const tg = data[idx + 1];
  const tb = data[idx + 2];
  const ta = data[idx + 3];

  const m = fillColor.match(/^#?([0-9a-f]{6})$/i);
  if (!m) return;
  const fr = parseInt(m[1].slice(0, 2), 16);
  const fg = parseInt(m[1].slice(2, 4), 16);
  const fb = parseInt(m[1].slice(4, 6), 16);
  if (Math.abs(tr - fr) + Math.abs(tg - fg) + Math.abs(tb - fb) < 8 && ta > 200) return;

  const match = (i: number) => {
    const dr = Math.abs(data[i] - tr);
    const dg = Math.abs(data[i + 1] - tg);
    const db = Math.abs(data[i + 2] - tb);
    const da = Math.abs(data[i + 3] - ta);
    return dr + dg + db + da <= tolerance * 4;
  };

  const stack = [ix, iy];
  const seen = new Uint8Array(w * h);
  while (stack.length) {
    const cy = stack.pop()!;
    const cx = stack.pop()!;
    if (cx < 0 || cy < 0 || cx >= w || cy >= h) continue;
    const p = cy * w + cx;
    if (seen[p]) continue;
    const i = p * 4;
    if (!match(i)) continue;
    seen[p] = 1;
    data[i] = fr;
    data[i + 1] = fg;
    data[i + 2] = fb;
    data[i + 3] = 255;
    stack.push(cx + 1, cy, cx - 1, cy, cx, cy + 1, cx, cy - 1);
  }
  ctx.putImageData(image, 0, 0);
}

const TOOLS: Array<{ id: Tool; label: string; icon: typeof Pencil }> = [
  { id: 'select', label: 'Selecionar / mover', icon: MousePointer2 },
  { id: 'pan', label: 'Mover tela', icon: Hand },
  { id: 'brush', label: 'Pincel', icon: Pencil },
  { id: 'eraser', label: 'Borracha', icon: Eraser },
  { id: 'line', label: 'Linha', icon: Minus },
  { id: 'rect', label: 'Retangulo', icon: Square },
  { id: 'ellipse', label: 'Circulo / elipse', icon: Circle },
  { id: 'triangle', label: 'Triangulo', icon: Triangle },
  { id: 'text', label: 'Texto', icon: Type },
  { id: 'fill', label: 'Preencher', icon: PaintBucket },
  { id: 'eyedropper', label: 'Conta-gotas', icon: Droplets },
];

const PRESET_COLORS = [
  '#111111',
  '#ffffff',
  '#e11d48',
  '#f59e0b',
  '#eab308',
  '#22c55e',
  '#14b8a6',
  '#3b82f6',
  '#8b5cf6',
  '#ec4899',
  '#78716c',
  '#0ea5e9',
];


function isCanvasObj(value: unknown): value is CanvasObj {
  if (!value || typeof value !== 'object') return false;
  const k = (value as { kind?: string }).kind;
  return k === 'stroke' || k === 'line' || k === 'rect' || k === 'ellipse' || k === 'triangle' || k === 'image' || k === 'text';
}

interface CriarWorkspaceProps {
  project?: RiscadoProject | null;
  onProjectUpdated?: (project: RiscadoProject) => void;
}

export function CriarWorkspace({ project = null, onProjectUpdated }: CriarWorkspaceProps) {
  const { token } = useAuth();
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [objects, setObjects] = useState<CanvasObj[]>([]);
  const [history, setHistory] = useState<CanvasObj[][]>([[]]);
  const [historyIndex, setHistoryIndex] = useState(0);

  const [tool, setTool] = useState<Tool>('brush');
  const [color, setColor] = useState('#111111');
  const [fillColor, setFillColor] = useState('#3b82f6');
  const [brushSize, setBrushSize] = useState(6);
  const [opacity, setOpacity] = useState(1);
  const [filled, setFilled] = useState(false);
  const [textSize, setTextSize] = useState(28);
  const [bgColor, setBgColor] = useState('#f4f4f5');
  const [showGrid, setShowGrid] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [zoom, setZoom] = useState(0.7);
  const [pan, setPan] = useState({ x: 40, y: 40 });

  const [saveStatus, setSaveStatus] = useState<'idle' | 'pending' | 'saving' | 'saved' | 'error'>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [loadedProjectId, setLoadedProjectId] = useState<number | null>(null);
  /** Mascara do cone (cm) — recorte e wrap das imagens de overlay. */
  const [moldMask, setMoldMask] = useState<MoldMaskData | null>(null);
  const [lineColors, setLineColors] = useState<MoldLineColors>({ ...DEFAULT_LINE_COLORS });
  const [showMoldLines, setShowMoldLines] = useState(true);

  const drawingRef = useRef(false);
  const panStartRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const dragObjRef = useRef<{ id: string; ox: number; oy: number; start: Point } | null>(null);
  /** Redimensionar arquivo pelas alcas (cantos). */
  const resizeRef = useRef<{
    id: string;
    corner: 'nw' | 'ne' | 'sw' | 'se';
    start: Point;
    orig: { x: number; y: number; w: number; h: number };
  } | null>(null);
  const draftRef = useRef<CanvasObj | null>(null);
  const [, setTick] = useState(0);
  const force = () => setTick((t) => t + 1);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const panRef = useRef(pan);
  panRef.current = pan;

  const objectsRef = useRef<CanvasObj[]>([]);
  objectsRef.current = objects;
  const historyRef = useRef<CanvasObj[][]>([[]]);
  historyRef.current = history;
  const historyIndexRef = useRef(0);
  historyIndexRef.current = historyIndex;
  const bgColorRef = useRef(bgColor);
  bgColorRef.current = bgColor;
  const showGridRef = useRef(showGrid);
  showGridRef.current = showGrid;
  const projectRef = useRef(project);
  projectRef.current = project;
  const skipNextAutosave = useRef(false);

  const moldMaskRef = useRef<MoldMaskData | null>(null);
  moldMaskRef.current = moldMask;
  const lineColorsRef = useRef(lineColors);
  lineColorsRef.current = lineColors;
  const showMoldLinesRef = useRef(showMoldLines);
  showMoldLinesRef.current = showMoldLines;

  const buildState = useCallback((): RiscadoProjectState => {
    const base = projectRef.current?.state ?? {};
    return {
      ...base,
      lek: base.lek || {},
      snapshot_svg: typeof base.snapshot_svg === 'string' ? base.snapshot_svg : '',
      mold_mask: moldMaskRef.current ?? (base.mold_mask as MoldMaskData | null) ?? null,
      canvas: {
        objects: objectsRef.current,
        bgColor: bgColorRef.current,
        showGrid: showGridRef.current,
        line_colors: lineColorsRef.current,
        show_mold_lines: showMoldLinesRef.current,
      },
    };
  }, []);

  const persistLocal = useCallback(() => {
    const p = projectRef.current;
    if (!p) return;
    saveRiscadoLocalDraft({
      projectId: p.id,
      updatedAt: new Date().toISOString(),
      nome: p.nome,
      modelo_key: p.modelo_key,
      modelo_nome: p.modelo_nome,
      altura_cm: p.altura_cm,
      quantidade_gomos: p.quantidade_gomos,
      bainha_cm: p.bainha_cm,
      state: buildState(),
    });
  }, [buildState]);

  const persistServer = useCallback(async () => {
    const p = projectRef.current;
    if (!p || !token || !p.can_edit) return;
    setSaveStatus('saving');
    setSaveError(null);
    try {
      const state = buildState();
      // local first — se o PC desligar no meio, ainda tem o passo
      persistLocal();
      const res = await api.updateRiscadoProject(p.id, { state }, token);
      projectRef.current = res.data;
      onProjectUpdated?.(res.data);
      persistLocal();
      setSaveStatus('saved');
    } catch (err) {
      setSaveStatus('error');
      setSaveError(err instanceof ApiError ? err.message : 'Falha ao salvar no servidor (copia local ok).');
      persistLocal();
    }
  }, [token, buildState, persistLocal, onProjectUpdated]);

  // Grava local (navegador) a cada mudanca — sobrevive a refresh/fechar a
  // pagina. NAO envia ao servidor sozinho: isso so acontece quando o usuario
  // clica "Salvar agora" (evita disparar uma request nova a cada pincelada).
  const scheduleAutosave = useCallback(() => {
    if (!projectRef.current) return;
    if (skipNextAutosave.current) {
      skipNextAutosave.current = false;
      return;
    }
    persistLocal();
    setSaveStatus('pending');
  }, [persistLocal]);

  const pushHistory = useCallback((next: CanvasObj[]) => {
    const idx = historyIndexRef.current;
    const sliced = historyRef.current.slice(0, idx + 1);
    sliced.push(next);
    if (sliced.length > MAX_HISTORY) sliced.shift();
    const newIdx = sliced.length - 1;
    historyRef.current = sliced;
    historyIndexRef.current = newIdx;
    objectsRef.current = next;
    setHistory(sliced);
    setHistoryIndex(newIdx);
    setObjects(next);
    scheduleAutosave();
  }, [scheduleAutosave]);

  const undo = () => {
    if (historyIndexRef.current <= 0) return;
    const i = historyIndexRef.current - 1;
    historyIndexRef.current = i;
    setHistoryIndex(i);
    const snap = historyRef.current[i] ?? [];
    objectsRef.current = snap;
    setObjects(snap);
    setSelectedId(null);
    scheduleAutosave();
  };

  const redo = () => {
    if (historyIndexRef.current >= historyRef.current.length - 1) return;
    const i = historyIndexRef.current + 1;
    historyIndexRef.current = i;
    setHistoryIndex(i);
    const snap = historyRef.current[i] ?? [];
    objectsRef.current = snap;
    setObjects(snap);
    setSelectedId(null);
    scheduleAutosave();
  };

  // Carrega projeto (servidor + draft local mais novo se existir)
  useEffect(() => {
    if (!project) {
      setLoadedProjectId(null);
      return;
    }
    if (loadedProjectId === project.id) return;

    skipNextAutosave.current = true;
    const local = loadRiscadoLocalDraft(project.id);
    const useLocal = local && isLocalDraftNewer(local.updatedAt, project.updated_at);
    const state = useLocal ? local!.state : project.state;
    const canvas = (state?.canvas ?? {}) as {
      objects?: unknown[];
      bgColor?: string;
      showGrid?: boolean;
      line_colors?: MoldLineColors;
      show_mold_lines?: boolean;
    };
    let objs = Array.isArray(canvas.objects) ? canvas.objects.filter(isCanvasObj) : [];

    // Descarta "print" feio da tela cinza do Lek e troca pelo PNG de arquivo limpo
    const isUglyScreenShot = (src: string) =>
      src.includes('c8c8c8') || (src.startsWith('data:image/svg+xml') && src.includes('c8c8c8'));
    const hasUgly = objs.some((o) => o.kind === 'image' && isUglyScreenShot(o.src));
    const cleanPng =
      typeof state?.mold_image_png === 'string' && state.mold_image_png.startsWith('data:image')
        ? state.mold_image_png
        : typeof project.state?.mold_image_png === 'string' && project.state.mold_image_png.startsWith('data:image')
          ? project.state.mold_image_png
          : null;
    if (hasUgly && cleanPng) {
      objs = objs
        .filter((o) => !(o.kind === 'image' && isUglyScreenShot(o.src)))
        .concat([
          {
            id: `mold-file-fix-${Date.now().toString(36)}`,
            kind: 'image' as const,
            src: cleanPng,
            x: 250,
            y: 80,
            w: 700,
            h: 900,
            opacity: 1,
            name: (state?.mold_image_filename as string) || project.nome + '.png',
            fileKind: 'mold' as const,
          },
        ]);
    } else if (hasUgly && !cleanPng) {
      // remove só o cinza; usuario precisa "Usar lek" de novo pro arquivo limpo
      objs = objs.filter((o) => !(o.kind === 'image' && isUglyScreenShot(o.src)));
    }
    objectsRef.current = objs;
    historyRef.current = [objs];
    historyIndexRef.current = 0;
    setObjects(objs);
    setHistory([objs]);
    setHistoryIndex(0);
    if (typeof canvas.bgColor === 'string') setBgColor(canvas.bgColor);
    if (typeof canvas.showGrid === 'boolean') setShowGrid(canvas.showGrid);
    if (canvas.line_colors) setLineColors({ ...DEFAULT_LINE_COLORS, ...canvas.line_colors });
    if (typeof canvas.show_mold_lines === 'boolean') setShowMoldLines(canvas.show_mold_lines);
    setLoadedProjectId(project.id);
    setSaveStatus(useLocal ? 'pending' : 'saved');

    const maskFromState =
      (state?.mold_mask as MoldMaskData | undefined) ||
      (project.state?.mold_mask as MoldMaskData | undefined) ||
      null;
    setMoldMask(maskFromState && Array.isArray(maskFromState.paths) ? maskFromState : null);

    // Enquadra o molde; seleciona overlay se houver (pra poder mexer na imagem logo)
    const mold = objs.find(
      (o): o is ImageObj => o.kind === 'image' && (o.fileKind === 'mold' || (!!o.name && /molde|diamante|gomo|cone/i.test(o.name)))
    );
    const overlays = objs.filter((o): o is ImageObj => o.kind === 'image' && o.fileKind !== 'mold');
    const focus = mold || overlays[0] || null;
    setTool('select');
    if (overlays.length) {
      setSelectedId(overlays[overlays.length - 1].id);
    } else if (mold) {
      setSelectedId(mold.id);
    } else {
      setSelectedId(null);
    }
    if (focus) {
      const pad = 40;
      const fit = Math.min(
        (viewportRef.current?.clientWidth ?? 900) / (focus.w + pad * 2),
        (viewportRef.current?.clientHeight ?? 600) / (focus.h + pad * 2),
        1.2
      );
      const z = clamp(fit, ZOOM_MIN, ZOOM_MAX);
      setZoom(z);
      setPan({
        x: Math.max(16, ((viewportRef.current?.clientWidth ?? 900) - focus.w * z) / 2 - focus.x * z),
        y: Math.max(16, ((viewportRef.current?.clientHeight ?? 600) - focus.h * z) / 2 - focus.y * z),
      });
    }

  }, [project, loadedProjectId]);

  // Autosave ao mudar fundo/grade/cores das linhas (nao no load inicial)
  const bgGridReady = useRef(false);
  useEffect(() => {
    if (!project || loadedProjectId !== project.id) {
      bgGridReady.current = false;
      return;
    }
    if (!bgGridReady.current) {
      bgGridReady.current = true;
      return;
    }
    scheduleAutosave();
  }, [bgColor, showGrid, lineColors, showMoldLines, project, loadedProjectId, scheduleAutosave]);

  // Flush ao sair da pagina
  useEffect(() => {
    const flush = () => {
      if (projectRef.current) persistLocal();
    };
    window.addEventListener('beforeunload', flush);
    return () => {
      window.removeEventListener('beforeunload', flush);
      flush();
    };
  }, [persistLocal]);

  const screenToCanvas = useCallback((clientX: number, clientY: number): Point => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return { x: 0, y: 0 };
    // Usa o tamanho real renderizado (ja inclui zoom CSS) — nao divide por zoom de novo
    const sx = rect.width / CANVAS_W;
    const sy = rect.height / CANVAS_H;
    return {
      x: (clientX - rect.left) / sx,
      y: (clientY - rect.top) / sy,
    };
  }, []);

  const HANDLE = 10;
  function hitResizeHandle(img: ImageObj, p: Point): 'nw' | 'ne' | 'sw' | 'se' | null {
    const hs = HANDLE / Math.max(zoomRef.current, 0.25);
    const corners: Array<{ id: 'nw' | 'ne' | 'sw' | 'se'; x: number; y: number }> = [
      { id: 'nw', x: img.x, y: img.y },
      { id: 'ne', x: img.x + img.w, y: img.y },
      { id: 'sw', x: img.x, y: img.y + img.h },
      { id: 'se', x: img.x + img.w, y: img.y + img.h },
    ];
    for (const c of corners) {
      if (Math.abs(p.x - c.x) <= hs && Math.abs(p.y - c.y) <= hs) return c.id;
    }
    return null;
  }

  const paint = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    if (showGrid) {
      ctx.save();
      ctx.strokeStyle = 'rgba(0,0,0,0.06)';
      ctx.lineWidth = 1;
      for (let x = 0; x <= CANVAS_W; x += 40) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, CANVAS_H);
        ctx.stroke();
      }
      for (let y = 0; y <= CANVAS_H; y += 40) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(CANVAS_W, y);
        ctx.stroke();
      }
      ctx.restore();
    }

    // Borda do "papel"
    ctx.strokeStyle = 'rgba(0,0,0,0.12)';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, CANVAS_W - 2, CANVAS_H - 2);

    const moldFile =
      objects.find((o): o is ImageObj => o.kind === 'image' && o.fileKind === 'mold') ||
      objects.find((o): o is ImageObj => o.kind === 'image' && !!o.name && /molde|diamante|gomo|cone/i.test(o.name));
    const moldCtx =
      moldFile && moldMask && moldMask.paths?.length
        ? { mold: moldFile, mask: moldMask }
        : null;

    // 1) molde no fundo (sem recorte de arte)
    // 2) overlays com clip+wrap (silhueta continua — ponta+boca sem furo)
    // 3) linhas de gomo/divisao/guia POR CIMA da arte
    for (const obj of objects) {
      if (obj.kind === 'image' && obj.fileKind === 'mold') {
        drawObject(ctx, obj, null);
      }
    }
    for (const obj of objects) {
      if (obj.kind === 'image' && obj.fileKind === 'mold') continue;
      drawObject(ctx, obj, moldCtx);
    }
    if (draftRef.current) {
      drawObject(ctx, draftRef.current, moldCtx);
    }

    if (showMoldLines && moldFile && moldMask) {
      drawMoldLinesOnTop(ctx, moldFile, moldMask, lineColors);
    }

    if (selectedId) {
      const sel = objects.find((o) => o.id === selectedId);
      if (sel) {
        ctx.save();
        ctx.setLineDash([6, 4]);
        ctx.strokeStyle = '#2563eb';
        ctx.lineWidth = 1.5;
        if (sel.kind === 'image') {
          ctx.strokeRect(sel.x - 2, sel.y - 2, sel.w + 4, sel.h + 4);
          // alcas de redimensionar (arquivo livre, nao fixo)
          const hs = HANDLE / Math.max(zoomRef.current, 0.25);
          const corners = [
            [sel.x, sel.y],
            [sel.x + sel.w, sel.y],
            [sel.x, sel.y + sel.h],
            [sel.x + sel.w, sel.y + sel.h],
          ];
          ctx.setLineDash([]);
          ctx.fillStyle = '#2563eb';
          for (const [cx, cy] of corners) {
            ctx.fillRect(cx - hs / 2, cy - hs / 2, hs, hs);
          }
          // etiqueta do arquivo
          if (sel.name) {
            ctx.font = '600 12px "Segoe UI", system-ui, sans-serif';
            ctx.fillStyle = '#2563eb';
            ctx.fillText(sel.name, sel.x, Math.max(14, sel.y - 8));
          }
        } else if (sel.kind === 'text') {
          const w = sel.text.length * sel.size * 0.55;
          ctx.strokeRect(sel.x - 4, sel.y - sel.size - 4, w + 8, sel.size + 12);
        } else if (sel.kind === 'stroke') {
          let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
          for (const p of sel.points) {
            minX = Math.min(minX, p.x);
            minY = Math.min(minY, p.y);
            maxX = Math.max(maxX, p.x);
            maxY = Math.max(maxY, p.y);
          }
          ctx.strokeRect(minX - 4, minY - 4, maxX - minX + 8, maxY - minY + 8);
        } else {
          const minX = Math.min(sel.x1, sel.x2);
          const minY = Math.min(sel.y1, sel.y2);
          const w = Math.abs(sel.x2 - sel.x1);
          const h = Math.abs(sel.y2 - sel.y1);
          ctx.strokeRect(minX - 4, minY - 4, w + 8, h + 8);
        }
        ctx.restore();
      }
    }
  }, [objects, bgColor, showGrid, selectedId, moldMask, lineColors, showMoldLines]);

  useEffect(() => {
    paint();
  }, [paint]);

  // Redesenha quando imagens carregam
  useEffect(() => {
    const imgs = objects.filter((o): o is ImageObj => o.kind === 'image');
    imgs.forEach((o) => {
      if (!imageCache.has(o.src)) {
        const img = new Image();
        img.onload = () => paint();
        img.src = o.src;
        imageCache.set(o.src, img);
      }
    });
  }, [objects, paint]);

  const onPointerDown = (e: React.PointerEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.setPointerCapture(e.pointerId);
    const p = screenToCanvas(e.clientX, e.clientY);

    if (tool === 'pan' || e.button === 1 || (e.button === 0 && e.altKey)) {
      panStartRef.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
      return;
    }

    if (tool === 'select') {
      // 1) alca de resize do arquivo selecionado (usa ref atualizado)
      const currentSel = objectsRef.current.find((o) => o.id === selectedId);
      if (currentSel?.kind === 'image') {
        const corner = hitResizeHandle(currentSel, p);
        if (corner) {
          resizeRef.current = {
            id: currentSel.id,
            corner,
            start: p,
            orig: { x: currentSel.x, y: currentSel.y, w: currentSel.w, h: currentSel.h },
          };
          return;
        }
      }
      // 2) hit-test: PRIORIZA imagens de overlay (arte) em cima do molde
      let hit: CanvasObj | undefined;
      const list = objectsRef.current;
      // overlays / desenhos primeiro (fim da lista = topo)
      for (let i = list.length - 1; i >= 0; i--) {
        const o = list[i];
        if (o.kind === 'image' && o.fileKind === 'mold') continue;
        if (hitTest(o, p)) {
          hit = o;
          break;
        }
      }
      // so cai no molde se nao pegou nada por cima
      if (!hit) {
        for (let i = list.length - 1; i >= 0; i--) {
          const o = list[i];
          if (o.kind === 'image' && o.fileKind === 'mold' && hitTest(o, p)) {
            hit = o;
            break;
          }
        }
      }
      setSelectedId(hit?.id ?? null);
      if (hit) {
        dragObjRef.current = { id: hit.id, ox: 0, oy: 0, start: p };
      }
      return;
    }

    if (tool === 'eyedropper') {
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const px = ctx.getImageData(Math.floor(p.x), Math.floor(p.y), 1, 1).data;
      const hex = `#${[px[0], px[1], px[2]].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
      setColor(hex);
      setTool('brush');
      return;
    }

    if (tool === 'fill') {
      // Rasteriza estado atual num buffer limpo e preenche
      const off = document.createElement('canvas');
      off.width = CANVAS_W;
      off.height = CANVAS_H;
      const octx = off.getContext('2d');
      if (!octx) return;
      octx.fillStyle = bgColor;
      octx.fillRect(0, 0, CANVAS_W, CANVAS_H);
      for (const obj of objects) drawObject(octx, obj);
      floodFill(octx, p.x, p.y, color);
      // Guarda como imagem achatada
      const src = off.toDataURL('image/png');
      const flat: ImageObj = {
        id: uid(),
        kind: 'image',
        src,
        x: 0,
        y: 0,
        w: CANVAS_W,
        h: CANVAS_H,
        opacity: 1,
      };
      // Substitui tudo por uma camada rasterizada preenchida
      pushHistory([flat]);
      setSelectedId(null);
      return;
    }

    if (tool === 'text') {
      const text = window.prompt('Texto:', 'Texto');
      if (!text) return;
      const obj: TextObj = {
        id: uid(),
        kind: 'text',
        text,
        x: p.x,
        y: p.y,
        size: textSize,
        color,
        opacity,
      };
      pushHistory([...objects, obj]);
      setSelectedId(obj.id);
      return;
    }

    drawingRef.current = true;

    if (tool === 'brush' || tool === 'eraser') {
      const stroke: StrokeObj = {
        id: uid(),
        kind: 'stroke',
        points: [p],
        color,
        width: brushSize,
        opacity,
        erase: tool === 'eraser',
      };
      draftRef.current = stroke;
      force();
      return;
    }

    if (tool === 'line' || tool === 'rect' || tool === 'ellipse' || tool === 'triangle') {
      const shape: ShapeObj = {
        id: uid(),
        kind: tool,
        x1: p.x,
        y1: p.y,
        x2: p.x,
        y2: p.y,
        stroke: color,
        fill: fillColor,
        width: brushSize,
        opacity,
        filled,
      };
      draftRef.current = shape;
      force();
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (panStartRef.current) {
      const d = panStartRef.current;
      setPan({
        x: d.panX + (e.clientX - d.x),
        y: d.panY + (e.clientY - d.y),
      });
      return;
    }

    const p = screenToCanvas(e.clientX, e.clientY);

    if (resizeRef.current) {
      const r = resizeRef.current;
      const o = r.orig;
      let x = o.x;
      let y = o.y;
      let w = o.w;
      let h = o.h;
      const minSize = 24;
      if (r.corner.includes('e')) w = Math.max(minSize, o.w + (p.x - r.start.x));
      if (r.corner.includes('s')) h = Math.max(minSize, o.h + (p.y - r.start.y));
      if (r.corner.includes('w')) {
        const nx = Math.min(o.x + o.w - minSize, p.x);
        w = o.x + o.w - nx;
        x = nx;
      }
      if (r.corner.includes('n')) {
        const ny = Math.min(o.y + o.h - minSize, p.y);
        h = o.y + o.h - ny;
        y = ny;
      }
      const next = objectsRef.current.map((obj) =>
        obj.id === r.id && obj.kind === 'image' ? { ...obj, x, y, w, h } : obj
      );
      objectsRef.current = next;
      setObjects(next);
      return;
    }

    if (tool === 'select' && dragObjRef.current) {
      const d = dragObjRef.current;
      const dx = p.x - d.start.x;
      const dy = p.y - d.start.y;
      d.start = p;
      const next = objectsRef.current.map((obj) => {
        if (obj.id !== d.id) return obj;
        if (obj.kind === 'image') return { ...obj, x: obj.x + dx, y: obj.y + dy };
        if (obj.kind === 'text') return { ...obj, x: obj.x + dx, y: obj.y + dy };
        if (obj.kind === 'stroke') {
          return { ...obj, points: obj.points.map((pt) => ({ x: pt.x + dx, y: pt.y + dy })) };
        }
        return {
          ...obj,
          x1: obj.x1 + dx,
          y1: obj.y1 + dy,
          x2: obj.x2 + dx,
          y2: obj.y2 + dy,
        };
      });
      objectsRef.current = next;
      setObjects(next);
      return;
    }

    if (!drawingRef.current || !draftRef.current) return;
    const draft = draftRef.current;
    if (draft.kind === 'stroke') {
      draft.points.push(p);
      draftRef.current = { ...draft, points: [...draft.points] };
      force();
      paint();
      return;
    }
    if (draft.kind === 'line' || draft.kind === 'rect' || draft.kind === 'ellipse' || draft.kind === 'triangle') {
      draftRef.current = { ...draft, x2: p.x, y2: p.y };
      force();
      paint();
    }
  };

  const onPointerUp = () => {
    if (panStartRef.current) {
      panStartRef.current = null;
      return;
    }
    if (resizeRef.current) {
      pushHistory(objectsRef.current);
      resizeRef.current = null;
      return;
    }
    if (dragObjRef.current) {
      // commit move to history (estado atual do arraste)
      pushHistory(objectsRef.current);
      dragObjRef.current = null;
      return;
    }
    if (!drawingRef.current) return;
    drawingRef.current = false;
    if (draftRef.current) {
      pushHistory([...objects, draftRef.current]);
      draftRef.current = null;
      force();
    }
  };

  const handleAddImages = (files: FileList | null) => {
    if (!files?.length) return;
    const list = Array.from(files);
    let offset = 0;
    const loaders = list.map(
      (file) =>
        new Promise<ImageObj | null>((resolve) => {
          const reader = new FileReader();
          reader.onload = () => {
            const src = String(reader.result || '');
            const img = new Image();
            img.onload = () => {
              const maxSide = 480;
              const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
              const w = Math.max(40, img.width * scale);
              const h = Math.max(40, img.height * scale);
              const o: ImageObj = {
                id: uid(),
                kind: 'image',
                src,
                x: 80 + offset,
                y: 80 + offset,
                w,
                h,
                opacity: 1,
                name: file.name || `imagem-${Date.now()}.png`,
                fileKind: 'upload',
                wrapOnMold: true,
              };
              imageCache.set(src, img);
              offset += 36;
              resolve(o);
            };
            img.onerror = () => resolve(null);
            img.src = src;
          };
          reader.onerror = () => resolve(null);
          reader.readAsDataURL(file);
        })
    );

    void Promise.all(loaders).then((imgs) => {
      const valid = imgs.filter((x): x is ImageObj => !!x);
      if (!valid.length) return;
      pushHistory([...objects, ...valid]);
      setSelectedId(valid[valid.length - 1].id);
      setTool('select');
    });
  };

  const deleteSelected = () => {
    if (!selectedId) return;
    pushHistory(objects.filter((o) => o.id !== selectedId));
    setSelectedId(null);
  };

  const clearAll = () => {
    if (!objects.length) return;
    if (!window.confirm('Limpar todo o desenho?')) return;
    pushHistory([]);
    setSelectedId(null);
  };

  const downloadPng = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    paint();
    canvas.toBlob((blob) => {
      if (!blob) return;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `criar-desenho-${Date.now()}.png`;
      a.click();
      URL.revokeObjectURL(a.href);
    }, 'image/png');
  };

  const selected = useMemo(() => objects.find((o) => o.id === selectedId) ?? null, [objects, selectedId]);
  const fileObjects = useMemo(
    () => objects.filter((o): o is ImageObj => o.kind === 'image'),
    [objects]
  );

  const resizeSelected = (factor: number) => {
    if (!selected || selected.kind !== 'image') return;
    const cx = selected.x + selected.w / 2;
    const cy = selected.y + selected.h / 2;
    const w = clamp(selected.w * factor, 20, CANVAS_W * 2);
    const h = clamp(selected.h * factor, 20, CANVAS_H * 2);
    pushHistory(
      objects.map((o) =>
        o.id === selected.id && o.kind === 'image'
          ? { ...o, w, h, x: cx - w / 2, y: cy - h / 2 }
          : o
      )
    );
  };

  const fitToSelected = () => {
    if (!selected || selected.kind !== 'image') return;
    const vp = viewportRef.current;
    const vw = vp?.clientWidth ?? 900;
    const vh = vp?.clientHeight ?? 600;
    const pad = 48;
    const z = clamp(Math.min(vw / (selected.w + pad), vh / (selected.h + pad)), ZOOM_MIN, ZOOM_MAX);
    setZoom(z);
    setPan({
      x: (vw - selected.w * z) / 2 - selected.x * z,
      y: (vh - selected.h * z) / 2 - selected.y * z,
    });
  };

  const onViewportWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const vp = viewportRef.current;
    if (!vp) return;
    const rect = vp.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const oldZ = zoomRef.current;
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    const newZ = clamp(oldZ * factor, ZOOM_MIN, ZOOM_MAX);
    // zoom no cursor
    const worldX = (mx - panRef.current.x) / oldZ;
    const worldY = (my - panRef.current.y) / oldZ;
    setZoom(newZ);
    setPan({
      x: mx - worldX * newZ,
      y: my - worldY * newZ,
    });
  };

  const flipSelected = () => {
    if (!selected || selected.kind !== 'image') return;
    const img = imageCache.get(selected.src);
    if (!img?.complete) return;
    const off = document.createElement('canvas');
    off.width = img.naturalWidth || img.width;
    off.height = img.naturalHeight || img.height;
    const octx = off.getContext('2d');
    if (!octx) return;
    octx.translate(off.width, 0);
    octx.scale(-1, 1);
    octx.drawImage(img, 0, 0);
    const src = off.toDataURL('image/png');
    const flipped = new Image();
    flipped.src = src;
    imageCache.set(src, flipped);
    pushHistory(
      objects.map((o) => (o.id === selected.id && o.kind === 'image' ? { ...o, src } : o))
    );
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedId && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement)) {
          e.preventDefault();
          deleteSelected();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, historyIndex, history, objects]);

  return (
    <div className="criar-page">
      <div className="criar-toolbar">
        <div className="criar-toolbar-text">
          <h2>Editar{project ? ` — ${project.nome}` : ''}</h2>
          <p>
            {project
              ? 'Edite o molde com pincel, formas e imagens. Cada passo fica salvo neste navegador na hora — clique "Salvar agora" pra enviar ao servidor.'
              : 'Ferramenta paint: desenhe, use formas geometricas e adicione varias imagens. Use "Usar lek" no Lek pra vincular um projeto.'}
          </p>
          {project ? (
            <p className={`criar-save-status status-${saveStatus}`}>
              {saveStatus === 'pending' ? <><Save size={13} /> Salvo neste navegador (nao enviado ao servidor)</> : null}
              {saveStatus === 'saving' ? <><Loader2 size={13} className="mold-import-spinner" /> Salvando no servidor...</> : null}
              {saveStatus === 'saved' ? <><Cloud size={13} /> Tudo salvo no servidor — pode fechar a pagina com seguranca</> : null}
              {saveStatus === 'error' ? <><CloudOff size={13} /> {saveError || 'Erro ao salvar no servidor (local ok)'}</> : null}
              {saveStatus === 'idle' ? <><Save size={13} /> Pronto</> : null}
            </p>
          ) : (
            <p className="criar-save-status status-idle">
              Sem projeto vinculado — nada e listado em Meus Projetos ainda.
            </p>
          )}
        </div>
        <div className="criar-toolbar-actions">
          <button type="button" className="mold-import-button" onClick={undo} disabled={historyIndex <= 0} title="Desfazer">
            <Undo2 size={16} /> Desfazer
          </button>
          <button type="button" className="mold-import-button" onClick={redo} disabled={historyIndex >= history.length - 1} title="Refazer">
            <Redo2 size={16} /> Refazer
          </button>
          <button type="button" className="mold-import-button" onClick={() => fileInputRef.current?.click()}>
            <ImagePlus size={16} /> Imagens
          </button>
          {project && project.can_edit ? (
            <button
              type="button"
              className="mold-save-button"
              onClick={() => void persistServer()}
              disabled={saveStatus === 'saving'}
            >
              {saveStatus === 'saving' ? <Loader2 size={16} className="mold-import-spinner" /> : <Cloud size={16} />}
              Salvar agora
            </button>
          ) : null}
          <button type="button" className="mold-save-button" onClick={downloadPng}>
            <Download size={16} /> Baixar PNG
          </button>
          <button type="button" className="mold-import-button" onClick={clearAll} title="Limpar">
            <Trash2 size={16} /> Limpar
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e) => {
              handleAddImages(e.target.files);
              e.target.value = '';
            }}
          />
        </div>
      </div>

      <div className="criar-layout">
        <aside className="criar-sidebar">
          <div className="criar-card">
            <h4>Ferramentas</h4>
            <div className="criar-tools-grid">
              {TOOLS.map((t) => {
                const Icon = t.icon;
                return (
                  <button
                    key={t.id}
                    type="button"
                    className={`criar-tool-btn${tool === t.id ? ' on' : ''}`}
                    title={t.label}
                    onClick={() => setTool(t.id)}
                  >
                    <Icon size={16} />
                    <span>{t.label.split(' ')[0]}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="criar-card">
            <h4>Cor e traco</h4>
            <div className="criar-color-row">
              <label>
                Traço
                <input type="color" value={color} onChange={(e) => setColor(e.target.value)} />
              </label>
              <label>
                Preenchimento
                <input type="color" value={fillColor} onChange={(e) => setFillColor(e.target.value)} />
              </label>
            </div>
            <div className="criar-swatches">
              {PRESET_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={`criar-swatch${color === c ? ' on' : ''}`}
                  style={{ background: c }}
                  title={c}
                  onClick={() => setColor(c)}
                />
              ))}
            </div>
            <label className="criar-field">
              <span>Espessura: {brushSize}px</span>
              <input type="range" min={1} max={80} value={brushSize} onChange={(e) => setBrushSize(Number(e.target.value))} />
            </label>
            <label className="criar-field">
              <span>Opacidade: {Math.round(opacity * 100)}%</span>
              <input
                type="range"
                min={0.05}
                max={1}
                step={0.05}
                value={opacity}
                onChange={(e) => setOpacity(Number(e.target.value))}
              />
            </label>
            <label className="criar-check">
              <input type="checkbox" checked={filled} onChange={(e) => setFilled(e.target.checked)} />
              Formas com preenchimento
            </label>
            <label className="criar-field">
              <span>Tamanho do texto: {textSize}px</span>
              <input type="range" min={12} max={120} value={textSize} onChange={(e) => setTextSize(Number(e.target.value))} />
            </label>
          </div>

          {moldMask ? (
            <div className="criar-card">
              <h4>Linhas do molde (por cima)</h4>
              <label className="criar-check">
                <input
                  type="checkbox"
                  checked={showMoldLines}
                  onChange={(e) => setShowMoldLines(e.target.checked)}
                />
                Mostrar linhas em cima da arte
              </label>
              <div className="criar-color-row" style={{ marginTop: 8 }}>
                <label>
                  Gomos / costuras
                  <input
                    type="color"
                    value={lineColors.gomo}
                    onChange={(e) => setLineColors((c) => ({ ...c, gomo: e.target.value }))}
                  />
                </label>
                <label>
                  Guias / grade
                  <input
                    type="color"
                    value={lineColors.guide}
                    onChange={(e) => setLineColors((c) => ({ ...c, guide: e.target.value }))}
                  />
                </label>
              </div>
              <div className="criar-color-row">
                <label>
                  Equador
                  <input
                    type="color"
                    value={lineColors.equator}
                    onChange={(e) => setLineColors((c) => ({ ...c, equator: e.target.value }))}
                  />
                </label>
                <label>
                  Boca
                  <input
                    type="color"
                    value={lineColors.mouth}
                    onChange={(e) => setLineColors((c) => ({ ...c, mouth: e.target.value }))}
                  />
                </label>
              </div>
              <label className="criar-field">
                <span>Contorno</span>
                <input
                  type="color"
                  value={lineColors.outline}
                  onChange={(e) => setLineColors((c) => ({ ...c, outline: e.target.value }))}
                />
              </label>
              <p className="criar-hint" style={{ margin: '6px 0 0' }}>
                Linhas ficam por cima do desenho. Ajuste as cores pra enxergar melhor.
              </p>
            </div>
          ) : null}

          <div className="criar-card">
            <h4>Papel</h4>
            <label className="criar-field">
              <span>Cor de fundo</span>
              <input type="color" value={bgColor} onChange={(e) => setBgColor(e.target.value)} />
            </label>
            <label className="criar-check">
              <input type="checkbox" checked={showGrid} onChange={(e) => setShowGrid(e.target.checked)} />
              Mostrar grade
            </label>
            <div className="criar-zoom-row">
              <button type="button" className="mold-import-button" onClick={() => setZoom((z) => clamp(z - 0.1, ZOOM_MIN, ZOOM_MAX))}>
                <ZoomOut size={14} />
              </button>
              <span>{Math.round(zoom * 100)}%</span>
              <button type="button" className="mold-import-button" onClick={() => setZoom((z) => clamp(z + 0.1, ZOOM_MIN, ZOOM_MAX))}>
                <ZoomIn size={14} />
              </button>
              <button type="button" className="mold-import-button" onClick={() => { setZoom(0.7); setPan({ x: 40, y: 40 }); }}>
                Enquadrar
              </button>
            </div>
          </div>

          <div className="criar-card">
            <h4>Arquivos do projeto</h4>
            {fileObjects.length === 0 ? (
              <p className="criar-hint" style={{ margin: 0 }}>
                Nenhum arquivo ainda. Use <em>Usar lek</em> no Lek ou o botao <em>Imagens</em>.
              </p>
            ) : (
              <div className="criar-files-list">
                {fileObjects.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    className={`criar-file-row${selectedId === f.id ? ' on' : ''}`}
                    onClick={() => {
                      setSelectedId(f.id);
                      setTool('select');
                    }}
                  >
                    <span className="criar-file-icon">{f.fileKind === 'mold' ? '📐' : '🖼'}</span>
                    <span className="criar-file-name" title={f.name || 'arquivo'}>
                      {f.name || 'arquivo.png'}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {selected?.kind === 'image' && (
            <div className="criar-card">
              <h4>Arquivo selecionado</h4>
              <p className="criar-hint" style={{ margin: '0 0 8px' }}>
                <strong>{selected.name || 'arquivo'}</strong>
                <br />
                {selected.fileKind === 'mold'
                  ? 'Arquivo do molde (base). Arraste / redimensione.'
                  : moldMask
                    ? 'So aparece DENTRO do cone. Se sair pela esquerda, reaparece na direita.'
                    : 'Arraste pra mover · cantos pra redimensionar · scroll pro zoom'}
              </p>
              {selected.fileKind !== 'mold' && moldMask ? (
                <label className="criar-check">
                  <input
                    type="checkbox"
                    checked={selected.wrapOnMold !== false}
                    onChange={(e) => {
                      const on = e.target.checked;
                      pushHistory(
                        objects.map((o) =>
                          o.id === selected.id && o.kind === 'image' ? { ...o, wrapOnMold: on } : o
                        )
                      );
                    }}
                  />
                  Recortar no cone + wrap L/R
                </label>
              ) : null}
              {!moldMask && selected.fileKind !== 'mold' ? (
                <p className="criar-hint" style={{ color: '#fbbf24' }}>
                  Sem mascara do molde neste projeto. Use <em>Usar lek</em> de novo no Lek pra habilitar recorte/wrap.
                </p>
              ) : null}
              <div className="criar-zoom-row">
                <button type="button" className="mold-import-button" onClick={() => resizeSelected(1.15)}>Maior</button>
                <button type="button" className="mold-import-button" onClick={() => resizeSelected(1 / 1.15)}>Menor</button>
                <button type="button" className="mold-import-button" onClick={fitToSelected}>Enquadrar</button>
                <button type="button" className="mold-import-button" onClick={flipSelected} title="Espelhar">
                  <FlipHorizontal2 size={14} /> Espelhar
                </button>
              </div>
              <button type="button" className="mold-import-button" onClick={deleteSelected} style={{ width: '100%', marginTop: 8 }}>
                <Trash2 size={14} /> Remover arquivo
              </button>
            </div>
          )}

          {selected && selected.kind !== 'image' && (
            <div className="criar-card">
              <h4>Objeto selecionado</h4>
              <button type="button" className="mold-import-button" onClick={deleteSelected} style={{ width: '100%' }}>
                <Trash2 size={14} /> Remover
              </button>
            </div>
          )}

          <div className="criar-card criar-hint">
            <strong>Dicas</strong>
            <ul>
              <li>Imagens: botao <em>Imagens</em> (multiplas de uma vez)</li>
              <li>Mover imagem/objeto: ferramenta Selecionar</li>
              <li>Pan: ferramenta Mao ou Alt + arrastar</li>
              <li>Ctrl+Z / Ctrl+Y desfazer e refazer</li>
              <li>Delete remove o selecionado</li>
            </ul>
          </div>
        </aside>

        <div className="criar-viewport" ref={viewportRef} onWheel={onViewportWheel}>
          <div
            className="criar-stage"
            style={{
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              width: CANVAS_W,
              height: CANVAS_H,
            }}
          >
            <canvas
              ref={canvasRef}
              width={CANVAS_W}
              height={CANVAS_H}
              className={`criar-canvas tool-${tool}`}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              onContextMenu={(e) => e.preventDefault()}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
