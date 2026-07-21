import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Download, Loader2, Ruler } from 'lucide-react';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { buildBalaoConeModel, buildConeFan, pointsToClosedPathD, pointsToPolylineAttr } from '../lib/coneGeometry';
import { downloadBlob, slugifyFilename } from '../lib/pdfExport';
import { buildRiscadoPdf } from '../lib/plotterRiscadoPdf';
import type { MoldDetail } from '../types';

interface PlotterRiscadoPageProps {
  moldId: number | null;
  moldHint?: { id: number; nome: string; modelo: string } | null;
  onBackToGallery?: () => void;
}

type Modo = 'repeticao' | 'individual';

/** Nunca renderiza mais que isso de gomos fisicos de uma vez — evita travar o navegador. */
const MAX_PAINEIS_RENDER = 60;

function divisoresDe(total: number): number[] {
  if (total <= 0) {
    return [];
  }
  const divs: number[] = [];
  for (let i = 1; i <= total; i += 1) {
    if (total % i === 0) {
      divs.push(i);
    }
  }
  return divs;
}

interface CalcResult {
  repeticoes: number;
  /** Quantos gomos precisam ser desenhados de fato (a mao) — igual ao leque de cada repeticao. */
  desenhosUnicos: number;
  error: string | null;
}

export function PlotterRiscadoPage({ moldId, moldHint, onBackToGallery }: PlotterRiscadoPageProps) {
  const { token } = useAuth();
  const [mold, setMold] = useState<MoldDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [modo, setModo] = useState<Modo>('repeticao');
  const [repeticoesStr, setRepeticoesStr] = useState('1');
  const [gomosStr, setGomosStr] = useState('');
  const [lastEdited, setLastEdited] = useState<'repeticoes' | 'gomos'>('repeticoes');
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  useEffect(() => {
    if (!token || moldId == null) {
      setMold(null);
      setError(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    api
      .getMold(moldId, token)
      .then((response) => {
        if (cancelled) return;
        setMold(response.data);
        setModo('repeticao');
        setRepeticoesStr('1');
        setGomosStr(String(response.data.quantidade_gomos));
        setLastEdited('repeticoes');
      })
      .catch((err) => {
        if (!cancelled) {
          setMold(null);
          setError(err instanceof ApiError ? err.message : 'Nao foi possivel carregar o molde.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [moldId, token]);

  const quantidadeGomos = mold?.quantidade_gomos ?? 0;

  const divisoresValidos = useMemo(() => divisoresDe(quantidadeGomos), [quantidadeGomos]);

  const calc = useMemo((): CalcResult => {
    if (modo === 'individual') {
      return { repeticoes: 1, desenhosUnicos: quantidadeGomos, error: null };
    }
    if (quantidadeGomos <= 0) {
      return { repeticoes: 0, desenhosUnicos: 0, error: null };
    }

    if (lastEdited === 'repeticoes') {
      const r = parseInt(repeticoesStr, 10);
      if (!Number.isFinite(r) || r < 1) {
        return { repeticoes: 0, desenhosUnicos: 0, error: 'Informe uma quantidade de repeticoes valida.' };
      }
      if (quantidadeGomos % r !== 0) {
        return {
          repeticoes: r,
          desenhosUnicos: 0,
          error: `O molde tem ${quantidadeGomos} gomos, que nao divide certinho por ${r} repeticoes.`,
        };
      }
      return { repeticoes: r, desenhosUnicos: quantidadeGomos / r, error: null };
    }

    const g = parseInt(gomosStr, 10);
    if (!Number.isFinite(g) || g < 1) {
      return { repeticoes: 0, desenhosUnicos: 0, error: 'Informe uma quantidade de gomos valida.' };
    }
    if (quantidadeGomos % g !== 0) {
      return {
        repeticoes: 0,
        desenhosUnicos: g,
        error: `${g} gomos nao fecha certinho com os ${quantidadeGomos} gomos do molde.`,
      };
    }
    return { repeticoes: quantidadeGomos / g, desenhosUnicos: g, error: null };
  }, [modo, lastEdited, repeticoesStr, gomosStr, quantidadeGomos]);

  // Mantem os dois campos sincronizados: quando um da conta certo, reflete o
  // valor calculado no OUTRO campo (o que o usuario esta digitando fica intocado).
  useEffect(() => {
    if (modo !== 'repeticao' || calc.error) return;
    if (lastEdited === 'repeticoes') {
      setGomosStr(String(calc.desenhosUnicos));
    } else {
      setRepeticoesStr(String(calc.repeticoes));
    }
  }, [calc, lastEdited, modo]);

  const coneModel = useMemo(
    () => (mold ? buildBalaoConeModel(mold.pontos, mold.quantidade_gomos) : null),
    [mold]
  );

  const gomosNoLeque = Math.min(calc.desenhosUnicos, MAX_PAINEIS_RENDER);
  const truncado = calc.desenhosUnicos > MAX_PAINEIS_RENDER;

  /**
   * O balao nao e feito de gomos-lente separados — e feito de 2 pecas
   * planificadas: o CONE DO BICO (um leque so, fecha na ponta, abre pra
   * baixo) e o CONE DA BOCA (outro leque, abre pra cima), encostando um no
   * outro no ponto mais largo do molde. Cada raio dentro do leque e um
   * gomo — o angulo de cada um vem da largura real medida naquela altura
   * dividida pela distancia acumulada ate o apice (desenvolvimento de
   * cone/tronco-de-cone, o mesmo principio de abrir um chapeu de
   * aniversario numa folha plana).
   */
  const preview = useMemo(() => {
    if (!coneModel || gomosNoLeque <= 0) {
      return null;
    }

    const maxHalfAngle = Math.max(
      ...coneModel.bico.slices.map((s) => (s.larguraCm / Math.max(s.s, 0.0001)) * gomosNoLeque),
      ...coneModel.boca.slices.map((s) => (s.larguraCm / Math.max(s.s, 0.0001)) * gomosNoLeque)
    ) / 2;
    const larguraEstimadaCm =
      2 * Math.sin(Math.min(maxHalfAngle, Math.PI)) * Math.max(coneModel.bico.raioTotalCm, coneModel.boca.raioTotalCm);

    const padSide = Math.max(larguraEstimadaCm * 0.08, 2);
    const padOuter = Math.max(coneModel.bico.raioTotalCm * 0.02, 3);
    const centerX = padSide + larguraEstimadaCm / 2;

    const apiceYBico = padOuter;
    const seamY = apiceYBico + coneModel.bico.raioTotalCm;
    const apiceYBoca = seamY + coneModel.boca.raioTotalCm;

    const bicoFan = buildConeFan(coneModel.bico, gomosNoLeque, false, centerX, apiceYBico);
    const bocaFan = buildConeFan(coneModel.boca, gomosNoLeque, true, centerX, apiceYBoca);

    const viewW = padSide * 2 + larguraEstimadaCm;
    const viewH = apiceYBoca + padOuter;

    return { bicoFan, bocaFan, seamY, viewW, viewH };
  }, [coneModel, gomosNoLeque]);

  function handleDownloadPdf() {
    if (!mold || calc.error || calc.desenhosUnicos <= 0) return;
    setDownloading(true);
    setDownloadError(null);
    try {
      const blob = buildRiscadoPdf({
        nome: mold.nome,
        modelo: mold.modelo,
        quantidadeGomosTotal: quantidadeGomos,
        modo,
        repeticoes: calc.repeticoes,
        desenhosUnicos: calc.desenhosUnicos,
        pontos: mold.pontos,
      });
      downloadBlob(blob, `${slugifyFilename(mold.nome)}-risco.pdf`);
    } catch (err) {
      setDownloadError(err instanceof Error ? err.message : 'Nao foi possivel gerar o PDF.');
    } finally {
      setDownloading(false);
    }
  }

  if (moldId == null) {
    return (
      <div className="plotter-empty">
        <div className="plotter-empty-card">
          <Ruler size={28} />
          <h2>Plotter (Molde Riscado)</h2>
          <p>
            Selecione um molde na Galeria e clique em <strong>Plotar Risco</strong> para montar o risco dos
            gomos do balao.
          </p>
          {onBackToGallery ? (
            <button type="button" className="mold-add-point" onClick={onBackToGallery}>
              <ArrowLeft size={16} />
              Ir para Galeria de Moldes
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  const titleName = moldHint?.nome || mold?.nome || `Molde #${moldId}`;
  const titleModel = moldHint?.modelo || mold?.modelo || '';

  return (
    <div className="plotter-page">
      <div className="plotter-toolbar">
        <div className="plotter-toolbar-text">
          <h2>Plotter Riscado — {titleName}</h2>
          <p>
            {titleModel ? `${titleModel} · ` : ''}
            {quantidadeGomos > 0 ? `${quantidadeGomos} gomos no molde` : ''}
          </p>
        </div>
        <div className="plotter-toolbar-actions">
          {mold ? (
            <button
              type="button"
              className="mold-save-button"
              onClick={handleDownloadPdf}
              disabled={downloading || !!calc.error || calc.desenhosUnicos <= 0}
            >
              {downloading ? <Loader2 size={16} className="mold-import-spinner" /> : <Download size={16} />}
              {downloading ? 'Gerando...' : 'Baixar PDF (escala real)'}
            </button>
          ) : null}
          {onBackToGallery ? (
            <button type="button" className="mold-import-button plotter-back-btn" onClick={onBackToGallery}>
              <ArrowLeft size={16} />
              Voltar
            </button>
          ) : null}
        </div>
      </div>

      {error ? <p className="mold-import-error">{error}</p> : null}
      {downloadError ? <p className="mold-import-error">{downloadError}</p> : null}

      {loading ? (
        <p className="bandeira-size-hint">
          <Loader2 size={14} className="mold-import-spinner" /> Carregando molde...
        </p>
      ) : mold ? (
        <>
          <div className="bandeira-create-panel">
            <h4>Como o cliente vai desenhar</h4>

            <div className="rifa-form-section" style={{ padding: 0, border: 'none' }}>
              <label className="riscado-modo-option">
                <input
                  type="radio"
                  name="modo-riscado"
                  checked={modo === 'individual'}
                  onChange={() => setModo('individual')}
                />
                <span>
                  <strong>Desenho diferente em cada gomo</strong> — sem repeticao, desenha os {quantidadeGomos || '?'}{' '}
                  gomos um por um.
                </span>
              </label>
              <label className="riscado-modo-option">
                <input
                  type="radio"
                  name="modo-riscado"
                  checked={modo === 'repeticao'}
                  onChange={() => setModo('repeticao')}
                />
                <span>
                  <strong>Repetir um desenho</strong> — desenha so uma parte e repete ao redor do balao.
                </span>
              </label>
            </div>

            {modo === 'repeticao' ? (
              <>
                <div className="bandeira-size-fields">
                  <label className="auth-field">
                    <span>Repeticoes</span>
                    <input
                      type="number"
                      min={1}
                      max={quantidadeGomos || undefined}
                      value={repeticoesStr}
                      onChange={(e) => {
                        setLastEdited('repeticoes');
                        setRepeticoesStr(e.target.value);
                      }}
                    />
                  </label>
                  <label className="auth-field">
                    <span>Gomos para desenhar</span>
                    <input
                      type="number"
                      min={1}
                      max={quantidadeGomos || undefined}
                      value={gomosStr}
                      onChange={(e) => {
                        setLastEdited('gomos');
                        setGomosStr(e.target.value);
                      }}
                    />
                  </label>
                </div>

                {divisoresValidos.length > 0 ? (
                  <p className="bandeira-size-hint">
                    Repeticoes que fecham certinho os {quantidadeGomos} gomos:{' '}
                    {divisoresValidos.map((d, i) => (
                      <span key={d}>
                        <button
                          type="button"
                          className="riscado-divisor-chip"
                          onClick={() => {
                            setLastEdited('repeticoes');
                            setRepeticoesStr(String(d));
                          }}
                        >
                          {d}
                        </button>
                        {i < divisoresValidos.length - 1 ? ' ' : ''}
                      </span>
                    ))}
                  </p>
                ) : (
                  <p className="mold-import-error">Nenhuma repeticao fecha certinho pra esse molde.</p>
                )}
              </>
            ) : null}

            {calc.error ? (
              <p className="mold-import-error">{calc.error}</p>
            ) : (
              <p className="bandeira-size-hint">
                {modo === 'individual'
                  ? `O cliente desenha os ${quantidadeGomos} gomos, cada um diferente.`
                  : `O cliente desenha ${calc.desenhosUnicos} gomo${calc.desenhosUnicos === 1 ? '' : 's'} e esse desenho se repete ${calc.repeticoes}x ao redor do balao (${calc.repeticoes} × ${calc.desenhosUnicos} = ${calc.repeticoes * calc.desenhosUnicos} gomos).`}
              </p>
            )}
          </div>

          {truncado ? (
            <p className="mold-import-error">
              Mostrando so os primeiros {MAX_PAINEIS_RENDER} gomos aqui no leque da previa (o desenho pede{' '}
              {calc.desenhosUnicos}) — o calculo continua certo, so a previa que corta pra nao travar a tela.
            </p>
          ) : null}

          {preview ? (
            <div className="riscado-preview-scroll">
              <svg
                viewBox={`0 0 ${preview.viewW} ${preview.viewH}`}
                className="riscado-preview-fan-svg"
                role="img"
                aria-label="Cone do bico e cone da boca planificados, com as linhas de cada gomo"
              >
                <path d={pointsToClosedPathD(preview.bicoFan.outlinePoints)} fill="#0f1726" stroke="#77e6f2" strokeWidth={Math.max(preview.viewW * 0.004, 0.4)} />
                <path d={pointsToClosedPathD(preview.bocaFan.outlinePoints)} fill="#0f1726" stroke="#77e6f2" strokeWidth={Math.max(preview.viewW * 0.004, 0.4)} />
                {preview.bicoFan.divisoriasPoints.map((pts, i) => (
                  <polyline
                    key={`bico-div-${i}`}
                    points={pointsToPolylineAttr(pts)}
                    fill="none"
                    stroke="#3a4d6b"
                    strokeWidth={Math.max(preview.viewW * 0.0025, 0.2)}
                  />
                ))}
                {preview.bocaFan.divisoriasPoints.map((pts, i) => (
                  <polyline
                    key={`boca-div-${i}`}
                    points={pointsToPolylineAttr(pts)}
                    fill="none"
                    stroke="#3a4d6b"
                    strokeWidth={Math.max(preview.viewW * 0.0025, 0.2)}
                  />
                ))}
                <line
                  x1={0}
                  x2={preview.viewW}
                  y1={preview.seamY}
                  y2={preview.seamY}
                  stroke="#f062b8"
                  strokeDasharray={`${preview.viewW * 0.006},${preview.viewW * 0.004}`}
                  strokeWidth={Math.max(preview.viewW * 0.002, 0.15)}
                />
              </svg>
              <p className="bandeira-size-hint">
                Cone do bico (fecha em cima) + cone da boca (abre embaixo), encostando no ponto mais largo do
                molde. Cada linha e a divisoria entre um gomo e o vizinho.
              </p>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
