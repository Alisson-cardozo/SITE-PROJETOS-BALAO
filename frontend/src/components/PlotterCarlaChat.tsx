import { useEffect, useRef, useState } from 'react';
import { Bot, Send, CornerUpLeft, Save, Loader2, Check } from 'lucide-react';
import type { ChatParte } from '../lib/solicitacaoTaqueado';

type TipoTaco = 'unico' | 'progressivo';
type Etapa = 'intro' | 'tipo' | 'tamanhoUnico' | 'porGomo' | 'subindo' | 'tamanhoParte' | 'confirmarSalvar' | 'salvando' | 'salvo';

interface Msg {
  from: 'bot' | 'user';
  text: string;
}

interface Snapshot {
  msgs: Msg[];
  etapa: Etapa;
  tipo: TipoTaco;
  tamanhoUnico: number;
  partes: ChatParte[];
  cur: ChatParte;
  parteIdx: number;
}

interface Props {
  /** Primeiro nome do usuário logado (a Carla chama pelo nome). */
  userName: string;
  /** Altura total do molde carregado (em cm) — o alvo a preencher. */
  alvoCm: number;
  /** Atualiza o preview ao vivo com as partes montadas até agora. */
  onUpdatePreview: (partes: ChatParte[], tipo: TipoTaco, tamanhoUnico: number) => void;
  /** Salva o molde DIRETO das partes finais (inclui o "bico" que completa). */
  onSave: (partes: ChatParte[], tipo: TipoTaco, tamanhoUnico: number) => Promise<void> | void;
  savedMessage: string | null;
}

const ORDINAIS = ['primeira', 'segunda', 'terceira', 'quarta', 'quinta', 'sexta', 'sétima', 'oitava', 'nona', 'décima'];
const ordinal = (i: number): string => ORDINAIS[i] ?? `${i + 1}ª`;

const TACO_SIZES: number[] = (() => {
  const arr: number[] = [];
  for (let v = 1; v <= 15 + 1e-9; v += 0.5) arr.push(Math.round(v * 10) / 10);
  return arr;
})();

const fmtCm = (v: number): string => `${v.toLocaleString('pt-BR')} cm`;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Altura acumulada das partes (soma de tacos_subindo × tamanho do taco). */
function alturaAcumulada(partes: ChatParte[], tipo: TipoTaco, tamanhoUnico: number): number {
  const total = partes.reduce((s, p) => s + p.tacosSubindo * (tipo === 'unico' ? tamanhoUnico : p.tamanhoTaco ?? 0), 0);
  return Math.round(total * 10) / 10;
}

export function PlotterCarlaChat({ userName, alvoCm, onUpdatePreview, onSave, savedMessage }: Props) {
  const nome = userName.trim() || 'você';

  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [etapa, setEtapa] = useState<Etapa>('intro');
  const [tipo, setTipo] = useState<TipoTaco>('unico');
  const [tamanhoUnico, setTamanhoUnico] = useState(0);
  const [partes, setPartes] = useState<ChatParte[]>([]);
  const [cur, setCur] = useState<ChatParte>({ tacosPorGomo: 0, tacosSubindo: 0 });
  const [parteIdx, setParteIdx] = useState(0);
  const [history, setHistory] = useState<Snapshot[]>([]);
  const [inputVal, setInputVal] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [typing, setTyping] = useState(false);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [msgs, etapa, typing]);

  const addUser = (text: string) => setMsgs((m) => [...m, { from: 'user', text }]);
  const botType = async (text: string) => {
    setTyping(true);
    await sleep(1000 + Math.floor(Math.random() * 900));
    setTyping(false);
    setMsgs((m) => [...m, { from: 'bot', text }]);
  };
  const pushHist = () => setHistory((h) => [...h, { msgs, etapa, tipo, tamanhoUnico, partes, cur, parteIdx }]);

  /** A Carla "digita" e manda as mensagens de abertura. */
  const runIntro = async () => {
    await botType(`Oi, ${nome}! 👋 Eu sou a Carla. Vou montar esse molde com você — e ele vai aparecendo do lado em tempo real. 🙂`);
    await botType('O molde todo usa tacos de tamanho único, ou é progressivo?');
    setEtapa('tipo');
  };

  const introRan = useRef(false);
  useEffect(() => {
    if (introRan.current) return;
    introRan.current = true;
    void runIntro();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const voltar = () => {
    setHistory((h) => {
      if (h.length === 0) return h;
      const prev = h[h.length - 1];
      setMsgs(prev.msgs);
      setEtapa(prev.etapa);
      setTipo(prev.tipo);
      setTamanhoUnico(prev.tamanhoUnico);
      setPartes(prev.partes);
      setCur(prev.cur);
      setParteIdx(prev.parteIdx);
      setInputVal('');
      setErro(null);
      onUpdatePreview(prev.partes, prev.tipo, prev.tamanhoUnico);
      return h.slice(0, -1);
    });
  };

  const escolherTipo = async (t: TipoTaco) => {
    pushHist();
    setTipo(t);
    addUser(t === 'unico' ? 'Tamanho único' : 'Progressivo');
    if (t === 'unico') {
      await botType('Qual o tamanho de cada taco de altura, em cm?');
      setEtapa('tamanhoUnico');
    } else {
      await botType(`Na ${ordinal(0)} parte do seu projeto, quantos tacos por gomo?`);
      setEtapa('porGomo');
    }
  };

  const enviarNumero = () => {
    const n = Number(inputVal.replace(',', '.'));
    if (!Number.isFinite(n) || n <= 0) {
      setErro('Digite um número válido.');
      return;
    }
    setInputVal('');
    void processarNumero(n, String(inputVal));
  };

  const escolherTamanho = (n: number) => void processarNumero(n, fmtCm(n));

  const processarNumero = async (n: number, label: string) => {
    pushHist();
    setErro(null);
    addUser(label);

    if (etapa === 'tamanhoUnico') {
      setTamanhoUnico(n);
      await botType(`Na ${ordinal(0)} parte do seu projeto, quantos tacos por gomo?`);
      setEtapa('porGomo');
    } else if (etapa === 'porGomo') {
      setCur((c) => ({ ...c, tacosPorGomo: n }));
      await botType(`Nessa parte com ${n} tacos por gomo, quantos tacos subindo?`);
      setEtapa('subindo');
    } else if (etapa === 'subindo') {
      const parte: ChatParte = { ...cur, tacosSubindo: n };
      if (tipo === 'progressivo') {
        setCur(parte);
        await botType('Qual o tamanho do taco de altura dessa parte, em cm?');
        setEtapa('tamanhoParte');
      } else {
        const acc = alturaAcumulada(partes, tipo, tamanhoUnico);
        const faltam = Math.round((alvoCm - acc) * 10) / 10;
        const partH = Math.round(n * tamanhoUnico * 10) / 10;
        if (partH > faltam + 1e-6) {
          const maxSub = Math.floor((faltam + 1e-6) / tamanhoUnico);
          await botType(
            `Opa! Isso ultrapassa o tamanho do molde (${fmtCm(alvoCm)}). Faltam só ${fmtCm(faltam)}, ` +
            `então nessa parte você pode colocar no máximo ${maxSub} tacos subindo (taco de ${fmtCm(tamanhoUnico)}).\n` +
            `Se quiser, toque em "Voltar uma etapa" e ajuste a quantidade. 🙂`
          );
          setEtapa('subindo');
          return;
        }
        await registrarParte(parte);
      }
    } else if (etapa === 'tamanhoParte') {
      const acc = alturaAcumulada(partes, tipo, tamanhoUnico);
      const faltam = Math.round((alvoCm - acc) * 10) / 10;
      const partH = Math.round(cur.tacosSubindo * n * 10) / 10;
      if (partH > faltam + 1e-6) {
        await botType(
          `Opa! Isso ultrapassa o tamanho do molde (${fmtCm(alvoCm)}). Faltam só ${fmtCm(faltam)} nessa parte ` +
          `(${cur.tacosSubindo} tacos subindo × ${n} cm = ${fmtCm(partH)}).\n` +
          `Toque em "Voltar uma etapa" e ajuste a quantidade ou o tamanho. 🙂`
        );
        setEtapa('tamanhoParte');
        return;
      }
      await registrarParte({ ...cur, tamanhoTaco: n });
    }
  };

  /** Fecha a parte, atualiza o preview ao vivo e decide: próxima parte ou completou. */
  const registrarParte = async (parte: ChatParte) => {
    const novas = [...partes, parte];
    setPartes(novas);
    setCur({ tacosPorGomo: 0, tacosSubindo: 0 });
    onUpdatePreview(novas, tipo, tamanhoUnico);

    const acumulado = alturaAcumulada(novas, tipo, tamanhoUnico);
    const faltam = Math.round((alvoCm - acumulado) * 10) / 10;
    const completo = faltam <= 1e-6 || (tipo === 'unico' && faltam < tamanhoUnico);

    const tacoDaParte = tipo === 'unico' ? tamanhoUnico : (parte.tamanhoTaco ?? 0);
    const resumoParte = `✔ ${parte.tacosPorGomo} por gomo · ${parte.tacosSubindo} subindo · taco ${tacoDaParte} cm (${Math.round(parte.tacosSubindo * tacoDaParte * 10) / 10} cm)`;

    setMsgs((m) => [...m, { from: 'bot', text: `${resumoParte}\nJá somamos ${fmtCm(acumulado)} de ${fmtCm(alvoCm)} (faltam ${fmtCm(faltam)}).` }]);

    if (!completo) {
      const nextIdx = novas.length;
      setParteIdx(nextIdx);
      await botType(`Na ${ordinal(nextIdx)} parte do seu projeto, quantos tacos por gomo?`);
      setEtapa('porGomo');
    } else {
      await botType(`Pronto, ${nome}! 🎉 Você completou o molde (${fmtCm(alvoCm)}) — ${novas.length} parte(s), somando ${fmtCm(acumulado)}.`);
      await botType('Quer que eu salve esse molde na aba Meus Projetos → Moldes Taqueados?');
      setEtapa('confirmarSalvar');
    }
  };

  /** Completa o molde ATÉ O FIM (o bico/ponta) repetindo a última parte — mesma
   * lógica da venda (Math.round, garante que a ponta é coberta). Idempotente. */
  const fillToEnd = (base: ChatParte[]): ChatParte[] => {
    if (base.length === 0) return base;
    const acc = alturaAcumulada(base, tipo, tamanhoUnico);
    const remaining = Math.round((alvoCm - acc) * 10) / 10;
    if (remaining <= 0.05) return base;
    const last = base[base.length - 1];
    const tacoSize = tipo === 'unico' ? tamanhoUnico : (last.tamanhoTaco ?? 5);
    const fillSubindo = Math.max(1, Math.round(remaining / tacoSize));
    return [...base, { tacosPorGomo: last.tacosPorGomo, tacosSubindo: fillSubindo, tamanhoTaco: tacoSize }];
  };

  /** Botão "já coloquei tudo": completa o resto igual à última parte e pergunta se salva. */
  const concluirMontagem = async () => {
    if (partes.length === 0) return;
    pushHist();
    addUser('Já coloquei tudo');

    const finais = fillToEnd(partes);
    const acc = alturaAcumulada(partes, tipo, tamanhoUnico);
    const remaining = Math.round((alvoCm - acc) * 10) / 10;
    if (finais.length > partes.length) {
      const last = partes[partes.length - 1];
      const tacoSize = tipo === 'unico' ? tamanhoUnico : (last.tamanhoTaco ?? 5);
      setPartes(finais);
      onUpdatePreview(finais, tipo, tamanhoUnico);
      await botType(`Completei o restante do molde repetindo a última parte (${last.tacosPorGomo} por gomo, taco de ${fmtCm(tacoSize)}) até o fim. 🎉`);
    } else if (remaining > 0.05) {
      await botType(`Pronto, ${nome}! 🎉 Molde montado (sobra menos de um taco no topo, então fica assim).`);
    } else {
      await botType(`Pronto, ${nome}! 🎉 Molde montado.`);
    }
    await botType('Quer que eu salve esse molde na aba Meus Projetos → Moldes Taqueados?');
    setEtapa('confirmarSalvar');
  };

  /** Confirma: completa até o fim (garantia) e salva DIRETO das partes finais. */
  const salvar = async () => {
    addUser('Sim, salvar');
    const finais = fillToEnd(partes);
    if (finais.length !== partes.length) {
      setPartes(finais);
      onUpdatePreview(finais, tipo, tamanhoUnico);
    }
    setEtapa('salvando');
    try {
      await onSave(finais, tipo, tamanhoUnico);
      setEtapa('salvo');
      setMsgs((m) => [...m, { from: 'bot', text: `Prontinho, ${nome}! ✅ Seu molde foi salvo na aba Meus Projetos → Moldes Taqueados.` }]);
    } catch {
      setErro('Não foi possível salvar. Tente de novo.');
      setEtapa('confirmarSalvar');
    }
  };

  const inputVisivel = !typing && (etapa === 'porGomo' || etapa === 'subindo');
  const sizeVisivel = !typing && (etapa === 'tamanhoUnico' || etapa === 'tamanhoParte');
  const acumuladoAtual = alturaAcumulada(partes, tipo, tamanhoUnico);

  return (
    <div className="plotter-carla-chat" style={{ background: '#0b0f18', border: '1px solid #23304d', borderRadius: '14px', overflow: 'hidden', display: 'flex', flexDirection: 'column', height: '520px' }}>
      <div style={{ background: '#111622', borderBottom: '1px solid #1f293d', padding: '10px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
        <span style={{ color: '#f7fafc', fontWeight: 600, fontSize: '14px', display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
          <Bot size={18} color="#4299e1" /> Assistente-IA Carla
        </span>
        {partes.length > 0 && (
          <span style={{ color: '#a0aec0', fontSize: '12px' }}>{fmtCm(acumuladoAtual)} / {fmtCm(alvoCm)}</span>
        )}
      </div>

      <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: '14px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {msgs.map((m, i) => (
          <div key={i} style={{ alignSelf: m.from === 'bot' ? 'flex-start' : 'flex-end', maxWidth: '82%', background: m.from === 'bot' ? '#1a202c' : '#3182ce', color: m.from === 'bot' ? '#e2e8f0' : '#fff', padding: '9px 13px', borderRadius: '12px', fontSize: '14px', lineHeight: 1.5, whiteSpace: 'pre-line' }}>
            {m.text}
          </div>
        ))}
        {typing && (
          <div style={{ alignSelf: 'flex-start', background: '#1a202c', color: '#a0aec0', padding: '9px 13px', borderRadius: '12px', fontSize: '14px' }}>
            <span className="taco-typing">digitando…</span>
          </div>
        )}
      </div>

      <div style={{ borderTop: '1px solid #1f293d', padding: '12px', background: '#111622' }}>
        {history.length > 0 && !typing && etapa !== 'salvo' && etapa !== 'salvando' && etapa !== 'confirmarSalvar' && (
          <button type="button" onClick={voltar} style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', background: 'none', border: 'none', color: '#90cdf4', fontSize: '12px', cursor: 'pointer', marginBottom: '8px', padding: 0 }}>
            <CornerUpLeft size={13} /> Voltar uma etapa
          </button>
        )}
        {erro && <p className="mold-import-error" style={{ margin: '0 0 8px' }}>{erro}</p>}

        {!typing && etapa === 'tipo' && (
          <div style={{ display: 'flex', gap: '8px' }}>
            <button type="button" onClick={() => void escolherTipo('unico')} style={btnPrimary}>Tamanho único</button>
            <button type="button" onClick={() => void escolherTipo('progressivo')} style={btnSecondary}>Progressivo</button>
          </div>
        )}

        {sizeVisivel && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(60px, 1fr))', gap: '6px', maxHeight: '150px', overflowY: 'auto', paddingRight: '2px' }}>
            {TACO_SIZES.map((s) => (
              <button key={s} type="button" onClick={() => escolherTamanho(s)} style={{ background: '#1a202c', color: '#cbd5e0', border: '1px solid #2d3748', borderRadius: '8px', padding: '9px 4px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>
                {fmtCm(s)}
              </button>
            ))}
          </div>
        )}

        {inputVisivel && (
          <div style={{ display: 'flex', gap: '8px' }}>
            <input type="number" autoFocus value={inputVal} onChange={(e) => { setInputVal(e.target.value); setErro(null); }} onKeyDown={(e) => { if (e.key === 'Enter') enviarNumero(); }} placeholder="Quantidade" style={{ flex: 1, minWidth: 0, padding: '11px 12px', background: '#0b0f18', border: '1px solid #2d3748', borderRadius: '8px', color: '#fff', fontSize: '15px', outline: 'none' }} />
            <button type="button" onClick={enviarNumero} style={{ ...btnPrimary, flex: '0 0 auto', padding: '11px 14px', display: 'inline-flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap' }}>
              <Send size={16} /> Enviar
            </button>
          </div>
        )}

        {/* Já colocou todas as medidas: conclui completando o resto igual à última parte. */}
        {!typing && etapa === 'porGomo' && partes.length > 0 && (
          <button
            type="button"
            onClick={() => void concluirMontagem()}
            style={{ width: '100%', marginTop: '8px', background: 'transparent', color: '#48bb78', border: '1px solid #2f6f4f', borderRadius: '8px', padding: '10px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}
          >
            ✅ Já coloquei tudo — concluir (completa o resto igual à última parte)
          </button>
        )}

        {/* Pergunta se quer salvar */}
        {!typing && etapa === 'confirmarSalvar' && (
          <button type="button" onClick={() => void salvar()} style={{ ...btnPrimary, width: '100%', background: '#48bb78', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
            <Save size={16} /> Sim, salvar
          </button>
        )}

        {etapa === 'salvando' && (
          <p style={{ color: '#a0aec0', fontSize: '13px', margin: 0, textAlign: 'center' }}>
            <Loader2 size={14} className="mold-import-spinner" /> Salvando...
          </p>
        )}

        {etapa === 'salvo' && (
          <p style={{ color: '#48bb78', fontSize: '14px', fontWeight: 600, margin: 0, textAlign: 'center', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
            <Check size={16} /> {savedMessage ?? 'Molde salvo em Meus Projetos → Moldes Taqueados!'}
          </p>
        )}
      </div>
    </div>
  );
}

const btnPrimary: React.CSSProperties = {
  flex: 1, background: '#3182ce', color: '#fff', border: 'none', borderRadius: '8px',
  padding: '11px 14px', fontSize: '14px', fontWeight: 600, cursor: 'pointer',
};
const btnSecondary: React.CSSProperties = {
  flex: 1, background: '#1a202c', color: '#cbd5e0', border: '1px solid #2d3748', borderRadius: '8px',
  padding: '11px 14px', fontSize: '14px', fontWeight: 600, cursor: 'pointer',
};
