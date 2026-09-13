import { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';

export function AdminSocialPage() {
  const { token } = useAuth();
  const [telegram, setTelegram] = useState('');
  const [instagram, setInstagram] = useState('');
  const [whatsapp, setWhatsapp] = useState('');
  const [youtube, setYoutube] = useState('');
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
      setTelegram(response.data.telegram ?? '');
      setInstagram(response.data.instagram ?? '');
      setWhatsapp(response.data.whatsapp ?? '');
      setYoutube(response.data.youtube ?? '');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Nao foi possivel carregar as redes sociais.');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSave = async () => {
    if (!token) return;
    setError(null);
    setSuccess(false);
    setSaving(true);
    try {
      await api.adminUpdateSystemSettings(
        { telegram: telegram.trim(), instagram: instagram.trim(), whatsapp: whatsapp.trim(), youtube: youtube.trim() },
        token
      );
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
          <h2>Redes Sociais</h2>
          <p>Aparecem como icones no rodape do sistema, pra quem estiver logado. Deixe em branco pra esconder uma rede.</p>
        </div>

        {loading ? (
          <p className="bandeira-size-hint">
            <Loader2 size={14} className="mold-import-spinner" /> Carregando...
          </p>
        ) : (
          <div className="bandeira-create-panel">
            <label className="auth-field">
              <span>Telegram</span>
              <input
                type="text"
                value={telegram}
                onChange={(e) => setTelegram(e.target.value)}
                placeholder="@seucanal ou https://t.me/seucanal"
              />
            </label>

            <label className="auth-field">
              <span>Instagram</span>
              <input
                type="text"
                value={instagram}
                onChange={(e) => setInstagram(e.target.value)}
                placeholder="@seuperfil ou https://instagram.com/seuperfil"
              />
            </label>

            <label className="auth-field">
              <span>WhatsApp</span>
              <input
                type="text"
                value={whatsapp}
                onChange={(e) => setWhatsapp(e.target.value)}
                placeholder="5511999998888"
              />
            </label>

            <label className="auth-field">
              <span>Canal do YouTube</span>
              <input
                type="text"
                value={youtube}
                onChange={(e) => setYoutube(e.target.value)}
                placeholder="https://youtube.com/@seucanal"
              />
              <small className="bandeira-size-hint">
                Aparece como botão pros clientes verem as funcionalidades do sistema.
              </small>
            </label>

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
