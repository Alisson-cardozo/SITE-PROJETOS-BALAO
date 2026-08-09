import { useCallback, useEffect, useRef, useState } from 'react';
import { Lightbulb, Loader2, Trash2, UserRound } from 'lucide-react';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import type { LanternaProject } from '../types';

interface LanternagemProjectGalleryProps {
  onOpen: (project: LanternaProject) => void;
}

function formatDateTime(value: string): string {
  const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
  if (!match) return value;
  const [, year, month, day, hour, minute] = match;
  return `${day}/${month}/${year}, ${hour}:${minute}`;
}

/** Preview leve do card: desenha direto num canvas pequeno (nao 1 elemento
 * DOM por lanterna) — uma grade grande (ate ~45mil celulas) em SVG cru
 * deixaria a galeria travada com varios projetos na lista. */
function LanternaProjectThumbnail({ colors, gridWidth, gridHeight }: { colors: string[]; gridWidth: number; gridHeight: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || gridWidth <= 0 || gridHeight <= 0) {
      return;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return;
    }
    canvas.width = gridWidth;
    canvas.height = gridHeight;
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, gridWidth, gridHeight);
    for (let y = 0; y < gridHeight; y += 1) {
      for (let x = 0; x < gridWidth; x += 1) {
        const hex = colors[y * gridWidth + x];
        if (!hex || hex.toLowerCase() === '#000000') {
          continue;
        }
        ctx.fillStyle = hex;
        ctx.fillRect(x, y, 1, 1);
      }
    }
  }, [colors, gridWidth, gridHeight]);

  return <canvas ref={canvasRef} className="lanterna-project-thumb" />;
}

export function LanternagemProjectGallery({ onOpen }: LanternagemProjectGalleryProps) {
  const { token } = useAuth();
  const [projects, setProjects] = useState<LanternaProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const loadProjects = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const response = await api.listLanternaProjects(token);
      setProjects(response.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Nao foi possivel carregar os projetos de lanternagem.');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  async function handleDelete(project: LanternaProject) {
    if (!token || !project.can_delete) return;
    const confirmed = window.confirm(`Excluir o projeto "${project.nome}"?`);
    if (!confirmed) return;

    setDeletingId(project.id);
    setError(null);
    try {
      await api.deleteLanternaProject(project.id, token);
      setProjects((prev) => prev.filter((item) => item.id !== project.id));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Nao foi possivel excluir o projeto.');
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="mold-gallery">
      <div className="mold-gallery-header">
        <h2>Lanternagem de Bojo</h2>
        <p>
          Projetos salvos como arquivo editavel (nao imagem) — abra pra continuar o desenho de onde parou.
        </p>
      </div>

      {error ? <p className="mold-import-error">{error}</p> : null}

      {loading ? (
        <p className="bandeira-size-hint">
          <Loader2 size={14} className="mold-import-spinner" /> Carregando projetos...
        </p>
      ) : projects.length === 0 ? (
        <div className="plotter-empty">
          <div className="plotter-empty-card">
            <Lightbulb size={28} />
            <h2>Nenhum projeto de lanternagem ainda</h2>
            <p>
              Na aba <strong>Lanternagem de Bojo</strong>, escolha gomos/lanternas, desenhe o padrao e clique em{' '}
              <strong>Salvar projeto</strong>. Ele aparece aqui pra voce reabrir e continuar depois.
            </p>
          </div>
        </div>
      ) : (
        <div className="mold-gallery-grid">
          {projects.map((project) => {
            const previewColors = Array.isArray(project.state?.colors) ? project.state.colors : [];
            const previewWidth = project.state?.gridWidth || 0;
            const previewHeight = project.state?.gridHeight || 0;
            return (
              <article key={project.id} className="mold-card">
                <div className="mold-card-preview riscado-project-preview lanterna-project-preview">
                  {previewColors.length > 0 && previewWidth > 0 && previewHeight > 0 ? (
                    <LanternaProjectThumbnail colors={previewColors} gridWidth={previewWidth} gridHeight={previewHeight} />
                  ) : (
                    <div className="riscado-project-svg-empty">
                      <Lightbulb size={28} opacity={0.4} />
                    </div>
                  )}
                </div>
                <div className="mold-card-body">
                  <h3>{project.nome}</h3>
                  <p className="mold-card-meta">
                    {project.gomos} gomos · {project.lanternas_por_gomo} lanternas/gomo · {project.lanternas_subindo}{' '}
                    subindo
                  </p>
                  <p className="mold-card-meta">
                    <UserRound size={13} /> {project.created_by.name} · atualizado {formatDateTime(project.updated_at)}
                  </p>
                  <div className="mold-card-actions">
                    <button type="button" className="mold-save-button" onClick={() => onOpen(project)}>
                      <Lightbulb size={15} /> Continuar editando
                    </button>
                    {project.can_delete ? (
                      <button
                        type="button"
                        className="mold-import-button"
                        disabled={deletingId === project.id}
                        onClick={() => void handleDelete(project)}
                      >
                        {deletingId === project.id ? (
                          <Loader2 size={15} className="mold-import-spinner" />
                        ) : (
                          <Trash2 size={15} />
                        )}
                        Excluir
                      </button>
                    ) : null}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
