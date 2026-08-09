import { useCallback, useEffect, useState } from 'react';
import { Bell, BellRing, Check, CreditCard, Loader2, QrCode, ShoppingBag } from 'lucide-react';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import type { Notificacao } from '../types';

type PushState = 'checando' | 'nao-suportado' | 'inativo' | 'ativado' | 'negado';

function formatDataHora(iso: string | null | undefined): string {
  if (!iso) return '-';
  const match = iso.trim().match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
  if (!match) return iso;
  const [, year, month, day, hour, minute] = match;
  return `${day}/${month}/${year} ${hour}:${minute}`;
}

function formatMoeda(valor: number | undefined): string {
  if (valor === undefined || valor === null) return '';
  return valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

/** Converte a chave pública VAPID (base64url) para o formato que o pushManager espera. */
function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const buffer = new ArrayBuffer(raw.length);
  const out = new Uint8Array(buffer);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

export function AdminNotificacoesPage() {
  const { token } = useAuth();
  const [notificacoes, setNotificacoes] = useState<Notificacao[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [pushState, setPushState] = useState<PushState>('checando');
  const [pushBusy, setPushBusy] = useState(false);
  const [pushError, setPushError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const response = await api.adminListNotificacoes(token);
      setNotificacoes(response.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível carregar as notificações.');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  // Estado inicial do push neste dispositivo.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
        if (!cancelled) setPushState('nao-suportado');
        return;
      }
      if (Notification.permission === 'denied') {
        if (!cancelled) setPushState('negado');
        return;
      }
      try {
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        if (!cancelled) setPushState(sub ? 'ativado' : 'inativo');
      } catch {
        if (!cancelled) setPushState('inativo');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const ativarPush = async () => {
    if (!token) return;
    setPushBusy(true);
    setPushError(null);
    try {
      if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
        setPushState('nao-suportado');
        return;
      }
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setPushState(permission === 'denied' ? 'negado' : 'inativo');
        setPushError('Você precisa permitir as notificações no navegador.');
        return;
      }

      const reg = await navigator.serviceWorker.ready;
      const { data } = await api.adminGetVapidPublicKey(token);
      const applicationServerKey = urlBase64ToUint8Array(data.public_key);

      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey });
      }

      const json = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
      if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
        throw new Error('Não foi possível obter os dados da inscrição.');
      }

      await api.adminSubscribePush(
        { endpoint: json.endpoint, keys: { p256dh: json.keys.p256dh, auth: json.keys.auth } },
        token
      );
      setPushState('ativado');
    } catch (err) {
      setPushError(err instanceof ApiError ? err.message : 'Não foi possível ativar as notificações.');
    } finally {
      setPushBusy(false);
    }
  };

  const marcarLida = async (id: number) => {
    if (!token) return;
    try {
      await api.adminMarkNotificacaoRead(id, token);
      setNotificacoes((prev) => prev.map((n) => (n.id === id ? { ...n, lida: true } : n)));
    } catch {
      /* silencioso */
    }
  };

  const marcarTodasLidas = async () => {
    if (!token) return;
    try {
      await api.adminMarkAllNotificacoesRead(token);
      setNotificacoes((prev) => prev.map((n) => ({ ...n, lida: true })));
    } catch {
      /* silencioso */
    }
  };

  const naoLidas = notificacoes.filter((n) => !n.lida).length;

  return (
    <div className="bandeira-workspace">
      <div className="bandeira-main-panel">
        <div className="bandeira-panel-header">
          <h2>Notificações</h2>
          <p>Ative o aviso no celular pra ser notificado a cada venda, e veja o histórico dos pagamentos.</p>
        </div>

        {/* Ativação do push neste dispositivo */}
        <div className="bandeira-create-panel notif-push-panel">
          <div className="notif-push-head">
            {pushState === 'ativado' ? <BellRing size={20} /> : <Bell size={20} />}
            <div>
              <h3>Notificações push neste dispositivo</h3>
              <p className="bandeira-size-hint">
                {pushState === 'ativado'
                  ? 'Ativadas — você receberá um aviso aqui a cada venda, mesmo com o app fechado.'
                  : pushState === 'negado'
                    ? 'As notificações estão bloqueadas nas configurações do navegador para este site. Libere-as e tente de novo.'
                    : pushState === 'nao-suportado'
                      ? 'Este navegador não suporta notificações push. No iPhone, adicione o app à tela de início primeiro.'
                      : 'Ative para receber um aviso no celular/PC assim que um cliente pagar.'}
              </p>
            </div>
          </div>

          {pushState !== 'ativado' && pushState !== 'nao-suportado' ? (
            <button type="button" className="mold-save-button" onClick={() => void ativarPush()} disabled={pushBusy}>
              {pushBusy ? <Loader2 size={16} className="mold-import-spinner" /> : <Bell size={16} />}
              Ativar notificações neste dispositivo
            </button>
          ) : null}

          {pushState === 'ativado' ? (
            <span className="notif-push-badge ok">
              <Check size={14} /> Ativado
            </span>
          ) : null}

          {pushError ? <p className="mold-import-error">{pushError}</p> : null}
        </div>

        {/* Histórico */}
        <div className="notif-history-head">
          <h3>Histórico de vendas {naoLidas > 0 ? <span className="notif-count">{naoLidas} nova(s)</span> : null}</h3>
          {naoLidas > 0 ? (
            <button type="button" className="mold-secondary-button" onClick={() => void marcarTodasLidas()}>
              Marcar todas como lidas
            </button>
          ) : null}
        </div>

        {loading ? (
          <p className="bandeira-size-hint">
            <Loader2 size={14} className="mold-import-spinner" /> Carregando notificações...
          </p>
        ) : error ? (
          <p className="mold-import-error">{error}</p>
        ) : notificacoes.length === 0 ? (
          <p className="bandeira-size-hint">Nenhuma venda registrada ainda. As notificações aparecerão aqui.</p>
        ) : (
          <ul className="notif-list">
            {notificacoes.map((n) => {
              const metodo = n.dados?.metodo;
              return (
                <li key={n.id} className={n.lida ? 'notif-item' : 'notif-item notif-item-unread'}>
                  <div className="notif-item-icon">
                    {metodo === 'cartao' ? <CreditCard size={18} /> : metodo === 'pix' ? <QrCode size={18} /> : <ShoppingBag size={18} />}
                  </div>
                  <div className="notif-item-body">
                    <strong>{n.dados?.cliente_nome ?? n.titulo}</strong>
                    <span className="notif-item-line">
                      {n.dados?.plano_nome ? `${n.dados.plano_nome} • ` : ''}
                      {n.dados?.metodo_label ? `${n.dados.metodo_label} • ` : ''}
                      {formatMoeda(n.dados?.valor)}
                    </span>
                    {n.dados?.cliente_email ? <span className="notif-item-sub">{n.dados.cliente_email}</span> : null}
                    <span className="notif-item-sub">{formatDataHora(n.created_at)}</span>
                  </div>
                  {!n.lida ? (
                    <button
                      type="button"
                      className="mold-secondary-button notif-item-read-btn"
                      onClick={() => void marcarLida(n.id)}
                      title="Marcar como lida"
                    >
                      <Check size={14} />
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
