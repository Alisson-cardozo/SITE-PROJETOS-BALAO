import { useCallback, useEffect, useState } from 'react';
import { Eye, FileDown, Loader2, Mail, Printer, Shapes, Trash2, UserRound } from 'lucide-react';
import { GomoTacoPreview } from '../components/GomoTacoPreview';
import { SendEmailModal } from '../components/SendEmailModal';
import { SeparatedPiecesModal } from '../components/SeparatedPiecesModal';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { computeSectionTacoTotals, SECTION_COLORS, SECTION_LABELS, SECTION_ORDER } from '../lib/moldGeometry';
import { buildMoldPdf } from '../lib/moldPdf';
import { downloadBlob, slugifyFilename } from '../lib/pdfExport';
import type { MoldProjectSummary } from '../types';

interface ProjectGalleryProps {
  /** "Modificar" abre esse MESMO projeto no Plotter pra editar (nao cria outro). */
  onModify: (project: MoldProjectSummary) => void;
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

export function ProjectGallery({ onModify }: ProjectGalleryProps) {
  const { token } = useAuth();
  const [projects, setProjects] = useState<MoldProjectSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [downloadingId, setDownloadingId] = useState<number | null>(null);
  const [piecesProject, setPiecesProject] = useState<MoldProjectSummary | null>(null);
  const [emailProject, setEmailProject] = useState<MoldProjectSummary | null>(null);

  const loadProjects = useCallback(async () => {
    if (!token) {
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const response = await api.listProjects(token);
      setProjects(response.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Nao foi possivel carregar os projetos.');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  async function handleDelete(project: MoldProjectSummary) {
    if (!token || !project.can_delete) {
      return;
    }

    const confirmed = window.confirm(`Excluir o projeto "${project.display_nome}"? O molde continua na Galeria de Moldes.`);
    if (!confirmed) {
      return;
    }

    setDeletingId(project.id);
    setError(null);
    try {
      await api.deleteProject(project.id, token);
      setProjects((prev) => prev.filter((item) => item.id !== project.id));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Nao foi possivel excluir o projeto.');
    } finally {
      setDeletingId(null);
    }
  }

  function handleDownloadPdf(project: MoldProjectSummary) {
    if (downloadingId !== null) {
      return;
    }

    setDownloadingId(project.id);
    setError(null);
    try {
      const blob = buildMoldPdf({
        nome: project.nome,
        modelo: project.modelo,
        quantidadeGomos: project.quantidade_gomos,
        bainhaCm: project.bainha_cm,
        alturaTotalCm: project.altura_total_cm,
        pontos: project.pontos,
        plotterConfig: project.plotter_config,
        mode: 'pieces',
      });
      downloadBlob(blob, `${slugifyFilename(project.display_nome)}.pdf`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nao foi possivel gerar o PDF.');
    } finally {
      setDownloadingId(null);
    }
  }

  return (
    <div className="mold-gallery">
      <div className="mold-gallery-header">
        <h2>Meus Projetos</h2>
        <button type="button" className="mold-gallery-refresh" onClick={() => void loadProjects()} disabled={loading}>
          {loading ? <Loader2 size={16} className="mold-import-spinner" /> : null}
          Atualizar
        </button>
      </div>

      {error && <p className="mold-import-error">{error}</p>}

      {loading && projects.length === 0 ? (
        <div className="mold-gallery-empty">
          <Loader2 size={22} className="mold-import-spinner" />
          <span>Carregando projetos...</span>
        </div>
      ) : null}

      {!loading && projects.length === 0 ? (
        <div className="mold-gallery-empty">
          <Shapes size={28} />
          <strong>Nenhum projeto plotado ainda</strong>
          <span>Va na Galeria de Moldes, clique em "Plotar no Taco" e depois em "Salvar configuracao" para o projeto aparecer aqui.</span>
        </div>
      ) : null}

      <div className="mold-gallery-grid">
        {projects.map((project) => {
          const modifiedByOther =
            project.updated_by.id !== project.created_by.id || project.updated_at !== project.created_at;
          const sectionTotals = computeSectionTacoTotals(
            project.pontos,
            project.plotter_config.taco_configs,
            project.plotter_config.section_ratios
          );

          return (
            <article key={project.id} className="mold-card">
              <div className="mold-card-top">
                <div>
                  <h3>{project.display_nome}</h3>
                  <span className="mold-card-model">{project.modelo}</span>
                </div>
                <div className="mold-card-actions">
                  <button
                    type="button"
                    className="mold-card-btn plot"
                    onClick={() => onModify(project)}
                    title="Editar tacos, cores e proporcoes no Plotter"
                  >
                    <Printer size={15} />
                    Modificar
                  </button>

                  <button
                    type="button"
                    className="mold-card-btn pieces"
                    onClick={() => setPiecesProject(project)}
                    title="Visualizar o molde plotado, peca por peca"
                  >
                    <Eye size={15} />
                    Visualizar
                  </button>

                  <button
                    type="button"
                    className="mold-card-btn pdf"
                    onClick={() => handleDownloadPdf(project)}
                    disabled={downloadingId === project.id}
                    title="Baixar PDF com todas as pecas e dados do molde"
                  >
                    {downloadingId === project.id ? (
                      <Loader2 size={15} className="mold-import-spinner" />
                    ) : (
                      <FileDown size={15} />
                    )}
                    Baixar em PDF
                  </button>

                  <button
                    type="button"
                    className="mold-card-btn email"
                    onClick={() => setEmailProject(project)}
                    title="Enviar por email para o cliente final"
                  >
                    <Mail size={15} />
                    Enviar por Email
                  </button>

                  {project.can_delete ? (
                    <button
                      type="button"
                      className="mold-card-btn delete"
                      onClick={() => void handleDelete(project)}
                      disabled={deletingId === project.id}
                      title="Excluir projeto"
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

              <div className="mold-card-body">
                <div className="mold-card-preview">
                  <GomoTacoPreview
                    compact
                    pontos={project.pontos}
                    sectionColors={project.plotter_config.section_colors}
                    tacoConfigs={project.plotter_config.taco_configs}
                    sectionRatios={project.plotter_config.section_ratios}
                  />
                </div>

                <div className="mold-card-stats">
                  <div>
                    <span>Tamanho</span>
                    <strong>{formatCm(project.altura_total_cm)}</strong>
                  </div>
                  <div>
                    <span>Gomos</span>
                    <strong>{project.quantidade_gomos}</strong>
                  </div>
                  <div>
                    <span>Bainha</span>
                    <strong>{formatCm(project.bainha_cm)}</strong>
                  </div>
                </div>
              </div>

              <div className="mold-card-taco-stats">
                {SECTION_ORDER.map((id) => (
                  <div key={id} className="mold-card-taco-chip">
                    <span
                      className="mold-card-taco-dot"
                      style={{ background: project.plotter_config.section_colors[id] ?? SECTION_COLORS[id] }}
                    />
                    <span>{SECTION_LABELS[id]}</span>
                    <strong>{sectionTotals?.[id] ?? 0} tacos</strong>
                  </div>
                ))}
              </div>

              <div className="mold-card-meta">
                <div>
                  <UserRound size={14} />
                  <span>
                    Plotado por <strong>{project.created_by.name || 'Usuario'}</strong>
                    <em className="mold-card-date"> em {formatDateTime(project.created_at)}</em>
                  </span>
                </div>
                {modifiedByOther ? (
                  <div>
                    <UserRound size={14} />
                    <span>
                      Ultima alteracao por <strong>{project.updated_by.name || 'Usuario'}</strong>
                      <em className="mold-card-date"> em {formatDateTime(project.updated_at)}</em>
                    </span>
                  </div>
                ) : null}
              </div>
            </article>
          );
        })}
      </div>

      {piecesProject ? (
        <SeparatedPiecesModal
          nome={piecesProject.display_nome}
          pontos={piecesProject.pontos}
          plotterConfig={piecesProject.plotter_config}
          onClose={() => setPiecesProject(null)}
        />
      ) : null}

      {emailProject ? <SendEmailModal project={emailProject} onClose={() => setEmailProject(null)} /> : null}
    </div>
  );
}
