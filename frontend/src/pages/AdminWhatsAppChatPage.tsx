import { useCallback, useEffect, useRef, useState } from 'react';
import { Bot, BotOff, Loader2, MessagesSquare, Send, User as UserIcon } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import type { WhatsAppConversation, WhatsAppMessage } from '../types';

function formatTime(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso.replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay
    ? d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

export function AdminWhatsAppChatPage() {
  const { token } = useAuth();
  const [conversations, setConversations] = useState<WhatsAppConversation[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [messages, setMessages] = useState<WhatsAppMessage[]>([]);
  const [loadingConvs, setLoadingConvs] = useState(true);
  const [loadingMsgs, setLoadingMsgs] = useState(false);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [wsConnected, setWsConnected] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const selectedIdRef = useRef<number | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const reconnectTimer = useRef<number | null>(null);

  selectedIdRef.current = selectedId;

  const loadConversations = useCallback(async () => {
    if (!token) return;
    try {
      const r = await api.adminWhatsappConversations(token);
      setConversations(r.data);
    } finally {
      setLoadingConvs(false);
    }
  }, [token]);

  const loadMessages = useCallback(async (conversationId: number) => {
    if (!token) return;
    setLoadingMsgs(true);
    try {
      const r = await api.adminWhatsappMessages(conversationId, token);
      setMessages(r.data);
      void api.adminWhatsappMarkRead(conversationId, token).catch(() => {});
      setConversations((prev) => prev.map((c) => (c.id === conversationId ? { ...c, unread_count: 0 } : c)));
    } finally {
      setLoadingMsgs(false);
    }
  }, [token]);

  useEffect(() => {
    void loadConversations();
  }, [loadConversations]);

  useEffect(() => {
    if (selectedId !== null) void loadMessages(selectedId);
  }, [selectedId, loadMessages]);

  // Scroll pro final quando chega mensagem nova.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  // WebSocket: conecta com um ticket curto (30s) emitido pelo backend, e
  // reconecta sozinho se cair (rede instavel, deploy, etc.).
  const connectWs = useCallback(async () => {
    if (!token) return;
    try {
      const r = await api.adminWhatsappWsTicket(token);
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${proto}//${window.location.host}/ws/chat?ticket=${encodeURIComponent(r.data.ticket)}`);
      wsRef.current = ws;

      ws.onopen = () => setWsConnected(true);

      ws.onmessage = (evt) => {
        try {
          const payload = JSON.parse(evt.data as string) as {
            type?: string;
            message?: WhatsAppMessage;
            conversation?: WhatsAppConversation;
          };
          if (payload.type !== 'message') return;

          if (payload.conversation) {
            const conv = payload.conversation;
            setConversations((prev) => {
              const isOpen = selectedIdRef.current === conv.id;
              const next = isOpen ? { ...conv, unread_count: 0 } : conv;
              const others = prev.filter((c) => c.id !== conv.id);
              return [next, ...others].sort((a, b) => (b.last_message_at || '').localeCompare(a.last_message_at || ''));
            });
          }

          if (payload.message && payload.message.conversation_id === selectedIdRef.current) {
            setMessages((prev) => (prev.some((m) => m.id === payload.message!.id) ? prev : [...prev, payload.message!]));
            if (payload.message.direction === 'in') {
              void api.adminWhatsappMarkRead(payload.message.conversation_id, token).catch(() => {});
            }
          }
        } catch {
          /* ignora payload invalido */
        }
      };

      ws.onclose = () => {
        setWsConnected(false);
        wsRef.current = null;
        reconnectTimer.current = window.setTimeout(() => void connectWs(), 2500);
      };

      ws.onerror = () => ws.close();
    } catch {
      reconnectTimer.current = window.setTimeout(() => void connectWs(), 4000);
    }
  }, [token]);

  useEffect(() => {
    void connectWs();
    return () => {
      if (reconnectTimer.current) window.clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [connectWs]);

  const handleSend = async () => {
    if (!token || !selectedId || !input.trim() || sending) return;
    const body = input.trim();
    setInput('');
    setSending(true);
    try {
      const r = await api.adminWhatsappSendMessage(selectedId, body, token);
      setMessages((prev) => (prev.some((m) => m.id === r.data.message.id) ? prev : [...prev, r.data.message]));
    } catch {
      setInput(body); // devolve o texto se falhou
    } finally {
      setSending(false);
    }
  };

  const selected = conversations.find((c) => c.id === selectedId) ?? null;

  const handleToggleBotPaused = async () => {
    if (!token || !selectedId) return;
    const nextPaused = !selected?.bot_paused;
    setConversations((prev) => prev.map((c) => (c.id === selectedId ? { ...c, bot_paused: nextPaused } : c)));
    try {
      await api.adminWhatsappSetBotPaused(selectedId, nextPaused, token);
    } catch {
      setConversations((prev) => prev.map((c) => (c.id === selectedId ? { ...c, bot_paused: !nextPaused } : c)));
    }
  };

  return (
    <div className="bandeira-workspace" style={{ padding: '24px' }}>
      <div style={{ width: '100%', maxWidth: '1100px', margin: '0 auto', background: '#111622', border: '1px solid #1f293d', borderRadius: '14px', overflow: 'hidden', display: 'flex', height: '72vh', minHeight: '480px' }}>
        {/* Lista de conversas */}
        <div style={{ width: '300px', flexShrink: 0, borderRight: '1px solid #1f293d', display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '18px 18px 14px', borderBottom: '1px solid #1f293d' }}>
            <h2 style={{ fontSize: '18px', fontWeight: 700, color: '#f7fafc', margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
              <MessagesSquare size={19} color="#25d366" /> Mensagens
            </h2>
            <p style={{ margin: '4px 0 0', fontSize: '12px', color: wsConnected ? '#25d366' : '#a0aec0' }}>
              {wsConnected ? '● Ao vivo' : '○ Conectando...'}
            </p>
          </div>
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {loadingConvs ? (
              <p style={{ textAlign: 'center', color: '#a0aec0', padding: '24px', fontSize: '13px' }}>
                <Loader2 size={16} className="mold-import-spinner" /> Carregando...
              </p>
            ) : conversations.length === 0 ? (
              <p style={{ textAlign: 'center', color: '#718096', padding: '24px', fontSize: '13px' }}>
                Nenhuma conversa ainda. Quando um cliente mandar mensagem, aparece aqui.
              </p>
            ) : (
              conversations.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setSelectedId(c.id)}
                  style={{
                    display: 'block', width: '100%', textAlign: 'left', padding: '12px 16px', border: 'none',
                    borderBottom: '1px solid #161d2c', cursor: 'pointer',
                    background: selectedId === c.id ? '#1a2436' : 'transparent',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '8px' }}>
                    <strong style={{ color: '#f7fafc', fontSize: '13.5px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'flex', alignItems: 'center', gap: '5px' }}>
                      {c.bot_paused ? <BotOff size={12} color="#f6ad55" /> : null}
                      {c.contact_name || c.phone || c.remote_jid}
                    </strong>
                    <span style={{ fontSize: '11px', color: '#718096', flexShrink: 0 }}>{formatTime(c.last_message_at)}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', marginTop: '3px' }}>
                    <span style={{ color: '#a0aec0', fontSize: '12.5px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {c.last_direction === 'out' ? 'Você: ' : ''}{c.last_message_preview || ''}
                    </span>
                    {c.unread_count > 0 && (
                      <span style={{ background: '#25d366', color: '#06210f', borderRadius: '999px', minWidth: '18px', height: '18px', fontSize: '11px', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 5px', flexShrink: 0 }}>
                        {c.unread_count}
                      </span>
                    )}
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        {/* Thread da conversa */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          {!selected ? (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#718096', fontSize: '14px' }}>
              Selecione uma conversa
            </div>
          ) : (
            <>
              <div style={{ padding: '16px 20px', borderBottom: '1px solid #1f293d', display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{ width: '34px', height: '34px', borderRadius: '50%', background: '#1a202c', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <UserIcon size={17} color="#a0aec0" />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ color: '#f7fafc', fontWeight: 600, fontSize: '14.5px' }}>{selected.contact_name || selected.phone || selected.remote_jid}</div>
                  {selected.contact_name && selected.phone && <div style={{ color: '#718096', fontSize: '12px' }}>{selected.phone}</div>}
                </div>
                <button
                  type="button"
                  onClick={() => void handleToggleBotPaused()}
                  title={selected.bot_paused ? 'Retomar o bot nessa conversa' : 'Pausar o bot pra falar direto com o cliente'}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: '6px', border: '1px solid',
                    borderColor: selected.bot_paused ? '#f6ad55' : '#2d3748',
                    background: selected.bot_paused ? 'rgba(246,173,85,0.12)' : '#1a202c',
                    color: selected.bot_paused ? '#f6ad55' : '#a0aec0',
                    borderRadius: '8px', padding: '7px 12px', fontSize: '12px', fontWeight: 600, cursor: 'pointer', flexShrink: 0,
                  }}
                >
                  {selected.bot_paused ? <><BotOff size={14} /> Bot pausado — retomar</> : <><Bot size={14} /> Pausar bot</>}
                </button>
              </div>

              <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {loadingMsgs ? (
                  <p style={{ textAlign: 'center', color: '#a0aec0', fontSize: '13px' }}>
                    <Loader2 size={16} className="mold-import-spinner" /> Carregando conversa...
                  </p>
                ) : (
                  messages.map((m) => (
                    <div key={m.id} style={{ display: 'flex', justifyContent: m.direction === 'out' ? 'flex-end' : 'flex-start' }}>
                      <div style={{
                        maxWidth: '70%', padding: '9px 13px', borderRadius: '12px', fontSize: '13.5px', lineHeight: 1.4,
                        background: m.direction === 'out' ? '#1f6f47' : '#1a202c',
                        color: '#f0f4f8',
                        borderBottomRightRadius: m.direction === 'out' ? '3px' : '12px',
                        borderBottomLeftRadius: m.direction === 'out' ? '12px' : '3px',
                      }}>
                        <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{m.body}</div>
                        <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.5)', marginTop: '3px', textAlign: 'right' }}>{formatTime(m.created_at)}</div>
                      </div>
                    </div>
                  ))
                )}
              </div>

              <div style={{ padding: '14px 20px', borderTop: '1px solid #1f293d', display: 'flex', gap: '10px' }}>
                <input
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void handleSend(); } }}
                  placeholder="Digite uma mensagem..."
                  style={{ flex: 1, background: '#0d1420', border: '1px solid #2d3748', borderRadius: '10px', padding: '11px 14px', color: '#f7fafc', fontSize: '14px' }}
                />
                <button
                  type="button"
                  onClick={() => void handleSend()}
                  disabled={sending || !input.trim()}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', background: '#25d366', color: '#06210f', border: 'none', borderRadius: '10px', padding: '0 18px', fontSize: '14px', fontWeight: 700, cursor: sending ? 'default' : 'pointer' }}
                >
                  {sending ? <Loader2 size={16} className="mold-import-spinner" /> : <Send size={16} />}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
