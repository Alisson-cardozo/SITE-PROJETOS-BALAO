import { Handle, Position, type NodeProps } from '@xyflow/react';
import { MessageSquare, HelpCircle, Flag, UserSearch, ClipboardList, Headset, Clock } from 'lucide-react';
import type { ChatbotFlowNodeData, ChatbotFlowOption } from '../../types';

const CARD_BASE: React.CSSProperties = {
  minWidth: '220px',
  maxWidth: '260px',
  borderRadius: '10px',
  border: '1px solid #2d3748',
  background: '#141b2b',
  color: '#f0f4f8',
  fontSize: '12.5px',
  boxShadow: '0 2px 10px rgba(0,0,0,0.35)',
  position: 'relative',
};

function Header({ icon, label, color, selected }: { icon: React.ReactNode; label: string; color: string; selected?: boolean }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 12px',
      borderBottom: '1px solid #2d3748', borderRadius: '10px 10px 0 0',
      background: color, color: '#06210f', fontWeight: 700, fontSize: '12px',
      outline: selected ? '2px solid #fff' : 'none',
    }}>
      {icon} {label}
    </div>
  );
}

export function MessageNode({ data, selected }: NodeProps) {
  const d = data as unknown as ChatbotFlowNodeData;
  return (
    <div style={CARD_BASE}>
      <Handle type="target" position={Position.Top} />
      <Header icon={<MessageSquare size={13} />} label="Mensagem" color="#63b3ed" selected={selected} />
      <div style={{ padding: '10px 12px', minHeight: '32px', whiteSpace: 'pre-wrap', color: d.text ? '#f0f4f8' : '#718096' }}>
        {d.text || 'Clique pra escrever a mensagem...'}
      </div>
      {d.typingDelaySec ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '0 12px 8px', color: '#a0aec0', fontSize: '11px' }}>
          <Clock size={11} /> {d.typingDelaySec}s digitando antes de mandar
        </div>
      ) : null}
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}

export function PlansNode({ selected }: NodeProps) {
  return (
    <div style={CARD_BASE}>
      <Handle type="target" position={Position.Top} />
      <Header icon={<ClipboardList size={13} />} label="Mostrar planos" color="#4fd1c5" selected={selected} />
      <div style={{ padding: '10px 12px', minHeight: '32px', color: '#a0aec0' }}>
        Manda a lista de planos disponíveis (nome, valor e dias) — atualizada na hora, direto do sistema.
      </div>
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}

export function HandoffNode({ data, selected }: NodeProps) {
  const d = data as unknown as ChatbotFlowNodeData;
  return (
    <div style={CARD_BASE}>
      <Handle type="target" position={Position.Top} />
      <Header icon={<Headset size={13} />} label="Falar com humano" color="#f687b3" selected={selected} />
      <div style={{ padding: '10px 12px', minHeight: '32px', whiteSpace: 'pre-wrap', color: d.text ? '#f0f4f8' : '#718096' }}>
        {d.text || 'Já vou te conectar com um atendente humano, só um momento! 🙋'}
      </div>
      <div style={{ padding: '0 12px 8px', color: '#a0aec0', fontSize: '11px' }}>
        Pausa o bot nessa conversa e avisa o admin — sem saída (fim do fluxo automático).
      </div>
    </div>
  );
}

export function EndNode({ data, selected }: NodeProps) {
  const d = data as unknown as ChatbotFlowNodeData;
  return (
    <div style={CARD_BASE}>
      <Handle type="target" position={Position.Top} />
      <Header icon={<Flag size={13} />} label="Fim do fluxo" color="#fc8181" selected={selected} />
      <div style={{ padding: '10px 12px', minHeight: '32px', whiteSpace: 'pre-wrap', color: d.text ? '#f0f4f8' : '#718096' }}>
        {d.text || '(sem mensagem de encerramento — volta pro atendimento normal)'}
      </div>
    </div>
  );
}

const ROW_H = 30;

export function QuestionNode({ data, selected }: NodeProps) {
  const d = data as unknown as ChatbotFlowNodeData;
  const options: ChatbotFlowOption[] = d.options || [];
  return (
    <div style={{ ...CARD_BASE, paddingBottom: '6px' }}>
      <Handle type="target" position={Position.Top} />
      <Header icon={<HelpCircle size={13} />} label="Pergunta / Menu" color="#f6e05e" selected={selected} />
      <div style={{ padding: '10px 12px 6px', whiteSpace: 'pre-wrap', color: d.text ? '#f0f4f8' : '#718096' }}>
        {d.text || 'Clique pra escrever a pergunta...'}
      </div>
      <div style={{ borderTop: '1px solid #2d3748', marginTop: '2px' }}>
        {options.length === 0 && (
          <div style={{ padding: '8px 12px', color: '#718096', fontSize: '11.5px' }}>Sem opções ainda</div>
        )}
        {options.map((opt, idx) => (
          <div key={opt.id} style={{ position: 'relative', height: ROW_H, display: 'flex', alignItems: 'center', padding: '0 20px 0 12px', borderTop: idx > 0 ? '1px solid #1f293d' : 'none' }}>
            <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{idx + 1}. {opt.label || '(sem texto)'}</span>
            <Handle type="source" position={Position.Right} id={opt.id} style={{ top: '50%' }} />
          </div>
        ))}
      </div>
    </div>
  );
}

export function IdentifyNode({ data, selected }: NodeProps) {
  const d = data as unknown as ChatbotFlowNodeData;
  return (
    <div style={{ ...CARD_BASE, paddingBottom: '6px' }}>
      <Handle type="target" position={Position.Top} />
      <Header icon={<UserSearch size={13} />} label="Identificar cliente" color="#b794f4" selected={selected} />
      <div style={{ padding: '10px 12px 4px', color: '#a0aec0', fontSize: '11.5px' }}>
        Confere pelo número do WhatsApp. Se não achar, pergunta:
      </div>
      <div style={{ padding: '0 12px 8px', whiteSpace: 'pre-wrap', color: d.text ? '#f0f4f8' : '#718096' }}>
        {d.text || 'Clique pra escrever a pergunta do e-mail...'}
      </div>
      <div style={{ borderTop: '1px solid #2d3748' }}>
        <div style={{ position: 'relative', height: ROW_H, display: 'flex', alignItems: 'center', padding: '0 20px 0 12px' }}>
          <span style={{ color: '#68d391' }}>✓ É cliente</span>
          <Handle type="source" position={Position.Right} id="found" style={{ top: '50%' }} />
        </div>
        <div style={{ position: 'relative', height: ROW_H, display: 'flex', alignItems: 'center', padding: '0 20px 0 12px', borderTop: '1px solid #1f293d' }}>
          <span style={{ color: '#fc8181' }}>✕ Não é cliente</span>
          <Handle type="source" position={Position.Right} id="not_found" style={{ top: '50%' }} />
        </div>
      </div>
    </div>
  );
}

export const chatbotNodeTypes = {
  message: MessageNode,
  question: QuestionNode,
  end: EndNode,
  identify: IdentifyNode,
  plans: PlansNode,
  handoff: HandoffNode,
};
