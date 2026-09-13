import { useEffect, useMemo, useRef, useState } from 'react';
import { Bot, Loader2, Send, CornerUpLeft } from 'lucide-react';
import { api, ApiError } from '../lib/api';
import { buildTaqueadoBlob, buildTaqueadoTiledBlob, type BaseModel } from '../lib/solicitacaoTaqueado';
import type { SolicitacaoPedido } from '../types';

type TipoTaco = 'unico' | 'progressivo';
type Etapa = 'tipo' | 'tamanhoUnico' | 'porGomo' | 'subindo' | 'tamanhoParte' | 'proxima' | 'gerando' | 'pronto';

interface Parte {
  tacosPorGomo: number;
  tacosSubindo: number;
  tamanhoTaco?: number;
}

interface Msg {
  from: 'bot' | 'user';
  text: string;
}

const ORDINAIS = ['primeira', 'segunda', 'terceira', 'quarta', 'quinta', 'sexta', 'sétima', 'oitava', 'nona', 'décima'];
function ordinal(i: number): string {
  return ORDINAIS[i] ?? `${i + 1}ª`;
}

const TACO_SIZES: number[] = (() => {
  const arr: number[] = [];
  for (let v = 1; v <= 15 + 1e-9; v += 0.5) arr.push(Math.round(v * 10) / 10);
  return arr;
})();

const fmtCm = (v: number): string => `${v.toLocaleString('pt-BR')} cm`;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Altura acumulada das partes (soma de tacos_subindo * tamanho do taco). */
function alturaAcumulada(partes: Parte[], tipo: TipoTaco, tamanhoUnico: number): number {
  const total = partes.reduce((s, p) => s + p.tacosSubindo * (tipo === 'unico' ? tamanhoUnico : p.tamanhoTaco ?? 0), 0);
  return Math.round(total * 10) / 10;
}

interface Props {
  pedido: SolicitacaoPedido;
  storageKey: string;
  onEntregue: (pedido: SolicitacaoPedido) => void;
}

interface Snapshot {
  msgs: Msg[];
  etapa: Etapa;
  tipo: TipoTaco;
  tamanhoUnico: number;
  partes: Parte[];
  cur: Parte;
  parteIdx: number;
}

export function TacoChatWizard({ pedido, storageKey, onEntregue }: Props) {
  const saved = useMemo<(Snapshot & { history?: Snapshot[] }) | null>(() => {
    try {
      const s = localStorage.getItem(storageKey);
      return s ? JSON.parse(s) : null;
    } catch {
      return null;
    }
  }, [storageKey]);

  const [msgs, setMsgs] = useState<Msg[]>(() => {
    if (saved?.msgs) {
      // Remove o recap antigo que ficava preso na sessão (a info fica no card acima).
      return saved.msgs.filter((m) => !m.text.startsWith('Vamos montar seu molde'));
    }
    return [
      { from: 'bot', text: `Oi! Eu sou a Carla 🙂 Vou te ajudar a montar o molde "${pedido.modelo_nome}".` },
      { from: 'bot', text: 'O molde todo usa tacos de tamanho único, ou é progressivo?' },
    ];
  });
  const [etapa, setEtapa] = useState<Etapa>(saved?.etapa === 'gerando' ? 'proxima' : (saved?.etapa ?? 'tipo'));
  const [tipo, setTipo] = useState<TipoTaco>(saved?.tipo ?? 'unico');
  const [tamanhoUnico, setTamanhoUnico] = useState(saved?.tamanhoUnico ?? 0);
  const [partes, setPartes] = useState<Parte[]>(saved?.partes ?? []);
  const [cur, setCur] = useState<Parte>(saved?.cur ?? { tacosPorGomo: 0, tacosSubindo: 0 });
  const [parteIdx, setParteIdx] = useState(saved?.parteIdx ?? 0);
  const [history, setHistory] = useState<Snapshot[]>(saved?.history ?? []);
  const [inputVal, setInputVal] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [typing, setTyping] = useState(false);
  const [baseModel, setBaseModel] = useState<BaseModel | null>(null);

  // Carrega o modelo base do catálogo (a curva) para gerar o taqueado real.
  useEffect(() => {
    if (!pedido.modelo_key) return;
    fetch('/data.json')
      .then((r) => r.json())
      .then((data: Record<string, BaseModel>) => setBaseModel(data[pedido.modelo_key ?? ''] ?? null))
      .catch(() => setBaseModel(null));
  }, [pedido.modelo_key]);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [msgs, etapa, typing]);

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify({ msgs, etapa, tipo, tamanhoUnico, partes, cur, parteIdx, history }));
    } catch {
      /* ignora */
    }
  }, [msgs, etapa, tipo, tamanhoUnico, partes, cur, parteIdx, history, storageKey]);

  const user = (text: string) => setMsgs((m) => [...m, { from: 'user', text }]);

  /** Bot "digitando..." por 2-4s e então responde. */
  const botType = async (text: string) => {
    setTyping(true);
    await sleep(2000 + Math.floor(Math.random() * 2000));
    setTyping(false);
    setMsgs((m) => [...m, { from: 'bot', text }]);
  };

  const pushHist = () => setHistory((h) => [...h, { msgs, etapa, tipo, tamanhoUnico, partes, cur, parteIdx }]);

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
      return h.slice(0, -1);
    });
  };

  const escolherTipo = async (t: TipoTaco) => {
    pushHist();
    setTipo(t);
    user(t === 'unico' ? 'Tamanho único' : 'Progressivo');
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
    user(label);

    if (etapa === 'tamanhoUnico') {
      setTamanhoUnico(n);
      await botType(`Na ${ordinal(0)} parte do seu projeto, quantos tacos por gomo?`);
      setEtapa('porGomo');
    } else if (etapa === 'porGomo') {
      setCur((c) => ({ ...c, tacosPorGomo: n }));
      await botType(`Nessa parte com ${n} tacos por gomo, quantos tacos subindo?`);
      setEtapa('subindo');
    } else if (etapa === 'subindo') {
      const parte: Parte = { ...cur, tacosSubindo: n };
      if (tipo === 'progressivo') {
        setCur(parte);
        await botType('Qual o tamanho do taco de altura dessa parte, em cm?');
        setEtapa('tamanhoParte');
      } else {
        // Tamanho único: já dá pra validar o estouro (altura = subindo × taco).
        const acc = alturaAcumulada(partes, tipo, tamanhoUnico);
        const faltam = Math.round((pedido.tamanho_cm - acc) * 10) / 10;
        const partH = Math.round(n * tamanhoUnico * 10) / 10;
        if (partH > faltam + 1e-6) {
          const maxSub = Math.floor((faltam + 1e-6) / tamanhoUnico);
          await botType(
            `Opa! Isso ultrapassa o tamanho do molde (${pedido.tamanho_cm} cm). Faltam só ${faltam} cm, ` +
            `então nessa parte você pode colocar no máximo ${maxSub} tacos subindo (taco de ${tamanhoUnico} cm).\n` +
            `Se quiser, toque em "Voltar uma etapa" e ajuste a quantidade de tacos. Vai ser um prazer te ajudar! 🙂`
          );
          setEtapa('subindo');
          return;
        }
        await registrarParte(parte);
      }
    } else if (etapa === 'tamanhoParte') {
      // Progressivo: valida o estouro agora que sabemos o tamanho do taco.
      const acc = alturaAcumulada(partes, tipo, tamanhoUnico);
      const faltam = Math.round((pedido.tamanho_cm - acc) * 10) / 10;
      const partH = Math.round(cur.tacosSubindo * n * 10) / 10;
      if (partH > faltam + 1e-6) {
        await botType(
          `Opa! Isso ultrapassa o tamanho do molde (${pedido.tamanho_cm} cm). Faltam só ${faltam} cm nessa parte ` +
          `(${cur.tacosSubindo} tacos subindo × ${n} cm = ${partH} cm).\n` +
          `Toque em "Voltar uma etapa" e ajuste a quantidade de tacos ou o tamanho. Vai ser um prazer te ajudar! 🙂`
        );
        setEtapa('tamanhoParte');
        return;
      }
      await registrarParte({ ...cur, tamanhoTaco: n });
    }
  };

  /** Fecha a parte, soma a altura e decide: próxima parte ou bateu o tamanho. */
  const registrarParte = async (parte: Parte) => {
    const novas = [...partes, parte];
    setPartes(novas);
    setCur({ tacosPorGomo: 0, tacosSubindo: 0 });

    const alvo = pedido.tamanho_cm;
    const acumulado = alturaAcumulada(novas, tipo, tamanhoUnico);
    const faltam = Math.round((alvo - acumulado) * 10) / 10;
    // "Completo" quando bateu o alvo, ou (no único) não cabe mais nem 1 taco.
    const completo = faltam <= 1e-6 || (tipo === 'unico' && faltam < tamanhoUnico);

    // Descrição do que foi capturado nesta parte (transparência p/ o progressivo).
    const tacoDaParte = tipo === 'unico' ? tamanhoUnico : (parte.tamanhoTaco ?? 0);
    const resumoParte = `✔ ${parte.tacosPorGomo} por gomo · ${parte.tacosSubindo} subindo · taco ${tacoDaParte} cm (${Math.round(parte.tacosSubindo * tacoDaParte * 10) / 10} cm)`;

    // 1ª mensagem: confirmação do que foi registrado (imediata).
    setMsgs((m) => [...m, { from: 'bot', text: `${resumoParte}\nJá somamos ${acumulado} cm de ${alvo} cm (faltam ${faltam} cm).` }]);

    if (!completo) {
      const nextIdx = novas.length;
      setParteIdx(nextIdx);
      // 2ª mensagem: pergunta da próxima parte (com "digitando…").
      await botType(`Na ${ordinal(nextIdx)} parte do seu projeto, quantos tacos por gomo?`);
      setEtapa('porGomo');
    } else {
      await botType(
        `Pronto! Você completou o molde (${alvo} cm) — ${novas.length} parte(s), somando ${acumulado} cm.\n` +
        `Toque em "Finalizar e enviar" para receber o molde no seu e-mail. 🎈`
      );
      setEtapa('proxima');
    }
  };

  const finalizar = async () => {
    if (partes.length === 0) return;
    pushHist();
    user('Finalizar molde');
    setEtapa('gerando');

    // Completa o que faltou REPETINDO o padrão da última parte (mesma qtd de
    // tacos por gomo e mesmo tamanho de taco) — em vez de deixar em branco.
    let partesFinais = partes;
    const alvo = pedido.tamanho_cm;
    const acc = alturaAcumulada(partes, tipo, tamanhoUnico);
    const remaining = Math.round((alvo - acc) * 10) / 10;
    if (remaining > 0.05) {
      const last = partes[partes.length - 1];
      const tacoSize = tipo === 'unico' ? tamanhoUnico : (last.tamanhoTaco ?? 5);
      const fillSubindo = Math.max(1, Math.round(remaining / tacoSize));
      partesFinais = [...partes, { tacosPorGomo: last.tacosPorGomo, tacosSubindo: fillSubindo, tamanhoTaco: tacoSize }];
      await botType(`Completando os ${remaining} cm que faltavam com o padrão da última parte (${last.tacosPorGomo} por gomo, taco de ${tacoSize} cm). Gerando e enviando...`);
    } else {
      await botType('Perfeito! Gerando seu molde e enviando para o seu e-mail...');
    }

    const config = { tipo, tamanho_unico: tamanhoUnico, partes: partesFinais };
    try {
      await api.solicitacaoSalvarTacos(pedido.id, pedido.public_token, config);

      // Carrega o modelo base (curva) se ainda não veio, e gera o taqueado real.
      let base = baseModel;
      if (!base && pedido.modelo_key) {
        const data = (await fetch('/data.json').then((r) => r.json())) as Record<string, BaseModel>;
        base = data[pedido.modelo_key] ?? null;
      }
      if (!base) throw new Error('Não foi possível carregar o modelo (curva) para gerar o molde.');

      const taqueadoParams = {
        base,
        alturaCm: pedido.tamanho_cm,
        gomos: pedido.gomos,
        bainhaCm: pedido.bainha_cm,
        nome: pedido.modelo_nome,
        modelo: pedido.categoria ?? '',
        partes: partesFinais,
        tipo,
        tamanhoUnico,
      };
      const blob = buildTaqueadoBlob(taqueadoParams);
      const blobA4 = buildTaqueadoTiledBlob(taqueadoParams, 'a4');
      const blobA3 = buildTaqueadoTiledBlob(taqueadoParams, 'a3');
      const baseSlug = pedido.modelo_nome.replace(/\s+/g, '-').toLowerCase();
      const filename = `molde-${baseSlug}.pdf`;
      const filenameA4 = `molde-${baseSlug}-a4.pdf`;
      const filenameA3 = `molde-${baseSlug}-a3.pdf`;
      const toDataUrl = (b: Blob) =>
        new Promise<string>((res, rej) => {
          const fr = new FileReader();
          fr.onload = () => res(fr.result as string);
          fr.onerror = () => rej(new Error('Falha ao ler o PDF.'));
          fr.readAsDataURL(b);
        });
      const [dataUrl, dataUrlA4, dataUrlA3] = await Promise.all([toDataUrl(blob), toDataUrl(blobA4), toDataUrl(blobA3)]);

      // Resumo das medidas (vai junto no e-mail).
      const resumoEmail =
        `Tipo de taco: ${tipo === 'unico' ? `Tamanho único (${tamanhoUnico} cm)` : 'Progressivo'}\n\n` +
        `Medidas por parte:\n` +
        partesFinais
          .map((p, i) => {
            const t = tipo === 'unico' ? tamanhoUnico : p.tamanhoTaco ?? 0;
            return `${i + 1}ª parte: ${p.tacosPorGomo} por gomo · ${p.tacosSubindo} subindo · taco ${t} cm (${Math.round(p.tacosSubindo * t * 10) / 10} cm)`;
          })
          .join('\n');

      const r = await api.solicitacaoEntregar(pedido.id, pedido.public_token, dataUrl, filename, resumoEmail, {
        a4: { base64: dataUrlA4, filename: filenameA4 },
        a3: { base64: dataUrlA3, filename: filenameA3 },
      });
      setEtapa('pronto');
      setMsgs((m) => [...m, { from: 'bot', text: 'Pronto! Seu molde foi enviado para o seu e-mail. ✅ Confira a caixa de entrada (e o spam).' }]);
      onEntregue(r.data);
    } catch (err) {
      setErro(err instanceof ApiError ? err.message : 'Falha ao gerar o molde.');
      setMsgs((m) => [...m, { from: 'bot', text: 'Ops, algo deu errado ao gerar. Tente finalizar de novo.' }]);
      setEtapa('proxima');
    }
  };

  const inputVisivel = !typing && (etapa === 'porGomo' || etapa === 'subindo');
  const sizeVisivel = !typing && (etapa === 'tamanhoUnico' || etapa === 'tamanhoParte');
  const alvo = pedido.tamanho_cm;
  const acumuladoAtual = alturaAcumulada(partes, tipo, tamanhoUnico);

  return (
    <div style={{ background: '#0b0f18', border: '1px solid #23304d', borderRadius: '14px', overflow: 'hidden', display: 'flex', flexDirection: 'column', height: '470px' }}>
      <div style={{ background: '#111622', borderBottom: '1px solid #1f293d', padding: '10px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
        <span style={{ color: '#f7fafc', fontWeight: 600, fontSize: '14px', display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
          <Bot size={18} color="#4299e1" /> Assistente-IA Carla
        </span>
        {partes.length > 0 && (
          <span style={{ color: '#a0aec0', fontSize: '12px' }}>{acumuladoAtual} / {alvo} cm</span>
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
        {history.length > 0 && !typing && etapa !== 'pronto' && etapa !== 'gerando' && (
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
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(60px, 1fr))', gap: '6px', maxHeight: '140px', overflowY: 'auto', paddingRight: '2px' }}>
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

        {/* Já colocou todas as medidas: finaliza deixando o resto do molde em branco. */}
        {!typing && etapa === 'porGomo' && partes.length > 0 && (
          <button
            type="button"
            onClick={() => void finalizar()}
            style={{ width: '100%', marginTop: '8px', background: 'transparent', color: '#48bb78', border: '1px solid #2f6f4f', borderRadius: '8px', padding: '10px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}
          >
            ✅ Já coloquei tudo — finalizar (completa o resto igual à última parte)
          </button>
        )}

        {!typing && etapa === 'proxima' && (
          <button type="button" onClick={() => void finalizar()} style={{ ...btnPrimary, width: '100%', background: '#48bb78' }}>Finalizar e enviar</button>
        )}

        {etapa === 'gerando' && (
          <p style={{ color: '#a0aec0', fontSize: '13px', margin: 0, textAlign: 'center' }}>
            <Loader2 size={14} className="mold-import-spinner" /> Gerando e enviando...
          </p>
        )}

        {etapa === 'pronto' && (
          <p style={{ color: '#48bb78', fontSize: '14px', fontWeight: 600, margin: 0, textAlign: 'center' }}>
            ✅ Molde enviado para o e-mail!
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
