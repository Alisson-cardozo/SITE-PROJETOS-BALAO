import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, MailCheck, ShieldCheck } from 'lucide-react';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';

const RESEND_COOLDOWN = 60; // segundos entre reenvios

/**
 * Card que trava a tela inteira ate o usuario confirmar o e-mail com o codigo
 * de 6 digitos. Enquanto isso, um cronometro mostra o prazo (1h) — se estourar,
 * a conta e excluida e ele e deslogado. Admin nunca ve este componente (o App
 * so o renderiza pra usuario nao verificado).
 */
export function EmailVerificationGate() {
  const { user, token, logout, updateUser } = useAuth();

  const [email, setEmail] = useState(user?.email ?? '');
  const [deadline, setDeadline] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [resendIn, setResendIn] = useState(0);
  const [remainingMs, setRemainingMs] = useState<number | null>(null);

  const expiredRef = useRef(false);

  const handleDeleted = useCallback(
    (message: string) => {
      if (expiredRef.current) return;
      expiredRef.current = true;
      alert(message);
      void logout();
    },
    [logout]
  );

  // Ao montar: consulta status (isso ja dispara o 1o envio do codigo no backend).
  useEffect(() => {
    if (!token) return;
    let alive = true;
    setLoading(true);
    api
      .emailVerificationStatus(token)
      .then((res) => {
        if (!alive) return;
        if (res.verified) {
          updateUser({ email_verified: true });
          return;
        }
        setEmail(res.email);
        setDeadline(res.deadline);
        setInfo('Enviamos um código de 6 dígitos para o seu e-mail.');
      })
      .catch((err) => {
        if (!alive) return;
        if (err instanceof ApiError && err.status === 410) {
          handleDeleted('Sua conta foi removida por falta de confirmação do e-mail. Cadastre-se novamente.');
          return;
        }
        setError(err instanceof ApiError ? err.message : 'Não foi possível carregar a verificação.');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [token, updateUser, handleDeleted]);

  // Cronometro do prazo (1h). Ao zerar, desloga (a conta sera/foi excluida).
  useEffect(() => {
    if (!deadline) {
      setRemainingMs(null);
      return;
    }
    const target = new Date(deadline.replace(' ', 'T')).getTime();
    const tick = () => {
      const ms = target - Date.now();
      setRemainingMs(ms);
      if (ms <= 0) {
        handleDeleted('O prazo para confirmar o e-mail expirou e a conta foi removida. Cadastre-se novamente.');
      }
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [deadline, handleDeleted]);

  // Contador do botao de reenviar.
  useEffect(() => {
    if (resendIn <= 0) return;
    const id = window.setInterval(() => setResendIn((v) => (v > 0 ? v - 1 : 0)), 1000);
    return () => window.clearInterval(id);
  }, [resendIn]);

  const handleConfirm = useCallback(async () => {
    if (!token) return;
    const clean = code.replace(/\D/g, '');
    if (clean.length !== 6) {
      setError('Digite os 6 dígitos do código.');
      return;
    }
    setError(null);
    setInfo(null);
    setConfirming(true);
    try {
      const res = await api.emailVerificationConfirm(clean, token);
      if (res.user) {
        updateUser(res.user);
      } else {
        updateUser({ email_verified: true });
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 410) {
        handleDeleted('O prazo expirou e a conta foi removida. Cadastre-se novamente.');
        return;
      }
      setError(err instanceof ApiError ? err.message : 'Não foi possível confirmar o código.');
    } finally {
      setConfirming(false);
    }
  }, [code, token, updateUser, handleDeleted]);

  const handleResend = useCallback(async () => {
    if (!token || resendIn > 0) return;
    setError(null);
    setInfo(null);
    try {
      const res = await api.emailVerificationSend(token);
      if (res.verified) {
        updateUser({ email_verified: true });
        return;
      }
      if (res.deadline) setDeadline(res.deadline);
      setInfo('Enviamos um novo código para o seu e-mail.');
      setResendIn(RESEND_COOLDOWN);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível reenviar o código.');
      setResendIn(15);
    }
  }, [token, resendIn, updateUser]);

  const remainingLabel = (() => {
    if (remainingMs === null) return null;
    const total = Math.max(0, Math.floor(remainingMs / 1000));
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  })();

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        background: 'rgba(9, 13, 22, 0.92)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '440px',
          background: '#111622',
          border: '1px solid #1f293d',
          borderRadius: '16px',
          padding: '28px 24px',
          boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: '6px' }}>
          <div style={{ background: 'rgba(43,108,176,0.15)', padding: '14px', borderRadius: '50%' }}>
            <MailCheck size={30} color="#4299e1" />
          </div>
          <h2 style={{ color: '#f7fafc', fontSize: '20px', fontWeight: 700, margin: '10px 0 0' }}>Confirme seu e-mail</h2>
          <p style={{ color: '#a0aec0', fontSize: '14px', margin: 0, lineHeight: 1.5 }}>
            Enviamos um código de <strong>6 dígitos</strong> para
            <br />
            <span style={{ color: '#e2e8f0', fontWeight: 600 }}>{email}</span>
          </p>
        </div>

        {remainingLabel && (
          <div
            style={{
              marginTop: '18px',
              padding: '10px 12px',
              borderRadius: '8px',
              background: 'rgba(197, 48, 48, 0.1)',
              border: '1px solid rgba(197, 48, 48, 0.3)',
              color: '#fc8181',
              fontSize: '13px',
              textAlign: 'center',
            }}
          >
            Confirme em até <strong style={{ fontVariantNumeric: 'tabular-nums' }}>{remainingLabel}</strong> — passado o
            prazo, a conta é removida automaticamente.
          </div>
        )}

        {loading ? (
          <p style={{ textAlign: 'center', color: '#a0aec0', marginTop: '20px', fontSize: '14px' }}>
            <Loader2 size={18} className="mold-import-spinner" style={{ marginRight: '8px' }} /> Enviando código...
          </p>
        ) : (
          <>
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(e) => {
                setError(null);
                setCode(e.target.value.replace(/\D/g, '').slice(0, 6));
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleConfirm();
              }}
              placeholder="______"
              style={{
                width: '100%',
                marginTop: '20px',
                padding: '14px',
                fontSize: '28px',
                letterSpacing: '12px',
                textAlign: 'center',
                fontWeight: 700,
                background: '#0b0f18',
                border: '1px solid #2d3748',
                borderRadius: '10px',
                color: '#fff',
                outline: 'none',
                boxSizing: 'border-box',
              }}
            />

            {error && (
              <p style={{ color: '#fc8181', fontSize: '13px', margin: '10px 0 0', textAlign: 'center' }}>{error}</p>
            )}
            {info && !error && (
              <p style={{ color: '#68d391', fontSize: '13px', margin: '10px 0 0', textAlign: 'center' }}>{info}</p>
            )}

            <button
              type="button"
              onClick={() => void handleConfirm()}
              disabled={confirming || code.length !== 6}
              style={{
                width: '100%',
                marginTop: '18px',
                padding: '13px',
                background: code.length === 6 ? '#3182ce' : '#2a3548',
                color: '#fff',
                border: 'none',
                borderRadius: '10px',
                fontSize: '15px',
                fontWeight: 600,
                cursor: code.length === 6 && !confirming ? 'pointer' : 'not-allowed',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
              }}
            >
              {confirming ? <Loader2 size={16} className="mold-import-spinner" /> : <ShieldCheck size={16} />}
              Confirmar e liberar acesso
            </button>

            <div style={{ marginTop: '16px', textAlign: 'center' }}>
              <button
                type="button"
                onClick={() => void handleResend()}
                disabled={resendIn > 0}
                style={{
                  background: 'none',
                  border: 'none',
                  color: resendIn > 0 ? '#4a5568' : '#63b3ed',
                  fontSize: '13px',
                  cursor: resendIn > 0 ? 'default' : 'pointer',
                  textDecoration: resendIn > 0 ? 'none' : 'underline',
                }}
              >
                {resendIn > 0 ? `Reenviar código em ${resendIn}s` : 'Não recebeu? Reenviar código'}
              </button>
            </div>
          </>
        )}

        <div style={{ marginTop: '20px', borderTop: '1px solid #1f293d', paddingTop: '14px', textAlign: 'center' }}>
          <button
            type="button"
            onClick={() => void logout()}
            style={{ background: 'none', border: 'none', color: '#718096', fontSize: '12px', cursor: 'pointer' }}
          >
            Sair
          </button>
        </div>
      </div>
    </div>
  );
}
