import { useMemo, useState } from "react";
import { Download, Loader2, PenTool } from "lucide-react";
import { buildBalaoConeModel, buildConeFan, pointsToClosedPathD, pointsToPolylineAttr } from "../lib/coneGeometry";
import { buildModeladoProfilePoints } from "../lib/moldGeometry";
import { downloadBlob, slugifyFilename } from "../lib/pdfExport";
import { buildRiscadoPdf } from "../lib/plotterRiscadoPdf";

type Modelo = "modelado";
type ModoLayout = "corrido" | "repeticao" | "espelho";

const MODELOS: Array<{ id: Modelo; label: string }> = [
  { id: "modelado", label: "Modelado" },
];

const EMPTY_TACO_CONFIGS = {
  boca: { partitions: [] },
  bojo: { partitions: [] },
  bico: { partitions: [] },
};
const EMPTY_SECTION_RATIOS = { boca: 0.25, bojo: 0.45, bico: 0.30 };
const EMPTY_SECTION_COLORS = { boca: "#fff", bojo: "#fff", bico: "#fff" };

const MAX_PREVIEW_GOMOS = 64;

function divisoresDe(n: number): number[] {
  if (n <= 0) return [];
  const d: number[] = [];
  for (let i = 1; i <= n; i++) {
    if (n % i === 0) d.push(i);
  }
  return d;
}

export function PlotterRiscadoPage() {
  const [modelo, setModelo] = useState<Modelo>("modelado");
  const [tamanhoStr, setTamanhoStr] = useState("10");
  const [gomosStr, setGomosStr] = useState("32");
  const [modo, setModo] = useState<ModoLayout>("repeticao");
  const [repeticoesStr, setRepeticoesStr] = useState("4");
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const tamanhoM = parseFloat(tamanhoStr) || 0;
  const quantidadeGomos = parseInt(gomosStr, 10) || 0;
  const repeticoes = parseInt(repeticoesStr, 10) || 1;

  const divisores = useMemo(() => divisoresDe(quantidadeGomos), [quantidadeGomos]);

  const gomosNoLeque = useMemo(() => {
    if (quantidadeGomos <= 0) return 0;
    if (modo === "corrido") return quantidadeGomos;
    if (modo === "espelho") {
      return quantidadeGomos % 4 === 0 ? quantidadeGomos / 4 : 0;
    }
    if (repeticoes <= 0 || quantidadeGomos % repeticoes !== 0) return 0;
    return quantidadeGomos / repeticoes;
  }, [modo, quantidadeGomos, repeticoes]);

  const repeticoesReais = useMemo(() => {
    if (modo === "corrido") return 1;
    if (modo === "espelho") return 4;
    return repeticoes;
  }, [modo, repeticoes]);

  const erroFormulario = useMemo(() => {
    if (tamanhoM <= 0) return "Informe um tamanho valido em metros.";
    if (quantidadeGomos <= 0) return "Informe uma quantidade de gomos valida.";
    if (gomosNoLeque <= 0) {
      if (modo === "espelho") return `${quantidadeGomos} gomos nao divide certinho por 4 repeticoes.`;
      return `${quantidadeGomos} gomos nao divide certinho por ${repeticoes} repeticoes.`;
    }
    return null;
  }, [tamanhoM, quantidadeGomos, gomosNoLeque, modo, repeticoes]);

  const pontos = useMemo(() => {
    if (tamanhoM <= 0 || quantidadeGomos <= 0) return null;
    return buildModeladoProfilePoints(tamanhoM, quantidadeGomos);
  }, [tamanhoM, quantidadeGomos]);

  const coneModel = useMemo(() => {
    if (!pontos || quantidadeGomos <= 0) return null;
    return buildBalaoConeModel(pontos, quantidadeGomos);
  }, [pontos, quantidadeGomos]);

  const preview = useMemo(() => {
    if (!coneModel || gomosNoLeque <= 0 || erroFormulario) return null;
    const n = Math.min(gomosNoLeque, MAX_PREVIEW_GOMOS);

    const maxHalfAngle = Math.max(
      ...coneModel.bico.slices.map((s) => (s.larguraCm / Math.max(s.s, 0.0001)) * n),
      ...coneModel.boca.slices.map((s) => (s.larguraCm / Math.max(s.s, 0.0001)) * n),
    ) / 2;
    const larguraEst =
      2 * Math.sin(Math.min(maxHalfAngle, Math.PI)) *
      Math.max(coneModel.bico.raioTotalCm, coneModel.boca.raioTotalCm);

    const pad = Math.max(larguraEst * 0.08, 2);
    const padOuter = Math.max(coneModel.bico.raioTotalCm * 0.02, 3);
    const centerX = pad + larguraEst / 2;
    const apiceYBico = padOuter;
    const seamY = apiceYBico + coneModel.bico.raioTotalCm;
    const apiceYBoca = seamY + coneModel.boca.raioTotalCm;

    const bicoFan = buildConeFan(coneModel.bico, n, false, centerX, apiceYBico);
    const bocaFan = buildConeFan(coneModel.boca, n, true, centerX, apiceYBoca);

    const allX = [
      ...bicoFan.outlinePoints.map(([x]) => x),
      ...bocaFan.outlinePoints.map(([x]) => x),
    ];
    const allY = [
      ...bicoFan.outlinePoints.map(([, y]) => y),
      ...bocaFan.outlinePoints.map(([, y]) => y),
    ];

    return {
      bicoFan,
      bocaFan,
      seamY,
      minX: Math.min(...allX),
      minY: Math.min(...allY),
      boxW: Math.max(...allX) - Math.min(...allX),
      boxH: Math.max(...allY) - Math.min(...allY),
    };
  }, [coneModel, gomosNoLeque, erroFormulario]);

  function handleDownload() {
    if (!pontos || gomosNoLeque <= 0 || erroFormulario) return;
    setDownloading(true);
    setDownloadError(null);
    try {
      const nome = `Modelado ${tamanhoM}m ${quantidadeGomos}g`;
      const blob = buildRiscadoPdf({
        nome,
        modelo: "Modelado",
        quantidadeGomosTotal: quantidadeGomos,
        modo: modo === "corrido" ? "individual" : "repeticao",
        repeticoes: repeticoesReais,
        desenhosUnicos: gomosNoLeque,
        pontos,
        tacoConfigs: EMPTY_TACO_CONFIGS,
        sectionRatios: EMPTY_SECTION_RATIOS,
        sectionColors: EMPTY_SECTION_COLORS,
      });
      downloadBlob(blob, `${slugifyFilename(nome)}-risco.pdf`);
    } catch (err) {
      setDownloadError(err instanceof Error ? err.message : "Nao foi possivel gerar o PDF.");
    } finally {
      setDownloading(false);
    }
  }

  const strokeW = preview ? Math.max(preview.boxW * 0.004, 0.4) : 0.4;
  const divStrokeW = preview ? Math.max(preview.boxW * 0.003, 0.25) : 0.25;

  return (
    <div className="plotter-page">
      <div className="plotter-toolbar">
        <div className="plotter-toolbar-text">
          <h2>Plotter &mdash; Molde Riscado</h2>
          <p>Configure o balao e gere o leque com as linhas dos gomos para riscar.</p>
        </div>
        <div className="plotter-toolbar-actions">
          <button
            type="button"
            className="mold-save-button"
            onClick={handleDownload}
            disabled={downloading || !!erroFormulario || gomosNoLeque <= 0}
          >
            {downloading ? <Loader2 size={16} className="mold-import-spinner" /> : <Download size={16} />}
            {downloading ? "Gerando..." : "Baixar PDF (escala real)"}
          </button>
        </div>
      </div>

      {downloadError && <p className="mold-import-error">{downloadError}</p>}

      <div className="riscado-layout">
        <div className="bandeira-create-panel riscado-config-panel">

          <div className="riscado-field-group">
            <h4>Modelo</h4>
            <div className="riscado-modelo-options">
              {MODELOS.map((m) => (
                <label key={m.id} className={`riscado-modelo-card${modelo === m.id ? " active" : ""}`}>
                  <input
                    type="radio"
                    name="modelo"
                    value={m.id}
                    checked={modelo === m.id}
                    onChange={() => setModelo(m.id)}
                  />
                  <PenTool size={18} />
                  <span>{m.label}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="riscado-field-group">
            <h4>Dimensoes</h4>
            <div className="bandeira-size-fields">
              <label className="auth-field">
                <span>Tamanho (metros)</span>
                <input
                  type="number"
                  min={0.5}
                  max={50}
                  step={0.5}
                  value={tamanhoStr}
                  onChange={(e) => { setTamanhoStr(e.target.value); setDownloadError(null); }}
                  placeholder="Ex: 10"
                />
              </label>
              <label className="auth-field">
                <span>Quantidade de gomos</span>
                <input
                  type="number"
                  min={4}
                  max={256}
                  step={1}
                  value={gomosStr}
                  onChange={(e) => { setGomosStr(e.target.value); setDownloadError(null); }}
                  placeholder="Ex: 32"
                />
              </label>
            </div>
          </div>

          <div className="riscado-field-group">
            <h4>Como vai ser feito</h4>
            <div className="riscado-modo-grid">
              <label className={`riscado-modo-card${modo === "corrido" ? " active" : ""}`}>
                <input type="radio" name="modo-layout" checked={modo === "corrido"} onChange={() => setModo("corrido")} />
                <div className="riscado-modo-icon">&#9644;&#9644;&#9644;</div>
                <strong>Corrido</strong>
                <span>Um leque unico com todos os {quantidadeGomos || "?"} gomos</span>
              </label>
              <label className={`riscado-modo-card${modo === "repeticao" ? " active" : ""}`}>
                <input type="radio" name="modo-layout" checked={modo === "repeticao"} onChange={() => setModo("repeticao")} />
                <div className="riscado-modo-icon">&#9644;&#9644; x N</div>
                <strong>Repeticao</strong>
                <span>Desenha uma parte e repete ao redor</span>
              </label>
              <label className={`riscado-modo-card${modo === "espelho" ? " active" : ""}`}>
                <input type="radio" name="modo-layout" checked={modo === "espelho"} onChange={() => setModo("espelho")} />
                <div className="riscado-modo-icon">&#9668;&#9644;&#9644;&#9658;</div>
                <strong>Espelho</strong>
                <span>4 repeticoes simetricas</span>
              </label>
            </div>

            {modo === "repeticao" && (
              <div style={{ marginTop: "0.75rem" }}>
                <label className="auth-field">
                  <span>Numero de repeticoes</span>
                  <input
                    type="number"
                    min={1}
                    max={quantidadeGomos || 256}
                    value={repeticoesStr}
                    onChange={(e) => { setRepeticoesStr(e.target.value); setDownloadError(null); }}
                  />
                </label>
                {divisores.length > 0 && (
                  <p className="bandeira-size-hint" style={{ marginTop: "0.5rem" }}>
                    Repeticoes que fecham os {quantidadeGomos} gomos:{" "}
                    {divisores.map((d) => (
                      <button
                        key={d}
                        type="button"
                        className="riscado-divisor-chip"
                        onClick={() => setRepeticoesStr(String(d))}
                      >
                        {d}
                      </button>
                    ))}
                  </p>
                )}
              </div>
            )}
          </div>

          {erroFormulario ? (
            <p className="mold-import-error">{erroFormulario}</p>
          ) : gomosNoLeque > 0 ? (
            <div className="riscado-resumo">
              {modo === "corrido" ? (
                <p>Leque com <strong>todos os {gomosNoLeque} gomos</strong> &mdash; imprime de uma vez.</p>
              ) : (
                <p>
                  O cliente desenha <strong>{gomosNoLeque} gomos</strong> e esse leque se repete{" "}
                  <strong>{repeticoesReais}x</strong> ao redor do balao{" "}
                  ({repeticoesReais} x {gomosNoLeque} = {repeticoesReais * gomosNoLeque} gomos
                  {modo === "espelho" ? ", com espelho" : ""}).
                </p>
              )}
            </div>
          ) : null}
        </div>

        <div className="riscado-preview-area">
          {preview ? (
            <>
              <div className="riscado-preview-scroll">
                <svg
                  viewBox={`${preview.minX - 4} ${preview.minY - 4} ${preview.boxW + 8} ${preview.boxH + 8}`}
                  className="riscado-preview-fan-svg riscado-preview-white"
                  role="img"
                  aria-label="Leque dos gomos planificados"
                >
                  <rect
                    x={preview.minX - 4}
                    y={preview.minY - 4}
                    width={preview.boxW + 8}
                    height={preview.boxH + 8}
                    fill="white"
                  />
                  <path d={pointsToClosedPathD(preview.bicoFan.outlinePoints)} fill="white" stroke="none" />
                  <path d={pointsToClosedPathD(preview.bocaFan.outlinePoints)} fill="white" stroke="none" />

                  {preview.bicoFan.divisoriasPoints.map((pts, i) => (
                    <polyline
                      key={`bico-div-${i}`}
                      points={pointsToPolylineAttr(pts)}
                      fill="none"
                      stroke="#222"
                      strokeWidth={divStrokeW}
                    />
                  ))}
                  {preview.bocaFan.divisoriasPoints.map((pts, i) => (
                    <polyline
                      key={`boca-div-${i}`}
                      points={pointsToPolylineAttr(pts)}
                      fill="none"
                      stroke="#222"
                      strokeWidth={divStrokeW}
                    />
                  ))}

                  <path d={pointsToClosedPathD(preview.bicoFan.outlinePoints)} fill="none" stroke="#111" strokeWidth={strokeW} />
                  <path d={pointsToClosedPathD(preview.bocaFan.outlinePoints)} fill="none" stroke="#111" strokeWidth={strokeW} />

                  <line
                    x1={preview.minX - 2}
                    x2={preview.minX + preview.boxW + 2}
                    y1={preview.seamY}
                    y2={preview.seamY}
                    stroke="#e11d48"
                    strokeDasharray={`${preview.boxW * 0.006},${preview.boxW * 0.004}`}
                    strokeWidth={Math.max(preview.boxW * 0.002, 0.15)}
                  />
                </svg>
              </div>
              <p className="bandeira-size-hint" style={{ textAlign: "center", marginTop: "0.5rem" }}>
                {gomosNoLeque > MAX_PREVIEW_GOMOS
                  ? `Preview mostrando ${MAX_PREVIEW_GOMOS} de ${gomosNoLeque} gomos — o PDF tera todos.`
                  : "Cone do bico (cima) + cone da boca (baixo). Linha vermelha = ponto de encontro."}
              </p>
            </>
          ) : (
            <div className="riscado-preview-empty">
              <PenTool size={36} opacity={0.3} />
              <p>Preencha os dados ao lado para visualizar o leque.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
