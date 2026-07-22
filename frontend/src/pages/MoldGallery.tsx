import { useCallback, useEffect, useState } from 'react';
import { Copy, Loader2, Pencil, Printer, Ruler, Shapes, Trash2, UserRound } from 'lucide-react';
import { MoldSilhouettePreview } from '../components/MoldSilhouettePreview';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import type { MoldPoint, MoldSummary } from '../types';

interface MoldGalleryProps {
  onEdit: (moldId: number) => void;
  onCopied: (moldId: number) => void;
  /** "Plotar no Taco" sempre comeca do zero (3 partes padrao, taco 5cm) — cria
   * um projeto novo em Meus Projetos quando o usuario salvar, nunca reaproveita
   * um projeto ja existente desse molde. */
  onPlotTaco: (mold: MoldSummary) => void;
  /** Some com o atalho quando o admin esconde a aba "Plotter (Moldes Tacos)"
   * do menu. Default true (nunca escondido). */
  showPlotTaco?: boolean;
}

function formatCm(value: number): string {
  const n = Number(value);
  const text = Number.isFinite(n) ? n.toFixed(1).replace(/\.0$/, '').replace('.', ',') : '0';
  return `${text} cm`;
}

/** API envia data ja no horario de Brasilia (YYYY-MM-DD HH:mm:ss). */
function formatDateTime(value: string): string {
  const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
  if (!match) {
    return value;
  }

  const [, year, month, day, hour, minute] = match;
  return `${day}/${month}/${year}, ${hour}:${minute}`;
}

function toPreviewPoints(pontos: MoldPoint[] | undefined) {
  let acumulada = 0;
  return (pontos ?? []).map((point, index) => {
    const altura = Number(point.altura_cm) || 0;
    acumulada = index === 0 ? altura : acumulada + altura;
    return {
      alturaAcumuladaCm: acumulada,
      larguraMeiaCm: Number(point.largura_meia_cm) || 0,
    };
  });
}

export function MoldGallery({
  onEdit,
  onCopied,
  onPlotTaco,
  showPlotTaco = true,
}: MoldGalleryProps) {
  const { token } = useAuth();
  const [molds, setMolds] = useState<MoldSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [copyingId, setCopyingId] = useState<number | null>(null);

  const loadMolds = useCallback(async () => {
    if (!token) {
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const response = await api.listMolds(token);
      setMolds(response.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Nao foi possivel carregar a galeria.');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void loadMolds();
  }, [loadMolds]);

  async function handleDelete(mold: MoldSummary) {
    if (!token || !mold.can_delete) {
      return;
    }

    const confirmed = window.confirm(
      `Excluir o molde "${mold.nome}"? Essa acao remove o molde e todos os projetos plotados dele para todos.`
    );
    if (!confirmed) {
      return;
    }

    setDeletingId(mold.id);
    setError(null);
    try {
      await api.deleteMold(mold.id, token);
      setMolds((prev) => prev.filter((item) => item.id !== mold.id));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Nao foi possivel excluir o molde.');
    } finally {
      setDeletingId(null);
    }
  }

  async function handleCopy(mold: MoldSummary) {
    if (!token || !mold.can_copy) {
      return;
    }

    setCopyingId(mold.id);
    setError(null);
    try {
      const response = await api.copyMold(mold.id, token);
      // Abre a copia no formulario do usuario, sem alterar o original.
      onCopied(response.data.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Nao foi possivel criar a copia do molde.');
    } finally {
      setCopyingId(null);
    }
  }

  return (
    <div className="mold-gallery">
      <div className="mold-gallery-header">
        <h2>Galeria de Moldes</h2>
        <button type="button" className="mold-gallery-refresh" onClick={() => void loadMolds()} disabled={loading}>
          {loading ? <Loader2 size={16} className="mold-import-spinner" /> : null}
          Atualizar
        </button>
      </div>

      {error && <p className="mold-import-error">{error}</p>}

      {loading && molds.length === 0 ? (
        <div className="mold-gallery-empty">
          <Loader2 size={22} className="mold-import-spinner" />
          <span>Carregando moldes...</span>
        </div>
      ) : null}

      {!loading && molds.length === 0 ? (
        <div className="mold-gallery-empty">
          <Shapes size={28} />
          <strong>Nenhum molde salvo ainda</strong>
          <span>Use a aba "Adicionar sua Tabela de Molde" para cadastrar o primeiro.</span>
        </div>
      ) : null}

      <div className="mold-gallery-grid">
        {molds.map((mold) => {
          const modifiedByOther = mold.updated_by.id !== mold.created_by.id || mold.updated_at !== mold.created_at;

          return (
            <article key={mold.id} className="mold-card">
              <div className="mold-card-top">
                <div>
                  <h3>{mold.nome}</h3>
                  <span className="mold-card-model">{mold.modelo}</span>
                </div>
                <div className="mold-card-actions">
                  {showPlotTaco ? (
                    <button
                      type="button"
                      className="mold-card-btn plot"
                      onClick={() => onPlotTaco(mold)}
                      title="Plotar este molde em tacos"
                    >
                      <Printer size={15} />
                      Plotar no Taco
                    </button>
                  ) : null}

                  {mold.can_edit ? (
                    <button
                      type="button"
                      className="mold-card-btn edit"
                      onClick={() => onEdit(mold.id)}
                      title="Modificar molde"
                    >
                      <Pencil size={15} />
                      Modificar
                    </button>
                  ) : null}

                  {mold.can_copy ? (
                    <button
                      type="button"
                      className="mold-card-btn copy"
                      onClick={() => void handleCopy(mold)}
                      disabled={copyingId === mold.id}
                      title="Criar uma copia para usar"
                    >
                      {copyingId === mold.id ? (
                        <Loader2 size={15} className="mold-import-spinner" />
                      ) : (
                        <Copy size={15} />
                      )}
                      Criar copia
                    </button>
                  ) : null}

                  {mold.can_delete ? (
                    <button
                      type="button"
                      className="mold-card-btn delete"
                      onClick={() => void handleDelete(mold)}
                      disabled={deletingId === mold.id}
                      title="Excluir molde"
                    >
                      {deletingId === mold.id ? (
                        <Loader2 size={15} className="mold-import-spinner" />
                      ) : (
                        <Trash2 size={15} />
                      )}
                      Excluir
                    </button>
                  ) : null}
                </div>
              </div>

              <div className="mold-card-body">
                <div className="mold-card-preview">
                  <MoldSilhouettePreview points={toPreviewPoints(mold.pontos)} />
                </div>

                <div className="mold-card-stats">
                  <div>
                    <span>Tamanho</span>
                    <strong>{formatCm(mold.altura_total_cm)}</strong>
                  </div>
                  <div>
                    <span>Gomos</span>
                    <strong>{mold.quantidade_gomos}</strong>
                  </div>
                  <div>
                    <span>Pontos</span>
                    <strong>{mold.pontos_count}</strong>
                  </div>
                  <div>
                    <span>Bainha</span>
                    <strong>{formatCm(mold.bainha_cm)}</strong>
                  </div>
                </div>
              </div>

              <div className="mold-card-meta">
                <div>
                  <UserRound size={14} />
                  <span>
                    Adicionado por <strong>{mold.created_by.name || 'Usuario'}</strong>
                    <em className="mold-card-date"> em {formatDateTime(mold.created_at)}</em>
                  </span>
                </div>
                {modifiedByOther ? (
                  <div>
                    <Ruler size={14} />
                    <span>
                      Ultima alteracao por <strong>{mold.updated_by.name || 'Usuario'}</strong>
                      <em className="mold-card-date"> em {formatDateTime(mold.updated_at)}</em>
                    </span>
                  </div>
                ) : null}
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
