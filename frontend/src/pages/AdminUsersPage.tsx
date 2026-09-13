import { useCallback, useEffect, useState } from 'react';
import { Loader2, Trash2, Users, DollarSign, CheckCircle2, Clock, Search, Filter, Hammer } from 'lucide-react';
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

  const isBlocked = target.status === 'blocked';
  const handleToggleBlock = async () => {
    if (!token) return;
    const next = isBlocked ? 'active' : 'blocked';
    if (!isBlocked && !window.confirm(`Bloquear o acesso de "${target.name}"?\n\nEle NÃO vai conseguir logar nem criar uma conta nova com o e-mail ${target.email}.`)) return;
    setError(null);
    setBusy(true);
    try {
      const response = await api.adminUpdateUserStatus(target.id, next, token);
      onChanged(response.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Nao foi possivel alterar o bloqueio.');
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
          </>
        )}

        {/* Bloquear / Desbloquear (por conta + e-mail) — vale pra qualquer cliente */}
        <button
          type="button"
          onClick={() => void handleToggleBlock()}
          disabled={busy}
          style={{
            backgroundColor: isBlocked ? '#38a169' : '#e53e3e',
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
          title={isBlocked ? 'Liberar o e-mail e a conta deste cliente' : 'Bloqueia a conta e o e-mail (não loga nem cria conta nova)'}
        >
          {busy ? <Loader2 size={12} className="mold-import-spinner" /> : null}
          {isBlocked ? 'Desbloquear' : 'Bloquear'}
        </button>

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
    molds_sold_total: 0,
    molds_billing: 0,
    total_billing: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filtros
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [planoFilter, setPlanoFilter] = useState('all');
  const [pagamentoFilter, setPagamentoFilter] = useState('all'); // all | gerou_nao_pagou | ok
  const [emailFilter, setEmailFilter] = useState('all'); // all | validado | nao_validado
  const [roleFilter, setRoleFilter] = useState('all'); // all | admin | user
  const [onlineFilter, setOnlineFilter] = useState('all'); // all | online | offline

  // Blocklist de e-mails (bloqueio manual)
  const [blockedEmails, setBlockedEmails] = useState<Array<{ id: number; email: string; motivo: string | null; created_at: string }>>([]);
  const [showBlocklist, setShowBlocklist] = useState(false);
  const [blockInput, setBlockInput] = useState('');
  const [blockBusy, setBlockBusy] = useState(false);
  const [blockErr, setBlockErr] = useState<string | null>(null);

  const loadBlocklist = useCallback(async () => {
    if (!token) return;
    try {
      const r = await api.adminListBlockedEmails(token);
      setBlockedEmails(r.data);
    } catch { /* silencioso */ }
  }, [token]);

  const handleBlockEmailManual = async () => {
    if (!token) return;
    const email = blockInput.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { setBlockErr('Informe um e-mail válido.'); return; }
    setBlockBusy(true);
    setBlockErr(null);
    try {
      await api.adminBlockEmail(email, token);
      setBlockInput('');
      await loadBlocklist();
      await load();
    } catch (err) {
      setBlockErr(err instanceof ApiError ? err.message : 'Não foi possível bloquear.');
    } finally {
      setBlockBusy(false);
    }
  };

  const handleUnblockEmail = async (email: string) => {
    if (!token) return;
    try {
      await api.adminUnblockEmail(email, token);
      await loadBlocklist();
    } catch { /* silencioso */ }
  };

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const response = await api.adminListUsers(token);
      setUsers(response.data);
      setStats({
        ...response.stats,
        molds_sold_total: response.stats.molds_sold_total ?? 0,
        molds_billing: response.stats.molds_billing ?? 0,
        total_billing: response.stats.total_billing ?? 0,
      });

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
    void loadBlocklist();
  }, [load, loadBlocklist]);

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

    let matchesPagamento = true;
    if (pagamentoFilter === 'gerou_nao_pagou') {
      matchesPagamento = !!u.has_pending_payment;
    } else if (pagamentoFilter === 'ok') {
      matchesPagamento = !u.has_pending_payment;
    }

    const emailOk = u.role === 'admin' || !!u.email_verified;
    let matchesEmail = true;
    if (emailFilter === 'validado') {
      matchesEmail = emailOk;
    } else if (emailFilter === 'nao_validado') {
      matchesEmail = !emailOk;
    }

    let matchesRole = true;
    if (roleFilter !== 'all') {
      matchesRole = u.role === roleFilter;
    }

    let matchesOnline = true;
    if (onlineFilter === 'online') {
      matchesOnline = !!u.is_online;
    } else if (onlineFilter === 'offline') {
      matchesOnline = !u.is_online;
    }

    return (
      matchesSearch &&
      matchesStatus &&
      matchesPlano &&
      matchesPagamento &&
      matchesEmail &&
      matchesRole &&
      matchesOnline
    );
  });

  return (
    <div className="bandeira-workspace admin-users-page" style={{ padding: '24px' }}>
      <div className="bandeira-main-panel admin-users-panel" style={{ width: '100%', maxWidth: '100%', margin: '0 auto', background: '#111622', border: '1px solid #1f293d', borderRadius: '14px', padding: '24px' }}>
        
        {/* Header da Página */}
        <div className="bandeira-panel-header" style={{ marginBottom: '24px', borderBottom: '1px solid #1f293d', paddingBottom: '16px' }}>
          <h2 style={{ fontSize: '24px', fontWeight: 600, color: '#f7fafc', margin: 0 }}>Gerenciamento de Clientes</h2>
          <p style={{ color: '#a0aec0', margin: '4px 0 0 0', fontSize: '14px' }}>Gerencie acessos, planos e visualize o faturamento mensal real.</p>
        </div>

        {/* Dashboard de Métricas / Faturamento */}
        <div className="admin-stats-grid">

          {/* Card Acessos / Planos */}
          <div className="admin-stat-card" style={{ background: 'linear-gradient(135deg, #1e3c72 0%, #2a5298 100%)', border: 'none' }}>
            <div className="admin-stat-info">
              <span className="admin-stat-label" style={{ color: '#cbd5e0' }}>Acessos / Planos (Mês)</span>
              <h3 className="admin-stat-value">{formatCurrency(stats.monthly_billing)}</h3>
            </div>
            <div className="admin-stat-icon"><DollarSign size={22} color="#9ae6b4" /></div>
          </div>

          {/* Card Vendas de Moldes */}
          <div className="admin-stat-card" style={{ background: 'linear-gradient(135deg, #2d1b4e 0%, #4a2a6e 100%)', border: 'none' }}>
            <div className="admin-stat-info">
              <span className="admin-stat-label" style={{ color: '#d6bcfa' }}>Vendas de Moldes (Mês)</span>
              <h3 className="admin-stat-value">{formatCurrency(stats.molds_billing)}</h3>
              <span className="admin-stat-sub" style={{ color: '#b794f4' }}>{stats.molds_sold_total} molde(s) vendido(s) no total</span>
            </div>
            <div className="admin-stat-icon"><Hammer size={22} color="#d6bcfa" /></div>
          </div>

          {/* Card Faturamento Total (planos + moldes) */}
          <div className="admin-stat-card" style={{ background: 'linear-gradient(135deg, #1a3c2e 0%, #256e4a 100%)', border: 'none' }}>
            <div className="admin-stat-info">
              <span className="admin-stat-label" style={{ color: '#c6f6d5' }}>Faturamento Total (Mês)</span>
              <h3 className="admin-stat-value">{formatCurrency(stats.total_billing)}</h3>
              <span className="admin-stat-sub" style={{ color: '#9ae6b4' }}>Planos + Moldes</span>
            </div>
            <div className="admin-stat-icon"><DollarSign size={22} color="#9ae6b4" /></div>
          </div>

          {/* Card Ativos */}
          <div className="admin-stat-card">
            <div className="admin-stat-info">
              <span className="admin-stat-label">Clientes Ativos</span>
              <h3 className="admin-stat-value" style={{ color: '#48bb78' }}>{stats.active}</h3>
            </div>
            <div className="admin-stat-icon" style={{ background: 'rgba(72,187,120,0.12)' }}><CheckCircle2 size={22} color="#48bb78" /></div>
          </div>

          {/* Card Pendentes */}
          <div className="admin-stat-card">
            <div className="admin-stat-info">
              <span className="admin-stat-label">Aguardando Pgto</span>
              <h3 className="admin-stat-value" style={{ color: '#ecc94b' }}>{stats.pending}</h3>
            </div>
            <div className="admin-stat-icon" style={{ background: 'rgba(236,201,75,0.12)' }}><Clock size={22} color="#ecc94b" /></div>
          </div>

          {/* Card Total */}
          <div className="admin-stat-card">
            <div className="admin-stat-info">
              <span className="admin-stat-label">Total Cadastrados</span>
              <h3 className="admin-stat-value">{stats.total}</h3>
            </div>
            <div className="admin-stat-icon" style={{ background: 'rgba(255,255,255,0.06)' }}><Users size={22} color="#a0aec0" /></div>
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

          {/* Filtro por Pagamento */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: '180px' }}>
            <Filter size={14} color="#718096" />
            <select
              value={pagamentoFilter}
              onChange={(e) => setPagamentoFilter(e.target.value)}
              style={{ flex: 1, padding: '10px', background: '#111622', border: '1px solid #2d3748', borderRadius: '6px', color: '#fff', fontSize: '14px', cursor: 'pointer', outline: 'none' }}
            >
              <option value="all">Pagamento: Todos</option>
              <option value="gerou_nao_pagou">Gerou, não pagou</option>
              <option value="ok">Sem pendência</option>
            </select>
          </div>

          {/* Filtro por E-mail validado */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: '180px' }}>
            <Filter size={14} color="#718096" />
            <select
              value={emailFilter}
              onChange={(e) => setEmailFilter(e.target.value)}
              style={{ flex: 1, padding: '10px', background: '#111622', border: '1px solid #2d3748', borderRadius: '6px', color: '#fff', fontSize: '14px', cursor: 'pointer', outline: 'none' }}
            >
              <option value="all">E-mail: Todos</option>
              <option value="validado">Validado</option>
              <option value="nao_validado">Não validado</option>
            </select>
          </div>

          {/* Filtro por Papel */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: '160px' }}>
            <Filter size={14} color="#718096" />
            <select
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value)}
              style={{ flex: 1, padding: '10px', background: '#111622', border: '1px solid #2d3748', borderRadius: '6px', color: '#fff', fontSize: '14px', cursor: 'pointer', outline: 'none' }}
            >
              <option value="all">Papel: Todos</option>
              <option value="user">Usuário</option>
              <option value="admin">Administrador</option>
            </select>
          </div>

          {/* Filtro por Online */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: '160px' }}>
            <Filter size={14} color="#718096" />
            <select
              value={onlineFilter}
              onChange={(e) => setOnlineFilter(e.target.value)}
              style={{ flex: 1, padding: '10px', background: '#111622', border: '1px solid #2d3748', borderRadius: '6px', color: '#fff', fontSize: '14px', cursor: 'pointer', outline: 'none' }}
            >
              <option value="all">Conexão: Todos</option>
              <option value="online">Online agora</option>
              <option value="offline">Offline</option>
            </select>
          </div>

          {/* Limpar filtros + contador */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginLeft: 'auto' }}>
            <span style={{ color: '#718096', fontSize: '13px', whiteSpace: 'nowrap' }}>
              {filteredUsers.length} de {users.length}
            </span>
            <button
              type="button"
              onClick={() => {
                setSearch('');
                setStatusFilter('all');
                setPlanoFilter('all');
                setPagamentoFilter('all');
                setEmailFilter('all');
                setRoleFilter('all');
                setOnlineFilter('all');
              }}
              style={{ padding: '9px 14px', background: '#2d3748', color: '#cbd5e0', border: '1px solid #4a5568', borderRadius: '6px', fontSize: '13px', cursor: 'pointer', whiteSpace: 'nowrap' }}
            >
              Limpar filtros
            </button>
          </div>

        </div>

        {/* Bloqueio de e-mails (blocklist) — bloquear por e-mail/ID caso queira */}
        <div style={{ marginBottom: '18px', background: '#161e2e', border: '1px solid #24304f', borderRadius: '12px', overflow: 'hidden' }}>
          <button
            type="button"
            onClick={() => setShowBlocklist((v) => !v)}
            style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', background: 'transparent', border: 'none', color: '#f7fafc', padding: '14px 16px', fontSize: '14px', fontWeight: 600, cursor: 'pointer' }}
          >
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
              🚫 Bloqueio de e-mails
              {blockedEmails.length > 0 ? <span style={{ background: 'rgba(229,62,62,0.15)', color: '#f56565', borderRadius: '999px', padding: '2px 9px', fontSize: '12px' }}>{blockedEmails.length}</span> : null}
            </span>
            <span style={{ color: '#718096', fontSize: '13px' }}>{showBlocklist ? 'ocultar ▲' : 'mostrar ▼'}</span>
          </button>
          {showBlocklist && (
            <div style={{ padding: '0 16px 16px' }}>
              <p style={{ color: '#a0aec0', fontSize: '13px', margin: '0 0 12px' }}>
                E-mails aqui <strong>não conseguem logar</strong> nem <strong>criar conta nova</strong>. Bloquear um cliente na lista abaixo (botão <strong>Bloquear</strong>) já adiciona o e-mail dele aqui automaticamente.
              </p>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                <input
                  type="email"
                  value={blockInput}
                  onChange={(e) => { setBlockInput(e.target.value); setBlockErr(null); }}
                  onKeyDown={(e) => { if (e.key === 'Enter') void handleBlockEmailManual(); }}
                  placeholder="email@dobloqueado.com"
                  style={{ flex: '1 1 240px', minWidth: 0, padding: '10px 12px', background: '#111622', border: '1px solid #2d3748', borderRadius: '8px', color: '#fff', fontSize: '14px', outline: 'none' }}
                />
                <button type="button" onClick={() => void handleBlockEmailManual()} disabled={blockBusy} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', background: '#e53e3e', color: '#fff', border: 'none', borderRadius: '8px', padding: '10px 18px', fontSize: '14px', fontWeight: 600, cursor: blockBusy ? 'default' : 'pointer', whiteSpace: 'nowrap' }}>
                  {blockBusy ? <Loader2 size={14} className="mold-import-spinner" /> : null} Bloquear e-mail
                </button>
              </div>
              {blockErr && <p className="mold-import-error" style={{ margin: '8px 0 0' }}>{blockErr}</p>}
              {blockedEmails.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '14px' }}>
                  {blockedEmails.map((b) => (
                    <div key={b.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', background: '#111622', border: '1px solid #2d3748', borderRadius: '8px', padding: '9px 12px' }}>
                      <span style={{ color: '#e2e8f0', fontSize: '13px', wordBreak: 'break-all' }}>
                        {b.email}{b.motivo ? <span style={{ color: '#718096' }}> · {b.motivo}</span> : null}
                      </span>
                      <button type="button" onClick={() => void handleUnblockEmail(b.email)} style={{ background: '#2d3748', color: '#90cdf4', border: '1px solid #4a5568', borderRadius: '6px', padding: '5px 12px', fontSize: '12px', fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}>Desbloquear</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Tabela de Usuários */}
        {loading ? (
          <p className="bandeira-size-hint" style={{ padding: '24px 0', textAlign: 'center', color: '#a0aec0' }}>
            <Loader2 size={20} className="mold-import-spinner" style={{ marginRight: '8px' }} /> Carregando clientes...
          </p>
        ) : error ? (
          <p className="mold-import-error" style={{ color: '#e53e3e', textAlign: 'center', padding: '16px' }}>{error}</p>
        ) : filteredUsers.length === 0 ? (
          <div className="admin-users-empty">Nenhum cliente encontrado com os filtros aplicados.</div>
        ) : (
          <div className="admin-users-list">
            {filteredUsers.map((u) => {
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

              const emailOk = u.role === 'admin' || u.email_verified;
              const valorPago = u.valor_pago ?? u.plano_valor;

              return (
                <div key={u.id} className="admin-user-card">
                  {/* Topo: identidade + selos */}
                  <div className="admin-user-card-top">
                    <div className="admin-user-identity">
                      <span className="admin-user-name">{u.name}</span>
                      <span className="admin-user-email">{u.email}</span>
                      {u.session_device && <span className="admin-user-device">💻 {u.session_device}</span>}
                    </div>
                    <div className="admin-user-badges">
                      <span className="admin-badge" style={{ background: statusBg, color: statusColor }}>{statusLabel}</span>
                      {u.is_online ? (
                        <span className="admin-badge" style={{ background: 'rgba(72,187,120,0.15)', color: '#48bb78' }}>🟢 Online</span>
                      ) : u.last_activity ? (
                        <span className="admin-badge" style={{ background: 'rgba(237,137,54,0.12)', color: '#ed8936' }} title={`Última atividade: ${formatDataHora(u.last_activity)}`}>Offline</span>
                      ) : null}
                      {emailOk ? (
                        <span className="admin-badge" style={{ background: 'rgba(72,187,120,0.12)', color: '#48bb78' }}><CheckCircle2 size={12} /> E-mail</span>
                      ) : (
                        <span className="admin-badge" style={{ background: 'rgba(229,62,62,0.12)', color: '#f56565' }}><Clock size={12} /> E-mail ✗</span>
                      )}
                      {u.phone_verified ? (
                        <span className="admin-badge" style={{ background: 'rgba(37,211,102,0.14)', color: '#25d366' }}>📱 Tel. validado</span>
                      ) : u.phone ? (
                        <span className="admin-badge" style={{ background: 'rgba(229,62,62,0.12)', color: '#f56565' }}>📱 Tel. ✗</span>
                      ) : null}
                      {u.has_pending_payment && (
                        <span className="admin-badge" style={{ background: 'rgba(237,137,54,0.12)', color: '#ed8936' }} title="Gerou o pagamento (Pix) mas nunca efetuou">Gerou, não pagou</span>
                      )}
                    </div>
                  </div>

                  {/* Atividade ao vivo: qual aba/ferramenta o cliente está usando agora */}
                  {u.is_online && u.current_view && (
                    <div style={{ marginTop: '12px', display: 'inline-flex', alignItems: 'center', gap: '7px', background: 'rgba(66,153,225,0.12)', color: '#63b3ed', borderRadius: '9px', padding: '7px 13px', fontSize: '13px', fontWeight: 600 }}>
                      📍 Agora em: <strong style={{ color: '#90cdf4' }}>{u.current_view}</strong>
                    </div>
                  )}

                  {/* Meio: dados em grade rotulada */}
                  <div className="admin-user-meta">
                    <div className="admin-meta-item"><span>Telefone</span><strong style={{ color: u.phone ? '#e2e8f0' : '#718096' }}>{u.phone || '—'}</strong></div>
                    <div className="admin-meta-item"><span>Rede (IP)</span><strong style={{ color: u.last_ip ? '#e2e8f0' : '#718096', fontFamily: 'monospace' }}>{u.last_ip || '—'}</strong></div>
                    <div className="admin-meta-item"><span>Papel</span><strong style={{ color: u.role === 'admin' ? '#ecc94b' : '#e2e8f0' }}>{u.role === 'admin' ? 'Administrador' : 'Usuário'}</strong></div>
                    <div className="admin-meta-item"><span>Plano atual</span><strong>{u.plano_nome || 'Nenhum'}</strong></div>
                    <div className="admin-meta-item"><span>Valor pago</span><strong style={{ color: valorPago != null ? '#48bb78' : '#718096' }}>{valorPago != null ? formatCurrency(valorPago) : '—'}</strong></div>
                    <div className="admin-meta-item"><span>Assinou em</span><strong>{u.access_started_at ? formatDataHora(u.access_started_at) : u.data_pagamento ? formatDataHora(u.data_pagamento) : '—'}</strong></div>
                    <div className="admin-meta-item"><span>Acesso até</span><strong>{u.access_expires_at ? formatDataHora(u.access_expires_at) : 'Sem limite'}</strong></div>
                    <div className="admin-meta-item"><span>Cadastrado em</span><strong>{formatDataHora(u.created_at)}</strong></div>
                  </div>

                  {/* Rodapé: ações */}
                  <div className="admin-user-actions-wrap">
                    {u.id === currentUser?.id ? (
                      <span className="admin-own-account">Sua conta</span>
                    ) : (
                      <UserRowActions target={u} planos={planos} onChanged={handleRowChanged} />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
