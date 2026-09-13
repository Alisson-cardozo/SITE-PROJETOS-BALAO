import { useEffect, useState } from 'react';
import { Bell, BellRing, Check, Loader2, X } from 'lucide-react';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';

type PushState = 'checando' | 'nao-suportado' | 'inativo' | 'ativado' | 'negado';

/** Converte a chave pública VAPID (base64url) para o formato do pushManager. */
function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const buffer = new ArrayBuffer(raw.length);
  const out = new Uint8Array(buffer);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

interface Props {
  /** 'floating' = card flutuante dispensável; 'inline' = bloco fixo (Configurações). */
  variant?: 'floating' | 'inline';
  onClose?: () => void;
  /** Chamado quando, no floating, o push já estava ativo (pra o pai escondê-lo). */
  onAlreadyActive?: () => void;
}

/**
 * Card que deixa o usuário ativar as notificações push do sistema no seu
 * dispositivo — pra receber cada comunicado/novidade no navegador e no app,
 * mesmo com o site fechado.
 */
export function PushActivationCard({ variant = 'inline', onClose, onAlreadyActive }: Props) {
  const { token } = useAuth();
  const [state, setState] = useState<PushState>('checando');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
        if (!cancelled) setState('nao-suportado');
        return;
      }
      if (Notification.permission === 'denied') {
        if (!cancelled) setState('negado');
        return;
      }
      try {
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        if (cancelled) return;
        if (sub) {
          setState('ativado');
          // No floating: se ja estava ativo, some (nao precisa incomodar).
          if (variant === 'floating') onAlreadyActive?.();
        } else {
          setState('inativo');
        }
      } catch {
        if (!cancelled) setState('inativo');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [variant, onAlreadyActive]);

  const ativar = async () => {
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
        setState('nao-suportado');
        return;
      }
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setState(permission === 'denied' ? 'negado' : 'inativo');
        setError('Você precisa permitir as notificações no navegador.');
        return;
      }

      const reg = await navigator.serviceWorker.ready;
      const { data } = await api.getVapidPublicKey(token);
      const applicationServerKey = urlBase64ToUint8Array(data.public_key);

      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey });
      }

      const json = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
      if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
        throw new Error('Não foi possível obter os dados da inscrição.');
      }

      await api.subscribePush(
        { endpoint: json.endpoint, keys: { p256dh: json.keys.p256dh, auth: json.keys.auth } },
        token
      );
      setState('ativado');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível ativar as notificações.');
    } finally {
      setBusy(false);
    }
  };

  // Não mostra nada se o navegador não suporta (evita card inútil).
  if (state === 'nao-suportado' && variant === 'floating') return null;

  const isFloating = variant === 'floating';

  const wrapperStyle: React.CSSProperties = isFloating
    ? {
        position: 'fixed',
        right: '18px',
        bottom: '18px',
        zIndex: 9000,
        width: 'min(360px, calc(100vw - 36px))',
      }
    : { width: '100%' };

  return (
    <div style={wrapperStyle}>
      <div
        style={{
          background: '#111622',
          border: '1px solid #23304d',
          borderRadius: '14px',
          padding: '18px',
          boxShadow: isFloating ? '0 12px 40px rgba(0,0,0,0.45)' : 'none',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
          <div
            style={{
              background: state === 'ativado' ? 'rgba(72,187,120,0.15)' : 'rgba(49,130,206,0.15)',
              borderRadius: '10px',
              padding: '10px',
              flexShrink: 0,
            }}
          >
            {state === 'ativado' ? <BellRing size={20} color="#48bb78" /> : <Bell size={20} color="#4299e1" />}
          </div>

          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
              <h3 style={{ color: '#f7fafc', fontSize: '15px', fontWeight: 600, margin: 0 }}>
                Notificações do sistema
              </h3>
              {isFloating && onClose && (
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Fechar"
                  style={{ background: 'none', border: 'none', color: '#718096', cursor: 'pointer', padding: 0, lineHeight: 0 }}
                >
                  <X size={16} />
                </button>
              )}
            </div>

            <p style={{ color: '#a0aec0', fontSize: '13px', margin: '6px 0 0', lineHeight: 1.5 }}>
              {state === 'ativado'
                ? 'Tudo certo! Você vai receber cada atualização e novidade aqui no dispositivo.'
                : state === 'negado'
                  ? 'As notificações estão bloqueadas no navegador. Libere nas configurações do navegador (cadeado ao lado do endereço) e tente de novo.'
                  : state === 'nao-suportado'
                    ? 'Este navegador não suporta notificações. No iPhone, adicione o app à tela de início primeiro.'
                    : 'Ative para ficar por dentro de cada atualização e novidade — os comunicados chegam no navegador e no app, mesmo com o site fechado.'}
            </p>

            {state === 'ativado' ? (
              <span
                style={{
                  marginTop: '12px',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  color: '#48bb78',
                  fontSize: '13px',
                  fontWeight: 600,
                }}
              >
                <Check size={15} /> Notificações ativadas
              </span>
            ) : state !== 'nao-suportado' ? (
              <button
                type="button"
                onClick={() => void ativar()}
                disabled={busy || state === 'checando'}
                style={{
                  marginTop: '12px',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '8px',
                  background: '#3182ce',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '8px',
                  padding: '10px 16px',
                  fontSize: '14px',
                  fontWeight: 600,
                  cursor: busy ? 'default' : 'pointer',
                }}
              >
                {busy ? <Loader2 size={16} className="mold-import-spinner" /> : <Bell size={16} />}
                Ativar notificações
              </button>
            ) : null}

            {error && <p style={{ color: '#fc8181', fontSize: '12px', margin: '10px 0 0' }}>{error}</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
