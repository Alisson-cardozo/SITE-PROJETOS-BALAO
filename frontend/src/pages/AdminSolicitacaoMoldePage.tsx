import { useCallback, useEffect, useState } from 'react';
import { Loader2, Hammer, Check, KeyRound, Search, PackageCheck, Clock } from 'lucide-react';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import type { SolicitacaoChaveConsulta } from '../types';

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 12px',
  background: '#0b0f18',
  border: '1px solid #2d3748',
  borderRadius: '8px',
  color: '#fff',
  fontSize: '14px',
  outline: 'none',
  boxSizing: 'border-box',
};

export function AdminSolicitacaoMoldePage() {
  const { token } = useAuth();
  const [valorMetro, setValorMetro] = useState('0');
  const [videoUrl, setVideoUrl] = useState('');
  const [ativo, setAtivo] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Enviar chave grátis (só e-mail — o cliente escolhe o molde ao usar a chave)
  const [chaveEmail, setChaveEmail] = useState('');
  const [chaveBusy, setChaveBusy] = useState(false);
  const [chaveMsg, setChaveMsg] = useState<string | null>(null);
  const [chaveErr, setChaveErr] = useState<string | null>(null);

  const enviarChave = async () => {
    if (!token) return;
    setChaveErr(null);
    setChaveMsg(null);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(chaveEmail.trim())) { setChaveErr('Informe um e-mail válido.'); return; }
    setChaveBusy(true);
    try {
      const r = await api.adminSolicitacaoEnviarChave({ email: chaveEmail.trim().toLowerCase() }, token);
      setChaveMsg(`Chave enviada para ${chaveEmail.trim()} — ${r.chave}`);
      setChaveEmail('');
    } catch (err) {
      setChaveErr(err instanceof ApiError ? err.message : 'Não foi possível enviar a chave.');
    } finally {
      setChaveBusy(false);
    }
  };

  // Consultar chave — ver se o molde foi entregue e qual é.
  const [consultaChave, setConsultaChave] = useState('');
  const [consultaBusy, setConsultaBusy] = useState(false);
  const [consultaErr, setConsultaErr] = useState<string | null>(null);
  const [consultaRes, setConsultaRes] = useState<SolicitacaoChaveConsulta | null>(null);

  const consultarChave = async () => {
    if (!token) return;
    setConsultaErr(null);
    setConsultaRes(null);
    const chave = consultaChave.trim().toUpperCase();
    if (chave === '') { setConsultaErr('Digite a chave.'); return; }
    setConsultaBusy(true);
    try {
      const r = await api.adminSolicitacaoConsultarChave(chave, token);
      setConsultaRes(r.data);
    } catch (err) {
      setConsultaErr(err instanceof ApiError ? err.message : 'Não foi possível consultar a chave.');
    } finally {
      setConsultaBusy(false);
    }
  };

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.adminSolicitacaoConfig(token);
      setValorMetro(String(res.data.valor_metro ?? 0));
      setVideoUrl(res.data.video_url ?? '');
      setAtivo(res.data.ativo !== false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível carregar.');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSave = async () => {
    if (!token) return;
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      await api.adminSolicitacaoUpdateConfig({ valor_metro: Number(valorMetro) || 0, video_url: videoUrl.trim(), ativo }, token);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível salvar.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bandeira-workspace" style={{ padding: '24px' }}>
      <div className="bandeira-main-panel" style={{ width: '100%', maxWidth: '100%', background: '#111622', border: '1px solid #1f293d', borderRadius: '12px', padding: '24px' }}>
        <div style={{ marginBottom: '20px', borderBottom: '1px solid #1f293d', paddingBottom: '16px' }}>
          <h2 style={{ fontSize: '24px', fontWeight: 600, color: '#f7fafc', margin: 0, display: 'flex', alignItems: 'center', gap: '10px' }}>
            <Hammer size={24} /> Molde sob Encomenda
          </h2>
          <p style={{ color: '#a0aec0', margin: '4px 0 0 0', fontSize: '14px' }}>
            Valor do metro e vídeo tutorial da página pública. O cliente escolhe o modelo do catálogo do sistema.
          </p>
        </div>

        {loading ? (
          <p style={{ textAlign: 'center', color: '#a0aec0', padding: '24px' }}>
            <Loader2 size={20} className="mold-import-spinner" style={{ marginRight: '8px' }} /> Carregando...
          </p>
        ) : (
          <>
            {/* Liga/desliga a página pública de venda de molde com a IA */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap', background: ativo ? 'rgba(72,187,120,0.08)' : 'rgba(160,174,192,0.08)', border: `1px solid ${ativo ? 'rgba(72,187,120,0.3)' : 'rgba(160,174,192,0.25)'}`, borderRadius: '10px', padding: '14px 16px', marginBottom: '20px' }}>
              <div>
                <div style={{ color: '#f7fafc', fontSize: '15px', fontWeight: 600 }}>Venda de molde com IA (página pública)</div>
                <div style={{ color: '#a0aec0', fontSize: '13px', marginTop: '2px' }}>
                  {ativo ? 'Ativa — clientes podem solicitar moldes em /solicitar-molde.' : 'Desligada — a página mostra “indisponível” e não aceita novos pedidos.'}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setAtivo((v) => !v)}
                role="switch"
                aria-checked={ativo}
                style={{ position: 'relative', width: '52px', height: '28px', borderRadius: '999px', border: 'none', cursor: 'pointer', background: ativo ? '#48bb78' : '#4a5568', transition: 'background 0.15s', flexShrink: 0 }}
              >
                <span style={{ position: 'absolute', top: '3px', left: ativo ? '27px' : '3px', width: '22px', height: '22px', borderRadius: '50%', background: '#fff', transition: 'left 0.15s' }} />
              </button>
            </div>

            <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', marginBottom: '20px' }}>
              <div style={{ flex: '1 1 200px' }}>
                <label style={{ display: 'block', color: '#cbd5e0', fontSize: '13px', marginBottom: '6px', fontWeight: 600 }}>
                  Valor do metro (R$)
                </label>
                <input type="number" min={0} step="0.01" style={inputStyle} value={valorMetro} onChange={(e) => setValorMetro(e.target.value)} />
                <p style={{ color: '#718096', fontSize: '12px', margin: '6px 0 0' }}>
                  Ex: R$5 o metro. Cliente com molde de 1000 cm (10 m) paga R$50.
                </p>
              </div>
              <div style={{ flex: '2 1 320px' }}>
                <label style={{ display: 'block', color: '#cbd5e0', fontSize: '13px', marginBottom: '6px', fontWeight: 600 }}>
                  Link do vídeo tutorial (YouTube)
                </label>
                <input type="text" style={inputStyle} value={videoUrl} onChange={(e) => setVideoUrl(e.target.value)} placeholder="https://www.youtube.com/watch?v=..." />
                <p style={{ color: '#718096', fontSize: '12px', margin: '6px 0 0' }}>
                  Aparece no botão "Como solicitar seu molde" da página pública.
                </p>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <button type="button" onClick={() => void handleSave()} disabled={saving} className="mold-save-button">
                {saving ? <Loader2 size={16} className="mold-import-spinner" /> : null}
                Salvar configuração
              </button>
              {saved ? <span style={{ color: '#48bb78', fontSize: '13px', display: 'inline-flex', alignItems: 'center', gap: '4px' }}><Check size={15} /> Salvo!</span> : null}
              {error ? <span className="mold-import-error">{error}</span> : null}
            </div>

            {/* Enviar chave grátis pro cliente */}
            <div style={{ marginTop: '24px', paddingTop: '20px', borderTop: '1px solid #1f293d' }}>
              <h3 style={{ color: '#f7fafc', fontSize: '16px', fontWeight: 600, margin: '0 0 4px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <KeyRound size={18} /> Enviar chave para um cliente
              </h3>
              <p style={{ color: '#a0aec0', fontSize: '13px', margin: '0 0 14px' }}>
                Gera uma chave grátis e envia pro e-mail do cliente. Ele usa em <strong>/solicitar-molde</strong> → "Já paguei / tenho uma chave", e aí <strong>ele mesmo escolhe</strong> o modelo, tamanho, gomos e bainha.
              </p>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', maxWidth: '520px' }}>
                <div>
                  <label style={{ display: 'block', color: '#cbd5e0', fontSize: '13px', marginBottom: '6px', fontWeight: 600 }}>E-mail do cliente</label>
                  <input type="email" style={inputStyle} value={chaveEmail} onChange={(e) => setChaveEmail(e.target.value)} placeholder="cliente@email.com" onKeyDown={(e) => { if (e.key === 'Enter') void enviarChave(); }} />
                </div>

                {chaveErr && <p className="mold-import-error" style={{ margin: 0 }}>{chaveErr}</p>}
                {chaveMsg && <p style={{ color: '#48bb78', fontSize: '13px', margin: 0, fontWeight: 600 }}>✅ {chaveMsg}</p>}

                <div>
                  <button type="button" onClick={() => void enviarChave()} disabled={chaveBusy} style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', background: '#805ad5', color: '#fff', border: 'none', borderRadius: '8px', padding: '11px 18px', fontSize: '14px', fontWeight: 600, cursor: chaveBusy ? 'default' : 'pointer' }}>
                    {chaveBusy ? <Loader2 size={16} className="mold-import-spinner" /> : <KeyRound size={16} />}
                    Gerar e enviar chave
                  </button>
                </div>
              </div>
            </div>

            {/* Consultar chave: ver se o molde foi entregue e qual é */}
            <div style={{ marginTop: '24px', paddingTop: '20px', borderTop: '1px solid #1f293d' }}>
              <h3 style={{ color: '#f7fafc', fontSize: '16px', fontWeight: 600, margin: '0 0 4px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Search size={18} /> Consultar uma chave
              </h3>
              <p style={{ color: '#a0aec0', fontSize: '13px', margin: '0 0 14px' }}>
                Digite a chave do cliente para ver <strong>se o molde já foi entregue</strong> e qual molde é.
              </p>

              <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', maxWidth: '520px' }}>
                <input
                  type="text"
                  style={{ ...inputStyle, flex: '1 1 220px', textTransform: 'uppercase', letterSpacing: '2px', fontWeight: 600 }}
                  value={consultaChave}
                  onChange={(e) => { setConsultaChave(e.target.value.toUpperCase()); setConsultaErr(null); }}
                  onKeyDown={(e) => { if (e.key === 'Enter') void consultarChave(); }}
                  placeholder="CHAVE DO CLIENTE"
                />
                <button type="button" onClick={() => void consultarChave()} disabled={consultaBusy} style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', background: '#2b6cb0', color: '#fff', border: 'none', borderRadius: '8px', padding: '11px 18px', fontSize: '14px', fontWeight: 600, cursor: consultaBusy ? 'default' : 'pointer' }}>
                  {consultaBusy ? <Loader2 size={16} className="mold-import-spinner" /> : <Search size={16} />}
                  Consultar
                </button>
              </div>

              {consultaErr && <p className="mold-import-error" style={{ margin: '10px 0 0' }}>{consultaErr}</p>}

              {consultaRes && (
                <div style={{ marginTop: '14px', maxWidth: '520px', background: '#0b0f18', border: '1px solid #23304d', borderRadius: '10px', padding: '16px' }}>
                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '6px 12px', borderRadius: '999px', fontSize: '13px', fontWeight: 700, marginBottom: '12px', background: consultaRes.entregue ? 'rgba(72,187,120,0.15)' : 'rgba(236,201,75,0.15)', color: consultaRes.entregue ? '#48bb78' : '#ecc94b' }}>
                    {consultaRes.entregue ? <PackageCheck size={16} /> : <Clock size={16} />}
                    {consultaRes.entregue ? 'Molde ENTREGUE' : (consultaRes.status === 'pago' ? 'Pago — ainda NÃO entregue' : 'Aguardando pagamento')}
                  </div>
                  <div style={{ fontSize: '13.5px', color: '#cbd5e0', lineHeight: 1.9 }}>
                    <div>Molde: <strong style={{ color: '#f7fafc' }}>{consultaRes.modelo_nome || '(a definir)'}</strong>{consultaRes.categoria ? ` (${consultaRes.categoria})` : ''}</div>
                    <div>Tamanho: <strong>{consultaRes.tamanho_cm > 0 ? `${consultaRes.tamanho_cm} cm` : '—'}</strong> · Gomos: <strong>{consultaRes.gomos || '—'}</strong> · Bainha: <strong>{consultaRes.bainha_cm} cm</strong></div>
                    <div>Cliente: <strong>{consultaRes.email}</strong></div>
                    <div>Valor: <strong>{consultaRes.valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</strong></div>
                    {consultaRes.entregue_at && <div>Entregue em: <strong>{new Date(consultaRes.entregue_at).toLocaleString('pt-BR')}</strong></div>}
                  </div>
                </div>
              )}
            </div>

            <div style={{ marginTop: '20px', padding: '14px', background: 'rgba(66,153,225,0.08)', border: '1px solid rgba(66,153,225,0.25)', borderRadius: '10px', color: '#90cdf4', fontSize: '13px' }}>
              Link da página pública para divulgar: <strong>/solicitar-molde</strong>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
