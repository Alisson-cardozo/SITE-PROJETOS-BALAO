import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Maximize2, ZoomIn, ZoomOut } from 'lucide-react';
import {
  BAINHA_JUNTA_CM,
  buildMoldProfile,
  buildTacoDivisions,
  createDefaultTacoConfigs,
  DEFAULT_SECTION_RATIOS,
  expandSectionPartitions,
  profileToClosedPathAsymmetric,
  sliceProfile,
  type MoldProfile,
  type MoldSection,
  type SectionRatios,
  type SectionTacoConfigMap,
} from '../lib/moldGeometry';
import type { MoldPoint } from '../types';

interface GomoTacoPreviewProps {
  pontos: MoldPoint[];
  className?: string;
  showDetails?: boolean;
  sectionColors?: Partial<Record<MoldSection['id'], string>>;
  tacoConfigs?: SectionTacoConfigMap;
  /** Fracoes de altura Boca/Bojo/Bico (somam 1). */
  sectionRatios?: SectionRatios;
  /** Sem barra de zoom/pan — so o SVG, escalando pelo container (uso em cards/miniaturas). */
  compact?: boolean;
  bainhaCm?: number;
}

const ZOOM_MIN = 25;
const ZOOM_MAX = 600;
const ZOOM_STEP = 25;
const FIT_ZOOM = 100;
/** Largura base (px) do gomo em zoom 100% — molde completo legivel. */
const BASE_WIDTH_PX = 220;

function formatCm(value: number): string {
  const n = Number(value);
  const text = Number.isFinite(n) ? n.toFixed(1).replace(/\.0$/, '').replace('.', ',') : '0';
  return `${text} cm`;
}

function clampZoom(value: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(value)));
}

export function GomoTacoPreview({
  pontos,
  className,
  showDetails = false,
  sectionColors,
  tacoConfigs,
  sectionRatios = DEFAULT_SECTION_RATIOS,
  compact = false,
}: GomoTacoPreviewProps) {
  const resolvedTacoConfigs = tacoConfigs ?? createDefaultTacoConfigs(1);
  const profile = useMemo(
    () => buildMoldProfile(pontos, sectionRatios, resolvedTacoConfigs),
    [pontos, sectionRatios, resolvedTacoConfigs]
  );
  const [zoom, setZoom] = useState(FIT_ZOOM);
  const [isPanning, setIsPanning] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const panRef = useRef<{
    active: boolean;
    pointerId: number | null;
    startX: number;
    startY: number;
    scrollLeft: number;
    scrollTop: number;
  }>({
    active: false,
    pointerId: null,
    startX: 0,
    startY: 0,
    scrollLeft: 0,
    scrollTop: 0,
  });

  useEffect(() => {
    const el = stageRef.current;
    if (!el) {
      return;
    }

    function onWheel(event: WheelEvent) {
      // Rolagem normal = percorre o molde (boca/bojo/bico).
      // Ctrl/Cmd + scroll = zoom.
      if (!(event.ctrlKey || event.metaKey)) {
        return;
      }
      event.preventDefault();
      const direction = event.deltaY > 0 ? -1 : 1;
      const step = event.shiftKey ? ZOOM_STEP * 2 : ZOOM_STEP;
      setZoom((current) => clampZoom(current + direction * step));
    }

    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  useEffect(() => {
    function onMove(event: PointerEvent) {
      const pan = panRef.current;
      const el = stageRef.current;
      if (!pan.active || !el || pan.pointerId !== event.pointerId) {
        return;
      }
      const dx = event.clientX - pan.startX;
      const dy = event.clientY - pan.startY;
      // so engaja pan apos pequeno movimento (evita “travar” clique/scroll)
      if (Math.abs(dx) < 3 && Math.abs(dy) < 3) {
        return;
      }
      event.preventDefault();
      el.scrollLeft = pan.scrollLeft - dx;
      el.scrollTop = pan.scrollTop - dy;
    }

    function endPan(event?: PointerEvent) {
      const pan = panRef.current;
      if (!pan.active) {
        return;
      }
      if (event && pan.pointerId != null && pan.pointerId !== event.pointerId) {
        return;
      }
      pan.active = false;
      pan.pointerId = null;
      setIsPanning(false);
    }

    function onUp(event: PointerEvent) {
      endPan(event);
    }

    function onBlur() {
      endPan();
    }

    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      window.removeEventListener('blur', onBlur);
    };
  }, []);

  function onPanPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    // so botao esquerdo / toque — nao bloqueia a rolagem da roda/trackpad
    if (event.button !== 0) {
      return;
    }
    // ignora clique em botoes/inputs da barra de zoom
    const target = event.target as HTMLElement | null;
    if (target?.closest('button, input, a, label')) {
      return;
    }
    const el = stageRef.current;
    if (!el) {
      return;
    }

    panRef.current = {
      active: true,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      scrollLeft: el.scrollLeft,
      scrollTop: el.scrollTop,
    };
    setIsPanning(true);
    if (event.pointerType === 'mouse') {
      try {
        el.setPointerCapture(event.pointerId);
      } catch {
        // ignore
      }
    }
  }

  if (!profile) {
    return (
      <div className="gomo-preview-empty">
        Este molde precisa de pelo menos 2 pontos com altura e largura para gerar o gomo.
      </div>
    );
  }

  const coloredProfile: MoldProfile = {
    ...profile,
    secoes: profile.secoes.map((secao) => ({
      ...secao,
      cor: sectionColors?.[secao.id] ?? secao.cor,
    })),
  };

  const displayWidth = Math.round(BASE_WIDTH_PX * (zoom / 100));

  if (compact) {
    return (
      <div className="gomo-compact-wrap">
        <GomoSvgTrueScale
          profile={coloredProfile}
          className={className}
          showDetails={showDetails}
          tacoConfigs={resolvedTacoConfigs}
        />
      </div>
    );
  }

  return (
    <div className="gomo-true-scale-wrap">
      <div className="gomo-zoom-bar">
        <button
          type="button"
          className="gomo-zoom-btn"
          onClick={() => setZoom((z) => clampZoom(z - ZOOM_STEP))}
          disabled={zoom <= ZOOM_MIN}
          title="Diminuir zoom"
        >
          <ZoomOut size={16} />
        </button>

        <input
          type="range"
          className="gomo-zoom-slider"
          min={ZOOM_MIN}
          max={ZOOM_MAX}
          step={ZOOM_STEP}
          value={zoom}
          onChange={(event) => setZoom(clampZoom(Number(event.target.value)))}
          aria-label="Nivel de zoom"
        />

        <button
          type="button"
          className="gomo-zoom-btn"
          onClick={() => setZoom((z) => clampZoom(z + ZOOM_STEP))}
          disabled={zoom >= ZOOM_MAX}
          title="Aumentar zoom"
        >
          <ZoomIn size={16} />
        </button>

        <span className="gomo-zoom-label">{zoom}%</span>

        <button
          type="button"
          className="gomo-zoom-btn gomo-zoom-fit"
          onClick={() => setZoom(FIT_ZOOM)}
          title="Ver molde completo"
        >
          <Maximize2 size={15} />
          Molde completo
        </button>

        <span className="gomo-zoom-hint">
          Clique e arraste para mover · Role para ver · Ctrl+scroll = zoom
        </span>
      </div>

      <div
        className={`gomo-zoom-stage${isPanning ? ' is-panning' : ''}`}
        ref={stageRef}
        onPointerDown={onPanPointerDown}
      >
        <div className="gomo-zoom-inner" style={{ width: displayWidth }}>
          <GomoSvgTrueScale
            profile={coloredProfile}
            className={className}
            showDetails={showDetails}
            tacoConfigs={resolvedTacoConfigs}
          />
        </div>
      </div>
    </div>
  );
}

/**
 * Desenha APENAS 1 gomo (ou 1 peca separada) em escala real (1 cm horizontal = 1 cm vertical).
 * Exportado para reaproveitar no visualizador de "pecas separadas".
 */
export function GomoSvgTrueScale({
  profile,
  className,
  showDetails,
  tacoConfigs,
  monochrome = false,
  bainhaCm = 1.0,
}: {
  profile: MoldProfile;
  className?: string;
  showDetails: boolean;
  tacoConfigs: SectionTacoConfigMap;
  /** Peca em branco (so contorno + grade + bainhas) — para impressao/corte, sem preenchimento colorido. */
  monochrome?: boolean;
  bainhaCm?: number;
}) {
  const { points, alturaTotalCm, larguraMaximaCm, secoes } = profile;
  const maxHalf = Math.max(larguraMaximaCm / 2, 0.1);
  // Fonte proporcional a LARGURA do gomo, nao a altura — o gomo e sempre bem
  // mais alto que largo (as vezes metros de altura por poucos cm de largura).
  // Usar a altura aqui deixava a fonte/regua gigante em moldes compridos: a
  // regua ficava varias vezes mais larga que o proprio molde, e nenhum zoom
  // ajudava porque a proporcao entre os dois nunca mudava.
  const fontSmall = Math.max(larguraMaximaCm * 0.1, 2.6);

  const dimLeft = Math.max(alturaTotalCm * 0.01, 3);
  const dimRight = Math.max(alturaTotalCm * 0.01, 3);
  const padTop = Math.max(alturaTotalCm * 0.02, 6);
  const padBottom = Math.max(alturaTotalCm * 0.015, 4);
  const padSide = Math.max(maxHalf * 0.35, 4);
  /** Espaco pra regua lateral com o resumo de cada reparticao (tacos subindo,
   * altura do taco, metragem da parte, tacos/gomo) — so quando showDetails. */
  const rulerWidth = showDetails ? Math.max(larguraMaximaCm * 1.5, 40) : 0;

  const gomoLeft = dimLeft + padSide;
  const centerX = gomoLeft + maxHalf;
  const gomoRight = centerX + maxHalf;
  const viewW = gomoRight + padSide + dimRight + rulerWidth;
  const viewH = padTop + alturaTotalCm + padBottom;

  const mapX = (half: number, sign: 1 | -1) => centerX + sign * half;
  const mapXAsymmetric = (wBanco: number, sign: 1 | -1) => {
    if (sign === -1) {
      return centerX - wBanco - 1.0;
    } else {
      return centerX + wBanco;
    }
  };
  const mapXAbs = (xCm: number) => centerX + xCm;
  const mapY = (yCm: number) => padTop + (alturaTotalCm - yCm);

  const fullPath = profileToClosedPathAsymmetric(points, mapXAsymmetric, mapY);

  // Remove horizontais/bainhas internas coladas nas bordas — a junta tem UMA bainha de 1 cm.
  const BOUNDARY_EPS = BAINHA_JUNTA_CM + 0.15;

  const sectionPaths = secoes.flatMap((secao) => {
    const cfg = tacoConfigs[secao.id] ?? { partitions: [] };
    const bands = expandSectionPartitions(secao, cfg);
    return bands.map((band, bandIndexInParent) => {
      const raw = buildTacoDivisions(band, band.flatConfig, points, bainhaCm);
      const divisions = {
        ...raw,
        horizontals: raw.horizontals.filter(
          (line) =>
            Math.abs(line.yCm - band.inicioCm) > BOUNDARY_EPS &&
            Math.abs(line.yCm - band.fimCm) > BOUNDARY_EPS
        ),
        horizontalHems: raw.horizontalHems.filter(
          (line) =>
            Math.abs(line.yCm - band.inicioCm) > BOUNDARY_EPS &&
            Math.abs(line.yCm - band.fimCm) > BOUNDARY_EPS
        ),
      };
      const fillColor = band.partition.cor || band.cor || secao.cor;
      return {
        secao: band,
        parentId: secao.id as MoldSection['id'],
        bandIndexInParent,
        fillColor,
        path: profileToClosedPathAsymmetric(sliceProfile(points, band.inicioCm, band.fimCm), mapXAsymmetric, mapY),
        midY: mapY((band.inicioCm + band.fimCm) / 2),
        lineY: mapY(band.fimCm),
        divisions,
        config: band.partition,
      };
    });
  });

  // Preenche por REPARTICAO (cada parte pode ter cor propria)
  const colorFills = sectionPaths.map((band) => ({
    key: `fill-${band.secao.nome}-${band.bandIndexInParent}`,
    path: band.path,
    color: band.fillColor,
  }));

  /**
   * Junta entre partes: 1 corte + 1 bainha de 1 cm NA PARTE DE BAIXO.
   * Taco de cima 5 cm fica sobre a bainha 1 cm → encontro de 6 cm.
   * Sem multiplas linhas empilhadas.
   */
  const divisionBoundaries = sectionPaths
    .filter((band) => Math.abs(band.secao.fimCm - alturaTotalCm) > 0.05)
    .map((band, index) => {
      const yCm = band.secao.fimCm;
      const half = interpolateAt(profile, yCm);
      const isPartitionSplit = band.bandIndexInParent > 0;
      const parentBands = sectionPaths.filter((b) => b.parentId === band.parentId);
      const upperBand = isPartitionSplit ? parentBands[band.bandIndexInParent - 1] : null;
      const divisionColor = isPartitionSplit
        ? upperBand?.config.corDivisao || band.config.corDivisao || '#2563eb'
        : '#0f2740';

      // Sempre 1 cm abaixo do corte, na parte de baixo (esta faixa)
      const yHem = yCm - BAINHA_JUNTA_CM;
      const hemFits = yHem > band.secao.inicioCm + 0.02 && yHem > 0.02;
      const hemHalf = hemFits ? interpolateAt(profile, yHem) : half;

      return {
        key: `boundary-${band.secao.nome}-${index}`,
        yCm,
        halfCm: half,
        color: divisionColor,
        strokeWidth: isPartitionSplit ? 1.2 : 2.2,
        isPartitionSplit,
        hem: hemFits
          ? {
              yCm: yHem,
              halfCm: hemHalf,
            }
          : null,
      };
    });

  // Tracos em pixels de tela (nao em cm)
  const strokeOutline = 2.4;
  const strokeTaco = 1.25;
  const strokeHem = 0.7;
  const strokeDim = 1.1;
  const hemColor = '#1a1a1a';
  const cutColor = '#13283f';
  const clipId = `gomo-real-${Math.round(alturaTotalCm * 10)}-${Math.round(larguraMaximaCm * 10)}`;
  const nonScale = { vectorEffect: 'non-scaling-stroke' as const };

  return (
    <svg
      viewBox={`0 0 ${viewW} ${viewH}`}
      className={className ?? 'gomo-taco-svg'}
      role="img"
      aria-label="Um gomo do molde em escala real, dividido em boca, bojo e bico com tacos"
      preserveAspectRatio="xMidYMid meet"
    >
      <defs>
        <clipPath id={clipId}>
          <path d={fullPath} />
        </clipPath>
      </defs>

      {monochrome
        ? null
        : colorFills.map(({ key, path, color }) => (
            <path key={key} d={path} fill={color} stroke="none" opacity={0.95} />
          ))}

      {/* Divisoes de taco (mais grossas) */}
      <g clipPath={`url(#${clipId})`}>
        {sectionPaths.map(({ secao, divisions }, bandIndex) => (
          <g key={`cuts-${secao.nome}-${bandIndex}`}>
            {divisions.horizontals.map((line, index) => (
              <line
                key={`th-${bandIndex}-${index}`}
                x1={mapXAbs(-line.halfCm)}
                x2={mapXAbs(line.halfCm)}
                y1={mapY(line.yCm)}
                y2={mapY(line.yCm)}
                stroke={cutColor}
                strokeWidth={strokeTaco}
                {...nonScale}
              />
            ))}
            {divisions.verticals.map((poly, index) => (
              <polyline
                key={`tv-${bandIndex}-${index}`}
                points={poly.map((p) => `${mapXAbs(p.xCm)},${mapY(p.yCm)}`).join(' ')}
                fill="none"
                stroke={cutColor}
                strokeWidth={strokeTaco}
                strokeLinejoin="round"
                {...nonScale}
              />
            ))}
          </g>
        ))}
      </g>

      {/* Bainhas: linha FINA a 0,5cm (internas/direita) e 1cm (esquerda) */}
      <g clipPath={`url(#${clipId})`}>
        {sectionPaths.map(({ secao, divisions }, bandIndex) => (
          <g key={`hems-${secao.nome}-${bandIndex}`}>
            {divisions.horizontalHems.map((line, index) => (
              <line
                key={`hh-${bandIndex}-${index}`}
                x1={mapXAbs(-line.halfCm)}
                x2={mapXAbs(line.halfCm)}
                y1={mapY(line.yCm)}
                y2={mapY(line.yCm)}
                stroke={hemColor}
                strokeWidth={strokeHem}
                strokeOpacity={0.85}
                strokeLinecap="butt"
                {...nonScale}
              />
            ))}
            {divisions.verticalHems.map((hem, index) => (
              <polyline
                key={`vh-${bandIndex}-${index}`}
                points={hem.points.map((p) => `${mapXAbs(p.xCm)},${mapY(p.yCm)}`).join(' ')}
                fill="none"
                stroke={hemColor}
                strokeWidth={strokeHem}
                strokeOpacity={0.85}
                strokeLinecap="butt"
                strokeLinejoin="miter"
                {...nonScale}
              />
            ))}
          </g>
        ))}
      </g>

      <path
        d={fullPath}
        fill="none"
        stroke={cutColor}
        strokeWidth={strokeOutline}
        strokeLinejoin="round"
        {...nonScale}
      />

      {/* Junta: 1 corte + 1 bainha de 1 cm so na parte de baixo */}
      {divisionBoundaries.map((boundary) => (
        <g key={boundary.key}>
          <line
            x1={mapX(boundary.halfCm, -1)}
            x2={mapX(boundary.halfCm, 1)}
            y1={mapY(boundary.yCm)}
            y2={mapY(boundary.yCm)}
            stroke={boundary.color}
            strokeWidth={boundary.strokeWidth}
            strokeLinecap="butt"
            {...nonScale}
          />
          {boundary.hem ? (
            <line
              x1={mapX(boundary.hem.halfCm, -1)}
              x2={mapX(boundary.hem.halfCm, 1)}
              y1={mapY(boundary.hem.yCm)}
              y2={mapY(boundary.hem.yCm)}
              stroke={hemColor}
              strokeWidth={strokeHem}
              strokeOpacity={0.95}
              strokeLinecap="butt"
              {...nonScale}
            />
          ) : null}
        </g>
      ))}

      {/* Regua lateral por reparticao: qt tacos subindo, altura do taco,
          metragem da parte e tacos/gomo — mesma info que vai pro PDF. */}
      {showDetails
        ? sectionPaths
            .filter(({ divisions }) => divisions.totalTacos > 0)
            .map(({ secao, config, divisions }, index) => {
              const rulerX = gomoRight + padSide * 0.5;
              const tickLen = Math.max(larguraMaximaCm * 0.08, 2);
              const textX = rulerX + tickLen + Math.max(larguraMaximaCm * 0.06, 1.5);
              const yTop = mapY(secao.fimCm);
              const yBottom = mapY(secao.inicioCm);
              const yMid = (yTop + yBottom) / 2;
              const lineGap = fontSmall * 1.25;
              const linesStartY = yMid - lineGap * 1.0;

              return (
                <g key={`ruler-band-${secao.nome}-${index}`}>
                  <line x1={rulerX} x2={rulerX} y1={yTop} y2={yBottom} stroke="#1e293b" strokeWidth={strokeDim} {...nonScale} />
                  <line x1={rulerX - tickLen} x2={rulerX} y1={yTop} y2={yTop} stroke="#1e293b" strokeWidth={strokeDim} {...nonScale} />
                  <line x1={rulerX - tickLen} x2={rulerX} y1={yBottom} y2={yBottom} stroke="#1e293b" strokeWidth={strokeDim} {...nonScale} />
                  <text x={textX} y={linesStartY} fontSize={fontSmall} fontWeight={700} fill="#1e293b">
                    {divisions.quantidadeVertical} tacos subindo
                  </text>
                  <text x={textX} y={linesStartY + lineGap} fontSize={fontSmall} fill="#1e293b">
                    Taco: {formatCm(config.alturaTacoCm)} altura
                  </text>
                  <text x={textX} y={linesStartY + lineGap * 2} fontSize={fontSmall} fill="#1e293b">
                    {formatCm(secao.alturaCm)} nesta parte
                  </text>
                  <text x={textX} y={linesStartY + lineGap * 3} fontSize={fontSmall} fill="#1e293b">
                    {config.tacosPorGomo} tacos/gomo
                  </text>
                </g>
              );
            })
        : null}

    </svg>
  );
}

function interpolateAt(profile: MoldProfile, yCm: number): number {
  const { points } = profile;
  if (yCm <= points[0].yCm) {
    return points[0].halfWidthCm;
  }
  for (let i = 1; i < points.length; i += 1) {
    const prev = points[i - 1];
    const next = points[i];
    if (yCm <= next.yCm) {
      const span = next.yCm - prev.yCm;
      if (span <= 0) {
        return next.halfWidthCm;
      }
      const t = (yCm - prev.yCm) / span;
      return prev.halfWidthCm + (next.halfWidthCm - prev.halfWidthCm) * t;
    }
  }
  return points[points.length - 1].halfWidthCm;
}


