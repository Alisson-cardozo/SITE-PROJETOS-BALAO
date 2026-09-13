import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, MessageCircle, Power, CheckCircle2, AlertTriangle, RefreshCw, Smartphone, KeyRound, Save, UserX } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';

interface WaStatus {
  connected: boolean;
  qr: string | null;
  pairingCode?: string | null;
  initializing?: boolean;
  service_online: boolean;
  error?: string | null;
}

export function AdminWhatsAppPage() {
  const { token } = useAuth();
  const [status, setStatus] = useState<WaStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const pollRef = useRef<number | null>(null);

  // Metodo alternativo ao QR: codigo de pareamento (8 digitos, digitado no celular).
  const [connectMode, setConnectMode] = useState<'qr' | 'code'>('qr');
  const [phoneInput, setPhoneInput] = useState('');
  const [codeBusy, setCodeBusy] = useState(false);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [showCodeForm, setShowCodeForm] = useState(true);

  // Config: exigir validação de telefone dos clientes (portão)
  const [phoneReq, setPhoneReq] = useState(false);
  const [reqBusy, setReqBusy] = useState(false);

  // Config: mensagem automatica por WhatsApp pra quem nao ativou plano
  const [noPlanEnabled, setNoPlanEnabled] = useState(false);
  const [noPlanText, setNoPlanText] = useState('');
  const [noPlanDelayMin, setNoPlanDelayMin] = useState(60);
  const [noPlanRepeatMin, setNoPlanRepeatMin] = useState(1440);
  const [noPlanBusy, setNoPlanBusy] = useState(false);
  const [noPlanSaved, setNoPlanSaved] = useState(false);

  useEffect(() => {
    if (!token) return;
    api.getSystemSettings(token).then((r) => {
      setPhoneReq(!!r.data.phone_validation_required);
      setNoPlanEnabled(!!r.data.no_plan_msg_enabled);
      setNoPlanText(r.data.no_plan_msg_text || '');
      setNoPlanDelayMin(r.data.no_plan_msg_delay_min || 60);
      setNoPlanRepeatMin(r.data.no_plan_msg_repeat_min || 1440);
    }).catch(() => {});
  }, [token]);

  const handleSaveNoPlanMsg = async () => {
    if (!token) return;
    setNoPlanBusy(true);
    setNoPlanSaved(false);
    try {
      await api.adminUpdateSystemSettings(
        {
          no_plan_msg_enabled: noPlanEnabled,
          no_plan_msg_text: noPlanText,
          no_plan_msg_delay_min: noPlanDelayMin,
          no_plan_msg_repeat_min: noPlanRepeatMin,
        },
        token
      );
      setNoPlanSaved(true);
      window.setTimeout(() => setNoPlanSaved(false), 2500);
    } finally {
      setNoPlanBusy(false);
    }
  };

  const handleToggleReq = async (value: boolean) => {
    if (!token) return;
    setReqBusy(true);
    setPhoneReq(value);
    try {
      await api.adminUpdateSystemSettings({ phone_validation_required: value }, token);
    } catch {
      setPhoneReq(!value); // reverte se falhar
    } finally {
      setReqBusy(false);
    }
  };

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const r = await api.adminWhatsappStatus(token);
      setStatus(r.data);
    } catch {
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }, [token]);

  // Poll do status (a cada 3s) — pra o QR aparecer e detectar quando conectar.
  useEffect(() => {
    void load();
    pollRef.current = window.setInterval(() => void load(), 3000);
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
    };
  }, [load]);

  const handleConnect = async () => {
    if (!token) return;
    setBusy(true);
    try {
      await api.adminWhatsappConnect(token);
      await load();
    } finally {
      setBusy(false);
    }
  };

  const handleGenerateCode = async () => {
    if (!token || !phoneInput.trim()) return;
    setCodeBusy(true);
    setCodeError(null);
    try {
      await api.adminWhatsappConnectWithCode(phoneInput.trim(), token);
      setShowCodeForm(false);
      await load();
    } catch (err) {
      setCodeError(err instanceof Error ? err.message : 'Não foi possível gerar o código.');
    } finally {
      setCodeBusy(false);
    }
  };

  const handleDisconnect = async () => {
    if (!token) return;
    if (!window.confirm('Desconectar o WhatsApp? Você vai precisar escanear o QR Code de novo pra reconectar.')) return;
    setBusy(true);
    try {
      await api.adminWhatsappDisconnect(token);
      await load();
    } finally {
      setBusy(false);
    }
  };

  const card: React.CSSProperties = { background: '#141b2b', border: '1px solid #24304f', borderRadius: '14px', padding: '24px' };

  return (
    <div className="bandeira-workspace" style={{ padding: '24px' }}>
      <div className="bandeira-main-panel" style={{ width: '100%', maxWidth: '640px', margin: '0 auto', background: '#111622', border: '1px solid #1f293d', borderRadius: '14px', padding: '24px' }}>
        <div style={{ marginBottom: '20px', borderBottom: '1px solid #1f293d', paddingBottom: '16px' }}>
          <h2 style={{ fontSize: '24px', fontWeight: 600, color: '#f7fafc', margin: 0, display: 'flex', alignItems: 'center', gap: '10px' }}>
            <MessageCircle size={24} color="#25d366" /> WhatsApp
          </h2>
          <p style={{ color: '#a0aec0', margin: '4px 0 0 0', fontSize: '14px' }}>
            Conecte o seu número escaneando o QR Code. Depois de conectado, o sistema envia mensagens pelos clientes (ex.: código de validação de telefone).
          </p>
        </div>

        {loading ? (
          <p style={{ textAlign: 'center', color: '#a0aec0', padding: '32px' }}>
            <Loader2 size={20} className="mold-import-spinner" style={{ marginRight: '8px' }} /> Carregando...
          </p>
        ) : !status?.service_online ? (
          <div style={{ ...card, textAlign: 'center' }}>
            <AlertTriangle size={40} color="#ecc94b" style={{ marginBottom: '10px' }} />
            <h3 style={{ color: '#f7fafc', margin: '0 0 6px' }}>Serviço de WhatsApp offline</h3>
            <p style={{ color: '#a0aec0', fontSize: '14px', margin: 0 }}>
              O serviço que roda o WhatsApp não está respondendo. {status?.error ? <><br /><span style={{ color: '#718096', fontSize: '12px' }}>{status.error}</span></> : null}
            </p>
          </div>
        ) : status.connected ? (
          <div style={{ ...card, textAlign: 'center' }}>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', background: 'rgba(37,211,102,0.12)', color: '#25d366', borderRadius: '999px', padding: '8px 18px', fontWeight: 700, marginBottom: '14px' }}>
              <CheckCircle2 size={18} /> WhatsApp conectado
            </div>
            <p style={{ color: '#a0aec0', fontSize: '14px', margin: '0 0 18px' }}>
              Seu número está conectado e pronto pra enviar mensagens. ✅
            </p>
            <button type="button" onClick={() => void handleDisconnect()} disabled={busy} style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', background: '#e53e3e', color: '#fff', border: 'none', borderRadius: '10px', padding: '12px 22px', fontSize: '15px', fontWeight: 700, cursor: busy ? 'default' : 'pointer' }}>
              {busy ? <Loader2 size={16} className="mold-import-spinner" /> : <Power size={16} />}
              Desconectar número
            </button>
          </div>
        ) : (
          <div style={card}>
            {/* Abas: QR Code (padrao) ou codigo de pareamento (alternativa quando o QR nao fecha a conexao) */}
            <div style={{ display: 'flex', gap: '8px', marginBottom: '18px', background: '#0d1420', borderRadius: '10px', padding: '4px' }}>
              <button
                type="button"
                onClick={() => setConnectMode('qr')}
                style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', padding: '9px', borderRadius: '8px', border: 'none', cursor: 'pointer', fontSize: '13.5px', fontWeight: 700, background: connectMode === 'qr' ? '#25d366' : 'transparent', color: connectMode === 'qr' ? '#06210f' : '#a0aec0' }}
              >
                <Smartphone size={15} /> QR Code
              </button>
              <button
                type="button"
                onClick={() => setConnectMode('code')}
                style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', padding: '9px', borderRadius: '8px', border: 'none', cursor: 'pointer', fontSize: '13.5px', fontWeight: 700, background: connectMode === 'code' ? '#25d366' : 'transparent', color: connectMode === 'code' ? '#06210f' : '#a0aec0' }}
              >
                <KeyRound size={15} /> Código de pareamento
              </button>
            </div>

            {connectMode === 'qr' ? (
              <div style={{ textAlign: 'center' }}>
                <h3 style={{ color: '#f7fafc', margin: '0 0 4px' }}>Escaneie o QR Code</h3>
                <p style={{ color: '#a0aec0', fontSize: '13.5px', margin: '0 0 16px' }}>
                  No celular: <strong>WhatsApp</strong> → <strong>Configurações</strong> → <strong>Aparelhos conectados</strong> → <strong>Conectar um aparelho</strong> → aponte pro código abaixo.
                </p>

                {status.qr ? (
                  <img src={status.qr} alt="QR Code do WhatsApp" style={{ width: '260px', maxWidth: '100%', borderRadius: '12px', background: '#fff', padding: '10px' }} />
                ) : (
                  <div style={{ padding: '40px 0', color: '#a0aec0', fontSize: '14px' }}>
                    <Loader2 size={22} className="mold-import-spinner" style={{ marginRight: '8px' }} />
                    {status.initializing ? 'Iniciando o WhatsApp e gerando o QR...' : 'Gerando o QR Code...'}
                  </div>
                )}

                <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', flexWrap: 'wrap', marginTop: '18px' }}>
                  <button type="button" onClick={() => void handleConnect()} disabled={busy} style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', background: '#25d366', color: '#06210f', border: 'none', borderRadius: '10px', padding: '11px 20px', fontSize: '14px', fontWeight: 700, cursor: 'pointer' }}>
                    {busy ? <Loader2 size={16} className="mold-import-spinner" /> : <Smartphone size={16} />}
                    Gerar novo QR
                  </button>
                  <button type="button" onClick={() => void load()} style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', background: '#1a202c', color: '#cbd5e0', border: '1px solid #2d3748', borderRadius: '10px', padding: '11px 18px', fontSize: '14px', fontWeight: 600, cursor: 'pointer' }}>
                    <RefreshCw size={15} /> Atualizar
                  </button>
                </div>
                <p style={{ color: '#718096', fontSize: '12px', margin: '14px 0 0' }}>
                  A tela atualiza sozinha e detecta quando você escaneia. ⏳
                </p>
              </div>
            ) : (
              <div style={{ textAlign: 'center' }}>
                <h3 style={{ color: '#f7fafc', margin: '0 0 4px' }}>Conectar com código</h3>
                <p style={{ color: '#a0aec0', fontSize: '13.5px', margin: '0 0 16px' }}>
                  No celular: <strong>WhatsApp</strong> → <strong>Configurações</strong> → <strong>Aparelhos conectados</strong> → <strong>Conectar um aparelho</strong> → <strong>Conectar com número de telefone</strong> → digite o código abaixo.
                </p>

                {status.pairingCode && !showCodeForm ? (
                  <div style={{ marginBottom: '16px' }}>
                    <div style={{ display: 'inline-block', background: '#fff', color: '#111622', borderRadius: '12px', padding: '18px 26px', fontSize: '30px', fontWeight: 800, letterSpacing: '4px', fontFamily: 'monospace' }}>
                      {status.pairingCode}
                    </div>
                    <p style={{ color: '#718096', fontSize: '12px', margin: '10px 0 0' }}>
                      Esse código vale por um tempo curto — digite ele assim que aparecer. ⏳
                    </p>
                  </div>
                ) : (
                  <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', flexWrap: 'wrap', margin: '0 0 8px' }}>
                    <input
                      type="tel"
                      value={phoneInput}
                      onChange={(e) => setPhoneInput(e.target.value)}
                      placeholder="Ex: 21999998888"
                      style={{ background: '#0d1420', border: '1px solid #2d3748', borderRadius: '10px', padding: '11px 14px', color: '#f7fafc', fontSize: '14px', width: '220px' }}
                    />
                    <button
                      type="button"
                      onClick={() => void handleGenerateCode()}
                      disabled={codeBusy || !phoneInput.trim()}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', background: '#25d366', color: '#06210f', border: 'none', borderRadius: '10px', padding: '11px 20px', fontSize: '14px', fontWeight: 700, cursor: codeBusy ? 'default' : 'pointer' }}
                    >
                      {codeBusy ? <Loader2 size={16} className="mold-import-spinner" /> : <KeyRound size={16} />}
                      Gerar código
                    </button>
                  </div>
                )}
                {codeError && <p style={{ color: '#f56565', fontSize: '13px', margin: '4px 0 0' }}>{codeError}</p>}
                {status.pairingCode && !showCodeForm && (
                  <button type="button" onClick={() => { setPhoneInput(''); setShowCodeForm(true); }} style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', background: '#1a202c', color: '#cbd5e0', border: '1px solid #2d3748', borderRadius: '10px', padding: '9px 16px', fontSize: '13px', fontWeight: 600, cursor: 'pointer', marginTop: '4px' }}>
                    <RefreshCw size={14} /> Gerar outro número
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {/* Toggle: exigir validação de telefone dos clientes (portão) */}
        {!loading && (
          <div style={{ marginTop: '20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap', background: phoneReq ? 'rgba(37,211,102,0.08)' : '#1a202c', border: `1px solid ${phoneReq ? 'rgba(37,211,102,0.3)' : '#2d3748'}`, borderRadius: '12px', padding: '16px' }}>
            <div>
              <div style={{ color: '#f7fafc', fontSize: '15px', fontWeight: 600 }}>Exigir validação de telefone dos clientes</div>
              <div style={{ color: '#a0aec0', fontSize: '13px', marginTop: '2px', maxWidth: '440px' }}>
                {phoneReq
                  ? 'Ativado — o cliente precisa validar o telefone (código no WhatsApp) antes de usar o sistema.'
                  : 'Desligado — a validação de telefone fica opcional (nas Configurações do usuário).'}
                <br /><span style={{ color: '#ecc94b', fontSize: '12px' }}>⚠️ Só ative se o WhatsApp estiver conectado e estável — senão ninguém consegue entrar.</span>
              </div>
            </div>
            <button
              type="button"
              onClick={() => void handleToggleReq(!phoneReq)}
              disabled={reqBusy}
              role="switch"
              aria-checked={phoneReq}
              style={{ position: 'relative', width: '52px', height: '28px', borderRadius: '999px', border: 'none', cursor: reqBusy ? 'default' : 'pointer', background: phoneReq ? '#25d366' : '#4a5568', transition: 'background 0.15s', flexShrink: 0 }}
            >
              <span style={{ position: 'absolute', top: '3px', left: phoneReq ? '27px' : '3px', width: '22px', height: '22px', borderRadius: '50%', background: '#fff', transition: 'left 0.15s' }} />
            </button>
          </div>
        )}

        {/* Mensagem automatica por WhatsApp pra quem se cadastrou e nao ativou plano */}
        {!loading && (
          <div style={{ marginTop: '16px', background: '#1a202c', border: '1px solid #2d3748', borderRadius: '12px', padding: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap', marginBottom: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <UserX size={18} color="#ecc94b" />
                <div style={{ color: '#f7fafc', fontSize: '15px', fontWeight: 600 }}>Mensagem pra quem não ativou o plano</div>
              </div>
              <button
                type="button"
                onClick={() => setNoPlanEnabled((v) => !v)}
                role="switch"
                aria-checked={noPlanEnabled}
                style={{ position: 'relative', width: '52px', height: '28px', borderRadius: '999px', border: 'none', cursor: 'pointer', background: noPlanEnabled ? '#25d366' : '#4a5568', transition: 'background 0.15s', flexShrink: 0 }}
              >
                <span style={{ position: 'absolute', top: '3px', left: noPlanEnabled ? '27px' : '3px', width: '22px', height: '22px', borderRadius: '50%', background: '#fff', transition: 'left 0.15s' }} />
              </button>
            </div>
            <p style={{ color: '#a0aec0', fontSize: '13px', margin: '0 0 12px' }}>
              O sistema manda essa mensagem sozinho pro cliente que se cadastrou e não comprou nenhum plano — depois de um tempo do cadastro, e insistindo de tempos em tempos enquanto ele continuar sem plano.
            </p>

            <label style={{ display: 'block', color: '#a0aec0', fontSize: '12px', marginBottom: '4px' }}>
              Mensagem (use <code>{'{{nome}}'}</code> pra chamar o cliente pelo primeiro nome)
            </label>
            <textarea
              value={noPlanText}
              onChange={(e) => setNoPlanText(e.target.value)}
              rows={4}
              placeholder="Oi {{nome}}! Vi que você criou sua conta mas ainda não ativou um plano. Posso te ajudar?"
              style={{ width: '100%', background: '#0d1420', border: '1px solid #2d3748', borderRadius: '8px', padding: '10px', color: '#f7fafc', fontSize: '13.5px', resize: 'vertical', marginBottom: '12px' }}
            />

            <div style={{ display: 'flex', gap: '14px', flexWrap: 'wrap', marginBottom: '14px' }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '12px', color: '#a0aec0' }}>
                Manda a 1ª mensagem depois de (minutos)
                <input
                  type="number"
                  min={1}
                  value={noPlanDelayMin}
                  onChange={(e) => setNoPlanDelayMin(Math.max(1, Math.floor(Number(e.target.value)) || 1))}
                  style={{ background: '#0d1420', border: '1px solid #2d3748', borderRadius: '8px', padding: '8px 10px', color: '#f7fafc', fontSize: '13.5px', width: '140px' }}
                />
                <span style={{ color: '#718096' }}>Ex.: 60 = 1 hora · 1440 = 1 dia</span>
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '12px', color: '#a0aec0' }}>
                Insiste de novo a cada (minutos)
                <input
                  type="number"
                  min={1}
                  value={noPlanRepeatMin}
                  onChange={(e) => setNoPlanRepeatMin(Math.max(1, Math.floor(Number(e.target.value)) || 1))}
                  style={{ background: '#0d1420', border: '1px solid #2d3748', borderRadius: '8px', padding: '8px 10px', color: '#f7fafc', fontSize: '13.5px', width: '140px' }}
                />
                <span style={{ color: '#718096' }}>Ex.: 1440 = 1x por dia</span>
              </label>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <button
                type="button"
                onClick={() => void handleSaveNoPlanMsg()}
                disabled={noPlanBusy}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', background: '#25d366', color: '#06210f', border: 'none', borderRadius: '8px', padding: '10px 18px', fontSize: '13.5px', fontWeight: 700, cursor: noPlanBusy ? 'default' : 'pointer' }}
              >
                {noPlanBusy ? <Loader2 size={15} className="mold-import-spinner" /> : <Save size={15} />}
                Salvar
              </button>
              {noPlanSaved && <span style={{ color: '#25d366', fontSize: '13px' }}>Salvo ✓</span>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
