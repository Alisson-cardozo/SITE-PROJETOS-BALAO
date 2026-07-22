import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Loader2, Plus, Save, Trash2 } from 'lucide-react';
import { MoldSilhouettePreview } from '../components/MoldSilhouettePreview';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { jsPDF } from 'jspdf';

const MODEL_OPTIONS = [
  'Modelado',
  'Truff',
  'Piao',
  'Bagda',
  'Lapidado',
  'Careca',
  'Hally',
  'Pingolbag',
  'Golfier',
  'Barrica',
  'Tangerina',
  'Magico',
  'Outros',
];

interface MoldPointRow {
  id: string;
  alturaCm: string;
  larguraMeiaCm: string;
}

interface BaseMoldData {
  name?: string;
  /** Perímetro (circunferência) em cada ponto do perfil. */
  perimeter: number[];
  /** Altura real (inflado) acumulada em cada ponto. */
  heightAcum: number[];
  /**
   * Comprimento de cada passo no papel do molde (site: dist / getHeight()).
   * LargoBase = soma(dist). NÃO usar diferenças de heightAcum.
   */
  dist?: number[];
}

interface MoldSpecs {
  boca: number;
  gajomax: number;
  altoInflado: number;
  anchoInflado: number;
  volumen: number;
  pontos: {
    ponto: number;
    dL: number;
    accumL: number;
    widthHalf: number;
  }[];
}

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
    if (re.test(key)) {
      if (name === 'Truffy') return 'Truff';
      if (name === 'Pigolbag') return 'Pingolbag';
      if (name === 'Otros' || name === 'Corte Recto') return 'Outros';
      return name;
    }
  }
  return 'Outros';
}


interface MoldTableFormProps {
  editMoldId?: number | null;
  onSaved?: () => void;
  onCancelEdit?: () => void;
}

function createPoint(alturaCm = '', larguraMeiaCm = ''): MoldPointRow {
  return { id: Math.random().toString(36).slice(2), alturaCm, larguraMeiaCm };
}

function normalizeModelo(raw: string): string {
  const match = MODEL_OPTIONS.find((option) => option.toLowerCase() === raw.trim().toLowerCase());
  return match ?? MODEL_OPTIONS[MODEL_OPTIONS.length - 1];
}

export function MoldTableForm({ editMoldId = null, onSaved, onCancelEdit }: MoldTableFormProps) {
  const { token } = useAuth();
  const [nomeMolde, setNomeMolde] = useState('');
  const [modelo, setModelo] = useState(MODEL_OPTIONS[0]);
  const [quantidadeGomos, setQuantidadeGomos] = useState('');
  const [bainhaCm, setBainhaCm] = useState('');
  const [points, setPoints] = useState<MoldPointRow[]>(() => [createPoint(), createPoint()]);
  const [bulkAddCount, setBulkAddCount] = useState('1');
  const [activeFormTab, setActiveFormTab] = useState<'manual' | 'template'>('manual');

  // Base models states
  const [baseModelsData, setBaseModelsData] = useState<Record<string, BaseMoldData> | null>(null);
  const [selectedBaseModelKey, setSelectedBaseModelKey] = useState<string>('');
  const [balloonHeight, setBalloonHeight] = useState<string>('300');
  const [loadingBaseModels, setLoadingBaseModels] = useState(false);
  const [calculatedSpecs, setCalculatedSpecs] = useState<MoldSpecs | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoadingBaseModels(true);
    fetch('/data.json')
      .then((res) => {
        if (!res.ok) throw new Error('Não foi possível carregar o arquivo data.json');
        return res.json();
      })
      .then((data: Record<string, BaseMoldData>) => {
        if (cancelled) return;
        setBaseModelsData(data);
      })
      .catch((err) => {
        console.error('Erro ao carregar dados do arquivo JSON:', err);
      })
      .finally(() => {
        if (!cancelled) setLoadingBaseModels(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // Reset calculations when template inputs change
  useEffect(() => {
    setCalculatedSpecs(null);
  }, [selectedBaseModelKey, balloonHeight, quantidadeGomos, bainhaCm, modelo]);


  const [loadingMold, setLoadingMold] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);
  const [loadedEditorName, setLoadedEditorName] = useState<string | null>(null);
  const [canEditLoaded, setCanEditLoaded] = useState(true);

  const isEditing = editMoldId != null;

  useEffect(() => {
    if (!token || editMoldId == null) {
      if (editMoldId == null) {
        setNomeMolde('');
        setModelo(MODEL_OPTIONS[0]);
        setQuantidadeGomos('');
        setBainhaCm('');
        setPoints([createPoint(), createPoint()]);
        setLoadedEditorName(null);
        setCanEditLoaded(true);
        setFormError(null);
        setFormSuccess(null);
      }
      return;
    }

    let cancelled = false;
    setLoadingMold(true);
    setFormError(null);
    setFormSuccess(null);
    setCanEditLoaded(true);

    api
      .getMold(editMoldId, token)
      .then((response) => {
        if (cancelled) {
          return;
        }
        const mold = response.data;
        if (!mold.can_edit) {
          setCanEditLoaded(false);
          setFormError('Apenas quem criou o molde pode editar. Crie uma copia na galeria para usar este molde.');
          return;
        }
        setCanEditLoaded(true);
        setNomeMolde(mold.nome);
        setModelo(normalizeModelo(mold.modelo));
        setQuantidadeGomos(String(mold.quantidade_gomos));
        setBainhaCm(String(mold.bainha_cm));
        setPoints(
          mold.pontos.length > 0
            ? mold.pontos.map((point) => createPoint(String(point.altura_cm), String(point.largura_meia_cm)))
            : [createPoint(), createPoint()]
        );
        setLoadedEditorName(mold.updated_by.name || mold.created_by.name || null);
      })
      .catch((error) => {
        if (!cancelled) {
          setCanEditLoaded(false);
          setFormError(error instanceof ApiError ? error.message : 'Nao foi possivel carregar o molde.');
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingMold(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [editMoldId, token]);

  const baseModelsList = useMemo(() => {
    if (!baseModelsData) return [];
    return Object.keys(baseModelsData)
      .map((key) => ({
        key,
        name: baseModelsData[key].name || key,
        category: categorize(key),
      }))
      .sort((a, b) => a.name.localeCompare(b.name, 'pt'));
  }, [baseModelsData]);

  const baseModelsByCategory = useMemo(() => {
    const groups: Record<string, typeof baseModelsList> = {};
    baseModelsList.forEach((m) => {
      if (!groups[m.category]) {
        groups[m.category] = [];
      }
      groups[m.category].push(m);
    });
    return groups;
  }, [baseModelsList]);

  const handleCategoryChange = (newCategory: string) => {
    setModelo(newCategory);
    setSelectedBaseModelKey('');
    setNomeMolde('');
  };

  function handleCalculateSpecs() {
    if (!baseModelsData || !selectedBaseModelKey) {
      setFormError('Selecione um modelo base primeiro.');
      return;
    }

    const gomos = Number(quantidadeGomos);
    const bainha = Number(bainhaCm);
    const height = Number(balloonHeight);

    if (!quantidadeGomos || isNaN(gomos) || gomos < 1) {
      setFormError('Informe a quantidade de gomos.');
      return;
    }
    if (!bainhaCm || isNaN(bainha) || bainha < 0) {
      setFormError('Informe o tamanho da bainha.');
      return;
    }
    if (!balloonHeight || isNaN(height) || height <= 0) {
      setFormError('Informe uma altura do balão válida maior que 0.');
      return;
    }

    const model = baseModelsData[selectedBaseModelKey];
    if (!model) {
      setFormError('Modelo base não encontrado.');
      return;
    }

    const perimeter = model.perimeter;
    const heightAcum = model.heightAcum;

    // Igual ao site (calculos.js) e a Desktop/3d:
    // - dist = comprimento de cada passo no papel do molde
    // - LargoBase = soma(dist)  (= getHeight() no site)
    // NÃO recalcular dist a partir de heightAcum: heightAcum é a altura
    // real (inflado), menor que o comprimento do papel.
    let dist: number[];
    if (model.dist && model.dist.length === perimeter.length) {
      dist = model.dist.slice();
    } else {
      dist = [0];
      for (let i = 1; i < heightAcum.length; i++) {
        dist.push(heightAcum[i] - heightAcum[i - 1]);
      }
    }

    if (dist.length !== perimeter.length || heightAcum.length !== perimeter.length) {
      setFormError('O modelo base tem arrays inconsistentes (dist/perimeter/heightAcum).');
      return;
    }

    const LargoBase = dist.reduce((sum, val) => sum + val, 0);
    if (LargoBase <= 0) {
      setFormError('O modelo base possui um comprimento inválido.');
      return;
    }

    // Pontos da tabela (papel do molde escalado para a altura informada)
    let sumHeight = 0;
    const pontosEscalados = dist.map((step, i) => {
      const dL = (step * height) / LargoBase;
      sumHeight += dL;
      const widthHalf = ((perimeter[i] * height) / LargoBase) / (2 * gomos) + bainha / 2;
      return {
        ponto: i + 1,
        dL,
        accumL: sumHeight,
        widthHalf,
      };
    });

    const newPoints = pontosEscalados.map((p) =>
      createPoint(p.dL.toFixed(1), p.widthHalf.toFixed(1))
    );

    setPoints(newPoints);
    setFormError(null);

    // Ficha técnica — mesmas fórmulas do site / Desktop/3d/index.html Calcular()
    const boca = (perimeter[0] * height) / LargoBase / Math.PI;
    const maxWidth = Math.max(...perimeter);
    const gajomax = (maxWidth * height) / LargoBase / gomos + bainha;
    const altoInflado = (heightAcum[heightAcum.length - 1] * height) / LargoBase;
    const anchoInflado = (maxWidth * height) / LargoBase / Math.PI;

    let volumen = 0;
    for (let i = 1; i < perimeter.length; i++) {
      const r1 = (perimeter[i - 1] * height) / LargoBase / (2 * Math.PI);
      const r2 = (perimeter[i] * height) / LargoBase / (2 * Math.PI);
      const dh = ((heightAcum[i] - heightAcum[i - 1]) * height) / LargoBase;
      volumen += (Math.PI / 3) * Math.abs(dh) * (r1 * r1 + r1 * r2 + r2 * r2);
    }
    volumen = volumen / 1_000_000; // cm³ → m³

    setCalculatedSpecs({
      boca,
      gajomax,
      altoInflado,
      anchoInflado,
      volumen,
      pontos: pontosEscalados,
    });

    setFormSuccess('Medidas e escala calculadas com sucesso!');
  }

  function handleDownloadPDF() {
    if (!calculatedSpecs) return;
    const doc = new jsPDF();
    let y = 20;

    // Header
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(18);
    doc.text(`Ficha Tecnica do Molde: ${nomeMolde}`, 14, y);
    y += 10;

    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text(`Modelo / Categoria: ${modelo}`, 14, y);
    doc.text(`Altura do Balao: ${balloonHeight} cm`, 100, y);
    y += 6;
    doc.text(`Quantidade de Gomos: ${quantidadeGomos}`, 14, y);
    doc.text(`Tamanho da Bainha: ${bainhaCm} cm`, 100, y);
    y += 10;

    // Specs
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.text('Medidas Reais (Estimadas)', 14, y);
    y += 6;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.text(`Diametro da Boca: ${calculatedSpecs.boca.toFixed(1)} cm`, 14, y);
    doc.text(`Largura Max. Gomo: ${calculatedSpecs.gajomax.toFixed(1)} cm`, 100, y);
    y += 6;
    doc.text(`Altura Cheio: ${calculatedSpecs.altoInflado.toFixed(1)} cm`, 14, y);
    doc.text(`Largura Cheio: ${calculatedSpecs.anchoInflado.toFixed(1)} cm`, 100, y);
    y += 6;
    doc.text(`Volume Estimado: ${calculatedSpecs.volumen.toFixed(2)} m3`, 14, y);
    y += 12;

    // Table Header
    doc.setFont('helvetica', 'bold');
    doc.text('Ponto', 14, y);
    doc.text('Comprimento (cm)', 40, y);
    doc.text('Acumulado (cm)', 90, y);
    doc.text('Largura/2 (cm)', 140, y);
    doc.line(14, y + 2, 196, y + 2);
    y += 8;

    doc.setFont('helvetica', 'normal');
    calculatedSpecs.pontos.forEach((p, idx) => {
      if (y > 270) {
        doc.addPage();
        y = 20;
        // Table Header again
        doc.setFont('helvetica', 'bold');
        doc.text('Ponto', 14, y);
        doc.text('Comprimento (cm)', 40, y);
        doc.text('Acumulado (cm)', 90, y);
        doc.text('Largura/2 (cm)', 140, y);
        doc.line(14, y + 2, 196, y + 2);
        y += 8;
        doc.setFont('helvetica', 'normal');
      }

      doc.text(String(p.ponto), 14, y);
      doc.text(idx === 0 ? '-' : p.dL.toFixed(1), 40, y);
      doc.text(p.accumL.toFixed(1), 90, y);
      doc.text(p.widthHalf.toFixed(1), 140, y);
      y += 6;
    });

    doc.save(`escala_${nomeMolde.toLowerCase().replace(/\s+/g, '_')}.pdf`);
  }

  function handleDownloadCSV() {
    if (!calculatedSpecs) return;
    let csv = '\ufeffPonto;Comprimento (cm);Comprimento Acumulado (cm);Largura/2 (cm)\n';
    calculatedSpecs.pontos.forEach((p, idx) => {
      csv += `${p.ponto};${idx === 0 ? 0 : p.dL.toFixed(2)};${p.accumL.toFixed(2)};${p.widthHalf.toFixed(2)}\n`;
    });

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `escala_${nomeMolde.toLowerCase().replace(/\s+/g, '_')}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }


  function addPoints(count: number) {
    const safeCount = Math.max(1, Math.min(500, Math.floor(count) || 1));
    setPoints((prev) => [...prev, ...Array.from({ length: safeCount }, () => createPoint())]);
  }

  function removePoint(id: string) {
    setPoints((prev) => (prev.length > 1 ? prev.filter((point) => point.id !== id) : prev));
  }

  function updatePoint(id: string, field: 'alturaCm' | 'larguraMeiaCm', value: string) {
    setPoints((prev) => prev.map((point) => (point.id === id ? { ...point, [field]: value } : point)));
  }



  async function handleSave(event: FormEvent) {
    event.preventDefault();
    if (!token || saving || (isEditing && !canEditLoaded)) {
      return;
    }

    const nome = nomeMolde.trim();
    const gomos = Number(quantidadeGomos);
    const bainha = Number(bainhaCm);

    if (!nome) {
      setFormError('Informe o nome do molde.');
      return;
    }
    if (!Number.isFinite(gomos) || gomos < 1) {
      setFormError('Informe a quantidade de gomos.');
      return;
    }
    if (!Number.isFinite(bainha) || bainha < 0) {
      setFormError('Informe o tamanho da bainha.');
      return;
    }

    const pontosPayload = points.map((point) => ({
      altura_cm: Number(point.alturaCm),
      largura_meia_cm: Number(point.larguraMeiaCm),
    }));

    if (pontosPayload.length < 2 || pontosPayload.some((point) => !Number.isFinite(point.altura_cm) || !Number.isFinite(point.largura_meia_cm))) {
      setFormError('Preencha altura e largura/2 em pelo menos 2 pontos.');
      return;
    }

    setSaving(true);
    setFormError(null);
    setFormSuccess(null);

    try {
      const payload = {
        nome,
        modelo,
        quantidade_gomos: Math.floor(gomos),
        bainha_cm: bainha,
        pontos: pontosPayload,
      };

      if (isEditing && editMoldId != null) {
        await api.updateMold(editMoldId, payload, token);
      } else {
        await api.createMold(payload, token);
      }

      onSaved?.();
    } catch (error) {
      setFormError(error instanceof ApiError ? error.message : 'Nao foi possivel salvar o molde.');
    } finally {
      setSaving(false);
    }
  }

  const computedPoints = useMemo(() => {
    let acumulada = 0;
    return points.map((point, index) => {
      const altura = Number(point.alturaCm) || 0;
      acumulada = index === 0 ? altura : acumulada + altura;
      return {
        ...point,
        ponto: index + 1,
        alturaAcumuladaCm: acumulada,
        larguraMeiaValue: Number(point.larguraMeiaCm) || 0,
      };
    });
  }, [points]);

  return (
    <form className="mold-form-layout" onSubmit={(event) => void handleSave(event)}>
      <div className="mold-form-panel">
        <div className="mold-form-header mold-form-header-row">
          <div>
            <h2>{isEditing ? 'Modificar Tabela de Molde' : 'Adicionar sua Tabela de Molde'}</h2>
            {isEditing && loadedEditorName ? (
              <p className="mold-form-subtitle">Editando molde existente. Ultima gravacao: {loadedEditorName}.</p>
            ) : null}
          </div>
          <div className="mold-form-header-actions">
            {isEditing && onCancelEdit ? (
              <button type="button" className="mold-secondary-button" onClick={onCancelEdit} disabled={saving}>
                Cancelar
              </button>
            ) : null}
            <button type="submit" className="mold-save-button" disabled={saving || loadingMold}>
              {saving ? <Loader2 size={16} className="mold-import-spinner" /> : <Save size={16} />}
              {saving ? 'Salvando...' : isEditing ? 'Salvar alteracoes' : 'Salvar molde'}
            </button>
          </div>
        </div>

        {loadingMold && <p className="mold-form-loading">Carregando molde...</p>}
        {formError && <p className="mold-import-error">{formError}</p>}
        {formSuccess && <p className="mold-form-success">{formSuccess}</p>}

        {/* Abas do Formulário */}
        <div style={{ display: 'flex', gap: '8px', borderBottom: '1px solid #263349', marginBottom: '24px', paddingBottom: '1px' }}>
          <button
            type="button"
            onClick={() => setActiveFormTab('manual')}
            style={{
              padding: '10px 16px',
              background: activeFormTab === 'manual' ? 'rgba(38, 51, 73, 0.5)' : 'transparent',
              border: 'none',
              borderBottom: activeFormTab === 'manual' ? '2px solid #3b82f6' : '2px solid transparent',
              color: activeFormTab === 'manual' ? '#f2f6fb' : '#8fa3bd',
              fontWeight: '600',
              cursor: 'pointer',
              fontSize: '14px',
              transition: 'all 0.2s',
              borderTopLeftRadius: '6px',
              borderTopRightRadius: '6px',
            }}
          >
            ✍️ Digitar Pontos
          </button>
          <button
            type="button"
            onClick={() => setActiveFormTab('template')}
            style={{
              padding: '10px 16px',
              background: activeFormTab === 'template' ? 'rgba(38, 51, 73, 0.5)' : 'transparent',
              border: 'none',
              borderBottom: activeFormTab === 'template' ? '2px solid #f59e0b' : '2px solid transparent',
              color: activeFormTab === 'template' ? '#f2f6fb' : '#8fa3bd',
              fontWeight: '600',
              cursor: 'pointer',
              fontSize: '14px',
              transition: 'all 0.2s',
              borderTopLeftRadius: '6px',
              borderTopRightRadius: '6px',
            }}
          >
            ⚡ Escala do Molde
          </button>
        </div>

        {activeFormTab === 'manual' ? (
          <>
            <div className="mold-form-grid">
              <label className="auth-field">
                <span>
                  Nome do Molde <em className="mold-required-mark">*</em>
                </span>
                <input
                  type="text"
                  required
                  placeholder="Obrigatório (ex: JZ10)"
                  value={nomeMolde}
                  onChange={(event) => setNomeMolde(event.target.value)}
                  disabled={loadingMold}
                />
              </label>

              <label className="auth-field">
                <span>Modelo</span>
                <select value={modelo} onChange={(event) => setModelo(event.target.value)} disabled={loadingMold}>
                  {MODEL_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>

              <label className="auth-field">
                <span>
                  Quantidade de Gomos <em className="mold-required-mark">*</em>
                </span>
                <input
                  type="number"
                  min={1}
                  required
                  placeholder="Obrigatório"
                  value={quantidadeGomos}
                  onChange={(event) => setQuantidadeGomos(event.target.value)}
                  disabled={loadingMold}
                />
              </label>

              <label className="auth-field">
                <span>
                  Tamanho da Bainha (cm) <em className="mold-required-mark">*</em>
                </span>
                <input
                  type="number"
                  min={0}
                  step="0.1"
                  required
                  placeholder="Obrigatório"
                  value={bainhaCm}
                  onChange={(event) => setBainhaCm(event.target.value)}
                  disabled={loadingMold}
                />
              </label>
            </div>

            <div className="mold-points-header" style={{ marginTop: '24px' }}>
              <h3>Pontos do Molde</h3>
              <div className="mold-points-actions">
                <div className="mold-add-point-group">
                  <input
                    type="number"
                    min={1}
                    max={500}
                    className="mold-add-point-count"
                    value={bulkAddCount}
                    onChange={(event) => setBulkAddCount(event.target.value)}
                    aria-label="Quantidade de pontos para adicionar"
                    disabled={loadingMold}
                  />
                  <button
                    type="button"
                    className="mold-add-point"
                    onClick={() => addPoints(Number(bulkAddCount))}
                    disabled={loadingMold}
                  >
                    <Plus size={16} />
                    Adicionar pontos
                  </button>
                </div>
              </div>
            </div>

            <div className="mold-points-table-wrapper">
              <table className="mold-points-table">
                <thead>
                  <tr>
                    <th>Ponto</th>
                    <th>Altura (cm)</th>
                    <th>Largura/2 (cm)</th>
                    <th aria-label="Remover" />
                  </tr>
                </thead>
                <tbody>
                  {computedPoints.map((point) => (
                    <tr key={point.id}>
                      <td data-label="Ponto">{point.ponto}</td>
                      <td data-label="Altura (cm)">
                        <input
                          type="number"
                          step="0.1"
                          inputMode="decimal"
                          value={point.alturaCm}
                          onChange={(event) => updatePoint(point.id, 'alturaCm', event.target.value)}
                          disabled={loadingMold}
                        />
                      </td>
                      <td data-label="Largura/2 (cm)">
                        <input
                          type="number"
                          step="0.1"
                          inputMode="decimal"
                          value={point.larguraMeiaCm}
                          onChange={(event) => updatePoint(point.id, 'larguraMeiaCm', event.target.value)}
                          disabled={loadingMold}
                        />
                      </td>
                      <td data-label="Acoes" className="mold-points-actions-cell">
                        <button
                          type="button"
                          className="mold-remove-point"
                          onClick={() => removePoint(point.id)}
                          disabled={points.length <= 1 || loadingMold}
                          aria-label="Remover ponto"
                        >
                          <Trash2 size={15} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <>
            <div className="mold-form-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
              <label className="auth-field">
                <span>Modelo (Categoria)</span>
                <select value={modelo} onChange={(e) => handleCategoryChange(e.target.value)} disabled={loadingMold}>
                  {MODEL_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>

              <label className="auth-field">
                <span>Nome do Molde <em className="mold-required-mark">*</em></span>
                {loadingBaseModels ? (
                  <div style={{ color: '#8fa3bd', fontSize: '13px', padding: '8px 0' }}>Carregando moldes...</div>
                ) : (
                  <select 
                    value={selectedBaseModelKey} 
                    onChange={(e) => {
                      const key = e.target.value;
                      setSelectedBaseModelKey(key);
                      const found = baseModelsList.find(m => m.key === key);
                      setNomeMolde(found ? found.name : '');
                    }}
                    disabled={loadingMold}
                  >
                    <option value="">-- Selecione o Molde --</option>
                    {(baseModelsByCategory[modelo] || []).map((m) => (
                      <option key={m.key} value={m.key}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                )}
              </label>

              <label className="auth-field">
                <span>Altura do Balão (cm)</span>
                <input
                  type="number"
                  min={10}
                  placeholder="Ex: 300"
                  value={balloonHeight}
                  onChange={(e) => setBalloonHeight(e.target.value)}
                  disabled={loadingMold}
                />
              </label>

              <label className="auth-field">
                <span>
                  Quantidade de Gomos <em className="mold-required-mark">*</em>
                </span>
                <input
                  type="number"
                  min={1}
                  required
                  placeholder="Obrigatório"
                  value={quantidadeGomos}
                  onChange={(event) => setQuantidadeGomos(event.target.value)}
                  disabled={loadingMold}
                />
              </label>

              <label className="auth-field">
                <span>
                  Tamanho da Bainha (cm) <em className="mold-required-mark">*</em>
                </span>
                <input
                  type="number"
                  min={0}
                  step="0.1"
                  required
                  placeholder="Obrigatório"
                  value={bainhaCm}
                  onChange={(event) => setBainhaCm(event.target.value)}
                  disabled={loadingMold}
                />
              </label>
            </div>

            <div style={{ marginTop: '24px' }}>
              <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginBottom: '24px' }}>
                <button
                  type="button"
                  onClick={handleCalculateSpecs}
                  style={{
                    height: '42px',
                    background: 'linear-gradient(135deg, #f59e0b, #d97706)',
                    color: '#fff',
                    border: 'none',
                    fontWeight: '600',
                    padding: '0 20px',
                    borderRadius: '8px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    transition: 'opacity 0.2s'
                  }}
                  onMouseOver={(e) => e.currentTarget.style.opacity = '0.9'}
                  onMouseOut={(e) => e.currentTarget.style.opacity = '1'}
                >
                  📊 Calcular e Mostrar Escala
                </button>

                {calculatedSpecs && (
                  <>
                    <button
                      type="button"
                      onClick={handleDownloadPDF}
                      style={{
                        height: '42px',
                        background: 'linear-gradient(135deg, #10b981, #059669)',
                        color: '#fff',
                        border: 'none',
                        fontWeight: '600',
                        padding: '0 20px',
                        borderRadius: '8px',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        transition: 'opacity 0.2s'
                      }}
                      onMouseOver={(e) => e.currentTarget.style.opacity = '0.9'}
                      onMouseOut={(e) => e.currentTarget.style.opacity = '1'}
                    >
                      📄 Baixar PDF
                    </button>

                    <button
                      type="button"
                      onClick={handleDownloadCSV}
                      style={{
                        height: '42px',
                        background: 'linear-gradient(135deg, #3b82f6, #2563eb)',
                        color: '#fff',
                        border: 'none',
                        fontWeight: '600',
                        padding: '0 20px',
                        borderRadius: '8px',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        transition: 'opacity 0.2s'
                      }}
                      onMouseOver={(e) => e.currentTarget.style.opacity = '0.9'}
                      onMouseOut={(e) => e.currentTarget.style.opacity = '1'}
                    >
                      📊 Baixar CSV
                    </button>
                  </>
                )}
              </div>

              {calculatedSpecs && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '24px', marginTop: '24px' }}>
                  {/* Ficha Técnica Card */}
                  <div style={{
                    padding: '20px',
                    borderRadius: '12px',
                    background: 'rgba(30, 41, 59, 0.4)',
                    border: '1px solid #263349',
                    height: 'fit-content'
                  }}>
                    <h3 style={{ fontSize: '15px', color: '#3b82f6', margin: '0 0 16px 0', borderBottom: '1px solid #263349', paddingBottom: '8px' }}>
                      📐 Ficha Técnica (Medidas Reais)
                    </h3>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', fontSize: '14px', color: '#c3d1e6' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ color: '#8fa3bd' }}>Diâmetro da Boca:</span>
                        <strong style={{ color: '#f2f6fb' }}>{calculatedSpecs.boca.toFixed(1)} cm</strong>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ color: '#8fa3bd' }}>Largura Máx. Gomo:</span>
                        <strong style={{ color: '#f2f6fb' }}>{calculatedSpecs.gajomax.toFixed(1)} cm</strong>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ color: '#8fa3bd' }}>Altura Cheio:</span>
                        <strong style={{ color: '#f2f6fb' }}>{calculatedSpecs.altoInflado.toFixed(1)} cm</strong>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ color: '#8fa3bd' }}>Largura Cheio:</span>
                        <strong style={{ color: '#f2f6fb' }}>{calculatedSpecs.anchoInflado.toFixed(1)} cm</strong>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ color: '#8fa3bd' }}>Volume Estimado:</span>
                        <strong style={{ color: '#10b981' }}>{calculatedSpecs.volumen.toFixed(2)} m³</strong>
                      </div>
                    </div>
                  </div>

                  {/* Tabela de Pontos Gerada */}
                  <div style={{
                    padding: '20px',
                    borderRadius: '12px',
                    background: 'rgba(30, 41, 59, 0.4)',
                    border: '1px solid #263349',
                    height: 'fit-content'
                  }}>
                    <h3 style={{ fontSize: '15px', color: '#10b981', margin: '0 0 16px 0', borderBottom: '1px solid #263349', paddingBottom: '8px' }}>
                      📋 Tabela de Pontos Calculada
                    </h3>
                    <div style={{ maxHeight: '300px', overflowY: 'auto', borderRadius: '8px', border: '1px solid #263349' }}>
                      <table className="mold-points-table" style={{ margin: 0, width: '100%' }}>
                        <thead style={{ position: 'sticky', top: 0, background: '#131c2d', zIndex: 1 }}>
                          <tr>
                            <th>Ponto</th>
                            <th>Comprimento (cm)</th>
                            <th>Acumulado (cm)</th>
                            <th>Largura/2 (cm)</th>
                          </tr>
                        </thead>
                        <tbody>
                          {calculatedSpecs.pontos.map((p, idx) => (
                            <tr key={p.ponto}>
                              <td data-label="Ponto">{p.ponto}</td>
                              <td data-label="Comprimento (cm)">{idx === 0 ? '-' : p.dL.toFixed(1)}</td>
                              <td data-label="Acumulado (cm)">{p.accumL.toFixed(1)}</td>
                              <td data-label="Largura/2 (cm)">{p.widthHalf.toFixed(1)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </>
        )}

        <div className="mold-form-footer" style={{ marginTop: '32px' }}>
          <button type="submit" className="mold-save-button" disabled={saving || loadingMold}>
            {saving ? <Loader2 size={16} className="mold-import-spinner" /> : <Save size={16} />}
            {saving ? 'Salvando...' : isEditing ? 'Salvar alteracoes' : 'Salvar molde'}
          </button>
        </div>
      </div>

      <div className="mold-preview-panel">
        <h3>Previa da silhueta</h3>
        <MoldSilhouettePreview
          points={computedPoints.map((point) => ({
            alturaAcumuladaCm: point.alturaAcumuladaCm,
            larguraMeiaCm: point.larguraMeiaValue,
          }))}
        />
      </div>
    </form>
  );
}
