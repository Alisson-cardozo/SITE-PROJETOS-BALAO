import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, Copy, ImagePlus, Loader2, Plus, Search, Trash2, Trophy, X } from 'lucide-react';
import { NumeroGrid, type NumeroCellState } from '../components/NumeroGrid';
import { api, ApiError, createRifa } from '../lib/api';
import { useAuth } from '../lib/auth';
import type { Rifa, RifaCompradorDetail, RifaDetail, RifaPromocao } from '../types';

function formatMoeda(valor: number | string): string {
  const n = typeof valor === 'string' ? Number(valor) : valor;
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatDataHora(iso: string | null): string {
  if (!iso) return '-';
  const match = iso.trim().match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
  if (!match) return iso;
  const [, year, month, day, hour, minute] = match;
  return `${day}/${month}/${year} ${hour}:${minute}`;
}

const COMPRADOR_STATUS_LABEL: Record<string, string> = {
  aguardando_pagamento: 'Aguardando pagamento',
  pago: 'Pago',
  expirado: 'Expirado',
  cancelado: 'Cancelado',
};

const MODO_SORTEIO_LABEL: Record<string, string> = {
  sistema: 'Sorteio pelo sistema',
  caixa_federal: 'Loteria Federal',
};

export function RifasWorkspace() {
  const { token } = useAuth();
  const [rifas, setRifas] = useState<Rifa[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<'list' | 'create'>('list');
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const response = await api.listRifas(token);
      setRifas(response.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Nao foi possivel carregar as rifas.');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  if (selectedId !== null) {
    return (
      <RifaDetailView
        rifaId={selectedId}
        onBack={() => {
          setSelectedId(null);
          void load();
        }}
      />
    );
  }

  if (view === 'create') {
    return (
      <CreateRifaForm
        onCancel={() => setView('list')}
        onCreated={() => {
          setView('list');
          void load();
        }}
      />
    );
  }

  const ativas = rifas.filter((r) => r.status === 'ativa').length;

  return (
    <div className="bandeira-workspace">
      <div className="bandeira-main-panel">
        <div className="bandeira-panel-header">
          <h2>Rifas</h2>
          <p>Crie uma rifa, mande o link pros seus clientes e acompanhe as vendas em tempo real.</p>
        </div>

        <button type="button" className="mold-save-button" onClick={() => setView('create')} disabled={ativas >= 5}>
          <Plus size={16} />
          Criar Rifa
        </button>
        {ativas >= 5 ? (
          <p className="bandeira-size-hint">Voce ja tem 5 rifas ativas (o maximo). Finalize uma pra criar outra.</p>
        ) : null}

        {loading ? (
          <p className="bandeira-size-hint">
            <Loader2 size={14} className="mold-import-spinner" /> Carregando rifas...
          </p>
        ) : error ? (
          <p className="mold-import-error">{error}</p>
        ) : rifas.length === 0 ? (
          <p className="bandeira-size-hint">Nenhuma rifa criada ainda.</p>
        ) : (
          <div className="rifa-card-grid">
            {rifas.map((r) => (
              <button key={r.id} type="button" className="rifa-card" onClick={() => setSelectedId(r.id)}>
                {r.fotos[0] ? (
                  <img src={r.fotos[0]} alt={r.nome} />
                ) : (
                  <div className="rifa-card-foto-placeholder">
                    <ImagePlus size={24} />
                  </div>
                )}
                <div className="rifa-card-body">
                  <strong>{r.nome}</strong>
                  <span className={`rifa-card-status rifa-card-status-${r.status}`}>
                    {r.status === 'ativa' ? 'Ativa' : r.status === 'finalizada' ? 'Finalizada' : 'Cancelada'}
                  </span>
                  <div className="rifa-public-progress">
                    <div className="rifa-public-progress-fill" style={{ width: `${r.percentual_vendido}%` }} />
                  </div>
                  <span className="rifa-card-progress-label">
                    {r.vendidos}/{r.quantidade_numeros} vendidos ({r.percentual_vendido}%)
                  </span>
                  {r.valor_arrecadado !== undefined ? (
                    <span className="rifa-card-arrecadado">Arrecadado: {formatMoeda(r.valor_arrecadado)}</span>
                  ) : null}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function FotoUploadBox({
  label,
  file,
  onChange,
}: {
  label: string;
  file: File | null;
  onChange: (file: File | null) => void;
}) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!file) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  return (
    <label className={`rifa-foto-upload${previewUrl ? ' has-image' : ''}`}>
      {previewUrl ? (
        <img src={previewUrl} alt={label} />
      ) : (
        <>
          <ImagePlus size={20} />
          <span>{label}</span>
        </>
      )}
      <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => onChange(e.target.files?.[0] ?? null)} />
    </label>
  );
}

function CreateRifaForm({ onCancel, onCreated }: { onCancel: () => void; onCreated: () => void }) {
  const { token } = useAuth();
  const [nome, setNome] = useState('');
  const [descricao, setDescricao] = useState('');
  const [fotos, setFotos] = useState<Array<File | null>>([null, null]);
  const [fotoPreviews, setFotoPreviews] = useState<Array<string | null>>([null, null]);
  const [valorNumero, setValorNumero] = useState('');
  const [quantidadeNumeros, setQuantidadeNumeros] = useState('');
  // Loteria Federal foi removida das opcoes de criacao — toda rifa nova e sorteio pelo sistema.
  const modoSorteio = 'sistema' as const;
  const [modoTermino, setModoTermino] = useState<'data' | 'vender_tudo'>('vender_tudo');
  const [dataTermino, setDataTermino] = useState('');
  const [whatsappContato, setWhatsappContato] = useState('');
  const [chavePix, setChavePix] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    const urls = fotos.map((f) => (f ? URL.createObjectURL(f) : null));
    setFotoPreviews(urls);
    return () => {
      urls.forEach((u) => {
        if (u) URL.revokeObjectURL(u);
      });
    };
  }, [fotos]);

  const handleSave = async () => {
    if (!token) return;
    setFormError(null);

    if (nome.trim() === '') return setFormError('Informe o nome da rifa.');
    if (descricao.trim() === '') return setFormError('Informe a descricao.');
    if (!valorNumero || Number(valorNumero) <= 0) return setFormError('Informe o valor de cada numero.');
    if (!quantidadeNumeros || Number(quantidadeNumeros) < 2) return setFormError('Informe a quantidade de numeros (minimo 2).');
    if (modoTermino === 'data' && dataTermino === '') return setFormError('Informe a data de termino.');
    if (whatsappContato.trim() === '') return setFormError('Informe o seu whatsapp de contato.');
    if (chavePix.trim() === '') return setFormError('Informe sua chave Pix.');

    const formData = new FormData();
    formData.append('nome', nome.trim());
    formData.append('descricao', descricao.trim());
    formData.append('valor_numero', valorNumero);
    formData.append('quantidade_numeros', quantidadeNumeros);
    formData.append('modo_sorteio', modoSorteio);
    formData.append('modo_termino', modoTermino);
    if (modoTermino === 'data') formData.append('data_termino', dataTermino);
    formData.append('whatsapp_contato', whatsappContato.trim());
    formData.append('chave_pix', chavePix.trim());
    fotos.forEach((foto, i) => {
      if (foto) formData.append(`foto${i + 1}`, foto);
    });

    setSaving(true);
    try {
      await createRifa(formData, token);
      onCreated();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Nao foi possivel criar a rifa.');
    } finally {
      setSaving(false);
    }
  };

  const valorNum = Number(valorNumero) || 0;
  const qtdNum = Number(quantidadeNumeros) || 0;

  return (
    <div className="bandeira-workspace">
      <div className="bandeira-main-panel">
        <div className="bandeira-panel-header">
          <h2>Criar Rifa</h2>
          <p>Preencha os dados — depois de criada, voce recebe um link pra mandar pros seus clientes.</p>
        </div>

        <div className="rifa-create-layout">
          <div className="rifa-create-form-col">
            <div className="rifa-form-section">
              <h4>Sobre a rifa</h4>
              <label className="auth-field">
                <span>Nome</span>
                <input type="text" value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex: Rifa da Cesta de Natal" />
              </label>
              <label className="auth-field">
                <span>Descricao</span>
                <textarea value={descricao} onChange={(e) => setDescricao(e.target.value)} rows={3} placeholder="Conte o que o cliente vai ganhar..." />
              </label>
            </div>

            <div className="rifa-form-section">
              <h4>Fotos (opcional)</h4>
              <div className="rifa-foto-row">
                {[0, 1].map((i) => (
                  <FotoUploadBox
                    key={i}
                    label={`Foto ${i + 1}`}
                    file={fotos[i]}
                    onChange={(file) => setFotos((prev) => prev.map((f, idx) => (idx === i ? file : f)))}
                  />
                ))}
              </div>
            </div>

            <div className="rifa-form-section">
              <h4>Preco e numeros</h4>
              <div className="bandeira-size-fields">
                <label className="auth-field">
                  <span>Valor por numero (R$)</span>
                  <input type="number" min={0.01} step={0.01} value={valorNumero} onChange={(e) => setValorNumero(e.target.value)} />
                </label>
                <label className="auth-field">
                  <span>Quantidade de numeros</span>
                  <input type="number" min={2} value={quantidadeNumeros} onChange={(e) => setQuantidadeNumeros(e.target.value)} />
                </label>
              </div>
            </div>

            <div className="rifa-form-section">
              <h4>Sorteio e prazo</h4>
              <p className="bandeira-size-hint">
                O sorteio e sempre pelo sistema: quando voce mandar sortear, ele escolhe um numero vendido
                aleatoriamente.
              </p>
              <label className="auth-field">
                <span>Quando a rifa termina</span>
                <select value={modoTermino} onChange={(e) => setModoTermino(e.target.value as 'data' | 'vender_tudo')}>
                  <option value="vender_tudo">Quando vender todos os numeros</option>
                  <option value="data">Numa data especifica</option>
                </select>
              </label>
              {modoTermino === 'data' ? (
                <label className="auth-field">
                  <span>Data de termino</span>
                  <input type="datetime-local" value={dataTermino} onChange={(e) => setDataTermino(e.target.value)} />
                </label>
              ) : null}
            </div>

            <div className="rifa-form-section">
              <h4>Recebimento</h4>
              <p className="bandeira-size-hint">
                O cliente reserva os numeros, paga direto na sua chave Pix e te manda o comprovante pelo whatsapp. Voce
                confirma o pagamento manualmente no painel da rifa.
              </p>
              <label className="auth-field">
                <span>Sua chave Pix</span>
                <input
                  type="text"
                  value={chavePix}
                  onChange={(e) => setChavePix(e.target.value)}
                  placeholder="CPF, telefone, email ou chave aleatoria"
                />
              </label>
              <label className="auth-field">
                <span>Seu whatsapp de contato</span>
                <input type="text" value={whatsappContato} onChange={(e) => setWhatsappContato(e.target.value)} placeholder="5511999998888" />
              </label>
            </div>

            {formError ? <p className="mold-import-error">{formError}</p> : null}

            <div className="rifa-form-actions">
              <button type="button" className="mold-save-button" onClick={() => void handleSave()} disabled={saving}>
                {saving ? <Loader2 size={16} className="mold-import-spinner" /> : null}
                Criar rifa
              </button>
              <button type="button" className="mold-secondary-button" onClick={onCancel}>
                Cancelar
              </button>
            </div>
          </div>

          <div className="rifa-create-preview-col">
            <p className="rifa-preview-label">Previa — e assim que o cliente vai ver</p>
            <div className="rifa-public-card rifa-preview-card">
              <div className="rifa-public-gallery">
                {[0, 1].map((i) =>
                  fotoPreviews[i] ? (
                    <img key={i} src={fotoPreviews[i]!} alt={`Foto ${i + 1}`} />
                  ) : (
                    <div key={i} className="rifa-preview-photo-placeholder">
                      <ImagePlus size={22} />
                    </div>
                  )
                )}
              </div>

              <h1>{nome || 'Nome da rifa'}</h1>
              <p className="rifa-public-desc">{descricao || 'A descricao da rifa aparece aqui.'}</p>

              <div className="rifa-public-stats">
                <div>
                  <span>Valor por numero</span>
                  <strong>{formatMoeda(valorNum)}</strong>
                </div>
                <div>
                  <span>Disponiveis</span>
                  <strong>
                    {qtdNum} / {qtdNum}
                  </strong>
                </div>
              </div>

              <div className="rifa-public-progress">
                <div className="rifa-public-progress-fill" style={{ width: '0%' }} />
              </div>
              <p className="rifa-public-progress-label">0% vendido</p>

              <p className="rifa-public-hint">
                Sorteio: {MODO_SORTEIO_LABEL[modoSorteio]}
                {modoTermino === 'vender_tudo' ? ' — ate vender todos os numeros' : dataTermino ? ` — ate ${formatDataHora(dataTermino.replace('T', ' '))}` : ''}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function PromocoesManager({
  rifaId,
  promocoes,
  onChange,
}: {
  rifaId: number;
  promocoes: RifaPromocao[];
  onChange: () => void;
}) {
  const { token } = useAuth();
  const [tipo, setTipo] = useState<'pacote' | 'faixa'>('pacote');
  const [quantidade, setQuantidade] = useState('');
  const [valorTotal, setValorTotal] = useState('');
  const [valorUnidade, setValorUnidade] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async () => {
    if (!token) return;
    setError(null);

    const qtd = Number(quantidade);
    if (!qtd || qtd < 1) return setError('Informe a quantidade.');
    if (tipo === 'pacote' && (!valorTotal || Number(valorTotal) <= 0)) return setError('Informe o valor total do pacote.');
    if (tipo === 'faixa' && (!valorUnidade || Number(valorUnidade) <= 0)) return setError('Informe o valor por numero da faixa.');

    setSaving(true);
    try {
      await api.createPromocao(
        rifaId,
        {
          tipo,
          quantidade: qtd,
          valor_total: tipo === 'pacote' ? Number(valorTotal) : undefined,
          valor_unidade: tipo === 'faixa' ? Number(valorUnidade) : undefined,
          ativo: true,
        },
        token
      );
      setQuantidade('');
      setValorTotal('');
      setValorUnidade('');
      onChange();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Nao foi possivel criar a promocao.');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleAtivo = async (p: RifaPromocao) => {
    if (!token) return;
    await api.updatePromocao(
      rifaId,
      p.id,
      { tipo: p.tipo, quantidade: p.quantidade, valor_total: p.valor_total ?? undefined, valor_unidade: p.valor_unidade ?? undefined, ativo: !p.ativo },
      token
    );
    onChange();
  };

  const handleDelete = async (p: RifaPromocao) => {
    if (!token) return;
    await api.deletePromocao(rifaId, p.id, token);
    onChange();
  };

  return (
    <div className="bandeira-create-panel rifa-promocoes-manager">
      <h4>Promocoes de preco</h4>
      <p className="bandeira-size-hint">
        Crie pacotes (quantidade exata por um preco fechado) ou faixas (a partir de X numeros, cada um sai mais
        barato). Pode editar ou desativar a qualquer momento — util pra vender mais rapido perto do fim da rifa.
      </p>

      {promocoes.length > 0 ? (
        <div className="rifa-promocoes-existentes">
          {promocoes.map((p) => (
            <div key={p.id} className={`rifa-promocao-row${p.ativo ? '' : ' inativa'}`}>
              <span>
                {p.tipo === 'pacote'
                  ? `Pacote: ${p.quantidade} numeros por ${formatMoeda(p.valor_total ?? 0)}`
                  : `Faixa: a partir de ${p.quantidade} numeros, ${formatMoeda(p.valor_unidade ?? 0)} cada`}
              </span>
              <div className="rifa-promocao-row-actions">
                <button type="button" className="mold-secondary-button" onClick={() => void handleToggleAtivo(p)}>
                  {p.ativo ? 'Desativar' : 'Ativar'}
                </button>
                <button type="button" className="mold-secondary-button rifa-recusar-button" onClick={() => void handleDelete(p)}>
                  Excluir
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="bandeira-size-hint">Nenhuma promocao ainda — o preco padrao vale pra qualquer quantidade.</p>
      )}

      <div className="bandeira-size-fields">
        <label className="auth-field">
          <span>Tipo</span>
          <select value={tipo} onChange={(e) => setTipo(e.target.value as 'pacote' | 'faixa')}>
            <option value="pacote">Pacote (quantidade exata)</option>
            <option value="faixa">Faixa (a partir de X numeros)</option>
          </select>
        </label>
        <label className="auth-field">
          <span>{tipo === 'pacote' ? 'Quantidade do pacote' : 'A partir de quantos numeros'}</span>
          <input type="number" min={1} value={quantidade} onChange={(e) => setQuantidade(e.target.value)} />
        </label>
      </div>
      {tipo === 'pacote' ? (
        <label className="auth-field">
          <span>Valor total do pacote (R$)</span>
          <input type="number" min={0.01} step={0.01} value={valorTotal} onChange={(e) => setValorTotal(e.target.value)} />
        </label>
      ) : (
        <label className="auth-field">
          <span>Valor por numero nessa faixa (R$)</span>
          <input type="number" min={0.01} step={0.01} value={valorUnidade} onChange={(e) => setValorUnidade(e.target.value)} />
        </label>
      )}

      {error ? <p className="mold-import-error">{error}</p> : null}

      <button type="button" className="mold-save-button" onClick={() => void handleCreate()} disabled={saving}>
        {saving ? <Loader2 size={16} className="mold-import-spinner" /> : null}
        Adicionar promocao
      </button>
    </div>
  );
}

/**
 * O sorteio de verdade sempre acontece no backend (numero aleatorio escolhido
 * por SQL, atomico) — essa animacao e so apresentacao: ela gira por numeros
 * aleatorios da lista de vendidos por um tempo minimo, e so trava exatamente
 * no resultado que a API respondeu (nunca inventa um numero diferente do que
 * foi de fato gravado).
 */
function SorteioModal({
  numerosVendidos,
  onSortear,
  onClose,
}: {
  numerosVendidos: number[];
  onSortear: () => Promise<Rifa>;
  onClose: () => void;
}) {
  const [display, setDisplay] = useState<number | null>(null);
  const [phase, setPhase] = useState<'girando' | 'revelado' | 'erro'>('girando');
  const [resultado, setResultado] = useState<Rifa | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  // Guarda a MESMA promise entre re-execucoes do efeito (o StrictMode do React
  // roda todo useEffect 2x em dev) — sem isso o sorteio de verdade (que muda
  // dado no banco, nao pode rodar 2x) disparava duas vezes: a 2a chamada
  // sempre falha ("ja tem numero sorteado") e sobrescrevia o resultado certo.
  const sortearPromiseRef = useRef<Promise<Rifa> | null>(null);

  useEffect(() => {
    let cancelled = false;
    const MIN_DURATION_MS = 2600;
    const startedAt = Date.now();

    const intervalId = setInterval(() => {
      if (numerosVendidos.length === 0) return;
      setDisplay(numerosVendidos[Math.floor(Math.random() * numerosVendidos.length)]);
    }, 70);

    if (sortearPromiseRef.current === null) {
      sortearPromiseRef.current = onSortear();
    }

    sortearPromiseRef.current
      .then((rifaAtualizada) => {
        const remaining = Math.max(0, MIN_DURATION_MS - (Date.now() - startedAt));
        setTimeout(() => {
          if (cancelled) return;
          clearInterval(intervalId);
          setDisplay(rifaAtualizada.numero_sorteado);
          setResultado(rifaAtualizada);
          setPhase('revelado');
        }, remaining);
      })
      .catch((err) => {
        if (cancelled) return;
        clearInterval(intervalId);
        setErro(err instanceof ApiError ? err.message : 'Nao foi possivel sortear.');
        setPhase('erro');
      });

    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- roda so uma vez, ao abrir o modal
  }, []);

  return (
    <div className="rifa-sorteio-overlay">
      <div className="rifa-sorteio-modal">
        {phase === 'girando' ? (
          <>
            <p className="rifa-sorteio-label">Sorteando...</p>
            <div className="rifa-sorteio-numero rifa-sorteio-girando">{display ?? '--'}</div>
          </>
        ) : phase === 'revelado' ? (
          <>
            <Trophy size={36} className="rifa-sorteio-trophy" />
            <p className="rifa-sorteio-label">Numero vencedor</p>
            <div className="rifa-sorteio-numero rifa-sorteio-final">{resultado?.numero_sorteado}</div>
            {resultado?.vencedor_nome ? <p className="rifa-sorteio-vencedor">{resultado.vencedor_nome}</p> : null}
            <div className="rifa-sorteio-actions">
              {resultado?.vencedor_whatsapp ? (
                <a
                  className="mold-secondary-button"
                  href={`https://wa.me/${resultado.vencedor_whatsapp.replace(/\D/g, '')}?text=${encodeURIComponent(
                    `Parabens! Voce ganhou o numero ${resultado.numero_sorteado} da rifa "${resultado.nome}"!`
                  )}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Falar com o cliente
                </a>
              ) : null}
              <button type="button" className="mold-save-button" onClick={onClose}>
                Fechar
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="mold-import-error">{erro}</p>
            <button type="button" className="mold-secondary-button" onClick={onClose}>
              Fechar
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function RifaDetailView({ rifaId, onBack }: { rifaId: number; onBack: () => void }) {
  const { token } = useAuth();
  const [rifa, setRifa] = useState<RifaDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [showSorteio, setShowSorteio] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [search, setSearch] = useState('');

  const [selecionados, setSelecionados] = useState<Set<number>>(new Set());
  const [manualDigits, setManualDigits] = useState('');
  const [vendaNome, setVendaNome] = useState('');
  const [vendaWhatsapp, setVendaWhatsapp] = useState('');
  const [vendaJaPago, setVendaJaPago] = useState(true);
  const [vendaSaving, setVendaSaving] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const response = await api.getRifa(rifaId, token);
      setRifa(response.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Nao foi possivel carregar a rifa.');
    } finally {
      setLoading(false);
    }
  }, [rifaId, token]);

  useEffect(() => {
    void load();
  }, [load]);

  const numeroToComprador = useMemo(() => {
    const map = new Map<number, RifaCompradorDetail>();
    if (!rifa) return map;
    for (const c of rifa.compradores) {
      for (const n of c.numeros) map.set(n, c);
    }
    return map;
  }, [rifa]);

  const getState = useCallback(
    (n: number): NumeroCellState => {
      const c = numeroToComprador.get(n);
      if (!c) return { status: 'disponivel' };
      if (c.status === 'pago') return { status: 'vendido', label: c.nome };
      return { status: 'reservado', label: c.nome };
    },
    [numeroToComprador]
  );

  const toggleNumero = useCallback((n: number) => {
    setSelecionados((prev) => {
      const next = new Set(prev);
      if (next.has(n)) next.delete(n);
      else next.add(n);
      return next;
    });
  }, []);

  const searchTermDigits = search.replace(/\D/g, '');
  const searchNumero = /^\d+$/.test(search.trim()) ? Number(search.trim()) : null;
  const highlightNumero = searchNumero;

  const filteredCompradores = useMemo(() => {
    if (!rifa) return [];
    const term = search.trim().toLowerCase();
    if (term === '') return rifa.compradores;
    return rifa.compradores.filter((c) => {
      if (c.nome.toLowerCase().includes(term)) return true;
      if (searchTermDigits !== '' && c.whatsapp.replace(/\D/g, '').includes(searchTermDigits)) return true;
      if (searchNumero !== null && c.numeros.includes(searchNumero)) return true;
      return false;
    });
  }, [rifa, search, searchTermDigits, searchNumero]);

  if (loading) {
    return (
      <div className="bandeira-workspace">
        <div className="bandeira-main-panel">
          <Loader2 size={20} className="mold-import-spinner" />
        </div>
      </div>
    );
  }

  if (error || !rifa) {
    return (
      <div className="bandeira-workspace">
        <div className="bandeira-main-panel">
          <p className="mold-import-error">{error}</p>
          <button type="button" className="mold-secondary-button" onClick={onBack}>
            Voltar
          </button>
        </div>
      </div>
    );
  }

  const publicUrl = `${window.location.origin}/rifa/${rifa.slug}`;

  const handleConfirmar = async (comprador: RifaCompradorDetail) => {
    if (!token) return;
    setActionError(null);
    try {
      await api.confirmarPagamentoManual(rifa.id, comprador.id, token);
      void load();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Nao foi possivel confirmar.');
    }
  };

  const handleRecusar = async (comprador: RifaCompradorDetail) => {
    if (!token) return;
    setActionError(null);
    try {
      await api.recusarPagamento(rifa.id, comprador.id, token);
      void load();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Nao foi possivel recusar.');
    }
  };

  const handleDeleteRifa = async () => {
    if (!token) return;
    if (!window.confirm(`Excluir a rifa "${rifa.nome}" para sempre? Isso apaga todos os numeros e compradores dela.`)) {
      return;
    }
    setDeleting(true);
    setActionError(null);
    try {
      await api.deleteRifa(rifa.id, token);
      onBack();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Nao foi possivel excluir.');
      setDeleting(false);
    }
  };

  const handleAddManualDigits = () => {
    const numeros = manualDigits
      .split(',')
      .map((n) => Number(n.trim()))
      .filter((n) => Number.isFinite(n) && n > 0 && !numeroToComprador.has(n));
    setSelecionados((prev) => new Set([...prev, ...numeros]));
    setManualDigits('');
  };

  const handleVendaManual = async () => {
    if (!token) return;
    setActionError(null);
    const numeros = [...selecionados];

    if (vendaNome.trim() === '' || vendaWhatsapp.trim() === '' || numeros.length === 0) {
      setActionError('Preencha nome, whatsapp e selecione pelo menos 1 numero na grade.');
      return;
    }

    setVendaSaving(true);
    try {
      await api.criarVendaManual(
        rifa.id,
        { nome: vendaNome.trim(), whatsapp: vendaWhatsapp.trim(), numeros, ja_pago: vendaJaPago },
        token
      );
      setVendaNome('');
      setVendaWhatsapp('');
      setSelecionados(new Set());
      void load();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Nao foi possivel registrar a venda.');
    } finally {
      setVendaSaving(false);
    }
  };

  return (
    <div className="bandeira-workspace">
      <div className="bandeira-main-panel">
        <div className="bandeira-panel-header rifa-detail-header">
          <div>
            <button type="button" className="mold-secondary-button" onClick={onBack}>
              Voltar
            </button>
            <h2>{rifa.nome}</h2>
            {rifa.modo_termino === 'data' ? <p>Termina em {formatDataHora(rifa.data_termino)}</p> : null}
          </div>
          <button type="button" className="mold-secondary-button rifa-recusar-button" onClick={() => void handleDeleteRifa()} disabled={deleting}>
            {deleting ? <Loader2 size={16} className="mold-import-spinner" /> : <Trash2 size={16} />}
            Excluir rifa
          </button>
        </div>

        <div className="rifa-link-row">
          <input type="text" readOnly value={publicUrl} onFocus={(e) => e.currentTarget.select()} />
          <button
            type="button"
            className="mold-secondary-button"
            onClick={() => {
              void navigator.clipboard.writeText(publicUrl);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            }}
          >
            {copied ? <Check size={16} /> : <Copy size={16} />}
            {copied ? 'Copiado' : 'Copiar link'}
          </button>
        </div>

        <div className="rifa-stats-row">
          <div className="rifa-stat-box">
            <span>Disponiveis</span>
            <strong>{rifa.disponiveis}</strong>
          </div>
          <div className="rifa-stat-box">
            <span>Reservados</span>
            <strong>{rifa.reservados}</strong>
          </div>
          <div className="rifa-stat-box rifa-stat-box-success">
            <span>Vendidos</span>
            <strong>{rifa.vendidos}</strong>
          </div>
          <div className="rifa-stat-box">
            <span>Progresso</span>
            <strong>{rifa.percentual_vendido}%</strong>
          </div>
          <div className="rifa-stat-box rifa-stat-box-success">
            <span>Arrecadado</span>
            <strong>{formatMoeda(rifa.valor_arrecadado ?? 0)}</strong>
          </div>
        </div>
        <div className="rifa-public-progress">
          <div className="rifa-public-progress-fill" style={{ width: `${rifa.percentual_vendido}%` }} />
        </div>

        {rifa.numero_sorteado !== null ? (
          <p className="rifa-public-winner">
            <Trophy size={16} /> Numero sorteado: {rifa.numero_sorteado}
            {rifa.vencedor_nome ? ` — ${rifa.vencedor_nome}` : ''}
            {rifa.vencedor_whatsapp ? (
              <a
                className="rifa-vencedor-contato-link"
                href={`https://wa.me/${rifa.vencedor_whatsapp.replace(/\D/g, '')}?text=${encodeURIComponent(
                  `Parabens! Voce ganhou o numero ${rifa.numero_sorteado} da rifa "${rifa.nome}"!`
                )}`}
                target="_blank"
                rel="noreferrer"
              >
                Falar com o cliente
              </a>
            ) : null}
          </p>
        ) : rifa.modo_sorteio === 'sistema' && rifa.status === 'ativa' ? (
          <button type="button" className="mold-save-button" onClick={() => setShowSorteio(true)} disabled={rifa.vendidos === 0}>
            <Trophy size={16} />
            Sortear vencedor agora
          </button>
        ) : null}

        {showSorteio ? (
          <SorteioModal
            numerosVendidos={[...numeroToComprador.entries()].filter(([, c]) => c.status === 'pago').map(([n]) => n)}
            onSortear={async () => {
              if (!token) throw new Error('sem token');
              const response = await api.sortear(rifa.id, token);
              return response.data;
            }}
            onClose={() => {
              setShowSorteio(false);
              void load();
            }}
          />
        ) : null}

        {actionError ? <p className="mold-import-error">{actionError}</p> : null}

        {rifa.modo_sorteio !== 'caixa_federal' ? (
          <PromocoesManager rifaId={rifa.id} promocoes={rifa.promocoes} onChange={() => void load()} />
        ) : null}

        <h3>Controle de vendas</h3>
        <label className="rifa-search-row">
          <Search size={16} />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por numero ou nome do comprador..."
          />
          {search ? (
            <button type="button" onClick={() => setSearch('')}>
              <X size={14} />
            </button>
          ) : null}
        </label>

        <NumeroGrid
          total={rifa.quantidade_numeros}
          getState={getState}
          selecionados={selecionados}
          onToggle={toggleNumero}
          highlightNumero={highlightNumero}
        />

        <div className="rifa-legend">
          <span>
            <i className="rifa-legend-dot rifa-numero-disponivel" /> Disponivel
          </span>
          <span>
            <i className="rifa-legend-dot rifa-numero-reservado" /> Reservado
          </span>
          <span>
            <i className="rifa-legend-dot rifa-numero-vendido" /> Vendido
          </span>
        </div>

        <div className="bandeira-create-panel">
          <h4>Registrar venda manual</h4>
          <p className="bandeira-size-hint">Clique nos numeros disponiveis na grade acima, ou digite abaixo.</p>

          <div className="rifa-manual-add-row">
            <input
              type="text"
              value={manualDigits}
              onChange={(e) => setManualDigits(e.target.value)}
              placeholder="Ex: 4, 7, 12"
            />
            <button type="button" className="mold-secondary-button" onClick={handleAddManualDigits}>
              Adicionar
            </button>
          </div>

          {selecionados.size > 0 ? (
            <div className="rifa-selecionados-chips">
              {[...selecionados]
                .sort((a, b) => a - b)
                .map((n) => (
                  <span key={n} className="rifa-chip">
                    {n}
                    <button type="button" onClick={() => toggleNumero(n)}>
                      <X size={12} />
                    </button>
                  </span>
                ))}
              <button type="button" className="rifa-chip-clear" onClick={() => setSelecionados(new Set())}>
                Limpar tudo
              </button>
            </div>
          ) : (
            <p className="bandeira-size-hint">Nenhum numero selecionado ainda.</p>
          )}

          <div className="bandeira-size-fields">
            <label className="auth-field">
              <span>Nome do comprador</span>
              <input type="text" value={vendaNome} onChange={(e) => setVendaNome(e.target.value)} />
            </label>
            <label className="auth-field">
              <span>Whatsapp</span>
              <input type="text" value={vendaWhatsapp} onChange={(e) => setVendaWhatsapp(e.target.value)} />
            </label>
          </div>
          <label className="rifa-checkbox-row">
            <input type="checkbox" checked={vendaJaPago} onChange={(e) => setVendaJaPago(e.target.checked)} />
            <span>Ja recebi o pagamento (marca como vendido na hora)</span>
          </label>
          <button type="button" className="mold-save-button" onClick={() => void handleVendaManual()} disabled={vendaSaving}>
            {vendaSaving ? <Loader2 size={16} className="mold-import-spinner" /> : null}
            Registrar venda ({selecionados.size} numero{selecionados.size === 1 ? '' : 's'})
          </button>
        </div>

        <h3>Compradores ({filteredCompradores.length})</h3>
        {filteredCompradores.length === 0 ? (
          <p className="bandeira-size-hint">Ninguem encontrado.</p>
        ) : (
          <div className="table-scroll">
            <table className="rifa-compradores-table">
              <thead>
                <tr>
                  <th>Nome</th>
                  <th>Whatsapp</th>
                  <th>Numeros</th>
                  <th>Valor</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filteredCompradores.map((c) => (
                  <tr key={c.id}>
                    <td>{c.nome}</td>
                    <td>{c.whatsapp}</td>
                    <td className="rifa-compradores-numeros">{c.numeros.join(', ') || '-'}</td>
                    <td>{formatMoeda(c.valor_total)}</td>
                    <td>{COMPRADOR_STATUS_LABEL[c.status] ?? c.status}</td>
                    <td className="rifa-compradores-actions">
                      {c.status === 'aguardando_pagamento' ? (
                        <>
                          <button type="button" className="mold-secondary-button" onClick={() => void handleConfirmar(c)}>
                            Confirmar pagamento
                          </button>
                          <button type="button" className="mold-secondary-button rifa-recusar-button" onClick={() => void handleRecusar(c)}>
                            Pagamento nao confirmado
                          </button>
                        </>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
