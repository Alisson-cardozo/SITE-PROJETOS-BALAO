import { useCallback, useEffect, useState } from 'react';
import { Check, Copy, CreditCard, Loader2, QrCode } from 'lucide-react';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { MercadoPagoCardForm } from '../components/MercadoPagoCardForm';
import { PLANO_ABA_GROUPS } from '../config/userNavigation';
import type { Pagamento, PlanoPublic, SystemSettings, UserStatus } from '../types';

const POLL_INTERVAL_MS = 3500;

function formatMoeda(valor: number): string {
  return valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

interface SolicitarAcessoPageProps {
  lockedTabLabel?: string;
  /** Pra mostrar "Em breve"/etc nas abas de cada plano que estao ocultas
   * (ver AdminTabsPage) -- vem do UserArea, que ja carrega isso pro menu. */
  systemSettings?: SystemSettings | null;
}

export function SolicitarAcessoPage({ lockedTabLabel, systemSettings }: SolicitarAcessoPageProps) {
  const { token, updateUser } = useAuth();
  const [planos, setPlanos] = useState<PlanoPublic[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [pagamento, setPagamento] = useState<Pagamento | null>(null);
  const [creatingPlanoId, setCreatingPlanoId] = useState<number | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [pixCopied, setPixCopied] = useState(false);
  // Plano escolhido para pagar com cartao (abre o formulario inline).
  const [cardPlano, setCardPlano] = useState<PlanoPublic | null>(null);

  // Cupom de desconto (opcional). Cada plano pode ter um desconto diferente — ou
  // o cupom pode nem valer pra ele. `porPlano` guarda o valor final por plano_id
  // (so os planos em que o cupom vale entram no mapa).
  const [cupomInput, setCupomInput] = useState('');
  const [cupomAplicado, setCupomAplicado] = useState<{ codigo: string; porPlano: Record<number, number> } | null>(null);
  const [cupomError, setCupomError] = useState<string | null>(null);
  const [cupomBusy, setCupomBusy] = useState(false);

  /** Ordem dos cards: o plano com a Assistente-IA Carla SEMPRE primeiro, depois
   * do maior valor para o menor. */
  const planosOrdenados = [...planos].sort((a, b) => {
    const ca = a.carla_ia ? 1 : 0;
    const cb = b.carla_ia ? 1 : 0;
    if (ca !== cb) return cb - ca;
    return b.valor - a.valor;
  });

  /** Valor final do plano com o cupom (ou o valor cheio se o cupom não vale). */
  const valorPlano = (plano: PlanoPublic): number => cupomAplicado?.porPlano[plano.id] ?? plano.valor;
  const cupomValePlano = (plano: PlanoPublic): boolean =>
    !!cupomAplicado && cupomAplicado.porPlano[plano.id] !== undefined;

  const handleAplicarCupom = async () => {
    if (!token) return;
    const codigo = cupomInput.trim().toUpperCase();
    if (codigo === '') {
      setCupomError('Digite o código do cupom.');
      return;
    }
    if (planos.length === 0) return;
    setCupomError(null);
    setCupomBusy(true);
    try {
      // Valida o cupom pra CADA plano (o desconto pode variar / não valer).
      const resultados = await Promise.all(
        planos.map((p) =>
          api
            .validarCupom(codigo, p.id, token)
            .then((r) => ({ id: p.id, valor: r.data.valor_final, err: null as string | null }))
            .catch((e) => ({ id: p.id, valor: null as number | null, err: e instanceof ApiError ? e.message : 'Cupom inválido.' }))
        )
      );

      const porPlano: Record<number, number> = {};
      let primeiroErro: string | null = null;
      for (const r of resultados) {
        if (r.valor !== null) porPlano[r.id] = r.valor;
        else if (!primeiroErro && r.err) primeiroErro = r.err;
      }

      if (Object.keys(porPlano).length === 0) {
        setCupomAplicado(null);
        setCupomError(primeiroErro ?? 'Cupom inválido.');
        return;
      }

      setCupomAplicado({ codigo, porPlano });
      setCupomInput(codigo);
    } catch {
      setCupomAplicado(null);
      setCupomError('Não foi possível validar o cupom.');
    } finally {
      setCupomBusy(false);
    }
  };

  const removerCupom = () => {
    setCupomAplicado(null);
    setCupomInput('');
    setCupomError(null);
  };

  const mpPublicKey = systemSettings?.mercado_pago_public_key ?? null;

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
      const response = await api.createPagamento(plano.id, token, cupomValePlano(plano) ? cupomAplicado?.codigo : null);
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
    setCardPlano(null);
  };

  const handleCartaoSuccess = (
    pg: Pagamento,
    u: { status: UserStatus; access_expires_at: string | null } | null
  ) => {
    setCardPlano(null);
    setCreateError(null);
    setPagamento(pg);
    // Cartao aprovado ja libera o acesso no backend -- atualiza o usuario pra
    // destravar o menu na hora, sem esperar o poll.
    if (pg.status === 'aprovado' && u) {
      updateUser({ status: u.status, access_expires_at: u.access_expires_at });
    }
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
                A aba <strong>{lockedTabLabel}</strong> não faz parte do seu plano atual. Ative ou troque de plano
                abaixo para liberar o acesso a essa ferramenta!
              </p>
            </div>
          </div>
        ) : (
          <div className="bandeira-panel-header">
            <h2>Solicitar Acesso</h2>
            <p>Escolha um plano e pague via Pix ou cartão de crédito pra liberar o acesso ao sistema.</p>
          </div>
        )}

        {pagamento?.status === 'aprovado' ? (
          <div className="bandeira-create-panel solicitar-acesso-status">
            <Check size={32} className="solicitar-acesso-status-icon ok" />
            <h3>Pagamento confirmado!</h3>
            <p className="bandeira-size-hint">Seu acesso foi liberado. Vá em qualquer aba do menu pra começar a usar.</p>
          </div>
        ) : pagamento?.status === 'pendente' && pagamento.metodo === 'cartao' ? (
          <div className="bandeira-create-panel solicitar-acesso-status">
            <h3>Pagamento em processamento</h3>
            <p className="bandeira-size-hint">
              <Loader2 size={14} className="mold-import-spinner" /> Estamos confirmando seu pagamento com a
              operadora do cartão. Isso costuma levar só alguns instantes...
            </p>
            <button type="button" className="mold-secondary-button rifa-recusar-button" onClick={handleTentarNovamente}>
              Escolher outro plano
            </button>
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
        ) : cardPlano ? (
          mpPublicKey ? (
            <MercadoPagoCardForm
              publicKey={mpPublicKey}
              planoId={cardPlano.id}
              valor={valorPlano(cardPlano)}
              authToken={token ?? ''}
              codigoCupom={cupomValePlano(cardPlano) ? cupomAplicado?.codigo : null}
              onSuccess={handleCartaoSuccess}
              onCancel={() => setCardPlano(null)}
            />
          ) : (
            <div className="bandeira-create-panel solicitar-acesso-status">
              <p className="mold-import-error">Pagamento por cartão indisponível no momento.</p>
              <button type="button" className="mold-secondary-button" onClick={() => setCardPlano(null)}>
                Voltar
              </button>
            </div>
          )
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

            {/* Cupom de desconto (opcional) */}
            <div
              className={!cupomAplicado ? 'cupom-highlight' : undefined}
              style={{
                background: '#111622',
                border: '1px solid #23304d',
                borderRadius: '12px',
                padding: '16px',
                marginBottom: '18px',
              }}
            >
              {cupomAplicado ? (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
                  <span style={{ color: '#48bb78', fontWeight: 600, fontSize: '14px' }}>
                    ✅ Cupom <strong>{cupomAplicado.codigo}</strong> aplicado
                    {Object.keys(cupomAplicado.porPlano).length < planos.length
                      ? ' — válido só para alguns planos'
                      : ''}
                  </span>
                  <button type="button" className="mold-secondary-button" onClick={removerCupom}>
                    Remover cupom
                  </button>
                </div>
              ) : (
                <div style={{ position: 'relative', zIndex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px', flexWrap: 'wrap' }}>
                    <span className="cupom-highlight-icon" style={{ fontSize: '20px' }}>🎟️</span>
                    <span style={{ color: '#f7fafc', fontSize: '15px', fontWeight: 700 }}>Tem um cupom de desconto?</span>
                    <span className="cupom-highlight-badge">Economize!</span>
                  </div>
                  <p style={{ color: '#a0aec0', fontSize: '12px', margin: '0 0 8px' }}>
                    Digite o código e clique em <strong>Aplicar</strong> para ver o preço com desconto.
                  </p>
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    <input
                      type="text"
                      value={cupomInput}
                      onChange={(e) => {
                        setCupomInput(e.target.value.toUpperCase());
                        setCupomError(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void handleAplicarCupom();
                      }}
                      placeholder="Digite o código"
                      style={{
                        flex: 1,
                        minWidth: '160px',
                        padding: '10px 12px',
                        background: '#0b0f18',
                        border: '1px solid #2d3748',
                        borderRadius: '8px',
                        color: '#fff',
                        fontSize: '14px',
                        textTransform: 'uppercase',
                        outline: 'none',
                      }}
                    />
                    <button type="button" className="mold-save-button" onClick={() => void handleAplicarCupom()} disabled={cupomBusy}>
                      {cupomBusy ? <Loader2 size={16} className="mold-import-spinner" /> : null}
                      Aplicar
                    </button>
                  </div>
                  {cupomError ? <p className="mold-import-error" style={{ marginBottom: 0 }}>{cupomError}</p> : null}
                </div>
              )}

              {/* Aviso: desconto vale só no mês; na renovação, checar novo cupom. */}
              <p
                style={{
                  position: 'relative',
                  zIndex: 1,
                  margin: '12px 0 0',
                  paddingTop: '10px',
                  borderTop: '1px solid #1f293d',
                  color: '#ecc94b',
                  fontSize: '12px',
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '6px',
                  lineHeight: 1.5,
                }}
              >
                <span>⚠️</span>
                <span>
                  Desconto válido <strong>apenas para este mês</strong>. Ao renovar no próximo mês, verifique se há um
                  cupom disponível.
                </span>
              </p>
            </div>

            <div className="rifa-card-grid">
              {planosOrdenados.map((plano) => (
                <article key={plano.id} className={`rifa-card solicitar-acesso-card${plano.carla_ia ? ' plano-carla-card' : ''}`}>
                  {plano.carla_ia ? (
                    <span className="plano-carla-badge">🤖 Assistente-IA Carla</span>
                  ) : null}
                  <h3>{plano.nome}</h3>
                  {cupomValePlano(plano) ? (
                    <p className="solicitar-acesso-valor">
                      <span style={{ textDecoration: 'line-through', opacity: 0.55, fontSize: '0.7em', marginRight: '8px' }}>
                        {formatMoeda(plano.valor)}
                      </span>
                      {formatMoeda(valorPlano(plano))}
                    </p>
                  ) : (
                    <p className="solicitar-acesso-valor">{formatMoeda(plano.valor)}</p>
                  )}
                  {cupomAplicado && !cupomValePlano(plano) ? (
                    <p className="bandeira-size-hint" style={{ color: '#ecc94b' }}>Cupom não vale para este plano</p>
                  ) : null}
                  <p className="bandeira-size-hint">{plano.dias_acesso} dias de acesso</p>
                  <ul className="solicitar-acesso-abas-list">
                    {PLANO_ABA_GROUPS.filter((g) => plano.abas.includes(g.id)).map((g) => {
                      const isHidden = systemSettings?.hidden_nav_items.includes(g.id) ?? false;
                      const aviso = isHidden ? systemSettings?.nav_item_labels[g.id] : undefined;
                      return (
                        <li key={g.id}>
                          {g.label}
                          {aviso ? <em className="solicitar-acesso-aba-aviso">{aviso}</em> : null}
                        </li>
                      );
                    })}
                  </ul>
                  <div className="solicitar-acesso-actions">
                    <button
                      type="button"
                      className="mold-save-button"
                      onClick={() => void handlePagar(plano)}
                      disabled={creatingPlanoId === plano.id}
                    >
                      {creatingPlanoId === plano.id ? <Loader2 size={16} className="mold-import-spinner" /> : null}
                      Pagar com Pix
                    </button>
                    {mpPublicKey ? (
                      <button
                        type="button"
                        className="mold-secondary-button"
                        onClick={() => {
                          setCreateError(null);
                          setCardPlano(plano);
                        }}
                        disabled={creatingPlanoId === plano.id}
                      >
                        <CreditCard size={16} />
                        Pagar com Cartão
                      </button>
                    ) : null}
                  </div>
                </article>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
