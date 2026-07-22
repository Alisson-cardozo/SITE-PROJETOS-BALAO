import { useCallback, useEffect, useState } from 'react';
import { Check, Copy, Loader2, QrCode } from 'lucide-react';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import type { Pagamento, PlanoPublic } from '../types';

const POLL_INTERVAL_MS = 3500;

function formatMoeda(valor: number): string {
  return valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

interface SolicitarAcessoPageProps {
  lockedTabLabel?: string;
}

export function SolicitarAcessoPage({ lockedTabLabel }: SolicitarAcessoPageProps) {
  const { token, updateUser } = useAuth();
  const [planos, setPlanos] = useState<PlanoPublic[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [pagamento, setPagamento] = useState<Pagamento | null>(null);
  const [creatingPlanoId, setCreatingPlanoId] = useState<number | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [pixCopied, setPixCopied] = useState(false);

  const loadPlanos = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setLoadError(null);
    try {
      const response = await api.listPlanos(token);
      setPlanos(response.data);
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : 'Não foi possível carregar os planos.');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void loadPlanos();
  }, [loadPlanos]);

  const handlePagar = async (plano: PlanoPublic) => {
    if (!token) return;
    setCreatingPlanoId(plano.id);
    setCreateError(null);
    try {
      const response = await api.createPagamento(plano.id, token);
      setPagamento(response.data);
    } catch (err) {
      setCreateError(err instanceof ApiError ? err.message : 'Não foi possível gerar o Pix. Tente novamente.');
    } finally {
      setCreatingPlanoId(null);
    }
  };

  const handleTentarNovamente = () => {
    setPagamento(null);
    setCreateError(null);
  };

  // Poll do status do pagamento enquanto estiver pendente.
  useEffect(() => {
    if (!token || !pagamento || pagamento.status !== 'pendente') return;

    let cancelled = false;
    const interval = window.setInterval(async () => {
      try {
        const response = await api.getPagamento(pagamento.id, token);
        if (cancelled) return;
        setPagamento(response.data);
        if (response.data.status === 'aprovado' && response.user) {
          updateUser({ status: response.user.status, access_expires_at: response.user.access_expires_at });
        }
      } catch {
        // silencioso -- tenta de novo no proximo poll
      }
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [token, pagamento, updateUser]);

  return (
    <div className="bandeira-workspace">
      <div className="bandeira-main-panel">
        {lockedTabLabel ? (
          <div className="solicitar-acesso-alert-box">
            <div className="solicitar-acesso-alert-lock-icon">🔒</div>
            <div className="solicitar-acesso-alert-text">
              <h3>Área Bloqueada</h3>
              <p>
                A aba <strong>{lockedTabLabel}</strong> faz parte do plano pago. Ative um plano abaixo para liberar o acesso a todas as ferramentas do sistema!
              </p>
            </div>
          </div>
        ) : (
          <div className="bandeira-panel-header">
            <h2>Solicitar Acesso</h2>
            <p>Escolha um plano e pague via Pix pra liberar o acesso ao sistema.</p>
          </div>
        )}

        {pagamento?.status === 'aprovado' ? (
          <div className="bandeira-create-panel solicitar-acesso-status">
            <Check size={32} className="solicitar-acesso-status-icon ok" />
            <h3>Pagamento confirmado!</h3>
            <p className="bandeira-size-hint">Seu acesso foi liberado. Vá em qualquer aba do menu pra começar a usar.</p>
          </div>
        ) : pagamento?.status === 'pendente' ? (
          <div className="bandeira-create-panel solicitar-acesso-status">
            <h3>Pague com Pix pra liberar o acesso</h3>
            {pagamento.qr_code_base64 ? (
              <img
                src={`data:image/png;base64,${pagamento.qr_code_base64}`}
                alt="QR Code Pix"
                className="solicitar-acesso-qr"
              />
            ) : (
              <QrCode size={64} />
            )}
            {pagamento.qr_code ? (
              <button
                type="button"
                className="mold-secondary-button"
                onClick={() => {
                  void navigator.clipboard.writeText(pagamento.qr_code ?? '');
                  setPixCopied(true);
                  setTimeout(() => setPixCopied(false), 2000);
                }}
              >
                {pixCopied ? <Check size={16} /> : <Copy size={16} />}
                {pixCopied ? 'Copiado' : 'Copiar código Pix (copia e cola)'}
              </button>
            ) : null}
            <p className="bandeira-size-hint">
              <Loader2 size={14} className="mold-import-spinner" /> Aguardando confirmação do pagamento...
            </p>
            <button type="button" className="mold-secondary-button rifa-recusar-button" onClick={handleTentarNovamente}>
              Cancelar e escolher outro plano
            </button>
          </div>
        ) : pagamento?.status === 'rejeitado' ? (
          <div className="bandeira-create-panel solicitar-acesso-status">
            <p className="mold-import-error">O pagamento não foi aprovado.</p>
            <button type="button" className="mold-save-button" onClick={handleTentarNovamente}>
              Tentar novamente
            </button>
          </div>
        ) : loading ? (
          <p className="bandeira-size-hint">
            <Loader2 size={14} className="mold-import-spinner" /> Carregando planos...
          </p>
        ) : loadError ? (
          <p className="mold-import-error">{loadError}</p>
        ) : planos.length === 0 ? (
          <p className="bandeira-size-hint">Nenhum plano disponível no momento. Fale com o administrador.</p>
        ) : (
          <>
            {createError ? <p className="mold-import-error">{createError}</p> : null}
            <div className="rifa-card-grid">
              {planos.map((plano) => (
                <article key={plano.id} className="rifa-card solicitar-acesso-card">
                  <h3>{plano.nome}</h3>
                  <p className="solicitar-acesso-valor">{formatMoeda(plano.valor)}</p>
                  <p className="bandeira-size-hint">{plano.dias_acesso} dias de acesso</p>
                  <button
                    type="button"
                    className="mold-save-button"
                    onClick={() => void handlePagar(plano)}
                    disabled={creatingPlanoId === plano.id}
                  >
                    {creatingPlanoId === plano.id ? <Loader2 size={16} className="mold-import-spinner" /> : null}
                    Pagar com Pix
                  </button>
                </article>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
