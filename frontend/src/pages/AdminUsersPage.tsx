import { useCallback, useEffect, useState } from 'react';
import { Loader2, Trash2, Users, DollarSign, CheckCircle2, Clock, Search, Filter } from 'lucide-react';
import { api, ApiError } from '../lib/api';
import { isExpired } from '../lib/access';
import { useAuth } from '../lib/auth';
import type { User, Plano } from '../types';

function formatDataHora(iso: string | null | undefined): string {
  if (!iso) return '-';
  const match = iso.trim().match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
  if (!match) return iso;
  const [, year, month, day, hour, minute] = match;
  return `${day}/${month}/${year} ${hour}:${minute}`;
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
}

function UserRowActions({
  target,
  planos,
  onChanged,
}: {
  target: User;
  planos: Plano[];
  onChanged: (updated: User) => void;
}) {
  const { token } = useAuth();
  const [days, setDays] = useState('30');
  const [selectedPlanoOption, setSelectedPlanoOption] = useState('keep'); // 'keep' | 'manual' | ID_DO_PLANO
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Estados para troca de senha
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [savingPassword, setSavingPassword] = useState(false);

  const locked = target.status !== 'active' || isExpired(target);

  const handleRevokeSession = async () => {
    if (!token) return;
    if (!window.confirm(`Desconectar dispositivo ativo deste cliente?`)) return;
    setError(null);
    setBusy(true);
    try {
      await api.adminRevokeSession(target.id, token);
      onChanged({
        ...target,
        active_session_id: null,
        is_online: false,
        session_device: null,
        last_activity: null
      });
      alert('Sessão revogada com sucesso!');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Nao foi possivel revogar a sessao.');
    } finally {
      setBusy(false);
    }
  };

  const handlePlanoChange = (val: string) => {
    setSelectedPlanoOption(val);
    if (val === 'keep' || val === 'manual') {
      setDays('30');
    } else {
      const p = planos.find(x => x.id === Number(val));
      if (p) {
        setDays(String(p.dias_acesso));
      }
    }
  };

  const handleBlock = async () => {
    if (!token) return;
    setError(null);
    setBusy(true);
    try {
      const response = await api.adminUpdateUserStatus(target.id, 'blocked', token);
      onChanged(response.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Nao foi possivel bloquear.');
    } finally {
      setBusy(false);
    }
  };

  const handleRevokeAccess = async () => {
    if (!token) return;
    if (!window.confirm(`Remover o acesso do plano de "${target.name}"? Ele ficará sem as abas, como se não tivesse pago.`)) return;
    setError(null);
    setBusy(true);
    try {
      const response = await api.adminRevokeAccess(target.id, token);
      onChanged(response.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Nao foi possivel remover o acesso.');
    } finally {
      setBusy(false);
    }
  };

  const handleGrantAccess = async () => {
    if (!token) return;
    const parsedDays = Number(days);
    if (!parsedDays || parsedDays < 1) {
      setError('Informe a quantidade de dias.');
      return;
    }
    setError(null);
    setBusy(true);

    try {
      let planoIdToSend: number | null | undefined = undefined;
      if (selectedPlanoOption === 'manual') {
        planoIdToSend = null;
      } else if (selectedPlanoOption !== 'keep') {
        planoIdToSend = Number(selectedPlanoOption);
      }

      const response = await api.adminGrantAccess(target.id, parsedDays, token, planoIdToSend);
      onChanged(response.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Nao foi possivel liberar o acesso.');
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!token) return;
    if (!window.confirm(`Excluir o usuario "${target.name}" para sempre?`)) return;
    setError(null);
    setDeleting(true);
    try {
      await api.adminDeleteUser(target.id, token);
      onChanged({ ...target, id: -1 });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Nao foi possivel excluir.');
      setDeleting(false);
    }
  };

  const handleSavePassword = async () => {
    if (!token) return;
    if (newPassword.length < 8) {
      setPasswordError('A senha precisa ter pelo menos 8 caracteres.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('As senhas informadas nao coincidem.');
      return;
    }

    setPasswordError(null);
    setSavingPassword(true);
    try {
      await api.adminUpdateUserPassword(target.id, {
        password: newPassword,
        password_confirmation: confirmPassword
      }, token);
      alert('Senha redefinida com sucesso!');
      setIsChangingPassword(false);
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      setPasswordError(err instanceof ApiError ? err.message : 'Nao foi possivel alterar a senha.');
    } finally {
      setSavingPassword(false);
    }
  };

  if (isChangingPassword) {
    return (
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        background: '#1a202c',
        padding: '12px',
        borderRadius: '8px',
        border: '1px solid #2d3748',
        marginTop: '6px',
        width: '100%',
        boxSizing: 'border-box'
      }}>
        <div style={{ fontWeight: 600, fontSize: '13px', color: '#cbd5e0' }}>Alterar senha de {target.name}</div>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <input
            type="password"
            placeholder="Nova senha (mín. 8 chars)"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            style={{
              padding: '6px 8px',
              borderRadius: '6px',
              border: '1px solid #4a5568',
              backgroundColor: '#111622',
              color: '#fff',
              fontSize: '13px',
              minWidth: '140px',
              flex: 1
            }}
          />
          <input
            type="password"
            placeholder="Confirme a nova senha"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            style={{
              padding: '6px 8px',
              borderRadius: '6px',
              border: '1px solid #4a5568',
              backgroundColor: '#111622',
              color: '#fff',
              fontSize: '13px',
              minWidth: '140px',
              flex: 1
            }}
          />
        </div>
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', alignItems: 'center' }}>
          {passwordError ? <span style={{ color: '#e53e3e', fontSize: '11px', marginRight: 'auto' }}>{passwordError}</span> : null}
          <button
            type="button"
            onClick={() => {
              setIsChangingPassword(false);
              setPasswordError(null);
              setNewPassword('');
              setConfirmPassword('');
            }}
            style={{
              backgroundColor: '#4a5568',
              color: '#fff',
              border: 'none',
              padding: '6px 12px',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '12px'
            }}
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => void handleSavePassword()}
            disabled={savingPassword}
            style={{
              backgroundColor: '#48bb78',
              color: '#fff',
              border: 'none',
              padding: '6px 12px',
              borderRadius: '6px',
              cursor: 'pointer',
              fontWeight: 600,
              fontSize: '12px',
              display: 'flex',
              alignItems: 'center',
              gap: '4px'
            }}
          >
            {savingPassword ? <Loader2 size={12} className="mold-import-spinner" /> : null}
            Salvar
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="admin-user-actions" style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
      <div className="admin-user-actions-row" style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
        {locked ? (
          <>
            {/* Seletor do Plano para liberar */}
            <select
              value={selectedPlanoOption}
              onChange={(e) => handlePlanoChange(e.target.value)}
              style={{
                padding: '6px 8px',
                borderRadius: '6px',
                border: '1px solid #2d3748',
                backgroundColor: '#1a202c',
                color: '#fff',
                fontSize: '13px',
                cursor: 'pointer',
                outline: 'none',
                maxWidth: '180px'
              }}
            >
              <option value="keep">Manter Plano Atual</option>
              <option value="manual">Sem Plano / Manual</option>
              {planos.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nome} ({formatCurrency(p.valor)})
                </option>
              ))}
            </select>

            {/* Input de Dias */}
            <input
              type="number"
              min={1}
              max={3650}
              value={days}
              onChange={(e) => setDays(e.target.value)}
              className="admin-user-days-input"
              style={{
                width: '60px',
                padding: '6px 8px',
                borderRadius: '6px',
                border: '1px solid #2d3748',
                backgroundColor: '#1a202c',
                color: '#fff',
                textAlign: 'center',
                fontSize: '13px'
              }}
              title="Quantidade de dias de acesso"
            />
            <button
              type="button"
              className="mold-secondary-button"
              onClick={() => void handleGrantAccess()}
              disabled={busy}
              style={{
                backgroundColor: '#3182ce',
                color: '#fff',
                border: 'none',
                padding: '6px 12px',
                borderRadius: '6px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                fontWeight: 500,
                fontSize: '13px'
              }}
            >
              {busy ? <Loader2 size={12} className="mold-import-spinner" /> : null}
              Liberar
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={() => void handleRevokeAccess()}
              disabled={busy}
              style={{
                backgroundColor: '#dd6b20',
                color: '#fff',
                border: 'none',
                padding: '6px 12px',
                borderRadius: '6px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                fontWeight: 500,
                fontSize: '13px'
              }}
              title="Deixa o cliente sem as abas, como se não tivesse pago (ele ainda consegue logar)"
            >
              {busy ? <Loader2 size={12} className="mold-import-spinner" /> : null}
              Remover acesso
            </button>
            <button
              type="button"
              className="mold-secondary-button rifa-recusar-button"
              onClick={() => void handleBlock()}
              disabled={busy}
              style={{
                backgroundColor: '#e53e3e',
                color: '#fff',
                border: 'none',
                padding: '6px 12px',
                borderRadius: '6px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                fontWeight: 500,
                fontSize: '13px'
              }}
            >
              {busy ? <Loader2 size={12} className="mold-import-spinner" /> : null}
              Bloquear
            </button>
          </>
        )}

        {/* Botão de Trocar Senha */}
        <button
          type="button"
          onClick={() => setIsChangingPassword(true)}
          style={{
            backgroundColor: '#2b6cb0',
            color: '#fff',
            border: 'none',
            padding: '6px 12px',
            borderRadius: '6px',
            cursor: 'pointer',
            fontSize: '13px',
            fontWeight: 500
          }}
        >
          Senha
        </button>

        {target.active_session_id && (
          <button
            type="button"
            onClick={() => void handleRevokeSession()}
            disabled={busy}
            style={{
              backgroundColor: '#d69e2e',
              color: '#fff',
              border: 'none',
              padding: '6px 12px',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '13px',
              fontWeight: 500,
              display: 'flex',
              alignItems: 'center',
              gap: '4px'
            }}
            title="Desconectar dispositivo ativo deste cliente"
          >
            {busy ? <Loader2 size={12} className="mold-import-spinner" /> : null}
            Desconectar
          </button>
        )}

        <button
          type="button"
          className="mold-secondary-button rifa-recusar-button"
          onClick={() => void handleDelete()}
          disabled={deleting}
          style={{
            backgroundColor: '#4a5568',
            color: '#fff',
            border: 'none',
            padding: '6px 12px',
            borderRadius: '6px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            fontSize: '13px'
          }}
          title="Excluir usuario"
        >
          {deleting ? <Loader2 size={12} className="mold-import-spinner" /> : <Trash2 size={12} />}
          Excluir
        </button>
      </div>
      {error ? <small className="auth-error" style={{ color: '#e53e3e', marginTop: '2px' }}>{error}</small> : null}
    </div>
  );
}

export function AdminUsersPage() {
  const { user: currentUser, token } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [planos, setPlanos] = useState<Plano[]>([]);
  const [stats, setStats] = useState({
    total: 0,
    active: 0,
    expired: 0,
    pending: 0,
    blocked: 0,
    monthly_billing: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filtros
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [planoFilter, setPlanoFilter] = useState('all');

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const response = await api.adminListUsers(token);
      setUsers(response.data);
      setStats(response.stats);

      // Carregar os planos na mesma request sequencial
      const planosResponse = await api.adminListPlanos(token);
      setPlanos(planosResponse.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Nao foi possivel carregar os dados.');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleRowChanged = (updated: User) => {
    if (updated.id === -1) {
      void load();
      return;
    }
    setUsers((prev) => prev.map((u) => (u.id === updated.id ? updated : u)));
    void load();
  };

  // Planos disponíveis dinâmicos
  const planosDisponiveis = Array.from(
    new Set(users.map((u) => u.plano_nome).filter((p): p is string => !!p))
  );

  // Filtragem dos dados
  const filteredUsers = users.filter((u) => {
    const term = search.toLowerCase().trim();
    const matchesSearch =
      u.name.toLowerCase().includes(term) ||
      u.email.toLowerCase().includes(term);

    const isExp = isExpired(u);
    let matchesStatus = true;
    if (statusFilter === 'active') {
      matchesStatus = u.status === 'active' && !isExp;
    } else if (statusFilter === 'expired') {
      matchesStatus = u.status === 'active' && isExp;
    } else if (statusFilter === 'pending') {
      matchesStatus = u.status === 'pending_payment';
    } else if (statusFilter === 'blocked') {
      matchesStatus = u.status === 'blocked';
    }

    let matchesPlano = true;
    if (planoFilter !== 'all') {
      if (planoFilter === 'manual') {
        matchesPlano = !u.plano_nome;
      } else {
        matchesPlano = u.plano_nome === planoFilter;
      }
    }

    return matchesSearch && matchesStatus && matchesPlano;
  });

  return (
    <div className="bandeira-workspace" style={{ padding: '24px' }}>
      <div className="bandeira-main-panel" style={{ width: '100%', maxWidth: '100%', margin: '0 auto', background: '#111622', border: '1px solid #1f293d', borderRadius: '12px', padding: '24px' }}>
        
        {/* Header da Página */}
        <div className="bandeira-panel-header" style={{ marginBottom: '24px', borderBottom: '1px solid #1f293d', paddingBottom: '16px' }}>
          <h2 style={{ fontSize: '24px', fontWeight: 600, color: '#f7fafc', margin: 0 }}>Gerenciamento de Clientes</h2>
          <p style={{ color: '#a0aec0', margin: '4px 0 0 0', fontSize: '14px' }}>Gerencie acessos, planos e visualize o faturamento mensal real.</p>
        </div>

        {/* Dashboard de Métricas / Faturamento */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: '16px',
          marginBottom: '24px'
        }}>
          
          {/* Card Faturamento */}
          <div style={{
            background: 'linear-gradient(135deg, #1e3c72 0%, #2a5298 100%)',
            borderRadius: '10px',
            padding: '20px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            boxShadow: '0 4px 6px rgba(0, 0, 0, 0.15)'
          }}>
            <div>
              <span style={{ fontSize: '12px', color: '#cbd5e0', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Faturamento (Mês)</span>
              <h3 style={{ fontSize: '24px', fontWeight: 700, color: '#fff', margin: '6px 0 0 0' }}>{formatCurrency(stats.monthly_billing)}</h3>
            </div>
            <div style={{ background: 'rgba(255,255,255,0.15)', padding: '10px', borderRadius: '8px' }}>
              <DollarSign size={24} color="#48bb78" />
            </div>
          </div>

          {/* Card Ativos */}
          <div style={{
            background: '#1a202c',
            border: '1px solid #2d3748',
            borderRadius: '10px',
            padding: '20px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between'
          }}>
            <div>
              <span style={{ fontSize: '12px', color: '#a0aec0', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Clientes Ativos</span>
              <h3 style={{ fontSize: '24px', fontWeight: 700, color: '#48bb78', margin: '6px 0 0 0' }}>{stats.active}</h3>
            </div>
            <div style={{ background: 'rgba(72,187,120,0.1)', padding: '10px', borderRadius: '8px' }}>
              <CheckCircle2 size={24} color="#48bb78" />
            </div>
          </div>

          {/* Card Pendentes */}
          <div style={{
            background: '#1a202c',
            border: '1px solid #2d3748',
            borderRadius: '10px',
            padding: '20px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between'
          }}>
            <div>
              <span style={{ fontSize: '12px', color: '#a0aec0', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Aguardando Pgto</span>
              <h3 style={{ fontSize: '24px', fontWeight: 700, color: '#ecc94b', margin: '6px 0 0 0' }}>{stats.pending}</h3>
            </div>
            <div style={{ background: 'rgba(236,201,75,0.1)', padding: '10px', borderRadius: '8px' }}>
              <Clock size={24} color="#ecc94b" />
            </div>
          </div>

          {/* Card Total */}
          <div style={{
            background: '#1a202c',
            border: '1px solid #2d3748',
            borderRadius: '10px',
            padding: '20px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between'
          }}>
            <div>
              <span style={{ fontSize: '12px', color: '#a0aec0', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Total Cadastrados</span>
              <h3 style={{ fontSize: '24px', fontWeight: 700, color: '#fff', margin: '6px 0 0 0' }}>{stats.total}</h3>
            </div>
            <div style={{ background: 'rgba(255,255,255,0.05)', padding: '10px', borderRadius: '8px' }}>
              <Users size={24} color="#a0aec0" />
            </div>
          </div>

        </div>

        {/* Barra de Filtros e Busca */}
        <div style={{
          display: 'flex',
          gap: '12px',
          flexWrap: 'wrap',
          background: '#161e2e',
          padding: '16px',
          borderRadius: '8px',
          marginBottom: '20px',
          border: '1px solid #24304f',
          alignItems: 'center'
        }}>
          
          {/* Busca por texto */}
          <div style={{ position: 'relative', flex: '1', minWidth: '240px' }}>
            <Search size={16} color="#718096" style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)' }} />
            <input
              type="text"
              placeholder="Buscar por nome ou e-mail..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{
                width: '100%',
                padding: '10px 12px 10px 38px',
                background: '#111622',
                border: '1px solid #2d3748',
                borderRadius: '6px',
                color: '#fff',
                fontSize: '14px',
                outline: 'none'
              }}
            />
          </div>

          {/* Filtro por Status */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: '180px' }}>
            <Filter size={14} color="#718096" />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              style={{
                flex: 1,
                padding: '10px',
                background: '#111622',
                border: '1px solid #2d3748',
                borderRadius: '6px',
                color: '#fff',
                fontSize: '14px',
                cursor: 'pointer',
                outline: 'none'
              }}
            >
              <option value="all">Todos os Status</option>
              <option value="active">Ativos</option>
              <option value="pending">Aguardando pagamento</option>
              <option value="expired">Expirados</option>
              <option value="blocked">Bloqueados</option>
            </select>
          </div>

          {/* Filtro por Plano */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: '180px' }}>
            <Filter size={14} color="#718096" />
            <select
              value={planoFilter}
              onChange={(e) => setPlanoFilter(e.target.value)}
              style={{
                flex: 1,
                padding: '10px',
                background: '#111622',
                border: '1px solid #2d3748',
                borderRadius: '6px',
                color: '#fff',
                fontSize: '14px',
                cursor: 'pointer',
                outline: 'none'
              }}
            >
              <option value="all">Todos os Planos</option>
              <option value="manual">Sem Plano / Manual</option>
              {planosDisponiveis.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </div>

        </div>

        {/* Tabela de Usuários */}
        {loading ? (
          <p className="bandeira-size-hint" style={{ padding: '24px 0', textAlign: 'center', color: '#a0aec0' }}>
            <Loader2 size={20} className="mold-import-spinner" style={{ marginRight: '8px' }} /> Carregando clientes...
          </p>
        ) : error ? (
          <p className="mold-import-error" style={{ color: '#e53e3e', textAlign: 'center', padding: '16px' }}>{error}</p>
        ) : (
          <div className="table-scroll" style={{ overflowX: 'auto', overflowY: 'auto', maxHeight: '550px', borderRadius: '8px', border: '1px solid #1f293d' }}>
            <table className="rifa-compradores-table" style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', minWidth: '900px' }}>
              <thead>
                <tr style={{ background: '#161e2e', borderBottom: '1px solid #1f293d', position: 'sticky', top: 0, zIndex: 2 }}>
                  <th style={{ padding: '14px 16px', color: '#a0aec0', fontWeight: 600, fontSize: '13px', background: '#161e2e', position: 'sticky', top: 0 }}>Cliente</th>
                  <th style={{ padding: '14px 16px', color: '#a0aec0', fontWeight: 600, fontSize: '13px', background: '#161e2e', position: 'sticky', top: 0 }}>Papel</th>
                  <th style={{ padding: '14px 16px', color: '#a0aec0', fontWeight: 600, fontSize: '13px', background: '#161e2e', position: 'sticky', top: 0 }}>Status</th>
                  <th style={{ padding: '14px 16px', color: '#a0aec0', fontWeight: 600, fontSize: '13px', background: '#161e2e', position: 'sticky', top: 0 }}>Plano Atual</th>
                  <th style={{ padding: '14px 16px', color: '#a0aec0', fontWeight: 600, fontSize: '13px', background: '#161e2e', position: 'sticky', top: 0 }}>Valor Plano</th>
                  <th style={{ padding: '14px 16px', color: '#a0aec0', fontWeight: 600, fontSize: '13px', background: '#161e2e', position: 'sticky', top: 0 }}>Acesso Até</th>
                  <th style={{ padding: '14px 16px', color: '#a0aec0', fontWeight: 600, fontSize: '13px', background: '#161e2e', position: 'sticky', top: 0 }}>Cadastrado Em</th>
                  <th style={{ padding: '14px 16px', color: '#a0aec0', fontWeight: 600, fontSize: '13px', width: '220px', background: '#161e2e', position: 'sticky', top: 0 }}>Ações</th>
                </tr>
              </thead>
              <tbody>
                {filteredUsers.length === 0 ? (
                  <tr>
                    <td colSpan={8} style={{ padding: '32px', textAlign: 'center', color: '#718096' }}>
                      Nenhum cliente encontrado com os filtros aplicados.
                    </td>
                  </tr>
                ) : (
                  filteredUsers.map((u) => {
                    const isExp = isExpired(u);
                    let statusLabel = '';
                    let statusBg = '';
                    let statusColor = '';

                    if (u.status === 'active') {
                      if (isExp) {
                        statusLabel = 'Expirado';
                        statusBg = 'rgba(229, 62, 62, 0.1)';
                        statusColor = '#f56565';
                      } else {
                        statusLabel = 'Ativo';
                        statusBg = 'rgba(72, 187, 120, 0.1)';
                        statusColor = '#48bb78';
                      }
                    } else if (u.status === 'pending_payment') {
                      statusLabel = 'Aguardando Pgto';
                      statusBg = 'rgba(236, 201, 75, 0.1)';
                      statusColor = '#ecc94b';
                    } else {
                      statusLabel = 'Bloqueado';
                      statusBg = 'rgba(160, 174, 192, 0.1)';
                      statusColor = '#a0aec0';
                    }

                    return (
                      <tr key={u.id} style={{ borderBottom: '1px solid #1f293d', background: '#111622' }}>
                        
                        {/* Cliente Info */}
                        <td style={{ padding: '14px 16px' }}>
                          <div style={{ display: 'flex', flexDirection: 'column' }}>
                            <span style={{ fontWeight: 600, color: '#f7fafc', fontSize: '14px' }}>{u.name}</span>
                            <span style={{ fontSize: '12px', color: '#718096', marginTop: '2px' }}>{u.email}</span>
                            {u.session_device && (
                              <span style={{ fontSize: '11px', color: '#cbd5e0', marginTop: '4px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                💻 {u.session_device}
                              </span>
                            )}
                          </div>
                        </td>

                        {/* Papel */}
                        <td style={{ padding: '14px 16px', color: u.role === 'admin' ? '#ecc94b' : '#cbd5e0', fontSize: '13px' }}>
                          {u.role === 'admin' ? 'Administrador' : 'Usuário'}
                        </td>

                        {/* Status */}
                        <td style={{ padding: '14px 16px' }}>
                          <span style={{
                            padding: '4px 8px',
                            borderRadius: '4px',
                            fontSize: '11px',
                            fontWeight: 600,
                            background: statusBg,
                            color: statusColor,
                            display: 'inline-block',
                            textTransform: 'uppercase'
                          }}>
                            {statusLabel}
                          </span>
                          {u.is_online ? (
                            <span style={{
                              padding: '4px 8px',
                              borderRadius: '4px',
                              fontSize: '11px',
                              fontWeight: 600,
                              background: 'rgba(72, 187, 120, 0.15)',
                              color: '#48bb78',
                              display: 'inline-block',
                              marginLeft: '8px',
                              textTransform: 'uppercase'
                            }}>
                              🟢 Online
                            </span>
                          ) : u.last_activity ? (
                            <span style={{
                              padding: '4px 8px',
                              borderRadius: '4px',
                              fontSize: '11px',
                              fontWeight: 600,
                              background: 'rgba(237, 137, 54, 0.1)',
                              color: '#ed8936',
                              display: 'inline-block',
                              marginLeft: '8px',
                              textTransform: 'uppercase'
                            }} title={`Última atividade: ${formatDataHora(u.last_activity)}`}>
                              Offline
                            </span>
                          ) : null}
                        </td>

                        {/* Plano Nome */}
                        <td style={{ padding: '14px 16px', color: '#e2e8f0', fontSize: '13px', fontWeight: 500 }}>
                          {u.plano_nome || <span style={{ color: '#4a5568', fontStyle: 'italic' }}>Nenhum</span>}
                        </td>

                        {/* Plano Valor */}
                        <td style={{ padding: '14px 16px', color: '#48bb78', fontSize: '13px', fontWeight: 600 }}>
                          {u.plano_valor !== null && u.plano_valor !== undefined ? formatCurrency(u.plano_valor) : '-'}
                        </td>

                        {/* Acesso Até */}
                        <td style={{ padding: '14px 16px', color: '#cbd5e0', fontSize: '13px' }}>
                          {u.access_expires_at ? formatDataHora(u.access_expires_at) : 'Sem limite'}
                        </td>

                        {/* Criado em */}
                        <td style={{ padding: '14px 16px', color: '#718096', fontSize: '13px' }}>
                          {formatDataHora(u.created_at)}
                        </td>

                        {/* Ações */}
                        <td style={{ padding: '14px 16px' }}>
                          {u.id === currentUser?.id ? (
                            <span style={{ color: '#718096', fontSize: '12px', fontStyle: 'italic' }}>Sua conta</span>
                          ) : (
                            <UserRowActions target={u} planos={planos} onChanged={handleRowChanged} />
                          )}
                        </td>

                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
