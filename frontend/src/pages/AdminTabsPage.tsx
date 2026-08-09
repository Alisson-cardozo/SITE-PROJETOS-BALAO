import { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { hideableNavItems } from '../config/userNavigation';
import type { TutorialConfig } from '../types';

const LABEL_PRESETS = ['Em breve', 'Em produção'];

export function AdminTabsPage() {
  const { token } = useAuth();
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [tutorials, setTutorials] = useState<Record<string, TutorialConfig>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const response = await api.getSystemSettings(token);
      setHidden(new Set(response.data.hidden_nav_items));
      setLabels(response.data.nav_item_labels);
      setTutorials(response.data.tutorials || {});
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Nao foi possivel carregar as abas.');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = (id: string) => {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const setLabel = (id: string, value: string) => {
    setLabels((prev) => ({ ...prev, [id]: value }));
  };

  const setTutorialShow = (id: string, show: boolean) => {
    setTutorials((prev) => ({
      ...prev,
      [id]: {
        ...(prev[id] || { video_url: '' }),
        show,
      },
    }));
  };

  const setTutorialVideoUrl = (id: string, video_url: string) => {
    setTutorials((prev) => ({
      ...prev,
      [id]: {
        ...(prev[id] || { show: true }),
        video_url,
      },
    }));
  };

  const handleSave = async () => {
    if (!token) return;
    setError(null);
    setSuccess(false);
    setSaving(true);
    try {
      // So faz sentido guardar rotulo de aba que ESTA oculta -- limpa o resto
      // pra nao deixar lixo de uma aba que foi desocultada depois.
      const cleanLabels = Object.fromEntries(
        Object.entries(labels).filter(([id, value]) => hidden.has(id) && value.trim() !== '')
      );
      await api.adminUpdateSystemSettings({
        hidden_nav_items: [...hidden],
        nav_item_labels: cleanLabels,
        tutorials,
      }, token);
      setLabels(cleanLabels);
      setSuccess(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Nao foi possivel salvar.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bandeira-workspace">
      <div className="bandeira-main-panel">
        <div className="bandeira-panel-header">
          <h2>Abas</h2>
          <p>Escolha quais abas ficam visiveis no sistema. Ocultar uma aba tira ela do menu (e de qualquer atalho que
            leve ate ela) pra todo mundo, incluindo voce — pra usar de novo, so voltar aqui e marcar como visivel.</p>
        </div>

        {loading ? (
          <p className="bandeira-size-hint">
            <Loader2 size={14} className="mold-import-spinner" /> Carregando...
          </p>
        ) : (
          <div className="bandeira-create-panel">
            <div className="admin-tabs-list">
              {hideableNavItems.map((item) => {
                const Icon = item.icon;
                const isHidden = hidden.has(item.id);
                return (
                  <div key={item.id} className={`admin-tabs-row-wrap${isHidden ? ' is-hidden' : ''}`}>
                    <label className={`admin-tabs-row${isHidden ? ' is-hidden' : ''}`}>
                      <div className="admin-tabs-row-info">
                        <Icon size={18} />
                        <div>
                          <strong>{item.label}</strong>
                          <span>{item.description}</span>
                        </div>
                      </div>
                      <span className="rifa-checkbox-row admin-tabs-toggle">
                        <input type="checkbox" checked={isHidden} onChange={() => toggle(item.id)} />
                        <span>{isHidden ? 'Oculta' : 'Visivel'}</span>
                      </span>
                    </label>

                    {isHidden ? (
                      <div className="admin-tabs-label-row">
                        <span className="bandeira-size-hint">
                          Opcional: mostrar um aviso no lugar dessa aba na lista de "Solicitar Acesso" e no
                          checklist de planos (ex.: "Em breve"). Deixe em branco pra nao mostrar nada.
                        </span>
                        <div className="admin-tabs-label-input-row">
                          <input
                            type="text"
                            value={labels[item.id] ?? ''}
                            onChange={(e) => setLabel(item.id, e.target.value)}
                            placeholder="Ex: Em breve"
                            maxLength={40}
                          />
                          {LABEL_PRESETS.map((preset) => (
                            <button
                              key={preset}
                              type="button"
                              className="mold-secondary-button"
                              onClick={() => setLabel(item.id, preset)}
                            >
                              {preset}
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div className="admin-tabs-tutorial-row">
                        <div className="admin-tabs-tutorial-input-row">
                          <label className="rifa-checkbox-row admin-tabs-toggle" style={{ margin: 0, userSelect: 'none' }}>
                            <input
                              type="checkbox"
                              checked={tutorials[item.id]?.show ?? false}
                              onChange={(e) => setTutorialShow(item.id, e.target.checked)}
                            />
                            <span>Botão de Tutorial</span>
                          </label>
                          <input
                            type="text"
                            value={tutorials[item.id]?.video_url ?? ''}
                            onChange={(e) => setTutorialVideoUrl(item.id, e.target.value)}
                            placeholder="Link do vídeo no YouTube (ex: https://www.youtube.com/watch?v=xxxx)"
                            disabled={!tutorials[item.id]?.show}
                            maxLength={255}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {error ? <p className="mold-import-error">{error}</p> : null}
            {success ? <p className="mold-form-success">Salvo com sucesso.</p> : null}

            <button type="button" className="mold-save-button" onClick={() => void handleSave()} disabled={saving}>
              {saving ? <Loader2 size={16} className="mold-import-spinner" /> : null}
              Salvar
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
