import { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { hideableNavItems } from '../config/userNavigation';

export function AdminTabsPage() {
  const { token } = useAuth();
  const [hidden, setHidden] = useState<Set<string>>(new Set());
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

  const handleSave = async () => {
    if (!token) return;
    setError(null);
    setSuccess(false);
    setSaving(true);
    try {
      await api.adminUpdateSystemSettings({ hidden_nav_items: [...hidden] }, token);
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
                  <label key={item.id} className={`admin-tabs-row${isHidden ? ' is-hidden' : ''}`}>
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
