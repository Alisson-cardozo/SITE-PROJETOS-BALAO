import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, Copy, Loader2, Trophy } from 'lucide-react';
import { NumeroGrid, type NumeroCellState } from '../components/NumeroGrid';
import { api, ApiError } from '../lib/api';
import { calcularValorTotal } from '../lib/rifaPricing';
import type { Rifa, RifaReservaResponse } from '../types';

function formatMoeda(valor: number): string {
  return valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatData(iso: string | null): string {
  if (!iso) return '';
  const match = iso.trim().match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
  if (!match) return iso;
  const [, year, month, day, hour, minute] = match;
  return `${day}/${month}/${year} as ${hour}:${minute}`;
}

function ConsultaMeusNumeros({ slug }: { slug: string }) {
  const [whatsapp, setWhatsapp] = useState('');
  const [numeros, setNumeros] = useState<number[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [checked, setChecked] = useState(false);

  const handleCheck = async () => {
    if (whatsapp.trim() === '') return;
    setLoading(true);
    setChecked(false);
    try {
      const response = await api.getMeusNumeros(slug, whatsapp);
      setNumeros(response.data.numeros);
    } catch {
      setNumeros([]);
    } finally {
      setChecked(true);
      setLoading(false);
    }
  };

  return (
    <div className="rifa-consulta-box">
      <h3>Ja comprou? Consulte seus numeros</h3>
      <div className="rifa-manual-add-row">
        <input
          type="text"
          value={whatsapp}
          onChange={(e) => setWhatsapp(e.target.value)}
          placeholder="Seu whatsapp"
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void handleCheck();
            }
          }}
        />
        <button type="button" className="mold-secondary-button" onClick={() => void handleCheck()} disabled={loading}>
          {loading ? <Loader2 size={16} className="mold-import-spinner" /> : null}
          Consultar
        </button>
      </div>
      {checked ? (
        numeros && numeros.length > 0 ? (
          <p className="rifa-public-meus-numeros">
            Voce tem {numeros.length} numero(s) nessa rifa: {numeros.join(', ')}.
          </p>
        ) : (
          <p className="bandeira-size-hint">Nenhum numero encontrado com esse whatsapp.</p>
        )
      ) : null}
    </div>
  );
}

export function RifaPublicPage({ slug }: { slug: string }) {
  const [rifa, setRifa] = useState<Rifa | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [nome, setNome] = useState('');
  const [whatsapp, setWhatsapp] = useState('');
  const [email, setEmail] = useState('');
  const [selecionados, setSelecionados] = useState<Set<number>>(new Set());
  const [meusNumeros, setMeusNumeros] = useState<number[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [reserva, setReserva] = useState<RifaReservaResponse | null>(null);
  const [compradorStatus, setCompradorStatus] = useState<string | null>(null);
  const [checkingStatus, setCheckingStatus] = useState(false);
  const [pixCopied, setPixCopied] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.getRifaPublica(slug);
      setRifa(response.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Nao foi possivel carregar essa rifa.');
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    void load();
  }, [load]);

  const checkMeusNumeros = useCallback(async () => {
    const digits = whatsapp.replace(/\D/g, '');
    if (digits.length < 8) {
      setMeusNumeros([]);
      return;
    }
    try {
      const response = await api.getMeusNumeros(slug, whatsapp);
      setMeusNumeros(response.data.numeros);
    } catch {
      // silencioso -- e so um aviso a mais, nao trava o fluxo se falhar
    }
  }, [slug, whatsapp]);

  const ocupadosSet = useMemo(() => new Set(rifa?.numeros_ocupados ?? []), [rifa]);
  const meusSet = useMemo(() => new Set(meusNumeros), [meusNumeros]);

  const getState = useCallback(
    (n: number): NumeroCellState => {
      if (meusSet.has(n)) return { status: 'meu', label: 'Seu numero' };
      if (ocupadosSet.has(n)) return { status: 'vendido' };
      return { status: 'disponivel' };
    },
    [ocupadosSet, meusSet]
  );

  const toggleNumero = useCallback((n: number) => {
    setSelecionados((prev) => {
      const next = new Set(prev);
      if (next.has(n)) next.delete(n);
      else next.add(n);
      return next;
    });
  }, []);

  const checkStatus = useCallback(async () => {
    if (!reserva) return;
    setCheckingStatus(true);
    try {
      const response = await api.getStatusComprador(reserva.comprador_id);
      setCompradorStatus(response.data.status);
    } catch {
      // silencioso -- so um refresh de status, se falhar tenta de novo no proximo clique/poll
    } finally {
      setCheckingStatus(false);
    }
  }, [reserva]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rifa) return;

    setFormError(null);
    if (nome.trim() === '') {
      setFormError('Informe seu nome.');
      return;
    }
    if (whatsapp.trim() === '') {
      setFormError('Informe seu whatsapp.');
      return;
    }
    if (selecionados.size === 0) {
      setFormError('Escolha pelo menos 1 numero na grade.');
      return;
    }

    setSubmitting(true);
    try {
      const response = await api.reservarNumeros(slug, {
        nome: nome.trim(),
        whatsapp: whatsapp.trim(),
        email: email.trim() || undefined,
        numeros: [...selecionados],
      });
      setReserva(response.data);
      setCompradorStatus('aguardando_pagamento');
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Nao foi possivel reservar os numeros.');
      void load(); // a grade pode ter mudado (alguem pegou um numero que ele escolheu) -- recarrega
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="rifa-public-screen">
        <div className="rifa-public-loading">
          <Loader2 size={28} className="mold-import-spinner" />
        </div>
      </div>
    );
  }

  if (error || !rifa) {
    return (
      <div className="rifa-public-screen">
        <div className="rifa-public-card rifa-public-message">
          <h1>Rifa nao encontrada</h1>
          <p>{error ?? 'Esse link nao existe ou foi removido.'}</p>
        </div>
      </div>
    );
  }

  if (rifa.status === 'finalizada' && rifa.numero_sorteado !== null) {
    return (
      <div className="rifa-public-screen">
        <div className="rifa-public-card rifa-public-message">
          <Trophy size={40} />
          <h1>{rifa.nome}</h1>
          <p>Essa rifa ja foi sorteada!</p>
          <div className="rifa-public-winner">
            Numero vencedor: {rifa.numero_sorteado}
            {rifa.vencedor_nome ? ` — ${rifa.vencedor_nome}` : ''}
          </div>
        </div>
      </div>
    );
  }

  if (rifa.status !== 'ativa') {
    return (
      <div className="rifa-public-screen">
        <div className="rifa-public-card rifa-public-message">
          <h1>{rifa.nome}</h1>
          <p>Essa rifa nao esta mais disponivel pra compra.</p>
        </div>
      </div>
    );
  }

  const promocoesAtivas = rifa.promocoes.filter((p) => p.ativo);
  const total = calcularValorTotal(rifa.promocoes, rifa.valor_numero, selecionados.size);
  const waMessage = reserva
    ? encodeURIComponent(
        `Ola! Reservei os numeros ${reserva.numeros.join(', ')} da rifa "${rifa.nome}", ja paguei via Pix e vou mandar o comprovante.`
      )
    : '';

  return (
    <div className="rifa-public-screen">
      <div className="rifa-public-card">
        {rifa.fotos.some((foto) => foto !== null) ? (
          <div className="rifa-public-gallery">
            {rifa.fotos
              .filter((foto): foto is string => foto !== null)
              .map((foto, i) => (
                <img key={i} src={foto} alt={`${rifa.nome} - foto ${i + 1}`} />
              ))}
          </div>
        ) : null}

        <h1>{rifa.nome}</h1>
        <p className="rifa-public-desc">{rifa.descricao}</p>

        <div className="rifa-public-stats">
          <div>
            <span>Valor por numero</span>
            <strong>{formatMoeda(rifa.valor_numero)}</strong>
          </div>
          <div>
            <span>Disponiveis</span>
            <strong>
              {rifa.disponiveis} / {rifa.quantidade_numeros}
            </strong>
          </div>
        </div>

        <div className="rifa-public-progress">
          <div className="rifa-public-progress-fill" style={{ width: `${rifa.percentual_vendido}%` }} />
        </div>
        <p className="rifa-public-progress-label">{rifa.percentual_vendido}% vendido</p>

        {promocoesAtivas.length > 0 ? (
          <div className="rifa-promocoes-list">
            {promocoesAtivas.map((p) => (
              <span key={p.id} className="rifa-promocao-chip">
                {p.tipo === 'pacote'
                  ? `${p.quantidade} numeros por ${formatMoeda(p.valor_total ?? 0)}`
                  : `${p.quantidade}+ numeros, ${formatMoeda(p.valor_unidade ?? 0)} cada`}
              </span>
            ))}
          </div>
        ) : null}

        <p className="rifa-public-hint">
          Sorteio: {rifa.modo_sorteio === 'caixa_federal' ? 'pela Loteria Federal' : 'pelo sistema'}
          {rifa.modo_termino === 'data' && rifa.data_termino ? ` — ate ${formatData(rifa.data_termino)}` : ''}
          {rifa.modo_termino === 'vender_tudo' ? ' — ate vender todos os numeros' : ''}
        </p>

        <ConsultaMeusNumeros slug={slug} />

        {!reserva ? (
          <form className="rifa-public-form" onSubmit={handleSubmit}>
            <label className="auth-field">
              <span>Seu nome *</span>
              <input type="text" value={nome} onChange={(e) => setNome(e.target.value)} />
            </label>
            <label className="auth-field">
              <span>Seu whatsapp *</span>
              <input
                type="text"
                value={whatsapp}
                onChange={(e) => setWhatsapp(e.target.value)}
                onBlur={() => void checkMeusNumeros()}
                placeholder="(11) 99999-9999"
              />
            </label>
            <label className="auth-field">
              <span>Email (opcional)</span>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </label>

            {meusNumeros.length > 0 ? (
              <p className="rifa-public-meus-numeros">
                Voce ja tem {meusNumeros.length} numero(s) nessa rifa: {meusNumeros.join(', ')}. Escolha mais abaixo se
                quiser comprar mais — eles se somam a sua cota.
              </p>
            ) : null}

            <div className="auth-field">
              <span>
                Escolha seus numeros ({selecionados.size} selecionado{selecionados.size === 1 ? '' : 's'})
              </span>
              <NumeroGrid total={rifa.quantidade_numeros} getState={getState} selecionados={selecionados} onToggle={toggleNumero} />
            </div>

            <div className="rifa-public-total">Total: {formatMoeda(total)}</div>

            {formError ? <p className="mold-import-error">{formError}</p> : null}

            <button type="submit" className="mold-save-button" disabled={submitting || rifa.disponiveis === 0}>
              {submitting ? <Loader2 size={16} className="mold-import-spinner" /> : null}
              {rifa.disponiveis === 0 ? 'Esgotado' : 'Reservar numeros'}
            </button>
          </form>
        ) : compradorStatus === 'pago' ? (
          <div className="rifa-public-message rifa-public-success">
            <h2>Pagamento confirmado!</h2>
            <p>Seus numeros: {reserva.numeros.join(', ')}</p>
            <p>Boa sorte!</p>
          </div>
        ) : (
          <div className="rifa-public-reserva">
            <h2>Numeros reservados: {reserva.numeros.join(', ')}</h2>
            <p className="rifa-public-hint">
              Voce tem ate {formatData(reserva.expira_em)} pra pagar e mandar o comprovante, senao os numeros voltam a
              ficar disponiveis.
            </p>

            {reserva.chave_pix ? (
              <div className="rifa-public-pix">
                <span className="bandeira-size-hint">Pague via Pix pra esta chave:</span>
                <div className="rifa-public-pix-copy">
                  <input type="text" readOnly value={reserva.chave_pix} onFocus={(e) => e.currentTarget.select()} />
                  <button
                    type="button"
                    className="mold-secondary-button"
                    onClick={() => {
                      void navigator.clipboard.writeText(reserva.chave_pix ?? '');
                      setPixCopied(true);
                      setTimeout(() => setPixCopied(false), 2000);
                    }}
                  >
                    {pixCopied ? <Check size={16} /> : <Copy size={16} />}
                    {pixCopied ? 'Copiado' : 'Copiar'}
                  </button>
                </div>
              </div>
            ) : null}

            <a
              className="mold-save-button"
              href={`https://wa.me/${(reserva.whatsapp_contato ?? '').replace(/\D/g, '')}?text=${waMessage}`}
              target="_blank"
              rel="noreferrer"
            >
              Falar no WhatsApp e mandar o comprovante
            </a>

            <button type="button" className="mold-secondary-button" onClick={() => void checkStatus()} disabled={checkingStatus}>
              {checkingStatus ? <Loader2 size={16} className="mold-import-spinner" /> : null}
              Ja confirmaram meu pagamento? Verificar
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
