import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Copy, Loader2, PlayCircle, QrCode, X, KeyRound, MessageCircle, CreditCard } from 'lucide-react';
import { api, ApiError } from '../lib/api';
import { TacoChatWizard } from '../components/TacoChatWizard';
import { MercadoPagoCardForm } from '../components/MercadoPagoCardForm';
import type { SolicitacaoConfigPublic, SolicitacaoPedido } from '../types';

const POLL_MS = 4000;
const PEDIDO_STORAGE_KEY = 'solicitacao_molde_pedido_v1';
const TACOS_STORAGE_PREFIX = 'solicitacao_molde_tacos_';

// Catálogo de modelos (mesmo /data.json e categorias da aba "Escala do Molde").
const MODEL_OPTIONS = [
  'Modelado', 'Truff', 'Piao', 'Bagda', 'Lapidado', 'Careca', 'Hally',
  'Pingolbag', 'Golfier', 'Barrica', 'Tangerina', 'Magico', 'Outros',
];

const CATEGORY_RULES: [string, RegExp][] = [
  ['Corte Recto', /corte.?ret[oa]/i],
  ['Tangerina', /tangerin/i],
  ['Barrica', /barrica/i],
  ['Hally', /hally/i],
  ['Lapidado', /lapidado/i],
  ['Pigolbag', /pi[gn]ol?bag|pigobald|piglbag/i],
  ['Golfier', /golfier/i],
  ['Careca', /careca/i],
  ['Bagda', /bagda/i],
  ['Truffy', /truff/i],
  ['Piao', /piao/i],
  ['Magico', /magico/i],
  ['Modelado', /modelado/i],
];

function categorize(key: string): string {
  for (const [name, re] of CATEGORY_RULES) {
    if (re.test(key)) {
      if (name === 'Truffy') return 'Truff';
      if (name === 'Pigolbag') return 'Pingolbag';
      if (name === 'Corte Recto') return 'Outros';
      return name;
    }
  }
  return 'Outros';
}

interface CatalogModelo {
  key: string;
  name: string;
  categoria: string;
}

function formatMoeda(v: number): string {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

/** Converte um link do YouTube em URL de embed. */
function youtubeEmbed(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/)([A-Za-z0-9_-]{6,})/,
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m) return `https://www.youtube.com/embed/${m[1]}`;
  }
  return null;
}

type Step = 'dados' | 'pagamento' | 'pago';

export function SolicitarMoldePublicPage() {
  const [config, setConfig] = useState<SolicitacaoConfigPublic | null>(null);
  const [loadingCfg, setLoadingCfg] = useState(true);
  const [cfgError, setCfgError] = useState<string | null>(null);

  const [step, setStep] = useState<Step>('dados');
  const [showVideo, setShowVideo] = useState(false);
  const [videoPos, setVideoPos] = useState({ x: 40, y: 90 });
  const dragRef = useRef<{ ox: number; oy: number } | null>(null);

  const openVideo = () => {
    // abre a janela flutuante perto do topo-direito
    const w = typeof window !== 'undefined' ? window.innerWidth : 1000;
    setVideoPos({ x: Math.max(12, w - 420), y: 80 });
    setShowVideo(true);
  };

  const startVideoDrag = (e: React.MouseEvent) => {
    dragRef.current = { ox: e.clientX - videoPos.x, oy: e.clientY - videoPos.y };
    const move = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      setVideoPos({ x: ev.clientX - dragRef.current.ox, y: ev.clientY - dragRef.current.oy });
    };
    const up = () => {
      dragRef.current = null;
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };
  const [showRecuperar, setShowRecuperar] = useState(false);

  // Catálogo de modelos (/data.json)
  const [catalogo, setCatalogo] = useState<CatalogModelo[]>([]);
  const [catLoading, setCatLoading] = useState(true);

  // Formulário
  const [categoria, setCategoria] = useState('Modelado');
  const [modeloKey, setModeloKey] = useState('');
  const [tamanho, setTamanho] = useState('300');
  const [gomos, setGomos] = useState('');
  const [bainha, setBainha] = useState('');
  const [email, setEmail] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [criando, setCriando] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Pedido / pagamento
  const [pedido, setPedido] = useState<SolicitacaoPedido | null>(null);
  const [pixCopiado, setPixCopiado] = useState(false);
  const [cardOpen, setCardOpen] = useState(false);

  // Recuperação por chave
  const [chaveInput, setChaveInput] = useState('');
  const [recuperando, setRecuperando] = useState(false);
  const [recError, setRecError] = useState<string | null>(null);

  const pollRef = useRef<number | null>(null);

  useEffect(() => {
    api
      .solicitacaoConfig()
      .then((r) => setConfig(r.data))
      .catch((e) => setCfgError(e instanceof ApiError ? e.message : 'Não foi possível carregar.'))
      .finally(() => setLoadingCfg(false));
  }, []);

  // Restaura o pedido salvo (se o cliente atualizar a página, continua de onde
  // parou). Revalida o status no servidor.
  useEffect(() => {
    const saved = localStorage.getItem(PEDIDO_STORAGE_KEY);
    if (!saved) return;
    try {
      const p: SolicitacaoPedido = JSON.parse(saved);
      setPedido(p);
      setStep(p.status === 'aguardando_pagamento' ? 'pagamento' : 'pago');
      // atualiza do servidor em segundo plano
      api.solicitacaoStatus(p.id, p.public_token)
        .then((r) => {
          setPedido(r.data);
          setStep(r.data.status === 'aguardando_pagamento' ? 'pagamento' : 'pago');
        })
        .catch(() => {
          // pedido pode ter sido removido — limpa
          localStorage.removeItem(PEDIDO_STORAGE_KEY);
        });
    } catch {
      localStorage.removeItem(PEDIDO_STORAGE_KEY);
    }
  }, []);

  // Persiste o pedido a cada mudança (pra sobreviver ao refresh).
  useEffect(() => {
    if (pedido) localStorage.setItem(PEDIDO_STORAGE_KEY, JSON.stringify(pedido));
  }, [pedido]);

  const novoPedido = () => {
    if (pedido) localStorage.removeItem(`${TACOS_STORAGE_PREFIX}${pedido.id}`);
    localStorage.removeItem(PEDIDO_STORAGE_KEY);
    setPedido(null);
    setStep('dados');
  };

  // Trocar modelo/gomos/bainha depois de pago (tamanho e e-mail ficam travados).
  const [showTrocar, setShowTrocar] = useState(false);
  const [trocarCat, setTrocarCat] = useState('Modelado');
  const [trocarKey, setTrocarKey] = useState('');
  const [trocarGomos, setTrocarGomos] = useState('');
  const [trocarBainha, setTrocarBainha] = useState('');
  const [trocarBusy, setTrocarBusy] = useState(false);
  const [trocarErr, setTrocarErr] = useState<string | null>(null);

  const abrirTrocar = () => {
    if (!pedido) return;
    setTrocarCat(pedido.categoria ?? 'Modelado');
    setTrocarKey(pedido.modelo_key ?? '');
    setTrocarGomos(String(pedido.gomos));
    setTrocarBainha(String(pedido.bainha_cm));
    setTrocarErr(null);
    setShowTrocar(true);
  };

  const salvarTrocar = async () => {
    if (!pedido) return;
    const modelo = catalogo.find((m) => m.key === trocarKey);
    if (!modelo) { setTrocarErr('Escolha um modelo.'); return; }
    if ((Number(trocarGomos) || 0) < 1) { setTrocarErr('Informe os gomos.'); return; }
    if (trocarBainha.trim() === '' || isNaN(Number(trocarBainha)) || Number(trocarBainha) < 0) { setTrocarErr('Informe a bainha.'); return; }
    setTrocarBusy(true);
    setTrocarErr(null);
    try {
      const r = await api.solicitacaoAtualizarDados(pedido.id, pedido.public_token, {
        modelo_key: modelo.key,
        categoria: modelo.categoria,
        modelo_nome: modelo.name,
        gomos: Number(trocarGomos),
        bainha_cm: Number(trocarBainha),
      });
      setPedido(r.data);
      setShowTrocar(false);
    } catch (err) {
      setTrocarErr(err instanceof ApiError ? err.message : 'Não foi possível salvar.');
    } finally {
      setTrocarBusy(false);
    }
  };

  const trocarModelos = catalogo.filter((m) => m.categoria === trocarCat);

  // Chave-cortesia: o pedido veio pago mas SEM molde definido (tamanho_cm === 0).
  // O cliente escolhe modelo/tamanho/gomos/bainha aqui antes de ir pro chat.
  const isCortesia = !!pedido && pedido.status !== 'entregue' && Number(pedido.tamanho_cm) <= 0;
  const [cortCat, setCortCat] = useState('Modelado');
  const [cortKey, setCortKey] = useState('');
  const [cortTamanho, setCortTamanho] = useState('300');
  const [cortGomos, setCortGomos] = useState('');
  const [cortBainha, setCortBainha] = useState('');
  const [cortBusy, setCortBusy] = useState(false);
  const [cortErr, setCortErr] = useState<string | null>(null);
  const cortModelos = catalogo.filter((m) => m.categoria === cortCat);

  const definirDadosCortesia = async () => {
    if (!pedido) return;
    const modelo = catalogo.find((m) => m.key === cortKey);
    if (!modelo) { setCortErr('Escolha um modelo.'); return; }
    if ((Number(cortTamanho) || 0) < 1) { setCortErr('Informe o tamanho (cm).'); return; }
    if ((Number(cortGomos) || 0) < 1) { setCortErr('Informe os gomos.'); return; }
    if (cortBainha.trim() === '' || isNaN(Number(cortBainha)) || Number(cortBainha) < 0) { setCortErr('Informe a bainha.'); return; }
    setCortBusy(true);
    setCortErr(null);
    try {
      const r = await api.solicitacaoDefinirDados(pedido.id, pedido.public_token, {
        modelo_key: modelo.key,
        categoria: modelo.categoria,
        modelo_nome: modelo.name,
        tamanho_cm: Number(cortTamanho),
        gomos: Number(cortGomos),
        bainha_cm: Number(cortBainha),
      });
      setPedido(r.data);
    } catch (err) {
      setCortErr(err instanceof ApiError ? err.message : 'Não foi possível salvar.');
    } finally {
      setCortBusy(false);
    }
  };

  // Carrega o catálogo de modelos (mesmo arquivo da aba Escala do Molde).
  useEffect(() => {
    fetch('/data.json')
      .then((r) => r.json())
      .then((data: Record<string, { name?: string }>) => {
        const list: CatalogModelo[] = Object.keys(data)
          .map((key) => ({ key, name: data[key]?.name || key, categoria: categorize(key) }))
          .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
        setCatalogo(list);
      })
      .catch(() => setCatalogo([]))
      .finally(() => setCatLoading(false));
  }, []);

  const modelosDaCategoria = catalogo.filter((m) => m.categoria === categoria);

  const valorMetro = config?.valor_metro ?? 0;
  const tamanhoNum = Number(tamanho) || 0;
  const valorEstimado = tamanhoNum > 0 && valorMetro > 0
    ? Math.max(0.5, Math.round((tamanhoNum / 100) * valorMetro * 100) / 100)
    : 0;

  /** Valida os campos do pedido. Retorna o modelo escolhido, ou null se inválido. */
  const validarDados = (): { key: string; name: string; categoria: string } | null => {
    const errs: Record<string, string> = {};
    const modelo = catalogo.find((m) => m.key === modeloKey) ?? null;
    if (!modelo) errs.modelo_key = 'Escolha um modelo.';
    if (tamanhoNum < 1) errs.tamanho_cm = 'Informe o tamanho (cm).';
    if ((Number(gomos) || 0) < 1) errs.gomos = 'Informe os gomos.';
    if (bainha.trim() === '' || isNaN(Number(bainha)) || Number(bainha) < 0) errs.bainha_cm = 'Informe a bainha.';
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) errs.email = 'E-mail inválido.';
    setFieldErrors(errs);
    return Object.keys(errs).length ? null : modelo;
  };

  const abrirCartao = () => {
    setFormError(null);
    if (validarDados()) setCardOpen(true);
  };

  const cobrarCartao = async (card: {
    token: string; payment_method_id: string; installments: number; issuer_id: number | null; device_id: string | null; identification: { type: string; number: string };
  }) => {
    const modelo = validarDados();
    if (!modelo) throw new Error('Verifique os dados do pedido.');
    const r = await api.solicitacaoCriarCartao({
      modelo_key: modelo.key,
      categoria: modelo.categoria,
      modelo_nome: modelo.name,
      tamanho_cm: tamanhoNum,
      gomos: Number(gomos),
      bainha_cm: Number(bainha) || 0,
      email: email.trim().toLowerCase(),
      ...card,
    });
    setPedido(r.data);
    setCardOpen(false);
    setStep(r.data.status === 'aguardando_pagamento' ? 'pagamento' : 'pago');
  };

  const handleGerar = async () => {
    setFieldErrors({});
    setFormError(null);
    const modelo = validarDados();
    if (!modelo) return;

    setCriando(true);
    try {
      const r = await api.solicitacaoCriar({
        modelo_key: modelo.key,
        categoria: modelo.categoria,
        modelo_nome: modelo.name,
        tamanho_cm: tamanhoNum,
        gomos: Number(gomos),
        bainha_cm: Number(bainha) || 0,
        email: email.trim().toLowerCase(),
      });
      setPedido(r.data);
      setStep('pagamento');
    } catch (err) {
      if (err instanceof ApiError && err.errors) setFieldErrors(err.errors);
      setFormError(err instanceof ApiError ? err.message : 'Não foi possível gerar o pagamento.');
    } finally {
      setCriando(false);
    }
  };

  // Poll do pagamento.
  useEffect(() => {
    if (step !== 'pagamento' || !pedido || pedido.status !== 'aguardando_pagamento') return;
    const tick = async () => {
      try {
        const r = await api.solicitacaoStatus(pedido.id, pedido.public_token);
        setPedido(r.data);
        if (r.data.status !== 'aguardando_pagamento') {
          setStep('pago');
        }
      } catch {
        // tenta de novo no próximo tick
      }
    };
    pollRef.current = window.setInterval(() => void tick(), POLL_MS);
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
    };
  }, [step, pedido]);

  const handleSimular = useCallback(async () => {
    if (!pedido) return;
    try {
      const r = await api.solicitacaoSimularPago(pedido.id, pedido.public_token);
      setPedido(r.data);
      setStep('pago');
    } catch (err) {
      alert(err instanceof ApiError ? err.message : 'Falha ao simular.');
    }
  }, [pedido]);

  const [cancelando, setCancelando] = useState(false);
  const handleCancelar = useCallback(async () => {
    if (!pedido) return;
    if (!window.confirm('Cancelar este pagamento? O pedido será descartado.')) return;
    setCancelando(true);
    try {
      await api.solicitacaoCancelar(pedido.id, pedido.public_token);
    } catch {
      // mesmo se falhar no servidor, limpa localmente
    } finally {
      setCancelando(false);
      novoPedido();
    }
  }, [pedido]);

  const handleRecuperar = useCallback(async () => {
    const chave = chaveInput.trim().toUpperCase();
    if (chave === '') {
      setRecError('Digite a chave.');
      return;
    }
    setRecuperando(true);
    setRecError(null);
    try {
      const r = await api.solicitacaoRecuperar(chave);
      setPedido(r.data);
      setStep('pago');
      setShowRecuperar(false);
    } catch (err) {
      setRecError(err instanceof ApiError ? err.message : 'Chave inválida.');
    } finally {
      setRecuperando(false);
    }
  }, [chaveInput]);

  const embed = config?.video_url ? youtubeEmbed(config.video_url) : null;

  const card: React.CSSProperties = {
    background: '#111622',
    border: '1px solid #1f293d',
    borderRadius: '14px',
    padding: '22px',
  };
  const inp: React.CSSProperties = {
    width: '100%',
    padding: '11px 12px',
    background: '#0b0f18',
    border: '1px solid #2d3748',
    borderRadius: '8px',
    color: '#fff',
    fontSize: '14px',
    outline: 'none',
    boxSizing: 'border-box',
  };

  return (
    <div className="solicitar-molde-bg" style={{ minHeight: '100vh', color: '#e6edf5', padding: '24px 16px' }}>
      <div style={{ maxWidth: '560px', margin: '0 auto', position: 'relative', zIndex: 1 }}>
        <div style={{ textAlign: 'center', marginBottom: '20px' }}>
          <h1 className="solicitar-brand" style={{ margin: 0, fontSize: '30px', fontWeight: 800, letterSpacing: '-0.5px' }}>
            ALISSON <span style={{ fontWeight: 400 }}>PROJETOS</span>
          </h1>
          <div style={{ height: '3px', width: '80px', margin: '8px auto 0', borderRadius: '3px', background: 'linear-gradient(90deg,#4299e1,#9f7aea)' }} />
          <p style={{ color: '#e2e8f0', fontSize: '15px', fontWeight: 600, margin: '12px 0 0' }}>
            Molde taqueado sob encomenda — na mesma hora, rápido e prático! 🚀
          </p>
          <p style={{ color: '#a0aec0', fontSize: '13px', margin: '4px 0 0' }}>
            Escolha o modelo, informe as medidas e receba por e-mail.
          </p>

          {/* Chamada da IA */}
          <div style={{ marginTop: '14px', padding: '12px 14px', borderRadius: '12px', background: 'linear-gradient(135deg, rgba(66,153,225,0.18), rgba(159,122,234,0.18))', border: '1px solid rgba(120,150,230,0.4)', display: 'flex', alignItems: 'center', gap: '10px', textAlign: 'left' }}>
            <span style={{ fontSize: '22px', flexShrink: 0 }}>🤖</span>
            <span style={{ color: '#e2e8f0', fontSize: '13.5px', lineHeight: 1.45 }}>
              Converse com a nossa <strong>Inteligência Artificial</strong> — ela faz todo o trabalho para criar seu
              arquivo <strong>sob medida</strong>, bem rápido!
            </span>
          </div>
        </div>

        {loadingCfg ? (
          <p style={{ textAlign: 'center', color: '#a0aec0' }}>
            <Loader2 size={20} className="mold-import-spinner" style={{ marginRight: '8px' }} /> Carregando...
          </p>
        ) : cfgError ? (
          <p className="mold-import-error" style={{ textAlign: 'center' }}>{cfgError}</p>
        ) : config ? (
          <>
            {/* Botão recuperar por chave (some quando a feature está desligada) */}
            {step === 'dados' && config.ativo !== false && (
              <div style={{ marginBottom: '16px' }}>
                <button type="button" onClick={() => setShowRecuperar(true)} style={{ width: '100%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '8px', background: '#1a202c', color: '#cbd5e0', border: '1px solid #2d3748', borderRadius: '10px', padding: '12px', fontSize: '14px', fontWeight: 600, cursor: 'pointer' }}>
                  <KeyRound size={16} /> Já paguei / tenho uma chave
                </button>
              </div>
            )}

            {/* Feature desligada pelo admin: bloqueia novos pedidos (mas quem já
                tem chave ainda consegue retomar pelo botão acima). */}
            {step === 'dados' && config.ativo === false && (
              <div style={{ ...card, textAlign: 'center' }}>
                <div style={{ fontSize: '34px', marginBottom: '6px' }}>🛠️</div>
                <h3 style={{ color: '#f7fafc', margin: '0 0 6px' }}>Solicitação de molde indisponível no momento</h3>
                <p style={{ color: '#a0aec0', fontSize: '14px', margin: 0 }}>
                  Estamos ajustando alguns detalhes. Volte em breve — ou fale com o suporte abaixo.
                </p>
              </div>
            )}

            {/* PASSO 1: dados */}
            {step === 'dados' && config.ativo !== false && (
              <div style={card}>
                {catLoading ? (
                  <p style={{ color: '#a0aec0', fontSize: '14px', margin: 0 }}>
                    <Loader2 size={16} className="mold-import-spinner" style={{ marginRight: '8px' }} /> Carregando modelos...
                  </p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                    <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                      <div style={{ flex: '1 1 160px' }}>
                        <label style={{ display: 'block', color: '#cbd5e0', fontSize: '13px', marginBottom: '6px', fontWeight: 600 }}>Categoria</label>
                        <select style={inp} value={categoria} onChange={(e) => { setCategoria(e.target.value); setModeloKey(''); }}>
                          {MODEL_OPTIONS.map((c) => (
                            <option key={c} value={c}>{c}</option>
                          ))}
                        </select>
                      </div>
                      <div style={{ flex: '2 1 220px' }}>
                        <label style={{ display: 'block', color: '#cbd5e0', fontSize: '13px', marginBottom: '6px', fontWeight: 600 }}>Nome do molde</label>
                        <select style={inp} value={modeloKey} onChange={(e) => setModeloKey(e.target.value)}>
                          <option value="">-- Selecione o molde --</option>
                          {modelosDaCategoria.map((m) => (
                            <option key={m.key} value={m.key}>{m.name}</option>
                          ))}
                        </select>
                        {fieldErrors.modelo_key && <small style={{ color: '#fc8181' }}>{fieldErrors.modelo_key}</small>}
                      </div>
                    </div>

                    <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                      <div style={{ flex: '1 1 140px' }}>
                        <label style={{ display: 'block', color: '#cbd5e0', fontSize: '13px', marginBottom: '6px', fontWeight: 600 }}>Tamanho do molde (cm)</label>
                        <input type="number" min={1} style={inp} value={tamanho} onChange={(e) => setTamanho(e.target.value)} placeholder="ex: 1000" />
                        {fieldErrors.tamanho_cm && <small style={{ color: '#fc8181' }}>{fieldErrors.tamanho_cm}</small>}
                      </div>
                      <div style={{ flex: '1 1 100px' }}>
                        <label style={{ display: 'block', color: '#cbd5e0', fontSize: '13px', marginBottom: '6px', fontWeight: 600 }}>Gomos</label>
                        <input type="number" min={1} style={inp} value={gomos} onChange={(e) => setGomos(e.target.value)} />
                        {fieldErrors.gomos && <small style={{ color: '#fc8181' }}>{fieldErrors.gomos}</small>}
                      </div>
                      <div style={{ flex: '1 1 100px' }}>
                        <label style={{ display: 'block', color: '#cbd5e0', fontSize: '13px', marginBottom: '6px', fontWeight: 600 }}>Bainha (cm)</label>
                        <input type="number" min={0} step="0.1" style={inp} value={bainha} onChange={(e) => setBainha(e.target.value)} placeholder="ex: 1" />
                        {fieldErrors.bainha_cm && <small style={{ color: '#fc8181' }}>{fieldErrors.bainha_cm}</small>}
                      </div>
                    </div>

                    <div>
                      <label style={{ display: 'block', color: '#cbd5e0', fontSize: '13px', marginBottom: '6px', fontWeight: 600 }}>Seu e-mail</label>
                      <input type="email" style={inp} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="voce@email.com" />
                      {fieldErrors.email && <small style={{ color: '#fc8181' }}>{fieldErrors.email}</small>}
                    </div>

                    {/* Preço */}
                    <div style={{ background: '#0b0f18', border: '1px solid #23304d', borderRadius: '10px', padding: '14px', textAlign: 'center' }}>
                      <span style={{ color: '#a0aec0', fontSize: '13px' }}>Valor do molde</span>
                      <div style={{ color: '#48bb78', fontSize: '26px', fontWeight: 700 }}>
                        {valorEstimado > 0 ? formatMoeda(valorEstimado) : '—'}
                      </div>
                      {valorMetro > 0 && (
                        <span style={{ color: '#718096', fontSize: '12px' }}>{formatMoeda(valorMetro)}/metro · {tamanhoNum > 0 ? `${(tamanhoNum / 100).toLocaleString('pt-BR')} m` : 'informe o tamanho'}</span>
                      )}
                    </div>

                    {formError && <p className="mold-import-error" style={{ margin: 0 }}>{formError}</p>}

                    {cardOpen && config.mp_public_key ? (
                      <div>
                        <MercadoPagoCardForm
                          publicKey={config.mp_public_key}
                          planoId={0}
                          valor={valorEstimado}
                          authToken=""
                          onCharge={cobrarCartao}
                          onSuccess={() => {}}
                          onCancel={() => setCardOpen(false)}
                        />
                      </div>
                    ) : (
                      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                        <button type="button" onClick={() => void handleGerar()} disabled={criando} style={{ flex: '1 1 180px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '8px', background: '#3182ce', color: '#fff', border: 'none', borderRadius: '10px', padding: '13px', fontSize: '15px', fontWeight: 700, cursor: criando ? 'default' : 'pointer' }}>
                          {criando ? <Loader2 size={16} className="mold-import-spinner" /> : <QrCode size={18} />}
                          Pagar com Pix
                        </button>
                        {config.mp_public_key && (
                          <button type="button" onClick={abrirCartao} disabled={criando} style={{ flex: '1 1 180px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '8px', background: '#1a202c', color: '#cbd5e0', border: '1px solid #2d3748', borderRadius: '10px', padding: '13px', fontSize: '15px', fontWeight: 700, cursor: 'pointer' }}>
                            <CreditCard size={18} /> Pagar com Cartão
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* PASSO 2: pagamento Pix */}
            {step === 'pagamento' && pedido && (
              <div style={{ ...card, textAlign: 'center' }}>
                <h3 style={{ color: '#f7fafc', margin: '0 0 6px' }}>Pague {formatMoeda(pedido.valor)} via Pix</h3>
                <p style={{ color: '#a0aec0', fontSize: '13px', margin: '0 0 14px' }}>Modelo: {pedido.modelo_nome}</p>
                {pedido.qr_code_base64 ? (
                  <img src={`data:image/png;base64,${pedido.qr_code_base64}`} alt="QR Code Pix" style={{ width: '220px', maxWidth: '100%', borderRadius: '8px', background: '#fff', padding: '8px' }} />
                ) : (
                  <QrCode size={64} />
                )}
                {pedido.qr_code && (
                  <div style={{ marginTop: '14px' }}>
                    <button type="button" onClick={() => { void navigator.clipboard.writeText(pedido.qr_code ?? ''); setPixCopiado(true); setTimeout(() => setPixCopiado(false), 2000); }} style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', background: '#1a202c', color: '#cbd5e0', border: '1px solid #2d3748', borderRadius: '8px', padding: '10px 16px', fontSize: '14px', cursor: 'pointer' }}>
                      {pixCopiado ? <Check size={16} /> : <Copy size={16} />}
                      {pixCopiado ? 'Copiado!' : 'Copiar código Pix (copia e cola)'}
                    </button>
                  </div>
                )}
                <p style={{ color: '#a0aec0', fontSize: '13px', margin: '16px 0 0' }}>
                  <Loader2 size={14} className="mold-import-spinner" /> Aguardando confirmação do pagamento...
                </p>
                <p style={{ color: '#718096', fontSize: '12px', margin: '10px 0 0' }}>
                  Assim que pagar, enviamos uma <strong>chave</strong> para o seu e-mail. Guarde-a para retomar caso saia da página.
                </p>
                {config.dev_mode && (
                  <button type="button" onClick={() => void handleSimular()} style={{ marginTop: '14px', background: '#805ad5', color: '#fff', border: 'none', borderRadius: '8px', padding: '8px 14px', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}>
                    🧪 Simular pagamento (teste local)
                  </button>
                )}
                <div style={{ marginTop: '16px', borderTop: '1px solid #1f293d', paddingTop: '14px' }}>
                  <button type="button" onClick={() => void handleCancelar()} disabled={cancelando} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', background: 'none', color: '#fc8181', border: '1px solid rgba(252,129,129,0.4)', borderRadius: '8px', padding: '9px 16px', fontSize: '13px', fontWeight: 600, cursor: cancelando ? 'default' : 'pointer' }}>
                    {cancelando ? <Loader2 size={14} className="mold-import-spinner" /> : <X size={15} />}
                    Cancelar pagamento
                  </button>
                </div>
              </div>
            )}

            {/* PASSO 3: pago */}
            {step === 'pago' && pedido && (
              <div style={{ ...card, textAlign: 'center' }}>
                <Check size={40} color="#48bb78" style={{ marginBottom: '8px' }} />
                <h3 style={{ color: '#f7fafc', margin: '0 0 6px' }}>Pagamento confirmado!</h3>
                {pedido.chave_unica && (
                  <div style={{ background: '#0b0f18', border: '1px solid #23304d', borderRadius: '10px', padding: '14px', margin: '14px 0' }}>
                    <span style={{ color: '#a0aec0', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '1px' }}>Sua chave</span>
                    <div style={{ color: '#f7fafc', fontSize: '24px', fontWeight: 700, letterSpacing: '4px' }}>{pedido.chave_unica}</div>
                    <span style={{ color: '#718096', fontSize: '12px' }}>Também enviamos por e-mail. Guarde para retomar.</span>
                  </div>
                )}
                {pedido.status === 'entregue' ? (
                  <div style={{ textAlign: 'left' }}>
                    <div style={{ background: 'rgba(72,187,120,0.1)', border: '1px solid rgba(72,187,120,0.3)', borderRadius: '10px', padding: '16px', color: '#68d391', fontSize: '14px', textAlign: 'center' }}>
                      <strong>Este molde já foi enviado!</strong><br />
                      Enviamos para <strong>{pedido.email}</strong>. Confira seu e-mail (e o spam).
                    </div>
                    <div style={{ background: '#0b0f18', border: '1px solid #23304d', borderRadius: '10px', padding: '14px', marginTop: '12px', fontSize: '13px', color: '#cbd5e0', lineHeight: 1.9 }}>
                      <div style={{ color: '#a0aec0', fontWeight: 600, marginBottom: '4px' }}>Informações do molde</div>
                      <div>Balão: <strong>{pedido.modelo_nome}</strong>{pedido.categoria ? ` (${pedido.categoria})` : ''}</div>
                      <div>Tamanho: <strong>{pedido.tamanho_cm} cm</strong> · Gomos: <strong>{pedido.gomos}</strong> · Bainha: <strong>{pedido.bainha_cm} cm</strong></div>
                      <div>Valor pago: <strong>{formatMoeda(pedido.valor)}</strong></div>
                    </div>
                    <button type="button" onClick={novoPedido} style={{ marginTop: '14px', background: '#3182ce', color: '#fff', border: 'none', borderRadius: '8px', padding: '11px 16px', fontSize: '14px', fontWeight: 600, cursor: 'pointer', width: '100%' }}>
                      Fazer novo pedido
                    </button>
                  </div>
                ) : isCortesia ? (
                  <div style={{ marginTop: '10px', textAlign: 'left' }}>
                    <div style={{ background: 'rgba(128,90,213,0.12)', border: '1px solid rgba(128,90,213,0.35)', borderRadius: '10px', padding: '14px', color: '#d6bcfa', fontSize: '13.5px', marginBottom: '14px', textAlign: 'center' }}>
                      🎁 <strong>Chave liberada!</strong> Agora escolha o modelo e as medidas do seu molde.
                    </div>
                    {catLoading ? (
                      <p style={{ color: '#a0aec0', fontSize: '14px', margin: 0 }}>
                        <Loader2 size={16} className="mold-import-spinner" style={{ marginRight: '8px' }} /> Carregando modelos...
                      </p>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                          <div style={{ flex: '1 1 160px' }}>
                            <label style={{ display: 'block', color: '#cbd5e0', fontSize: '13px', marginBottom: '6px', fontWeight: 600 }}>Categoria</label>
                            <select style={inp} value={cortCat} onChange={(e) => { setCortCat(e.target.value); setCortKey(''); }}>
                              {MODEL_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
                            </select>
                          </div>
                          <div style={{ flex: '2 1 220px' }}>
                            <label style={{ display: 'block', color: '#cbd5e0', fontSize: '13px', marginBottom: '6px', fontWeight: 600 }}>Nome do molde</label>
                            <select style={inp} value={cortKey} onChange={(e) => setCortKey(e.target.value)}>
                              <option value="">-- Selecione o molde --</option>
                              {cortModelos.map((m) => <option key={m.key} value={m.key}>{m.name}</option>)}
                            </select>
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                          <div style={{ flex: '1 1 140px' }}>
                            <label style={{ display: 'block', color: '#cbd5e0', fontSize: '13px', marginBottom: '6px', fontWeight: 600 }}>Tamanho do molde (cm)</label>
                            <input type="number" min={1} style={inp} value={cortTamanho} onChange={(e) => setCortTamanho(e.target.value)} placeholder="ex: 1000" />
                          </div>
                          <div style={{ flex: '1 1 100px' }}>
                            <label style={{ display: 'block', color: '#cbd5e0', fontSize: '13px', marginBottom: '6px', fontWeight: 600 }}>Gomos</label>
                            <input type="number" min={1} style={inp} value={cortGomos} onChange={(e) => setCortGomos(e.target.value)} />
                          </div>
                          <div style={{ flex: '1 1 100px' }}>
                            <label style={{ display: 'block', color: '#cbd5e0', fontSize: '13px', marginBottom: '6px', fontWeight: 600 }}>Bainha (cm)</label>
                            <input type="number" min={0} step="0.1" style={inp} value={cortBainha} onChange={(e) => setCortBainha(e.target.value)} placeholder="ex: 1" />
                          </div>
                        </div>
                        {cortErr && <p className="mold-import-error" style={{ margin: 0 }}>{cortErr}</p>}
                        <button type="button" onClick={() => void definirDadosCortesia()} disabled={cortBusy} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '8px', background: '#805ad5', color: '#fff', border: 'none', borderRadius: '10px', padding: '13px', fontSize: '15px', fontWeight: 700, cursor: cortBusy ? 'default' : 'pointer' }}>
                          {cortBusy ? <Loader2 size={16} className="mold-import-spinner" /> : null}
                          Continuar
                        </button>
                      </div>
                    )}
                  </div>
                ) : (
                  <div style={{ marginTop: '10px', textAlign: 'left' }}>
                    {/* Dados do molde + trocar (tamanho e e-mail travados) */}
                    <div style={{ background: '#0b0f18', border: '1px solid #23304d', borderRadius: '10px', padding: '12px 14px', marginBottom: '12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap' }}>
                      <div style={{ fontSize: '13px', color: '#cbd5e0' }}>
                        <strong>{pedido.modelo_nome}</strong>{pedido.categoria ? ` (${pedido.categoria})` : ''} · {pedido.gomos} gomos · bainha {pedido.bainha_cm} cm
                        <div style={{ color: '#718096', fontSize: '12px' }}>Tamanho {pedido.tamanho_cm} cm (fixo)</div>
                      </div>
                      <button type="button" onClick={abrirTrocar} style={{ background: '#1a202c', color: '#90cdf4', border: '1px solid #2d3748', borderRadius: '8px', padding: '8px 12px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>
                        Trocar modelo / gomos
                      </button>
                    </div>
                    <p style={{ color: '#90cdf4', fontSize: '14px', margin: '0 0 10px', fontWeight: 600 }}>
                      Agora vamos montar seu molde — responda as medidas abaixo:
                    </p>
                    <TacoChatWizard pedido={pedido} storageKey={`${TACOS_STORAGE_PREFIX}${pedido.id}`} onEntregue={(p) => setPedido(p)} />
                  </div>
                )}
              </div>
            )}
          </>
        ) : null}

        {/* Rodapé fixo: tutorial em vídeo + suporte no WhatsApp */}
        {!loadingCfg && !cfgError && (
          <div style={{ display: 'flex', gap: '10px', marginTop: '18px', flexWrap: 'wrap' }}>
            {embed && (
              <button type="button" onClick={openVideo} style={{ flex: 1, minWidth: '160px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '8px', background: '#c53030', color: '#fff', border: 'none', borderRadius: '10px', padding: '12px', fontSize: '14px', fontWeight: 600, cursor: 'pointer' }}>
                <PlayCircle size={18} /> Tutorial em vídeo
              </button>
            )}
            {config?.whatsapp && (
              <a
                href={`https://wa.me/${(config.whatsapp || '').replace(/\D/g, '')}`}
                target="_blank"
                rel="noreferrer"
                style={{ flex: 1, minWidth: '160px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '8px', background: '#25d366', color: '#06210f', textDecoration: 'none', borderRadius: '10px', padding: '12px', fontSize: '14px', fontWeight: 700 }}
              >
                <MessageCircle size={18} /> Suporte (WhatsApp)
              </a>
            )}
          </div>
        )}
      </div>

      {/* Janela flutuante do vídeo tutorial (arrastável, não bloqueia a página) */}
      {showVideo && embed && (
        <div
          style={{
            position: 'fixed',
            left: `${videoPos.x}px`,
            top: `${videoPos.y}px`,
            width: 'min(400px, calc(100vw - 24px))',
            zIndex: 9999,
            background: '#111622',
            border: '1px solid #2d3748',
            borderRadius: '12px',
            overflow: 'hidden',
            boxShadow: '0 16px 50px rgba(0,0,0,0.55)',
          }}
        >
          {/* barra de título = alça pra arrastar */}
          <div
            onMouseDown={startVideoDrag}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', padding: '8px 12px', background: '#1a202c', cursor: 'move', userSelect: 'none' }}
          >
            <span style={{ color: '#e2e8f0', fontSize: '13px', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
              <PlayCircle size={15} color="#fc8181" /> Tutorial · arraste para mover
            </span>
            <button type="button" onClick={() => setShowVideo(false)} style={{ background: 'none', border: 'none', color: '#a0aec0', cursor: 'pointer', lineHeight: 0 }}><X size={18} /></button>
          </div>
          <div style={{ position: 'relative', paddingBottom: '56.25%', height: 0 }}>
            <iframe src={embed} title="Tutorial" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 0 }} allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowFullScreen />
          </div>
        </div>
      )}

      {/* Modal trocar modelo / gomos */}
      {showTrocar && (
        <div onClick={() => setShowTrocar(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: '16px', backdropFilter: 'blur(4px)' }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: '420px', ...card }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
              <h3 style={{ color: '#f7fafc', margin: 0, fontSize: '17px' }}>Trocar modelo / gomos</h3>
              <button type="button" onClick={() => setShowTrocar(false)} style={{ background: 'none', border: 'none', color: '#718096', cursor: 'pointer' }}><X size={18} /></button>
            </div>
            <p style={{ color: '#718096', fontSize: '12px', margin: '0 0 14px' }}>O tamanho ({pedido?.tamanho_cm} cm) e o e-mail ficam travados.</p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                <div style={{ flex: '1 1 140px' }}>
                  <label style={{ display: 'block', color: '#cbd5e0', fontSize: '13px', marginBottom: '6px', fontWeight: 600 }}>Categoria</label>
                  <select style={inp} value={trocarCat} onChange={(e) => { setTrocarCat(e.target.value); setTrocarKey(''); }}>
                    {MODEL_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div style={{ flex: '2 1 180px' }}>
                  <label style={{ display: 'block', color: '#cbd5e0', fontSize: '13px', marginBottom: '6px', fontWeight: 600 }}>Nome do molde</label>
                  <select style={inp} value={trocarKey} onChange={(e) => setTrocarKey(e.target.value)}>
                    <option value="">-- Selecione --</option>
                    {trocarModelos.map((m) => <option key={m.key} value={m.key}>{m.name}</option>)}
                  </select>
                </div>
              </div>
              <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                <div style={{ flex: '1 1 120px' }}>
                  <label style={{ display: 'block', color: '#cbd5e0', fontSize: '13px', marginBottom: '6px', fontWeight: 600 }}>Gomos</label>
                  <input type="number" min={1} style={inp} value={trocarGomos} onChange={(e) => setTrocarGomos(e.target.value)} />
                </div>
                <div style={{ flex: '1 1 120px' }}>
                  <label style={{ display: 'block', color: '#cbd5e0', fontSize: '13px', marginBottom: '6px', fontWeight: 600 }}>Bainha (cm)</label>
                  <input type="number" min={0} step="0.1" style={inp} value={trocarBainha} onChange={(e) => setTrocarBainha(e.target.value)} />
                </div>
              </div>

              {trocarErr && <p className="mold-import-error" style={{ margin: 0 }}>{trocarErr}</p>}

              <button type="button" onClick={() => void salvarTrocar()} disabled={trocarBusy} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '8px', background: '#3182ce', color: '#fff', border: 'none', borderRadius: '8px', padding: '12px', fontSize: '15px', fontWeight: 600, cursor: 'pointer' }}>
                {trocarBusy ? <Loader2 size={16} className="mold-import-spinner" /> : null}
                Salvar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal recuperar por chave */}
      {showRecuperar && (
        <div onClick={() => setShowRecuperar(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: '16px', backdropFilter: 'blur(4px)' }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: '400px', ...card }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <h3 style={{ color: '#f7fafc', margin: 0, fontSize: '17px' }}>Já paguei</h3>
              <button type="button" onClick={() => setShowRecuperar(false)} style={{ background: 'none', border: 'none', color: '#718096', cursor: 'pointer' }}><X size={18} /></button>
            </div>
            <p style={{ color: '#a0aec0', fontSize: '13px', margin: '0 0 12px' }}>Cole a chave que enviamos no seu e-mail para continuar seu molde.</p>
            <input type="text" style={{ ...inp, textTransform: 'uppercase', letterSpacing: '3px', textAlign: 'center', fontSize: '18px', fontWeight: 700 }} value={chaveInput} onChange={(e) => { setChaveInput(e.target.value.toUpperCase()); setRecError(null); }} placeholder="SUA CHAVE" onKeyDown={(e) => { if (e.key === 'Enter') void handleRecuperar(); }} />
            {recError && <p className="mold-import-error" style={{ margin: '8px 0 0' }}>{recError}</p>}
            <button type="button" onClick={() => void handleRecuperar()} disabled={recuperando} style={{ width: '100%', marginTop: '14px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '8px', background: '#3182ce', color: '#fff', border: 'none', borderRadius: '8px', padding: '12px', fontSize: '15px', fontWeight: 600, cursor: 'pointer' }}>
              {recuperando ? <Loader2 size={16} className="mold-import-spinner" /> : null}
              Continuar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
