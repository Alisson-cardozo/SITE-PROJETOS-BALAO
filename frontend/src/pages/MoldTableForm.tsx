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
