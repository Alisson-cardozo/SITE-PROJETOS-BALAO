import { useCallback, useEffect, useState } from 'react';
import { Loader2, Send, Mail, Users, CheckCircle2, AlertTriangle, MessageSquare } from 'lucide-react';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import type { Comunicado, User } from '../types';

function formatDataHora(iso: string | null | undefined): string {
  if (!iso) return '-';
  const match = iso.trim().match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
  if (!match) return iso;
  const [, year, month, day, hour, minute] = match;
  return `${day}/${month}/${year} ${hour}:${minute}`;
}

export function AdminComunicadosPage() {
  const { token } = useAuth();
  const [comunicados, setComunicados] = useState<Comunicado[]>([]);
  const [systemUsers, setSystemUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Form states
  const [titulo, setTitulo] = useState('');
  const [conteudo, setConteudo] = useState('');
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<{ sent: number; failed: number } | null>(null);

  // E-mail filters states
  const [sendEmailTo, setSendEmailTo] = useState<'all' | 'selected'>('all');
  const [selectedEmails, setSelectedEmails] = useState<string[]>([]);
  const [searchUser, setSearchUser] = useState('');

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      // Carregar comunicados
      const response = await api.adminListComunicados(token);
      setComunicados(response.data);

      // Carregar usuarios para a selecao de e-mails (todos, independente de status)
      const usersResponse = await api.adminListUsers(token);
      const activeClients = usersResponse.data.filter(
        (u) => u.role === 'user' && u.email
      );
      setSystemUsers(activeClients);
      // Inicializar marcando todos por padrao
      setSelectedEmails(activeClients.map((u) => u.email));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível carregar os dados.');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    if (titulo.trim().length < 3) {
      alert('O título precisa ter pelo menos 3 caracteres.');
      return;
    }
    if (conteudo.trim().length < 5) {
      alert('A mensagem precisa ter pelo menos 5 caracteres.');
      return;
    }

    if (sendEmailTo === 'selected' && selectedEmails.length === 0) {
      alert('Selecione pelo menos 1 cliente para enviar o e-mail ou mude a opção para todos.');
      return;
    }

    setSending(true);
    setSendResult(null);
    try {
      const response = await api.adminCreateComunicado(
        {
          titulo,
          conteudo,
          send_email_to: sendEmailTo,
          emails: sendEmailTo === 'selected' ? selectedEmails : undefined,
        },
        token
      );
      setSendResult(response.email_stats);
      setTitulo('');
      setConteudo('');
      // Limpa selecao
      setSelectedEmails(systemUsers.map((u) => u.email));
      setSendEmailTo('all');
      setSearchUser('');
      // Recarrega lista
      await load();
      alert('Comunicado enviado com sucesso!');
    } catch (err) {
      alert(err instanceof ApiError ? err.message : 'Falha ao enviar comunicado.');
    } finally {
      setSending(false);
    }
  };

  // Funcoes auxiliares de multiselecao
  const handleToggleUser = (email: string) => {
    setSelectedEmails((prev) =>
      prev.includes(email) ? prev.filter((e) => e !== email) : [...prev, email]
    );
  };

  const handleSelectAll = () => {
    setSelectedEmails(systemUsers.map((u) => u.email));
  };

  const handleSelectNone = () => {
    setSelectedEmails([]);
  };

  const filteredUsersForSelection = systemUsers.filter((u) => {
    const term = searchUser.toLowerCase();
    return u.name.toLowerCase().includes(term) || u.email.toLowerCase().includes(term);
  });

  return (
    <div className="bandeira-workspace" style={{ padding: '24px' }}>
      <div style={{ width: '100%', maxWidth: '1200px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '24px' }}>
        
        {/* Header */}
        <div style={{ background: '#111622', border: '1px solid #1f293d', borderRadius: '12px', padding: '24px' }}>
          <h2 style={{ fontSize: '24px', fontWeight: 600, color: '#f7fafc', margin: 0 }}>Comunicação em Massa</h2>
          <p style={{ color: '#a0aec0', margin: '4px 0 0 0', fontSize: '14px' }}>
            Envie avisos importantes. O comunicado será exibido como pop-up centralizado para <strong>todos</strong> os clientes no sistema, mas você pode selecionar quais deles devem receber a cópia por e-mail.
          </p>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(350px, 1fr))', gap: '24px' }}>
          
          {/* Form de Criação */}
          <div style={{ background: '#111622', border: '1px solid #1f293d', borderRadius: '12px', padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <h3 style={{ fontSize: '18px', fontWeight: 600, color: '#f7fafc', margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Send size={18} color="#3182ce" />
              Novo Comunicado
            </h3>

            <form onSubmit={(e) => void handleSubmit(e)} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: '13px', color: '#a0aec0', fontWeight: 500 }}>Título do Comunicado</label>
                <input
                  type="text"
                  placeholder="Ex: Atualização no sistema de moldes tacos"
                  value={titulo}
                  onChange={(e) => setTitulo(e.target.value)}
                  required
                  disabled={sending}
                  style={{
                    padding: '10px 12px',
                    background: '#161e2e',
                    border: '1px solid #2d3748',
                    borderRadius: '6px',
                    color: '#fff',
                    fontSize: '14px',
                    outline: 'none'
                  }}
                />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: '13px', color: '#a0aec0', fontWeight: 500 }}>Conteúdo da Mensagem</label>
                <textarea
                  placeholder="Escreva a mensagem aqui. Ela será formatada por e-mail e exibida no pop-up..."
                  value={conteudo}
                  onChange={(e) => setConteudo(e.target.value)}
                  required
                  disabled={sending}
                  rows={8}
                  style={{
                    padding: '10px 12px',
                    background: '#161e2e',
                    border: '1px solid #2d3748',
                    borderRadius: '6px',
                    color: '#fff',
                    fontSize: '14px',
                    outline: 'none',
                    resize: 'vertical',
                    fontFamily: 'inherit'
                  }}
                />
              </div>

              {/* Seletor de Envio por E-mail */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', borderTop: '1px solid #1f293d', paddingTop: '16px' }}>
                <label style={{ fontSize: '13px', color: '#a0aec0', fontWeight: 500 }}>Quem deve receber por e-mail?</label>
                <div style={{ display: 'flex', gap: '16px', margin: '4px 0' }}>
                  <label style={{ color: '#fff', fontSize: '14px', display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                    <input
                      type="radio"
                      name="sendEmailTo"
                      value="all"
                      checked={sendEmailTo === 'all'}
                      onChange={() => setSendEmailTo('all')}
                      disabled={sending}
                      style={{ cursor: 'pointer' }}
                    />
                    Todos os clientes ({systemUsers.length})
                  </label>
                  <label style={{ color: '#fff', fontSize: '14px', display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                    <input
                      type="radio"
                      name="sendEmailTo"
                      value="selected"
                      checked={sendEmailTo === 'selected'}
                      onChange={() => setSendEmailTo('selected')}
                      disabled={sending}
                      style={{ cursor: 'pointer' }}
                    />
                    Apenas selecionados ({selectedEmails.length})
                  </label>
                </div>

                {/* Lista de Seleção de Usuários */}
                {sendEmailTo === 'selected' && (
                  <div style={{
                    background: '#161e2e',
                    border: '1px solid #2d3748',
                    borderRadius: '8px',
                    padding: '12px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '10px',
                    maxHeight: '260px'
                  }}>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                      <input
                        type="text"
                        placeholder="Buscar cliente..."
                        value={searchUser}
                        onChange={(e) => setSearchUser(e.target.value)}
                        disabled={sending}
                        style={{
                          padding: '6px 10px',
                          background: '#111622',
                          border: '1px solid #2d3748',
                          borderRadius: '6px',
                          color: '#fff',
                          fontSize: '13px',
                          flex: 1,
                          outline: 'none'
                        }}
                      />
                      <button
                        type="button"
                        onClick={handleSelectAll}
                        disabled={sending}
                        style={{
                          background: '#2d3748',
                          color: '#fff',
                          border: 'none',
                          padding: '6px 10px',
                          borderRadius: '6px',
                          cursor: 'pointer',
                          fontSize: '12px'
                        }}
                      >
                        Todos
                      </button>
                      <button
                        type="button"
                        onClick={handleSelectNone}
                        disabled={sending}
                        style={{
                          background: '#2d3748',
                          color: '#fff',
                          border: 'none',
                          padding: '6px 10px',
                          borderRadius: '6px',
                          cursor: 'pointer',
                          fontSize: '12px'
                        }}
                      >
                        Nenhum
                      </button>
                    </div>

                    <div style={{
                      overflowY: 'auto',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '4px',
                      paddingRight: '4px',
                      flex: 1
                    }}>
                      {filteredUsersForSelection.length === 0 ? (
                        <span style={{ color: '#718096', fontSize: '12px', fontStyle: 'italic', textAlign: 'center', padding: '12px' }}>
                          Nenhum cliente encontrado.
                        </span>
                      ) : (
                        filteredUsersForSelection.map((u) => {
                          const isChecked = selectedEmails.includes(u.email);
                          
                          let statusLabel = 'Pendente';
                          let statusBg = 'rgba(236, 201, 75, 0.1)';
                          let statusColor = '#ecc94b';
                          if (u.status === 'active') {
                            statusLabel = 'Ativo';
                            statusBg = 'rgba(72, 187, 120, 0.1)';
                            statusColor = '#48bb78';
                          } else if (u.status === 'blocked') {
                            statusLabel = 'Bloqueado';
                            statusBg = 'rgba(229, 62, 62, 0.1)';
                            statusColor = '#e53e3e';
                          }

                          return (
                            <label
                              key={u.id}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '8px',
                                padding: '6px 8px',
                                borderRadius: '4px',
                                background: isChecked ? 'rgba(49,130,206,0.1)' : 'transparent',
                                cursor: 'pointer',
                                transition: 'background 0.2s'
                              }}
                            >
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={() => handleToggleUser(u.email)}
                                disabled={sending}
                                style={{ cursor: 'pointer' }}
                              />
                              <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                  <span style={{ color: '#fff', fontSize: '13px', fontWeight: 500 }}>{u.name}</span>
                                  <span style={{
                                    fontSize: '9px',
                                    fontWeight: 600,
                                    padding: '2px 4px',
                                    borderRadius: '3px',
                                    background: statusBg,
                                    color: statusColor,
                                    textTransform: 'uppercase'
                                  }}>{statusLabel}</span>
                                </div>
                                <span style={{ color: '#718096', fontSize: '11px' }}>{u.email}</span>
                              </div>
                            </label>
                          );
                        })
                      )}
                    </div>
                  </div>
                )}
              </div>

              <button
                type="submit"
                disabled={sending}
                style={{
                  background: '#3182ce',
                  color: '#fff',
                  border: 'none',
                  padding: '12px',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontWeight: 600,
                  fontSize: '14px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
                  marginTop: '8px'
                }}
              >
                {sending ? (
                  <>
                    <Loader2 size={16} className="mold-import-spinner" />
                    Disparando para os clientes...
                  </>
                ) : (
                  <>
                    <Send size={16} />
                    Disparar Comunicado
                  </>
                )}
              </button>
            </form>

            {/* Resultado do Envio */}
            {sendResult && (
              <div style={{
                background: '#161e2e',
                border: '1px solid #24304f',
                borderRadius: '8px',
                padding: '16px',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
                marginTop: '8px'
              }}>
                <div style={{ fontWeight: 600, fontSize: '13px', color: '#e2e8f0', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Mail size={16} color="#3182ce" />
                  Status do envio de e-mails:
                </div>
                <div style={{ display: 'flex', gap: '16px', fontSize: '13px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px', color: '#48bb78' }}>
                    <CheckCircle2 size={14} /> {sendResult.sent} enviados
                  </div>
                  {sendResult.failed > 0 && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px', color: '#e53e3e' }}>
                      <AlertTriangle size={14} /> {sendResult.failed} falharam
                    </div>
                  )}
                </div>
              </div>
            )}

          </div>

          {/* Lista de Enviados */}
          <div style={{ background: '#111622', border: '1px solid #1f293d', borderRadius: '12px', padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <h3 style={{ fontSize: '18px', fontWeight: 600, color: '#f7fafc', margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
              <MessageSquare size={18} color="#48bb78" />
              Histórico de Comunicados
            </h3>

            {loading ? (
              <p style={{ color: '#a0aec0', textAlign: 'center', padding: '24px' }}>
                <Loader2 size={16} className="mold-import-spinner" /> Carregando histórico...
              </p>
            ) : error ? (
              <p style={{ color: '#e53e3e', textAlign: 'center' }}>{error}</p>
            ) : comunicados.length === 0 ? (
              <p style={{ color: '#718096', textAlign: 'center', padding: '24px', fontStyle: 'italic' }}>
                Nenhum comunicado enviado ainda.
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', overflowY: 'auto', maxHeight: '550px', paddingRight: '4px' }}>
                {comunicados.map((c) => (
                  <div key={c.id} style={{ background: '#161e2e', border: '1px solid #24304f', borderRadius: '8px', padding: '16px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px' }}>
                      <span style={{ fontWeight: 600, color: '#f7fafc', fontSize: '14px' }}>{c.titulo}</span>
                      <span style={{ fontSize: '11px', color: '#718096' }}>{formatDataHora(c.created_at)}</span>
                    </div>
                    <p style={{ color: '#cbd5e0', fontSize: '13px', margin: '4px 0', whiteSpace: 'pre-wrap', lineHeight: '1.4' }}>{c.conteudo}</p>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: '#48bb78', marginTop: '6px', background: 'rgba(72,187,120,0.06)', padding: '6px 8px', borderRadius: '4px', alignSelf: 'flex-start' }}>
                      <Users size={12} />
                      Visualizado por {c.total_views ?? 0} clientes
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

        </div>

      </div>
    </div>
  );
}
