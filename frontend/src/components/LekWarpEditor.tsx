import { useCallback, useEffect, useRef, useState } from 'react';
import { Maximize2, Minus, Plus, RotateCcw, ZoomIn, ZoomOut } from 'lucide-react';

export interface WarpPt {
  x: number;
  y: number;
}

/**
 * Grade baseada em BORDAS: cada borda (topo/base/esquerda/direita) tem seu
 * proprio numero de pontos, independente das outras. Os 4 cantos sao
 * compartilhados. O interior nunca tem pontos — e preenchido liso por Coons.
 */
export interface WarpGrid {
  corners: WarpPt[]; // [TL, TR, BR, BL]
  topInner: WarpPt[]; // entre TL e TR (esq->dir)
  bottomInner: WarpPt[]; // entre BL e BR (esq->dir)
  leftInner: WarpPt[]; // entre TL e BL (cima->baixo)
  rightInner: WarpPt[]; // entre TR e BR (cima->baixo)
}

type Edge = 'top' | 'bottom' | 'sides';
type Handle =
  | { kind: 'corner'; i: number }
  | { kind: 'top'; i: number }
  | { kind: 'bottom'; i: number }
  | { kind: 'left'; i: number }
  | { kind: 'right'; i: number };

const OUTPUT_MAX_DIM = 900;
const HANDLE_HIT_PX = 18;
const SUB_X = 24;
const SUB_Y = 30;

const lerp = (a: WarpPt, b: WarpPt, t: number): WarpPt => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

function innerBetween(a: WarpPt, b: WarpPt, n: number): WarpPt[] {
  const out: WarpPt[] = [];
  for (let i = 1; i < n; i++) out.push(lerp(a, b, i / n));
  return out;
}

function makeGrid(x0: number, y0: number, x1: number, y1: number, topN: number, botN: number, rows: number): WarpGrid {
  const TL = { x: x0, y: y0 };
  const TR = { x: x1, y: y0 };
  const BR = { x: x1, y: y1 };
  const BL = { x: x0, y: y1 };
  return {
    corners: [TL, TR, BR, BL],
    topInner: innerBetween(TL, TR, topN),
    bottomInner: innerBetween(BL, BR, botN),
    leftInner: innerBetween(TL, BL, rows),
    rightInner: innerBetween(TR, BR, rows),
  };
}
const MIN_PARTS = 1;
const MAX_PARTS = 5;
const PART_COLORS = ['#f59e0b', '#22d3ee', '#a78bfa', '#f472b6', '#4ade80'];

/** Nome da parte pela posicao no balao: 1a (topo) = Bico (a ponta de cima),
 * ultima (baixo) = Boca (a abertura de baixo), meio = Bojo. */
function partLabel(i: number, n: number): string {
  if (n === 1) return 'Único';
  if (i === 0) return 'Bico';
  if (i === n - 1) return 'Boca';
  return n === 3 ? 'Bojo' : `Bojo ${i}`;
}

/** Grade padrao da parte i (de n), empilhada verticalmente no lek. */
function defaultPart(i: number, n: number): WarpGrid {
  const margin = 0.02;
  const y0 = i / n + margin;
  const y1 = (i + 1) / n - margin;
  let topN = 2;
  let botN = 2;
  let rows = 1;
  if (n > 1 && i === 0) {
    // Bico (ponta de cima): afunila no topo, mais largo embaixo.
    topN = 1;
    botN = 3;
    rows = 2;
  } else if (n > 1 && i === n - 1) {
    // Boca (baixo): mais largo em cima, afunila embaixo.
    topN = 3;
    botN = 1;
    rows = 2;
  }
  return makeGrid(0.08, y0, 0.92, y1, topN, botN, rows);
}

/** Repeticao padrao: pontas (boca/bico) 4x, meio (bojo) 1x (corrido). */
function defaultRepeat(i: number, n: number): number {
  if (n <= 2) return 4;
  return i === 0 || i === n - 1 ? 4 : 1;
}

function buildDefaultParts(n: number): WarpGrid[] {
  return Array.from({ length: n }, (_, i) => defaultPart(i, n));
}
function buildDefaultRepeats(n: number): number[] {
  return Array.from({ length: n }, (_, i) => defaultRepeat(i, n));
}

interface Edges {
  top: WarpPt[];
  bottom: WarpPt[];
  left: WarpPt[];
  right: WarpPt[];
}
function edgesOf(g: WarpGrid): Edges {
  return {
    top: [g.corners[0], ...g.topInner, g.corners[1]],
    bottom: [g.corners[3], ...g.bottomInner, g.corners[2]],
    left: [g.corners[0], ...g.leftInner, g.corners[3]],
    right: [g.corners[1], ...g.rightInner, g.corners[2]],
  };
}

/** Todos os pontos arrastaveis da grade (cantos + internos das bordas). */
function handlesOf(g: WarpGrid): Array<{ h: Handle; p: WarpPt }> {
  const out: Array<{ h: Handle; p: WarpPt }> = [];
  g.corners.forEach((p, i) => out.push({ h: { kind: 'corner', i }, p }));
  g.topInner.forEach((p, i) => out.push({ h: { kind: 'top', i }, p }));
  g.bottomInner.forEach((p, i) => out.push({ h: { kind: 'bottom', i }, p }));
  g.leftInner.forEach((p, i) => out.push({ h: { kind: 'left', i }, p }));
  g.rightInner.forEach((p, i) => out.push({ h: { kind: 'right', i }, p }));
  return out;
}

function moveHandle(g: WarpGrid, h: Handle, np: WarpPt): WarpGrid {
  const next: WarpGrid = {
    corners: g.corners.slice(),
    topInner: g.topInner.slice(),
    bottomInner: g.bottomInner.slice(),
    leftInner: g.leftInner.slice(),
    rightInner: g.rightInner.slice(),
  };
  if (h.kind === 'corner') next.corners[h.i] = np;
  else if (h.kind === 'top') next.topInner[h.i] = np;
  else if (h.kind === 'bottom') next.bottomInner[h.i] = np;
  else if (h.kind === 'left') next.leftInner[h.i] = np;
  else next.rightInner[h.i] = np;
  return next;
}

/** Muda a quantidade de pontos de uma borda, redistribuindo entre os cantos. */
function setEdgeCount(g: WarpGrid, edge: Edge, n: number): WarpGrid {
  const [TL, TR, BR, BL] = g.corners;
  const next: WarpGrid = { ...g, topInner: g.topInner.slice(), bottomInner: g.bottomInner.slice(), leftInner: g.leftInner.slice(), rightInner: g.rightInner.slice() };
  if (edge === 'top') next.topInner = innerBetween(TL, TR, n);
  else if (edge === 'bottom') next.bottomInner = innerBetween(BL, BR, n);
  else {
    next.leftInner = innerBetween(TL, BL, n);
    next.rightInner = innerBetween(TR, BR, n);
  }
  return next;
}

function sampleEdge(edge: WarpPt[], t: number): WarpPt {
  const K = edge.length - 1;
  const x = Math.max(0, Math.min(1, t)) * K;
  let i = Math.floor(x);
  if (i >= K) i = K - 1;
  const f = x - i;
  return lerp(edge[i], edge[i + 1], f);
}

function coonsPoint(u: number, v: number, e: Edges): WarpPt {
  const T = sampleEdge(e.top, u);
  const B = sampleEdge(e.bottom, u);
  const L = sampleEdge(e.left, v);
  const R = sampleEdge(e.right, v);
  const P00 = e.top[0];
  const P10 = e.top[e.top.length - 1];
  const P01 = e.bottom[0];
  const P11 = e.bottom[e.bottom.length - 1];
  const lc = { x: (1 - u) * L.x + u * R.x, y: (1 - u) * L.y + u * R.y };
  const ld = { x: (1 - v) * T.x + v * B.x, y: (1 - v) * T.y + v * B.y };
  const bl = {
    x: (1 - u) * (1 - v) * P00.x + u * (1 - v) * P10.x + (1 - u) * v * P01.x + u * v * P11.x,
    y: (1 - u) * (1 - v) * P00.y + u * (1 - v) * P10.y + (1 - u) * v * P01.y + u * v * P11.y,
  };
  return { x: lc.x + ld.x - bl.x, y: lc.y + ld.y - bl.y };
}

function drawTexturedTriangle(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  s0: WarpPt, s1: WarpPt, s2: WarpPt,
  d0: WarpPt, d1: WarpPt, d2: WarpPt
) {
  const cx = (d0.x + d1.x + d2.x) / 3;
  const cy = (d0.y + d1.y + d2.y) / 3;
  const grow = 0.6;
  const ex = (p: WarpPt): WarpPt => {
    const dx = p.x - cx;
    const dy = p.y - cy;
    const len = Math.hypot(dx, dy) || 1;
    return { x: p.x + (dx / len) * grow, y: p.y + (dy / len) * grow };
  };
  const e0 = ex(d0), e1 = ex(d1), e2 = ex(d2);
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(e0.x, e0.y);
  ctx.lineTo(e1.x, e1.y);
  ctx.lineTo(e2.x, e2.y);
  ctx.closePath();
  ctx.clip();
  const denom = (s1.x - s0.x) * (s2.y - s0.y) - (s2.x - s0.x) * (s1.y - s0.y);
  if (denom !== 0) {
    const a = ((d1.x - d0.x) * (s2.y - s0.y) - (d2.x - d0.x) * (s1.y - s0.y)) / denom;
    const b = ((d2.x - d0.x) * (s1.x - s0.x) - (d1.x - d0.x) * (s2.x - s0.x)) / denom;
    const c = ((d1.y - d0.y) * (s2.y - s0.y) - (d2.y - d0.y) * (s1.y - s0.y)) / denom;
    const d = ((d2.y - d0.y) * (s1.x - s0.x) - (d1.y - d0.y) * (s2.x - s0.x)) / denom;
    const e = d0.x - a * s0.x - b * s0.y;
    const f = d0.y - c * s0.x - d * s0.y;
    ctx.transform(a, c, b, d, e, f);
    ctx.drawImage(img, 0, 0);
  }
  ctx.restore();
}

function rectify(img: HTMLImageElement, grid: WarpGrid): string | null {
  const W = img.naturalWidth || img.width;
  const H = img.naturalHeight || img.height;
  const e = edgesOf(grid);
  const all = [...e.top, ...e.bottom, ...e.left, ...e.right];

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of all) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  const bboxW = Math.max(1, (maxX - minX) * W);
  const bboxH = Math.max(1, (maxY - minY) * H);
  const scale = Math.min(1, OUTPUT_MAX_DIM / Math.max(bboxW, bboxH));
  const outW = Math.max(32, Math.round(bboxW * scale));
  const outH = Math.max(32, Math.round(bboxH * scale));

  const canvas = document.createElement('canvas');
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.clearRect(0, 0, outW, outH);

  const src: WarpPt[][] = [];
  for (let j = 0; j <= SUB_Y; j++) {
    const rowArr: WarpPt[] = [];
    for (let i = 0; i <= SUB_X; i++) {
      const p = coonsPoint(i / SUB_X, j / SUB_Y, e);
      rowArr.push({ x: p.x * W, y: p.y * H });
    }
    src.push(rowArr);
  }
  for (let j = 0; j < SUB_Y; j++) {
    for (let i = 0; i < SUB_X; i++) {
      const s00 = src[j][i], s10 = src[j][i + 1], s01 = src[j + 1][i], s11 = src[j + 1][i + 1];
      const d00 = { x: (i / SUB_X) * outW, y: (j / SUB_Y) * outH };
      const d10 = { x: ((i + 1) / SUB_X) * outW, y: (j / SUB_Y) * outH };
      const d01 = { x: (i / SUB_X) * outW, y: ((j + 1) / SUB_Y) * outH };
      const d11 = { x: ((i + 1) / SUB_X) * outW, y: ((j + 1) / SUB_Y) * outH };
      drawTexturedTriangle(ctx, img, s00, s10, s11, d00, d10, d11);
      drawTexturedTriangle(ctx, img, s00, s11, s01, d00, d11, d01);
    }
  }
  try {
    return canvas.toDataURL('image/png');
  } catch {
    return null;
  }
}

interface LekWarpEditorProps {
  sourceUrl: string;
  parts: WarpGrid[] | null;
  repeats: number[] | null;
  onConfigChange: (parts: WarpGrid[], repeats: number[]) => void;
  onWarpedChange: (index: number, dataUrl: string | null) => void;
}

export function LekWarpEditor({
  sourceUrl,
  parts: partsProp,
  repeats: repeatsProp,
  onConfigChange,
  onWarpedChange,
}: LekWarpEditorProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [imgReady, setImgReady] = useState(false);
  const [aspect, setAspect] = useState(0.75);
  const [parts, setParts] = useState<WarpGrid[]>(() => partsProp ?? buildDefaultParts(2));
  const [repeats, setRepeats] = useState<number[]>(() => repeatsProp ?? buildDefaultRepeats(2));
  const [active, setActive] = useState(0);
  const dragRef = useRef<{ part: number; h: Handle } | null>(null);

  const n = parts.length;

  // Zoom + pan (origin 0,0). pan em px relativo ao container.
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const panDragRef = useRef<{ startX: number; startY: number; panX: number; panY: number } | null>(null);

  const clampPan = useCallback((p: { x: number; y: number }, z: number, rect: DOMRect) => ({
    x: Math.min(0, Math.max((1 - z) * rect.width, p.x)),
    y: Math.min(0, Math.max((1 - z) * rect.height, p.y)),
  }), []);

  const toNorm = useCallback(
    (clientX: number, clientY: number) => {
      const el = containerRef.current;
      if (!el) return { x: 0, y: 0 };
      const rect = el.getBoundingClientRect();
      return {
        x: Math.max(0, Math.min(1, (clientX - rect.left - pan.x) / (zoom * rect.width))),
        y: Math.max(0, Math.min(1, (clientY - rect.top - pan.y) / (zoom * rect.height))),
      };
    },
    [zoom, pan]
  );

  const applyZoom = useCallback(
    (nz: number) => {
      const el = containerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const z = Math.max(1, Math.min(5, nz));
      const cx = rect.width / 2;
      const cy = rect.height / 2;
      setPan((prev) => clampPan({ x: cx - (z * (cx - prev.x)) / zoom, y: cy - (z * (cy - prev.y)) / zoom }, z, rect));
      setZoom(z);
    },
    [zoom, clampPan]
  );

  const resetZoom = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      if (e.deltaY === 0) return;
      applyZoom(zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15));
    },
    [zoom, applyZoom]
  );

  useEffect(() => {
    setImgReady(false);
    const img = new Image();
    img.onload = () => {
      imgRef.current = img;
      setAspect((img.naturalWidth || img.width) / Math.max(1, img.naturalHeight || img.height));
      setImgReady(true);
    };
    img.src = sourceUrl;
  }, [sourceUrl]);

  useEffect(() => {
    setParts(partsProp ?? buildDefaultParts(2));
    setRepeats(repeatsProp ?? buildDefaultRepeats(2));
    setActive(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceUrl]);

  const emitOne = useCallback(
    (index: number, grid: WarpGrid) => {
      const img = imgRef.current;
      if (img) onWarpedChange(index, rectify(img, grid));
    },
    [onWarpedChange]
  );
  const emitAll = useCallback(
    (arr: WarpGrid[]) => {
      const img = imgRef.current;
      if (!img) return;
      arr.forEach((g, i) => onWarpedChange(i, rectify(img, g)));
    },
    [onWarpedChange]
  );

  // Re-emite todas as texturas ao (re)carregar a imagem
  const emittedRef = useRef(false);
  useEffect(() => {
    emittedRef.current = false;
  }, [sourceUrl]);
  useEffect(() => {
    if (!imgReady || emittedRef.current) return;
    emittedRef.current = true;
    emitAll(parts);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imgReady]);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      const el = containerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      let best: { part: number; h: Handle } | null = null;
      let bestDist = HANDLE_HIT_PX;
      parts.forEach((g, pi) => {
        handlesOf(g).forEach(({ h, p }) => {
          const hx = pan.x + zoom * (p.x * rect.width);
          const hy = pan.y + zoom * (p.y * rect.height);
          const dist = Math.hypot(hx - sx, hy - sy);
          if (dist < bestDist) {
            bestDist = dist;
            best = { part: pi, h };
          }
        });
      });
      if (best) {
        dragRef.current = best;
        setActive((best as { part: number }).part);
      } else if (zoom > 1) {
        panDragRef.current = { startX: e.clientX, startY: e.clientY, panX: pan.x, panY: pan.y };
      } else {
        return;
      }
      el.setPointerCapture(e.pointerId);
      e.preventDefault();
    },
    [parts, zoom, pan]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (panDragRef.current) {
        const el = containerRef.current;
        if (!el) return;
        const rect = el.getBoundingClientRect();
        const pd = panDragRef.current;
        setPan(clampPan({ x: pd.panX + (e.clientX - pd.startX), y: pd.panY + (e.clientY - pd.startY) }, zoom, rect));
        return;
      }
      const drag = dragRef.current;
      if (!drag) return;
      const np = toNorm(e.clientX, e.clientY);
      setParts((prev) => prev.map((g, i) => (i === drag.part ? moveHandle(g, drag.h, np) : g)));
    },
    [toNorm, zoom, clampPan]
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      try {
        containerRef.current?.releasePointerCapture(e.pointerId);
      } catch {
        /* noop */
      }
      if (panDragRef.current) {
        panDragRef.current = null;
        return;
      }
      const drag = dragRef.current;
      if (!drag) return;
      const idx = drag.part;
      dragRef.current = null;
      onConfigChange(parts, repeats);
      emitOne(idx, parts[idx]);
    },
    [parts, repeats, onConfigChange, emitOne]
  );

  const changeCount = useCallback(
    (edge: Edge, delta: number) => {
      const cur = parts[active];
      if (!cur) return;
      const countOf = (g: WarpGrid): number =>
        edge === 'top' ? g.topInner.length + 1 : edge === 'bottom' ? g.bottomInner.length + 1 : g.leftInner.length + 1;
      const cnt = Math.max(1, Math.min(49, countOf(cur) + delta));
      const updated = setEdgeCount(cur, edge, cnt);
      const nextParts = parts.map((g, i) => (i === active ? updated : g));
      setParts(nextParts);
      onConfigChange(nextParts, repeats);
      emitOne(active, updated);
    },
    [parts, active, repeats, onConfigChange, emitOne]
  );

  const handleResetActive = useCallback(() => {
    const def = defaultPart(active, n);
    const nextParts = parts.map((g, i) => (i === active ? def : g));
    setParts(nextParts);
    onConfigChange(nextParts, repeats);
    emitOne(active, def);
  }, [active, n, parts, repeats, onConfigChange, emitOne]);

  const changeNumParts = useCallback(
    (newN: number) => {
      const clamped = Math.max(MIN_PARTS, Math.min(MAX_PARTS, newN));
      if (clamped === n) return;
      // Regenera as grades empilhadas pro novo numero de partes; preserva as
      // repeticoes onde der.
      const nextParts = buildDefaultParts(clamped);
      const nextReps = Array.from({ length: clamped }, (_, i) => repeats[i] ?? defaultRepeat(i, clamped));
      setParts(nextParts);
      setRepeats(nextReps);
      setActive((a) => Math.min(a, clamped - 1));
      onConfigChange(nextParts, nextReps);
      emitAll(nextParts);
    },
    [n, repeats, onConfigChange, emitAll]
  );

  const changeRepeat = useCallback(
    (value: number) => {
      const v = Math.max(1, Math.min(60, Math.round(value) || 1));
      const nextReps = repeats.map((r, i) => (i === active ? v : r));
      setRepeats(nextReps);
      onConfigChange(parts, nextReps);
    },
    [active, repeats, parts, onConfigChange]
  );

  const targetGrid = parts[active];
  const topN = (targetGrid?.topInner.length ?? 0) + 1;
  const botN = (targetGrid?.bottomInner.length ?? 0) + 1;
  const sideN = (targetGrid?.leftInner.length ?? 0) + 1;
  const activeColor = PART_COLORS[active % PART_COLORS.length];

  const perimeterPolygon = (g: WarpGrid): string => {
    const seq = [
      g.corners[0],
      ...g.topInner,
      g.corners[1],
      ...g.rightInner,
      g.corners[2],
      ...g.bottomInner.slice().reverse(),
      g.corners[3],
      ...g.leftInner.slice().reverse(),
    ];
    return seq.map((p) => `${p.x * 100},${p.y * 100}`).join(' ');
  };

  const isoLines = (g: WarpGrid): string[] => {
    const e = edgesOf(g);
    const out: string[] = [];
    for (const v of [0.33, 0.66]) {
      const seg: string[] = [];
      for (let i = 0; i <= 10; i++) {
        const p = coonsPoint(i / 10, v, e);
        seg.push(`${p.x * 100},${p.y * 100}`);
      }
      out.push(seg.join(' '));
    }
    for (const u of [0.5]) {
      const seg: string[] = [];
      for (let j = 0; j <= 10; j++) {
        const p = coonsPoint(u, j / 10, e);
        seg.push(`${p.x * 100},${p.y * 100}`);
      }
      out.push(seg.join(' '));
    }
    return out;
  };

  const renderGrid = (index: number, g: WarpGrid, isActive: boolean) => {
    const color = PART_COLORS[index % PART_COLORS.length];
    const z = Math.max(1, zoom);
    const r = (isActive ? 0.7 : 0.5) / z;
    const perimW = (isActive ? 0.3 : 0.22) / z;
    const isoW = 0.14 / z;
    const dot = 0.9 / z;
    return (
      <g key={index} opacity={isActive ? 1 : 0.45}>
        {isActive &&
          isoLines(g).map((pl, i) => (
            <polyline key={`p${index}-iso${i}`} points={pl} fill="none" stroke={color} strokeWidth={isoW} strokeDasharray={`${dot} ${dot}`} opacity={0.5} />
          ))}
        <polygon points={perimeterPolygon(g)} fill="none" stroke={color} strokeWidth={perimW} strokeLinejoin="round" />
        {handlesOf(g).map(({ p }, i) => (
          <circle key={`p${index}-h${i}`} cx={p.x * 100} cy={p.y * 100} r={r} fill={color} stroke="#111" strokeWidth={0.12 / z} />
        ))}
      </g>
    );
  };

  const CountCtl = ({ label, edge, value }: { label: string; edge: Edge; value: number }) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      <span style={{ fontSize: 12, minWidth: 42 }}>{label}</span>
      <button type="button" className="mold-secondary-button" style={{ padding: '2px 6px' }} onClick={() => changeCount(edge, -1)}>
        <Minus size={12} />
      </button>
      <span style={{ fontSize: 12, minWidth: 40, textAlign: 'center' }}>{value + 1} pts</span>
      <button type="button" className="mold-secondary-button" style={{ padding: '2px 6px' }} onClick={() => changeCount(edge, +1)}>
        <Plus size={12} />
      </button>
    </div>
  );

  return (
    <div className="lek-warp-editor" style={{ width: '100%' }}>
      {/* Quantas partes o lek tem */}
      <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', marginBottom: '8px' }}>
        <span style={{ fontSize: 12, fontWeight: 600 }}>Quantas partes tem o lek?</span>
        <button type="button" className="mold-secondary-button" style={{ padding: '2px 6px' }} onClick={() => changeNumParts(n - 1)} disabled={n <= MIN_PARTS}>
          <Minus size={12} />
        </button>
        <span style={{ fontSize: 13, fontWeight: 700, minWidth: 20, textAlign: 'center' }}>{n}</span>
        <button type="button" className="mold-secondary-button" style={{ padding: '2px 6px' }} onClick={() => changeNumParts(n + 1)} disabled={n >= MAX_PARTS}>
          <Plus size={12} />
        </button>
      </div>

      {/* Selecionar a parte a ajustar */}
      <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', marginBottom: '6px' }}>
        <span style={{ fontSize: 12, fontWeight: 600 }}>Ajustar:</span>
        <div className="painel-malha-switch" style={{ display: 'inline-flex', flexWrap: 'wrap' }}>
          {parts.map((_, i) => (
            <button
              key={i}
              type="button"
              className={active === i ? 'active' : ''}
              onClick={() => setActive(i)}
              style={{ padding: '3px 10px', borderLeft: `3px solid ${PART_COLORS[i % PART_COLORS.length]}` }}
            >
              {partLabel(i, n)}
            </button>
          ))}
        </div>
      </div>

      {/* Repeticoes da parte ativa */}
      <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', marginBottom: '8px' }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: activeColor }}>
          Repetições de "{partLabel(active, n)}":
        </span>
        <input
          type="number"
          min={1}
          max={60}
          value={repeats[active] ?? 1}
          onChange={(e) => changeRepeat(Number(e.target.value))}
          className="modelo3d-search-input-field"
          style={{ width: 70 }}
        />
        <span className="bandeira-size-hint" style={{ margin: 0 }}>
          {(repeats[active] ?? 1) === 1 ? 'corrido (1 volta)' : `${repeats[active]}x em volta`}
        </span>
      </div>

      {/* Pontos das bordas da parte ativa */}
      <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap', marginBottom: '8px' }}>
        <CountCtl label="Topo" edge="top" value={topN} />
        <CountCtl label="Base" edge="bottom" value={botN} />
        <CountCtl label="Lados" edge="sides" value={sideN} />
        <button type="button" className="mold-secondary-button" style={{ padding: '2px 8px' }} onClick={handleResetActive}>
          <RotateCcw size={13} /> Resetar {partLabel(active, n).toLowerCase()}
        </button>
      </div>

      <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap', marginBottom: '8px' }}>
        <span style={{ fontSize: 12, fontWeight: 600 }}>Zoom:</span>
        <button type="button" className="mold-secondary-button" style={{ padding: '2px 6px' }} onClick={() => applyZoom(zoom / 1.3)} title="Diminuir zoom">
          <ZoomOut size={13} />
        </button>
        <span style={{ fontSize: 12, minWidth: 42, textAlign: 'center' }}>{Math.round(zoom * 100)}%</span>
        <button type="button" className="mold-secondary-button" style={{ padding: '2px 6px' }} onClick={() => applyZoom(zoom * 1.3)} title="Aumentar zoom">
          <ZoomIn size={13} />
        </button>
        <button type="button" className="mold-secondary-button" style={{ padding: '2px 8px' }} onClick={resetZoom} title="Ajustar à tela">
          <Maximize2 size={13} /> Ajustar
        </button>
      </div>

      <div
        ref={containerRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onWheel={handleWheel}
        style={{
          position: 'relative',
          height: 'min(74vh, 860px)',
          width: 'auto',
          maxWidth: '96%',
          aspectRatio: `${aspect}`,
          margin: '0 auto',
          alignSelf: 'center',
          borderRadius: '8px',
          touchAction: 'none',
          cursor: zoom > 1 ? 'grab' : 'crosshair',
          backgroundColor: '#e9e9ec',
          backgroundImage:
            'linear-gradient(45deg, #c9c9d0 25%, transparent 25%), linear-gradient(-45deg, #c9c9d0 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #c9c9d0 75%), linear-gradient(-45deg, transparent 75%, #c9c9d0 75%)',
          backgroundSize: '16px 16px',
          backgroundPosition: '0 0, 0 8px, 8px -8px, -8px 0',
          overflow: 'hidden',
          userSelect: 'none',
        }}
      >
        <div
          style={{
            position: 'absolute',
            inset: 0,
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transformOrigin: '0 0',
          }}
        >
          <img src={sourceUrl} alt="Lek" draggable={false} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'fill', pointerEvents: 'none' }} />
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
            {parts.map((g, i) => (i === active ? null : renderGrid(i, g, false)))}
            {targetGrid && renderGrid(active, targetGrid, true)}
          </svg>
        </div>
      </div>

      <p className="bandeira-size-hint" style={{ textAlign: 'center', marginTop: '6px' }}>
        Escolha quantas partes o lek tem, ajuste a grade de cada uma (arraste os pontos) e a repetição de cada parte. Dê <strong>zoom</strong> pra precisão.
      </p>
    </div>
  );
}
