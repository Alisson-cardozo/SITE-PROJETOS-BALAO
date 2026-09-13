import { useState } from 'react';
import { Loader2, Smartphone, ShieldCheck, MessageCircle } from 'lucide-react';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';

/**
 * Trava a tela inteira até o usuário validar o telefone com o código enviado
 * pelo WhatsApp. Admin nunca vê (o App só renderiza pra usuário não-verificado).
 */
export function PhoneVerificationGate() {
  const { user, token, logout, updateUser } = useAuth();
  const [step, setStep] = useState<'pedir' | 'confirmar'>(user?.phone ? 'confirmar' : 'pedir');
  const [phone, setPhone] = useState(user?.phone ?? '');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const handleEnviar = async () => {
    if (!token) return;
    setError(null);
    setInfo(null);
    const digits = phone.replace(/\D/g, '');
    if (digits.length < 10) {
      setError('Informe o número com DDD (ex: 21 99999-9999).');
      return;
    }
    setBusy(true);
    try {
      await api.sendPhoneCode(digits, token);
      setStep('confirmar');
      setInfo('Enviamos um código de 6 dígitos no seu WhatsApp.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível enviar o código.');
    } finally {
      setBusy(false);
    }
  };

  const handleConfirmar = async () => {
    if (!token) return;
    const clean = code.replace(/\D/g, '');
    if (clean.length !== 6) {
      setError('Digite os 6 dígitos do código.');
      return;
    }
    setError(null);
    setInfo(null);
    setBusy(true);
    try {
      const r = await api.confirmPhoneCode(clean, token);
      updateUser(r.user);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível confirmar o código.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(9, 13, 22, 0.94)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
      <div style={{ width: '100%', maxWidth: '440px', background: '#111622', border: '1px solid #1f293d', borderRadius: '16px', padding: '28px 24px', boxShadow: '0 20px 60px rgba(0,0,0,0.5)' }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: '6px' }}>
          <div style={{ background: 'rgba(37,211,102,0.15)', padding: '14px', borderRadius: '50%' }}>
            <Smartphone size={30} color="#25d366" />
          </div>
          <h2 style={{ color: '#f7fafc', fontSize: '20px', fontWeight: 700, margin: '10px 0 0' }}>Confirme seu telefone</h2>
        </div>

        {/* Mensagem de segurança */}
        <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start', background: 'rgba(37,211,102,0.1)', border: '1px solid rgba(37,211,102,0.3)', borderRadius: '10px', padding: '12px 14px', marginTop: '18px' }}>
          <span style={{ fontSize: '20px', flexShrink: 0 }}>🔒</span>
          <span style={{ color: '#cbd5e0', fontSize: '13.5px', lineHeight: 1.5 }}>
            <strong>Pela segurança de todos os usuários</strong>, estamos confirmando o número de telefone — para a
            <strong> sua segurança</strong> e para manter a <strong>qualidade do sistema</strong>. Sem isso, o acesso
            fica bloqueado.
          </span>
        </div>

        {step === 'pedir' ? (
          <>
            <label style={{ display: 'block', marginTop: '18px' }}>
              <span style={{ display: 'block', color: '#cbd5e0', fontSize: '13px', marginBottom: '6px', fontWeight: 600 }}>Seu número (com DDD)</span>
              <input
                type="tel"
                value={phone}
                onChange={(e) => { setPhone(e.target.value); setError(null); }}
                onKeyDown={(e) => { if (e.key === 'Enter') void handleEnviar(); }}
                placeholder="21 99999-9999"
                autoFocus
                style={{ width: '100%', padding: '13px', fontSize: '16px', background: '#0b0f18', border: '1px solid #2d3748', borderRadius: '10px', color: '#fff', outline: 'none', boxSizing: 'border-box' }}
              />
            </label>

            {error && <p style={{ color: '#fc8181', fontSize: '13px', margin: '10px 0 0', textAlign: 'center' }}>{error}</p>}

            <button type="button" onClick={() => void handleEnviar()} disabled={busy} style={{ width: '100%', marginTop: '18px', padding: '13px', background: '#25d366', color: '#06210f', border: 'none', borderRadius: '10px', fontSize: '15px', fontWeight: 700, cursor: busy ? 'default' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
              {busy ? <Loader2 size={16} className="mold-import-spinner" /> : <MessageCircle size={16} />}
              Enviar código no WhatsApp
            </button>
          </>
        ) : (
          <>
            <p style={{ color: '#a0aec0', fontSize: '13.5px', margin: '16px 0 0', textAlign: 'center' }}>
              Código enviado no WhatsApp de <span style={{ color: '#e2e8f0', fontWeight: 600 }}>{phone}</span>
            </p>
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(e) => { setError(null); setCode(e.target.value.replace(/\D/g, '').slice(0, 6)); }}
              onKeyDown={(e) => { if (e.key === 'Enter') void handleConfirmar(); }}
              placeholder="______"
              autoFocus
              style={{ width: '100%', marginTop: '14px', padding: '14px', fontSize: '28px', letterSpacing: '12px', textAlign: 'center', fontWeight: 700, background: '#0b0f18', border: '1px solid #2d3748', borderRadius: '10px', color: '#fff', outline: 'none', boxSizing: 'border-box' }}
            />

            {error && <p style={{ color: '#fc8181', fontSize: '13px', margin: '10px 0 0', textAlign: 'center' }}>{error}</p>}
            {info && !error && <p style={{ color: '#68d391', fontSize: '13px', margin: '10px 0 0', textAlign: 'center' }}>{info}</p>}

            <button type="button" onClick={() => void handleConfirmar()} disabled={busy || code.length !== 6} style={{ width: '100%', marginTop: '18px', padding: '13px', background: code.length === 6 ? '#25d366' : '#2a3548', color: code.length === 6 ? '#06210f' : '#fff', border: 'none', borderRadius: '10px', fontSize: '15px', fontWeight: 700, cursor: code.length === 6 && !busy ? 'pointer' : 'not-allowed', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
              {busy ? <Loader2 size={16} className="mold-import-spinner" /> : <ShieldCheck size={16} />}
              Confirmar e liberar acesso
            </button>

            <div style={{ marginTop: '14px', textAlign: 'center' }}>
              <button type="button" onClick={() => { setStep('pedir'); setCode(''); setError(null); setInfo(null); }} style={{ background: 'none', border: 'none', color: '#63b3ed', fontSize: '13px', cursor: 'pointer', textDecoration: 'underline' }}>
                Trocar o número / reenviar
              </button>
            </div>
          </>
        )}

        <div style={{ marginTop: '20px', borderTop: '1px solid #1f293d', paddingTop: '14px', textAlign: 'center' }}>
          <button type="button" onClick={() => void logout()} style={{ background: 'none', border: 'none', color: '#718096', fontSize: '12px', cursor: 'pointer' }}>
            Sair
          </button>
        </div>
      </div>
    </div>
  );
}
