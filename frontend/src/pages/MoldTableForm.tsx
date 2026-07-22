import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { FileUp, Loader2, Plus, Save, Trash2 } from 'lucide-react';
import { MoldSilhouettePreview } from '../components/MoldSilhouettePreview';
import { api, importMoldPdf, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';

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
  perimeter: number[];
  heightAcum: number[];
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

  // Base models states
  const [baseModelsData, setBaseModelsData] = useState<Record<string, BaseMoldData> | null>(null);
  const [selectedBaseModelKey, setSelectedBaseModelKey] = useState<string>('');
  const [balloonHeight, setBalloonHeight] = useState<string>('300');
  const [loadingBaseModels, setLoadingBaseModels] = useState(false);

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

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
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
        setImportError(null);
      }
      return;
    }

    let cancelled = false;
    setLoadingMold(true);
    setFormError(null);
    setFormSuccess(null);
    setImportError(null);
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

  function handleGenerateFromBase() {
    if (!baseModelsData || !selectedBaseModelKey) {
      setFormError('Selecione um modelo base primeiro.');
      return;
    }

    const gomos = Number(quantidadeGomos);
    const bainha = Number(bainhaCm);
    const height = Number(balloonHeight);

    if (!quantidadeGomos || !Number.isFinite(gomos) || gomos < 1) {
      setFormError('Informe a quantidade de gomos antes de gerar.');
      return;
    }
    if (!bainhaCm || !Number.isFinite(bainha) || bainha < 0) {
      setFormError('Informe o tamanho da bainha antes de gerar.');
      return;
    }
    if (!balloonHeight || !Number.isFinite(height) || height <= 0) {
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

    // Calculate dist
    const dist = [0];
    for (let i = 1; i < heightAcum.length; i++) {
      dist.push(heightAcum[i] - heightAcum[i - 1]);
    }

    const LargoBase = dist.reduce((sum, val) => sum + val, 0);
    if (LargoBase <= 0) {
      setFormError('O modelo base possui um comprimento inválido.');
      return;
    }

    // Generate new points
    const newPoints = dist.map((_, i) => {
      const dL = (dist[i] * height) / LargoBase;
      const anchoAux = ((perimeter[i] * height / LargoBase) / (2 * gomos)) + (bainha / 2);
      
      // format to fixed-point strings
      return createPoint(
        dL.toFixed(1),
        anchoAux.toFixed(1)
      );
    });

    setPoints(newPoints);
    setFormError(null);
    setFormSuccess('Tabela de pontos gerada com sucesso a partir do modelo base!');

    // Automatically set the main model category
    const detectedCategory = categorize(selectedBaseModelKey);
    setModelo(normalizeModelo(detectedCategory));
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

  async function handlePdfSelected(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !token) {
      return;
    }

    setImporting(true);
    setImportError(null);
    setFormSuccess(null);

    try {
      const imported = await importMoldPdf(file, token);

      if (imported.nome_molde) {
        setNomeMolde(imported.nome_molde);
      }
      if (imported.modelo) {
        setModelo(normalizeModelo(imported.modelo));
      }
      if (imported.quantidade_gomos > 0) {
        setQuantidadeGomos(String(imported.quantidade_gomos));
      }
      if (imported.bainha_cm > 0) {
        setBainhaCm(String(imported.bainha_cm));
      }
      if (imported.pontos.length > 0) {
        setPoints(
          imported.pontos.map((point) => createPoint(String(point.altura_cm), String(point.largura_meia_cm)))
        );
      }
    } catch (error) {
      setImportError(error instanceof ApiError ? error.message : 'Nao foi possivel importar o PDF.');
    } finally {
      setImporting(false);
    }
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
            <button type="submit" className="mold-save-button" disabled={saving || loadingMold || importing}>
              {saving ? <Loader2 size={16} className="mold-import-spinner" /> : <Save size={16} />}
              {saving ? 'Salvando...' : isEditing ? 'Salvar alteracoes' : 'Salvar molde'}
            </button>
          </div>
        </div>

        {loadingMold && <p className="mold-form-loading">Carregando molde...</p>}
        {importError && <p className="mold-import-error">{importError}</p>}
        {formError && <p className="mold-import-error">{formError}</p>}
        {formSuccess && <p className="mold-form-success">{formSuccess}</p>}

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

        <div style={{
          marginTop: '24px',
          marginBottom: '24px',
          padding: '20px',
          border: '1px solid #263349',
          borderRadius: '12px',
          background: 'rgba(30, 41, 59, 0.4)'
        }}>
          <h3 style={{ fontSize: '15px', color: '#f59e0b', margin: '0 0 16px 0', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span>⚡</span> Gerar Molde de Modelo Pronto (data.json)
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '16px', alignItems: 'end' }}>
            <label className="auth-field" style={{ margin: 0 }}>
              <span>Modelo Base</span>
              {loadingBaseModels ? (
                <div style={{ color: '#8fa3bd', fontSize: '13px', padding: '8px 0' }}>Carregando modelos...</div>
              ) : (
                <select 
                  value={selectedBaseModelKey} 
                  onChange={(e) => setSelectedBaseModelKey(e.target.value)}
                  style={{ width: '100%' }}
                >
                  <option value="">-- Selecione um modelo --</option>
                  {Object.keys(baseModelsByCategory).sort().map((cat) => (
                    <optgroup key={cat} label={cat}>
                      {baseModelsByCategory[cat].map((m) => (
                        <option key={m.key} value={m.key}>
                          {m.name}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              )}
            </label>

            <label className="auth-field" style={{ margin: 0 }}>
              <span>Altura do Balão (cm)</span>
              <input
                type="number"
                min={10}
                placeholder="Ex: 300"
                value={balloonHeight}
                onChange={(e) => setBalloonHeight(e.target.value)}
              />
            </label>

            <button
              type="button"
              onClick={handleGenerateFromBase}
              style={{
                height: '42px',
                background: 'linear-gradient(135deg, #f59e0b, #d97706)',
                color: '#fff',
                border: 'none',
                fontWeight: '600',
                padding: '0 16px',
                borderRadius: '8px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                transition: 'opacity 0.2s'
              }}
              onMouseOver={(e) => e.currentTarget.style.opacity = '0.9'}
              onMouseOut={(e) => e.currentTarget.style.opacity = '1'}
            >
              Calcular e Gerar Pontos
            </button>
          </div>
        </div>

        <div className="mold-points-header">
          <h3>Pontos do Molde</h3>
          <div className="mold-points-actions">
            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf"
              className="mold-import-input"
              onChange={handlePdfSelected}
            />
            <button
              type="button"
              className="mold-import-button"
              onClick={() => fileInputRef.current?.click()}
              disabled={importing || loadingMold}
            >
              {importing ? <Loader2 size={16} className="mold-import-spinner" /> : <FileUp size={16} />}
              {importing ? 'Lendo PDF...' : 'Importar PDF'}
            </button>
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

        <div className="mold-form-footer">
          <button type="submit" className="mold-save-button" disabled={saving || loadingMold || importing}>
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
