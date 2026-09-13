import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  addEdge,
  useNodesState,
  useEdgesState,
  MarkerType,
  type Node,
  type Edge,
  type Connection,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Bot, Plus, Trash2, ArrowLeft, Save, Loader2, MessageSquare, HelpCircle, Flag, X, UserSearch, ClipboardList, Headset, Clock } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import type { ChatbotFlowSummary, ChatbotFlowNodeData, ChatbotFlowNodeType, ChatbotFlowOption, ChatbotFlowGraph } from '../types';
import { chatbotNodeTypes } from './chatbot/ChatbotFlowNodes';

function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;
}

function emptyGraph(): ChatbotFlowGraph {
  return {
    nodes: [{ id: newId('n'), type: 'message', position: { x: 60, y: 60 }, data: { text: 'Oi! Tudo bem? 😊' } }],
    edges: [],
  };
}

// ---------------------------------------------------------------------------
// Lista de fluxos
// ---------------------------------------------------------------------------

function FlowList({ onOpen }: { onOpen: (id: number) => void }) {
  const { token } = useAuth();
  const [flows, setFlows] = useState<ChatbotFlowSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const r = await api.adminChatbotFlows(token);
      setFlows(r.data);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { void load(); }, [load]);

  const handleCreate = async () => {
    if (!token || !newName.trim()) return;
    setCreating(true);
    try {
      const r = await api.adminChatbotCreateFlow(newName.trim(), token);
      await api.adminChatbotUpdateFlow(r.data.id, { flow: emptyGraph() }, token);
      setNewName('');
      await load();
      onOpen(r.data.id);
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!token || !window.confirm('Apagar esse fluxo? Não tem como desfazer.')) return;
    await api.adminChatbotDeleteFlow(id, token);
    await load();
  };

  return (
    <div className="bandeira-workspace" style={{ padding: '24px' }}>
      <div style={{ width: '100%', maxWidth: '760px', margin: '0 auto', background: '#111622', border: '1px solid #1f293d', borderRadius: '14px', padding: '24px' }}>
        <div style={{ marginBottom: '18px', borderBottom: '1px solid #1f293d', paddingBottom: '16px' }}>
          <h2 style={{ fontSize: '22px', fontWeight: 700, color: '#f7fafc', margin: 0, display: 'flex', alignItems: 'center', gap: '10px' }}>
            <Bot size={22} color="#25d366" /> Chatbot
          </h2>
          <p style={{ color: '#a0aec0', margin: '4px 0 0', fontSize: '13.5px' }}>
            Monte fluxos de atendimento automático — o cliente manda uma palavra-chave e o bot responde sozinho seguindo o fluxo que você desenhar.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '10px', marginBottom: '18px' }}>
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Nome do novo fluxo (ex: Boas-vindas)"
            style={{ flex: 1, background: '#0d1420', border: '1px solid #2d3748', borderRadius: '10px', padding: '11px 14px', color: '#f7fafc', fontSize: '14px' }}
          />
          <button
            type="button"
            onClick={() => void handleCreate()}
            disabled={creating || !newName.trim()}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', background: '#25d366', color: '#06210f', border: 'none', borderRadius: '10px', padding: '0 18px', fontSize: '14px', fontWeight: 700, cursor: 'pointer' }}
          >
            {creating ? <Loader2 size={16} className="mold-import-spinner" /> : <Plus size={16} />} Novo fluxo
          </button>
        </div>

        {loading ? (
          <p style={{ textAlign: 'center', color: '#a0aec0' }}><Loader2 size={16} className="mold-import-spinner" /> Carregando...</p>
        ) : flows.length === 0 ? (
          <p style={{ textAlign: 'center', color: '#718096', padding: '24px', fontSize: '13.5px' }}>Nenhum fluxo criado ainda.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {flows.map((f) => (
              <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: '12px', background: '#141b2b', border: '1px solid #24304f', borderRadius: '12px', padding: '14px 16px' }}>
                <button type="button" onClick={() => onOpen(f.id)} style={{ flex: 1, textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer' }}>
                  <div style={{ color: '#f7fafc', fontWeight: 600, fontSize: '14.5px' }}>{f.name}</div>
                  <div style={{ color: '#718096', fontSize: '12px', marginTop: '2px' }}>
                    {f.trigger_keyword ? `Gatilho: "${f.trigger_keyword}"` : 'Sem palavra-chave (fluxo de fallback)'}
                  </div>
                </button>
                <span style={{ fontSize: '11.5px', fontWeight: 700, padding: '4px 10px', borderRadius: '999px', background: f.is_active ? 'rgba(37,211,102,0.14)' : 'rgba(160,174,192,0.12)', color: f.is_active ? '#25d366' : '#a0aec0' }}>
                  {f.is_active ? 'Ativo' : 'Inativo'}
                </span>
                <button type="button" onClick={() => void handleDelete(f.id)} style={{ background: 'none', border: 'none', color: '#f56565', cursor: 'pointer', padding: '4px' }}>
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Editor visual de um fluxo
// ---------------------------------------------------------------------------

function FlowEditorInner({ flowId, onBack }: { flowId: number; onBack: () => void }) {
  const { token } = useAuth();
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [triggerKeyword, setTriggerKeyword] = useState('');
  const [isActive, setIsActive] = useState(false);
  const [saving, setSaving] = useState(false);
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<Record<string, unknown>>>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    api.adminChatbotFlow(flowId, token).then((r) => {
      setName(r.data.name);
      setTriggerKeyword(r.data.trigger_keyword || '');
      setIsActive(!!r.data.is_active);
      const graph = r.data.flow?.nodes?.length ? r.data.flow : emptyGraph();
      setNodes(graph.nodes.map((n) => ({ id: n.id, type: n.type, position: n.position, data: n.data as unknown as Record<string, unknown> })));
      setEdges(graph.edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle: e.sourceHandle ?? null,
        targetHandle: e.targetHandle ?? null,
        type: 'default',
        style: { stroke: '#25d366', strokeWidth: 2.5 },
      })));
      setLoading(false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flowId, token]);

  const onConnect = useCallback((connection: Connection) => {
    setEdges((eds) => addEdge({
      ...connection,
      sourceHandle: connection.sourceHandle ?? null,
      targetHandle: connection.targetHandle ?? null,
      id: newId('e'),
      type: 'default',
      style: { stroke: '#25d366', strokeWidth: 2.5 },
    }, eds));
  }, [setEdges]);

  const selectedNode = useMemo(() => nodes.find((n) => n.id === selectedId) ?? null, [nodes, selectedId]);
  const selectedData = (selectedNode?.data ?? {}) as unknown as ChatbotFlowNodeData;

  const updateNodeData = (id: string, patch: Partial<ChatbotFlowNodeData>) => {
    setNodes((nds) => nds.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } as unknown as Record<string, unknown> } : n)));
  };

  const addNode = (type: ChatbotFlowNodeType) => {
    const id = newId('n');
    const defaultData: ChatbotFlowNodeData = type === 'question' ? { text: '', options: [] } : { text: '' };
    const position = { x: 80 + (nodes.length % 4) * 40, y: 60 + nodes.length * 90 };
    setNodes((nds) => [...nds, { id, type, position, data: defaultData as unknown as Record<string, unknown> }]);
    setSelectedId(id);
  };

  const addOption = (nodeId: string) => {
    const opt: ChatbotFlowOption = { id: newId('opt'), label: '', matchKeywords: '' };
    setNodes((nds) => nds.map((n) => {
      if (n.id !== nodeId) return n;
      const data = n.data as unknown as ChatbotFlowNodeData;
      return { ...n, data: { ...data, options: [...(data.options || []), opt] } as unknown as Record<string, unknown> };
    }));
  };

  const updateOption = (nodeId: string, optId: string, patch: Partial<ChatbotFlowOption>) => {
    setNodes((nds) => nds.map((n) => {
      if (n.id !== nodeId) return n;
      const data = n.data as unknown as ChatbotFlowNodeData;
      return { ...n, data: { ...data, options: (data.options || []).map((o) => (o.id === optId ? { ...o, ...patch } : o)) } as unknown as Record<string, unknown> };
    }));
  };

  const removeOption = (nodeId: string, optId: string) => {
    setNodes((nds) => nds.map((n) => {
      if (n.id !== nodeId) return n;
      const data = n.data as unknown as ChatbotFlowNodeData;
      return { ...n, data: { ...data, options: (data.options || []).filter((o) => o.id !== optId) } as unknown as Record<string, unknown> };
    }));
    setEdges((eds) => eds.filter((e) => !(e.source === nodeId && e.sourceHandle === optId)));
  };

  const handleSave = async () => {
    if (!token) return;
    setSaving(true);
    try {
      const graph: ChatbotFlowGraph = {
        nodes: nodes.map((n) => ({ id: n.id, type: n.type as ChatbotFlowNodeType, position: n.position, data: n.data as unknown as ChatbotFlowNodeData })),
        edges: edges.map((e) => ({ id: e.id, source: e.source, target: e.target, sourceHandle: e.sourceHandle ?? null, targetHandle: e.targetHandle ?? null })),
      };
      await api.adminChatbotUpdateFlow(flowId, { name, trigger_keyword: triggerKeyword, is_active: isActive, flow: graph }, token);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div style={{ padding: '60px', textAlign: 'center', color: '#a0aec0' }}><Loader2 size={20} className="mold-import-spinner" /> Carregando fluxo...</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '86vh', minHeight: '560px' }}>
      {/* Barra superior: nome, gatilho, ativo, salvar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 18px', borderBottom: '1px solid #1f293d', background: '#111622', flexWrap: 'wrap' }}>
        <button type="button" onClick={onBack} style={{ background: 'none', border: 'none', color: '#a0aec0', cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
          <ArrowLeft size={18} />
        </button>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Nome do fluxo"
          style={{ background: '#0d1420', border: '1px solid #2d3748', borderRadius: '8px', padding: '8px 12px', color: '#f7fafc', fontSize: '14px', fontWeight: 600, width: '200px' }}
        />
        <input
          type="text"
          value={triggerKeyword}
          onChange={(e) => setTriggerKeyword(e.target.value)}
          placeholder="Palavra-chave (ex: oi, preço) — deixe vazio pra fallback"
          style={{ background: '#0d1420', border: '1px solid #2d3748', borderRadius: '8px', padding: '8px 12px', color: '#f7fafc', fontSize: '13px', width: '280px' }}
        />
        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: '#a0aec0', cursor: 'pointer' }}>
          <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} /> Ativo
        </label>
        <div style={{ flex: 1 }} />
        <button
          type="button"
          onClick={() => addNode('message')}
          style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', background: '#1a202c', border: '1px solid #2d3748', color: '#63b3ed', borderRadius: '8px', padding: '8px 12px', fontSize: '12.5px', fontWeight: 600, cursor: 'pointer' }}
        >
          <MessageSquare size={14} /> Mensagem
        </button>
        <button
          type="button"
          onClick={() => addNode('question')}
          style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', background: '#1a202c', border: '1px solid #2d3748', color: '#f6e05e', borderRadius: '8px', padding: '8px 12px', fontSize: '12.5px', fontWeight: 600, cursor: 'pointer' }}
        >
          <HelpCircle size={14} /> Pergunta
        </button>
        <button
          type="button"
          onClick={() => addNode('identify')}
          style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', background: '#1a202c', border: '1px solid #2d3748', color: '#b794f4', borderRadius: '8px', padding: '8px 12px', fontSize: '12.5px', fontWeight: 600, cursor: 'pointer' }}
        >
          <UserSearch size={14} /> Identificar cliente
        </button>
        <button
          type="button"
          onClick={() => addNode('plans')}
          style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', background: '#1a202c', border: '1px solid #2d3748', color: '#4fd1c5', borderRadius: '8px', padding: '8px 12px', fontSize: '12.5px', fontWeight: 600, cursor: 'pointer' }}
        >
          <ClipboardList size={14} /> Mostrar planos
        </button>
        <button
          type="button"
          onClick={() => addNode('handoff')}
          style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', background: '#1a202c', border: '1px solid #2d3748', color: '#f687b3', borderRadius: '8px', padding: '8px 12px', fontSize: '12.5px', fontWeight: 600, cursor: 'pointer' }}
        >
          <Headset size={14} /> Falar com humano
        </button>
        <button
          type="button"
          onClick={() => addNode('end')}
          style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', background: '#1a202c', border: '1px solid #2d3748', color: '#fc8181', borderRadius: '8px', padding: '8px 12px', fontSize: '12.5px', fontWeight: 600, cursor: 'pointer' }}
        >
          <Flag size={14} /> Fim
        </button>
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={saving}
          style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', background: '#25d366', color: '#06210f', border: 'none', borderRadius: '8px', padding: '8px 16px', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}
        >
          {saving ? <Loader2 size={15} className="mold-import-spinner" /> : <Save size={15} />} Salvar
        </button>
      </div>

      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            nodeTypes={chatbotNodeTypes}
            onNodeClick={(_, node) => setSelectedId(node.id)}
            onPaneClick={() => setSelectedId(null)}
            deleteKeyCode={['Delete']}
            colorMode="dark"
            defaultEdgeOptions={{ type: 'default', style: { stroke: '#25d366', strokeWidth: 2.5 }, markerEnd: { type: MarkerType.ArrowClosed, color: '#25d366' } }}
            fitView
          >
            <Background />
            <Controls />
            <MiniMap pannable zoomable style={{ background: '#111622' }} />
          </ReactFlow>
        </div>

        {/* Painel de propriedades do no selecionado */}
        {selectedNode && (
          <div style={{ width: '300px', flexShrink: 0, borderLeft: '1px solid #1f293d', background: '#0d1420', padding: '16px', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
              <strong style={{ color: '#f7fafc', fontSize: '13.5px' }}>
                {selectedNode.type === 'message' ? 'Mensagem'
                  : selectedNode.type === 'question' ? 'Pergunta / Menu'
                  : selectedNode.type === 'identify' ? 'Identificar cliente'
                  : selectedNode.type === 'plans' ? 'Mostrar planos'
                  : selectedNode.type === 'handoff' ? 'Falar com humano'
                  : 'Fim do fluxo'}
              </strong>
              <button type="button" onClick={() => setSelectedId(null)} style={{ background: 'none', border: 'none', color: '#718096', cursor: 'pointer' }}><X size={16} /></button>
            </div>

            {selectedNode.type === 'identify' && (
              <p style={{ color: '#a0aec0', fontSize: '11.5px', margin: '0 0 10px' }}>
                O sistema confere sozinho pelo número do WhatsApp se é um cliente cadastrado. Se não achar, manda a pergunta abaixo e confere a resposta pelo e-mail. Ligue as saídas <strong style={{ color: '#68d391' }}>É cliente</strong> / <strong style={{ color: '#fc8181' }}>Não é cliente</strong> ao próximo passo.
              </p>
            )}

            {selectedNode.type === 'plans' && (
              <p style={{ color: '#a0aec0', fontSize: '11.5px', margin: '0 0 10px' }}>
                Não precisa escrever nada aqui — na hora de mandar, o bot monta a lista com os planos ativos de verdade (nome, valor e dias de acesso), direto do cadastro de planos.
              </p>
            )}

            {selectedNode.type === 'handoff' && (
              <p style={{ color: '#a0aec0', fontSize: '11.5px', margin: '0 0 10px' }}>
                Ao chegar aqui, o bot manda a mensagem abaixo, <strong>pausa</strong> nessa conversa (não responde mais até você retomar no chat de Mensagens) e te avisa por notificação com um resumo do que o cliente perguntou.
              </p>
            )}

            {selectedNode.type !== 'plans' && (
              <>
                <label style={{ display: 'block', color: '#a0aec0', fontSize: '12px', marginBottom: '4px' }}>
                  {selectedNode.type === 'question' ? 'Texto da pergunta'
                    : selectedNode.type === 'identify' ? 'Pergunta do e-mail (se não achar pelo telefone)'
                    : selectedNode.type === 'handoff' ? 'Mensagem ao encaminhar'
                    : 'Texto da mensagem'}
                </label>
                <textarea
                  value={selectedData.text || ''}
                  onChange={(e) => updateNodeData(selectedNode.id, { text: e.target.value })}
                  rows={4}
                  style={{ width: '100%', background: '#141b2b', border: '1px solid #2d3748', borderRadius: '8px', padding: '10px', color: '#f7fafc', fontSize: '13px', resize: 'vertical', marginBottom: '14px' }}
                />
              </>
            )}

            {selectedNode.type === 'message' && (
              <>
                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#a0aec0', fontSize: '12px', marginBottom: '4px' }}>
                  <Clock size={13} /> Tempo "digitando..." antes de mandar (segundos)
                </label>
                <input
                  type="number"
                  min={0}
                  max={8}
                  step={0.5}
                  value={selectedData.typingDelaySec ?? 0}
                  onChange={(e) => updateNodeData(selectedNode.id, { typingDelaySec: Math.max(0, Math.min(8, Number(e.target.value) || 0)) })}
                  style={{ width: '100%', background: '#141b2b', border: '1px solid #2d3748', borderRadius: '8px', padding: '9px 10px', color: '#f7fafc', fontSize: '13px', marginBottom: '4px' }}
                />
                <p style={{ color: '#718096', fontSize: '11px', margin: '0 0 14px' }}>0 = manda na hora, sem esperar. Máximo 8s.</p>
              </>
            )}

            {(selectedNode.type === 'question' || selectedNode.type === 'identify') && (
              <p style={{ color: '#718096', fontSize: '11px', margin: '0 0 10px', padding: '8px', background: '#141b2b', borderRadius: '6px' }}>
                💡 O cliente pode digitar <strong style={{ color: '#a0aec0' }}>"voltar"</strong> a qualquer momento pra voltar pro passo anterior — funciona sozinho, não precisa desenhar nada.
              </p>
            )}

            {selectedNode.type === 'question' && (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                  <span style={{ color: '#a0aec0', fontSize: '12px' }}>Opções (conecte cada uma a um próximo passo)</span>
                  <button type="button" onClick={() => addOption(selectedNode.id)} style={{ background: 'none', border: '1px solid #2d3748', color: '#25d366', borderRadius: '6px', padding: '3px 8px', fontSize: '11px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <Plus size={12} /> Opção
                  </button>
                </div>
                {(selectedData.options || []).map((opt, idx) => (
                  <div key={opt.id} style={{ background: '#141b2b', border: '1px solid #24304f', borderRadius: '8px', padding: '8px', marginBottom: '8px' }}>
                    <div style={{ display: 'flex', gap: '6px', marginBottom: '6px' }}>
                      <span style={{ color: '#718096', fontSize: '12px', paddingTop: '7px' }}>{idx + 1}.</span>
                      <input
                        type="text"
                        value={opt.label}
                        onChange={(e) => updateOption(selectedNode.id, opt.id, { label: e.target.value })}
                        placeholder="Texto da opção (ex: Ver preços)"
                        style={{ flex: 1, background: '#0d1420', border: '1px solid #2d3748', borderRadius: '6px', padding: '6px 8px', color: '#f7fafc', fontSize: '12.5px' }}
                      />
                      <button type="button" onClick={() => removeOption(selectedNode.id, opt.id)} style={{ background: 'none', border: 'none', color: '#f56565', cursor: 'pointer' }}><X size={14} /></button>
                    </div>
                    <input
                      type="text"
                      value={opt.matchKeywords || ''}
                      onChange={(e) => updateOption(selectedNode.id, opt.id, { matchKeywords: e.target.value })}
                      placeholder="Outras palavras que valem (separadas por vírgula)"
                      style={{ width: '100%', background: '#0d1420', border: '1px solid #2d3748', borderRadius: '6px', padding: '6px 8px', color: '#a0aec0', fontSize: '11.5px' }}
                    />
                  </div>
                ))}
                <p style={{ color: '#718096', fontSize: '11px', margin: '6px 0 0' }}>
                  O cliente pode responder com o número (ex: "1"), o texto da opção, ou uma das palavras extras. Arraste da bolinha ao lado de cada opção até o próximo bloco.
                </p>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function FlowEditor(props: { flowId: number; onBack: () => void }) {
  return (
    <ReactFlowProvider>
      <FlowEditorInner {...props} />
    </ReactFlowProvider>
  );
}

// ---------------------------------------------------------------------------

export function AdminChatbotPage() {
  const [openFlowId, setOpenFlowId] = useState<number | null>(null);

  if (openFlowId !== null) {
    return (
      <div className="bandeira-workspace" style={{ padding: '24px' }}>
        <div style={{ width: '100%', maxWidth: '1200px', margin: '0 auto', background: '#111622', border: '1px solid #1f293d', borderRadius: '14px', overflow: 'hidden' }}>
          <FlowEditor flowId={openFlowId} onBack={() => setOpenFlowId(null)} />
        </div>
      </div>
    );
  }

  return <FlowList onOpen={setOpenFlowId} />;
}
