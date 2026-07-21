export interface PreviewPoint {
  alturaAcumuladaCm: number;
  larguraMeiaCm: number;
}

const VIEW_WIDTH = 240;
const VIEW_HEIGHT = 480;
const PADDING_X = 30;
const PADDING_Y = 20;

export function MoldSilhouettePreview({ points }: { points: PreviewPoint[] }) {
  const maxHeight = Math.max(...points.map((point) => point.alturaAcumuladaCm), 0);

  if (points.length < 2 || maxHeight <= 0) {
    return (
      <div className="mold-preview-empty">
        Adicione pelo menos 2 pontos com altura e largura para ver a previa da silhueta.
      </div>
    );
  }

  const maxHalfWidth = Math.max(...points.map((point) => point.larguraMeiaCm), 1);
  const usableWidth = VIEW_WIDTH - PADDING_X * 2;
  const usableHeight = VIEW_HEIGHT - PADDING_Y * 2;

  const scaleX = (halfWidth: number, sign: 1 | -1) =>
    VIEW_WIDTH / 2 + sign * (halfWidth / maxHalfWidth) * (usableWidth / 2);
  // ponto 1 (altura 0, boca do balao) fica embaixo; o ultimo ponto (bico) fica em cima
  const scaleY = (height: number) => PADDING_Y + usableHeight - (height / maxHeight) * usableHeight;

  const leftSide = points.map((point) => [scaleX(point.larguraMeiaCm, -1), scaleY(point.alturaAcumuladaCm)]);
  const rightSide = [...points]
    .reverse()
    .map((point) => [scaleX(point.larguraMeiaCm, 1), scaleY(point.alturaAcumuladaCm)]);
  const pathData = `M ${[...leftSide, ...rightSide].map(([x, y]) => `${x},${y}`).join(' L ')} Z`;

  return (
    <svg
      viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
      className="mold-preview-svg"
      role="img"
      aria-label="Previa da silhueta do molde"
    >
      <path d={pathData} className="mold-preview-shape" />
      {points.map((point, index) => (
        <g key={index}>
          <circle cx={scaleX(point.larguraMeiaCm, -1)} cy={scaleY(point.alturaAcumuladaCm)} r={2.5} className="mold-preview-dot" />
          <circle cx={scaleX(point.larguraMeiaCm, 1)} cy={scaleY(point.alturaAcumuladaCm)} r={2.5} className="mold-preview-dot" />
        </g>
      ))}
    </svg>
  );
}
