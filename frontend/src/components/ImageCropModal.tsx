import { useEffect, useMemo, useRef, useState } from 'react';
import { Crop, X } from 'lucide-react';

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

type DragMode = 'move' | 'nw' | 'ne' | 'sw' | 'se' | null;

interface ImageCropModalProps {
  file: File;
  /** Chamado com o arquivo ja recortado (mesmo tipo/nome do original). */
  onConfirm: (croppedFile: File) => void;
  /** Continua com a imagem inteira, sem recortar nada. */
  onUseWhole: () => void;
  onCancel: () => void;
}

const MIN_SELECTION_PX = 10;
const RULER_SIZE = 26;

/** Espacamento "bonito" (1/2/5 x 10^n) entre marcas maiores da regua, dado
 * quantos pixels da imagem ORIGINAL cabem no espaco alvo entre marcas. */
function niceStep(rawStep: number): number {
  if (rawStep <= 0) return 1;
  const exp = Math.floor(Math.log10(rawStep));
  const base = Math.pow(10, exp);
  const fraction = rawStep / base;
  const niceFraction = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10;
  return niceFraction * base;
}

function clampRect(rect: Rect, boundsW: number, boundsH: number): Rect {
  const w = Math.min(boundsW, Math.max(MIN_SELECTION_PX, rect.w));
  const h = Math.min(boundsH, Math.max(MIN_SELECTION_PX, rect.h));
  const x = Math.min(Math.max(0, rect.x), boundsW - w);
  const y = Math.min(Math.max(0, rect.y), boundsH - h);
  return { x, y, w, h };
}

export function ImageCropModal({ file, onConfirm, onUseWhole, onCancel }: ImageCropModalProps) {
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [rect, setRect] = useState<Rect | null>(null);
  const [cropping, setCropping] = useState(false);

  // Dimensoes maximas baseadas dinamicamente na largura/altura do viewport
  const [maxDisplayW, setMaxDisplayW] = useState(() => {
    return typeof window !== 'undefined' ? Math.min(720, window.innerWidth - 64 - RULER_SIZE) : 720;
  });
  const [maxDisplayH, setMaxDisplayH] = useState(() => {
    return typeof window !== 'undefined' ? Math.min(520, window.innerHeight * 0.5) : 520;
  });

  useEffect(() => {
    const handleResize = () => {
      setMaxDisplayW(Math.min(720, window.innerWidth - 64 - RULER_SIZE));
      setMaxDisplayH(Math.min(520, window.innerHeight * 0.5));
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const imageAreaRef = useRef<HTMLDivElement>(null);
  const hRulerRef = useRef<HTMLCanvasElement>(null);
  const vRulerRef = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef<{ mode: DragMode; startClientX: number; startClientY: number; startRect: Rect } | null>(null);

  useEffect(() => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => setImage(img);
    img.onerror = () => setLoadError('Nao foi possivel carregar essa imagem.');
    img.src = objectUrl;
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);

  const naturalW = image?.naturalWidth ?? 0;
  const naturalH = image?.naturalHeight ?? 0;

  const displayScale = useMemo(() => {
    if (!naturalW || !naturalH) return 1;
    const scale = Math.min(maxDisplayW / naturalW, maxDisplayH / naturalH, 8);
    return scale > 0 ? scale : 1;
  }, [naturalW, naturalH, maxDisplayW, maxDisplayH]);

  const displayW = Math.round(naturalW * displayScale);
  const displayH = Math.round(naturalH * displayScale);

  useEffect(() => {
    if (image && naturalW && naturalH) {
      setRect({ x: 0, y: 0, w: naturalW, h: naturalH });
    }
  }, [image, naturalW, naturalH]);

  // Reguas: uma marca maior a cada "step" pixels da imagem ORIGINAL,
  // convertido pra posicao em pixel de TELA (display).
  useEffect(() => {
    const hCanvas = hRulerRef.current;
    const vCanvas = vRulerRef.current;
    if (!hCanvas || !vCanvas || !displayW || !displayH) return;

    hCanvas.width = displayW;
    hCanvas.height = RULER_SIZE;
    vCanvas.width = RULER_SIZE;
    vCanvas.height = displayH;

    const step = niceStep(80 / displayScale);
    const hCtx = hCanvas.getContext('2d')!;
    const vCtx = vCanvas.getContext('2d')!;

    hCtx.clearRect(0, 0, displayW, RULER_SIZE);
    hCtx.fillStyle = '#0f1726';
    hCtx.fillRect(0, 0, displayW, RULER_SIZE);
    hCtx.strokeStyle = '#3a4d6b';
    hCtx.fillStyle = '#8fa3bd';
    hCtx.font = '10px sans-serif';
    hCtx.textBaseline = 'top';
    for (let value = 0; value <= naturalW; value += step) {
      const x = Math.round(value * displayScale) + 0.5;
      hCtx.beginPath();
      hCtx.moveTo(x, RULER_SIZE);
      hCtx.lineTo(x, RULER_SIZE - 10);
      hCtx.stroke();
      hCtx.fillText(String(value), x + 3, 2);
    }

    vCtx.clearRect(0, 0, RULER_SIZE, displayH);
    vCtx.fillStyle = '#0f1726';
    vCtx.fillRect(0, 0, RULER_SIZE, displayH);
    vCtx.strokeStyle = '#3a4d6b';
    vCtx.fillStyle = '#8fa3bd';
    vCtx.font = '10px sans-serif';
    for (let value = 0; value <= naturalH; value += step) {
      const y = Math.round(value * displayScale) + 0.5;
      vCtx.beginPath();
      vCtx.moveTo(RULER_SIZE, y);
      vCtx.lineTo(RULER_SIZE - 10, y);
      vCtx.stroke();
      vCtx.save();
      vCtx.translate(10, y + 3);
      vCtx.rotate(-Math.PI / 2);
      vCtx.fillText(String(value), 0, 0);
      vCtx.restore();
    }
  }, [displayW, displayH, displayScale, naturalW, naturalH]);

  function startDrag(mode: DragMode, event: React.PointerEvent) {
    if (!rect) return;
    event.preventDefault();
    event.stopPropagation();
    (event.target as Element).setPointerCapture(event.pointerId);
    dragRef.current = { mode, startClientX: event.clientX, startClientY: event.clientY, startRect: rect };
  }

  function handlePointerMove(event: React.PointerEvent) {
    const drag = dragRef.current;
    if (!drag || !drag.mode) return;
    const dxNatural = (event.clientX - drag.startClientX) / displayScale;
    const dyNatural = (event.clientY - drag.startClientY) / displayScale;
    const start = drag.startRect;
    let next: Rect = start;

    if (drag.mode === 'move') {
      next = { ...start, x: start.x + dxNatural, y: start.y + dyNatural };
    } else {
      let { x, y, w, h } = start;
      if (drag.mode === 'nw' || drag.mode === 'ne') {
        h = start.h - dyNatural;
        y = start.y + dyNatural;
      }
      if (drag.mode === 'sw' || drag.mode === 'se') {
        h = start.h + dyNatural;
      }
      if (drag.mode === 'nw' || drag.mode === 'sw') {
        w = start.w - dxNatural;
        x = start.x + dxNatural;
      }
      if (drag.mode === 'ne' || drag.mode === 'se') {
        w = start.w + dxNatural;
      }
      next = { x, y, w, h };
    }

    setRect(clampRect(next, naturalW, naturalH));
  }

  function endDrag() {
    dragRef.current = null;
  }

  async function handleConfirm() {
    if (!rect || !image || cropping) return;
    setCropping(true);
    try {
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(rect.w);
      canvas.height = Math.round(rect.h);
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(image, rect.x, rect.y, rect.w, rect.h, 0, 0, canvas.width, canvas.height);
      const blob: Blob = await new Promise((resolve, reject) => {
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Falha ao recortar.'))), file.type || 'image/png');
      });
      const croppedFile = new File([blob], file.name, { type: blob.type });
      onConfirm(croppedFile);
    } catch {
      setLoadError('Nao foi possivel recortar a imagem.');
    } finally {
      setCropping(false);
    }
  }

  const selX = rect ? Math.round(rect.x * displayScale) : 0;
  const selY = rect ? Math.round(rect.y * displayScale) : 0;
  const selW = rect ? Math.round(rect.w * displayScale) : 0;
  const selH = rect ? Math.round(rect.h * displayScale) : 0;
  const handleSize = 12;

  return (
    <div className="pieces-modal-backdrop" onClick={onCancel}>
      <div className="pieces-modal crop-modal" onClick={(e) => e.stopPropagation()}>
        <div className="pieces-modal-header">
          <div>
            <h2>
              <Crop size={16} /> Recortar imagem
            </h2>
          </div>
          <button type="button" className="pieces-modal-close" onClick={onCancel} aria-label="Fechar">
            <X size={18} />
          </button>
        </div>

        <p className="bandeira-hint">
          Arraste as bordas ou os cantos pra escolher so a parte da imagem que voce quer taquear. Se a imagem for
          maior do que precisa, recorte antes de escolher o tamanho e a quantidade de cores.
        </p>

        {loadError ? <p className="mold-import-error">{loadError}</p> : null}

        {image && rect ? (
          <>
            <div className="crop-grid" style={{ gridTemplateColumns: `${RULER_SIZE}px auto` }}>
              <div className="crop-ruler-corner" style={{ width: RULER_SIZE, height: RULER_SIZE }} />
              <canvas ref={hRulerRef} className="crop-ruler crop-ruler-h" />
              <canvas ref={vRulerRef} className="crop-ruler crop-ruler-v" />

              <div
                className="crop-image-area"
                ref={imageAreaRef}
                style={{ width: displayW, height: displayH }}
                onPointerMove={handlePointerMove}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
              >
                <img src={image.src} alt="Imagem pra recortar" className="crop-image" draggable={false} />

                <div
                  className="crop-rect"
                  style={{ left: selX, top: selY, width: selW, height: selH }}
                  onPointerDown={(e) => startDrag('move', e)}
                >
                  {(['nw', 'ne', 'sw', 'se'] as const).map((corner) => (
                    <span
                      key={corner}
                      className={`crop-handle crop-handle-${corner}`}
                      style={{ width: handleSize, height: handleSize }}
                      onPointerDown={(e) => startDrag(corner, e)}
                    />
                  ))}
                  <span className="crop-rect-size">
                    {Math.round(rect.w)} x {Math.round(rect.h)} px
                  </span>
                </div>
              </div>
            </div>

            <div className="crop-modal-actions">
              <button type="button" className="mold-secondary-button" onClick={onUseWhole} disabled={cropping}>
                Usar imagem inteira (sem recortar)
              </button>
              <button type="button" className="mold-secondary-button" onClick={onCancel} disabled={cropping}>
                Cancelar
              </button>
              <button type="button" className="mold-save-button" onClick={() => void handleConfirm()} disabled={cropping}>
                <Crop size={16} />
                {cropping ? 'Recortando...' : 'Recortar e continuar'}
              </button>
            </div>
          </>
        ) : !loadError ? (
          <p className="bandeira-size-hint">Carregando imagem...</p>
        ) : null}
      </div>
    </div>
  );
}
