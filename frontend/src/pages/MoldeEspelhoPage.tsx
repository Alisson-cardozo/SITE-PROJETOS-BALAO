import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Download, FlipHorizontal2, Loader2, Search } from 'lucide-react';

interface MoldData {
  name?: string;
  perimeter: number[];
  heightAcum: number[];
}

interface MoldModel {
  key: string;
  name: string;
  category: string;
}

const CATEGORY_ORDER = [
  'Modelado',
  'Piao',
  'Bagda',
  'Truffy',
  'Careca',
  'Golfier',
  'Pigolbag',
  'Lapidado',
  'Hally',
  'Barrica',
  'Tangerina',
  'Magico',
  'Otros',
  'Corte Recto',
];

const CATEGORY_RULES: [string, RegExp][] = [
  ['Corte Recto', /corte.?ret[oa]/i],
  ['Tangerina', /tangerin/i],
  ['Barrica', /barrica/i],
  ['Hally', /hally/i],
  ['Lapidado', /lapidado/i],
  ['Pigolbag', /pi[gn]ol?bag|pigobald|piglbag/i],
  ['Golfier', /golfier/i],
  ['Careca', /careca/i],
  ['Bagda', /bagda/i],
  ['Truffy', /truff/i],
  ['Piao', /piao/i],
  ['Magico', /magico/i],
  ['Modelado', /modelado/i],
];

function categorize(key: string): string {
  for (const [name, re] of CATEGORY_RULES) {
    if (re.test(key)) return name;
  }
  return 'Otros';
}

/**
 * Mesma formula do lek.html:
 * widthHalf = (perimeter[i] * Largo / LargoBase) / (2 * numCaras) + bainha/2
 * y=0 na boca, y=altura na ponta (heightAcum).
 */
function buildProfileCm(
  raw: MoldData,
  heightCm: number,
  gomos: number,
  bainhaCm: number
): Array<{ y: number; halfW: number }> {
  const hs = raw.heightAcum ?? [];
  const ps = raw.perimeter ?? [];
  if (hs.length < 2 || ps.length < 2) return [];

  const largoBase = hs[hs.length - 1] || 1;
  const n = Math.max(gomos, 3);
  const pts: Array<{ y: number; halfW: number }> = [];
  for (let i = 0; i < Math.min(hs.length, ps.length); i++) {
    const y = (hs[i] / largoBase) * heightCm;
    const halfW = Math.max(0, (ps[i] * heightCm / largoBase) / (2 * n) + bainhaCm / 2);
    pts.push({ y, halfW });
  }
  // Lek inverte se a ponta ficar mais larga que a boca — mantemos ordem do heightAcum
  // e desenhamos com y crescendo da boca (topo visual invertido se necessario).
  return pts;
}

function pathGomo(pts: Array<{ y: number; halfW: number }>, cx: number, flipY: boolean, totalH: number): string {
  if (!pts.length) return '';
  const yOf = (y: number) => (flipY ? totalH - y : y);
  let d = `M ${cx + pts[0].halfW} ${yOf(pts[0].y)}`;
  for (let i = 1; i < pts.length; i++) {
    d += ` L ${cx + pts[i].halfW} ${yOf(pts[i].y)}`;
  }
  for (let i = pts.length - 1; i >= 0; i--) {
    d += ` L ${cx - pts[i].halfW} ${yOf(pts[i].y)}`;
  }
  return d + ' Z';
}

export function MoldeEspelhoPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentData, setCurrentData] = useState<Record<string, MoldData> | null>(null);
  const [allModels, setAllModels] = useState<MoldModel[]>([]);
  const [modelsByCategory, setModelsByCategory] = useState<Record<string, MoldModel[]>>({});
  const [selectedKey, setSelectedKey] = useState('');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const [listOpen, setListOpen] = useState(false);

  const [heightCm, setHeightCm] = useState(300);
  const [gomos, setGomos] = useState(16);
  const [bainhaCm, setBainhaCm] = useState(1);
  const [gapCm, setGapCm] = useState(2);
  const [showCenter, setShowCenter] = useState(true);
  const [showBainha, setShowBainha] = useState(true);

  const pickerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/data.json');
        if (!res.ok) throw new Error('data.json nao encontrado');
        const data = (await res.json()) as Record<string, MoldData>;
        if (cancelled) return;
        setCurrentData(data);
        const models = Object.keys(data)
          .map((key) => ({ key, name: data[key].name || key, category: categorize(key) }))
          .sort((a, b) => a.name.localeCompare(b.name, 'pt'));
        setAllModels(models);
        const byCat: Record<string, MoldModel[]> = {};
        models.forEach((m) => {
          (byCat[m.category] = byCat[m.category] || []).push(m);
        });
        setModelsByCategory(byCat);
        setSelectedKey(models.find((m) => m.key === 'Piao3')?.key || models[0]?.key || '');
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Falha ao carregar moldes');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!pickerRef.current?.contains(e.target as Node)) setListOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const raw = selectedKey && currentData ? currentData[selectedKey] : null;
  const profile = useMemo(() => {
    if (!raw) return [];
    // Contorno do gomo sem bainha embutida (linha principal).
    return buildProfileCm(raw, heightCm, gomos, 0);
  }, [raw, heightCm, gomos]);

  /** Perfil com bainha embutida (costura/corte). */
  const profileComBainha = useMemo(() => {
    if (!raw) return [];
    return buildProfileCm(raw, heightCm, gomos, bainhaCm);
  }, [raw, heightCm, gomos, bainhaCm]);

  const layout = useMemo(() => {
    const usePts = showBainha ? profileComBainha : profile;
    if (!usePts.length) return null;
    const maxHalf = Math.max(...usePts.map((p) => p.halfW), 0.1);
    const pad = Math.max(heightCm * 0.04, 8);
    const halfW = maxHalf;
    const gomoW = halfW * 2;
    const gap = Math.max(0, gapCm);
    const totalW = gomoW * 2 + gap + pad * 2;
    const totalH = heightCm + pad * 2;
    const leftCx = pad + halfW;
    const rightCx = pad + gomoW + gap + halfW;
    const top = pad;
    // heightAcum: 0 = boca, max = ponta — desenhamos ponta em cima (flip Y)
    return { maxHalf, pad, halfW, gomoW, gap, totalW, totalH, leftCx, rightCx, top };
  }, [profile, profileComBainha, heightCm, gapCm, showBainha]);

  const leftPath = useMemo(() => {
    if (!layout || !profile.length) return '';
    // Ponta em cima: flip Y no path
    const shifted = profile.map((p) => ({
      y: layout.top + (heightCm - p.y),
      halfW: p.halfW,
    }));
    return pathGomo(shifted, layout.leftCx, false, layout.totalH);
  }, [layout, profile, heightCm]);

  const rightPath = useMemo(() => {
    if (!layout || !profile.length) return '';
    const shifted = profile.map((p) => ({
      y: layout.top + (heightCm - p.y),
      halfW: p.halfW,
    }));
    return pathGomo(shifted, layout.rightCx, false, layout.totalH);
  }, [layout, profile, heightCm]);

  const bainhaPaths = useMemo(() => {
    if (!layout || !profileComBainha.length || !showBainha || bainhaCm <= 0) {
      return { left: '', right: '' };
    }
    const outer = profileComBainha.map((p) => ({
      y: layout.top + (heightCm - p.y),
      halfW: p.halfW,
    }));
    return {
      left: pathGomo(outer, layout.leftCx, false, layout.totalH),
      right: pathGomo(outer, layout.rightCx, false, layout.totalH),
    };
  }, [layout, profileComBainha, showBainha, bainhaCm, heightCm]);

  const selectedName = allModels.find((m) => m.key === selectedKey)?.name || selectedKey || '—';

  const filteredModels = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (q) {
      const pool = category ? modelsByCategory[category] || [] : allModels;
      return pool.filter((m) => m.name.toLowerCase().includes(q) || m.key.toLowerCase().includes(q));
    }
    return null;
  }, [search, category, modelsByCategory, allModels]);

  const downloadSvg = useCallback(() => {
    if (!layout || !leftPath || !rightPath) return;
    const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${layout.totalW}mm" height="${layout.totalH}mm" viewBox="0 0 ${layout.totalW} ${layout.totalH}">
  <rect width="100%" height="100%" fill="#ffffff"/>
  ${showBainha && bainhaPaths.left ? `<path d="${bainhaPaths.left}" fill="none" stroke="#94a3b8" stroke-width="0.35" stroke-dasharray="2 1.5"/>` : ''}
  ${showBainha && bainhaPaths.right ? `<path d="${bainhaPaths.right}" fill="none" stroke="#94a3b8" stroke-width="0.35" stroke-dasharray="2 1.5"/>` : ''}
  <path d="${leftPath}" fill="none" stroke="#111111" stroke-width="0.5"/>
  <path d="${rightPath}" fill="none" stroke="#111111" stroke-width="0.5"/>
  ${showCenter ? `<line x1="${layout.leftCx}" y1="${layout.top}" x2="${layout.leftCx}" y2="${layout.top + heightCm}" stroke="#e11d48" stroke-width="0.25" stroke-dasharray="3 2"/>
  <line x1="${layout.rightCx}" y1="${layout.top}" x2="${layout.rightCx}" y2="${layout.top + heightCm}" stroke="#e11d48" stroke-width="0.25" stroke-dasharray="3 2"/>` : ''}
  <text x="${layout.pad}" y="${layout.totalH - 4}" font-size="4" fill="#64748b" font-family="Segoe UI,sans-serif">${selectedName} · ${heightCm}cm · ${gomos}g · espelho</text>
</svg>`;
    const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `molde-espelho-${selectedKey || 'molde'}-${heightCm}cm.svg`;
    a.click();
    URL.revokeObjectURL(a.href);
  }, [layout, leftPath, rightPath, bainhaPaths, showBainha, showCenter, heightCm, gomos, selectedName, selectedKey]);

  if (loading) {
    return (
      <div className="plotter-loading">
        <Loader2 className="mold-import-spinner" size={22} />
        <span>Carregando catalogo de moldes...</span>
      </div>
    );
  }

  if (error) {
    return <p className="mold-import-error">{error}</p>;
  }

  return (
    <div className="plotter-page molde-espelho-page">
      <div className="plotter-toolbar">
        <div className="plotter-toolbar-text">
          <h2>
            <FlipHorizontal2 size={20} style={{ verticalAlign: 'middle', marginRight: 8 }} />
            Molde Espelho
          </h2>
          <p>Dois gomos lado a lado (par simetrico) para riscar, cortar e costurar em espelho.</p>
        </div>
        <div className="plotter-toolbar-actions">
          <button type="button" className="mold-save-button" onClick={downloadSvg} disabled={!layout}>
            <Download size={16} /> Baixar SVG (1:1 cm)
          </button>
        </div>
      </div>

      <div className="riscado-layout molde-espelho-layout">
        <div className="bandeira-create-panel riscado-config-panel">
          <div className="riscado-field-group">
            <h4>Molde</h4>
            <div className="espelho-picker" ref={pickerRef}>
              <div className="espelho-search-wrap">
                <Search size={14} />
                <input
                  type="text"
                  value={search}
                  placeholder="Buscar molde ou categoria..."
                  onFocus={() => setListOpen(true)}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setListOpen(true);
                  }}
                />
              </div>
              <div className="model-current" style={{ marginTop: 8 }}>
                Atual: <strong>{selectedName}</strong>
              </div>
              {listOpen && (
                <div className="espelho-model-list">
                  {category && (
                    <button
                      type="button"
                      className="espelho-list-back"
                      onClick={() => {
                        setCategory(null);
                        setSearch('');
                      }}
                    >
                      ← Voltar categorias
                    </button>
                  )}
                  {filteredModels
                    ? filteredModels.length
                      ? filteredModels.map((m) => (
                          <button
                            key={m.key}
                            type="button"
                            className={`espelho-list-item${m.key === selectedKey ? ' on' : ''}`}
                            onClick={() => {
                              setSelectedKey(m.key);
                              setListOpen(false);
                              setSearch('');
                              setCategory(null);
                            }}
                          >
                            {m.name}
                          </button>
                        ))
                      : (
                        <div className="espelho-list-empty">Nenhum molde encontrado</div>
                      )
                    : category
                      ? (modelsByCategory[category] || []).map((m) => (
                          <button
                            key={m.key}
                            type="button"
                            className={`espelho-list-item${m.key === selectedKey ? ' on' : ''}`}
                            onClick={() => {
                              setSelectedKey(m.key);
                              setListOpen(false);
                              setCategory(null);
                            }}
                          >
                            {m.name}
                          </button>
                        ))
                      : CATEGORY_ORDER.map((cat) => {
                          const items = modelsByCategory[cat];
                          if (!items?.length) return null;
                          return (
                            <button
                              key={cat}
                              type="button"
                              className="espelho-list-cat"
                              onClick={() => setCategory(cat)}
                            >
                              <span>{cat}</span>
                              <em>{items.length}</em>
                            </button>
                          );
                        })}
                </div>
              )}
            </div>
          </div>

          <div className="riscado-field-group">
            <h4>Dimensoes</h4>
            <div className="bandeira-size-fields">
              <label className="auth-field">
                <span>Altura (cm)</span>
                <input
                  type="number"
                  min={10}
                  step={1}
                  value={heightCm}
                  onChange={(e) => setHeightCm(Math.max(10, Number(e.target.value) || 10))}
                />
              </label>
              <label className="auth-field">
                <span>Qtd. de gomos</span>
                <input
                  type="number"
                  min={4}
                  max={199}
                  step={1}
                  value={gomos}
                  onChange={(e) => setGomos(Math.max(4, Math.min(199, Number(e.target.value) || 4)))}
                />
              </label>
              <label className="auth-field">
                <span>Bainha (cm)</span>
                <input
                  type="number"
                  min={0}
                  max={50}
                  step={0.5}
                  value={bainhaCm}
                  onChange={(e) => setBainhaCm(Math.max(0, Number(e.target.value) || 0))}
                />
              </label>
              <label className="auth-field">
                <span>Espaco entre gomos (cm)</span>
                <input
                  type="number"
                  min={0}
                  max={50}
                  step={0.5}
                  value={gapCm}
                  onChange={(e) => setGapCm(Math.max(0, Number(e.target.value) || 0))}
                />
              </label>
            </div>
          </div>

          <div className="riscado-field-group">
            <h4>Visual</h4>
            <label className="criar-check">
              <input type="checkbox" checked={showCenter} onChange={(e) => setShowCenter(e.target.checked)} />
              Linha de centro (eixo do gomo)
            </label>
            <label className="criar-check">
              <input type="checkbox" checked={showBainha} onChange={(e) => setShowBainha(e.target.checked)} />
              Mostrar bainha (tracejado)
            </label>
          </div>

          {layout && (
            <div className="riscado-resumo">
              <p>
                Par em espelho: <strong>2 gomos</strong> · altura <strong>{heightCm} cm</strong>
              </p>
              <p>
                Area aproximada:{' '}
                <strong>
                  {layout.totalW.toFixed(1)} × {layout.totalH.toFixed(1)} cm
                </strong>
              </p>
            </div>
          )}
        </div>

        <div className="riscado-preview-area">
          {layout && leftPath ? (
            <div className="riscado-preview-scroll molde-espelho-preview">
              <svg
                viewBox={`0 0 ${layout.totalW} ${layout.totalH}`}
                className="riscado-preview-fan-svg riscado-preview-white"
                role="img"
                aria-label="Molde em espelho"
              >
                <rect x={0} y={0} width={layout.totalW} height={layout.totalH} fill="#fff" />
                {showBainha && bainhaPaths.left ? (
                  <path d={bainhaPaths.left} fill="none" stroke="#94a3b8" strokeWidth={0.4} strokeDasharray="2 1.5" />
                ) : null}
                {showBainha && bainhaPaths.right ? (
                  <path d={bainhaPaths.right} fill="none" stroke="#94a3b8" strokeWidth={0.4} strokeDasharray="2 1.5" />
                ) : null}
                <path d={leftPath} fill="rgba(20,184,166,0.08)" stroke="#111" strokeWidth={0.55} />
                <path d={rightPath} fill="rgba(59,130,246,0.08)" stroke="#111" strokeWidth={0.55} />
                {showCenter ? (
                  <>
                    <line
                      x1={layout.leftCx}
                      y1={layout.top}
                      x2={layout.leftCx}
                      y2={layout.top + heightCm}
                      stroke="#e11d48"
                      strokeWidth={0.3}
                      strokeDasharray="3 2"
                    />
                    <line
                      x1={layout.rightCx}
                      y1={layout.top}
                      x2={layout.rightCx}
                      y2={layout.top + heightCm}
                      stroke="#e11d48"
                      strokeWidth={0.3}
                      strokeDasharray="3 2"
                    />
                  </>
                ) : null}
                <text x={layout.leftCx} y={layout.pad * 0.7} textAnchor="middle" fontSize={Math.max(4, heightCm * 0.025)} fill="#0f766e" fontWeight={700}>
                  Gomo A
                </text>
                <text x={layout.rightCx} y={layout.pad * 0.7} textAnchor="middle" fontSize={Math.max(4, heightCm * 0.025)} fill="#1d4ed8" fontWeight={700}>
                  Gomo B (espelho)
                </text>
              </svg>
              <p className="bandeira-size-hint" style={{ textAlign: 'center', marginTop: '0.5rem' }}>
                Escala do SVG: 1 unidade = 1 cm. Ideal para plotter/corte.
              </p>
            </div>
          ) : (
            <div className="riscado-preview-empty">
              <FlipHorizontal2 size={36} opacity={0.3} />
              <p>Selecione um molde para ver o par em espelho.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
