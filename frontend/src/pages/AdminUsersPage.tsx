import { useCallback, useEffect, useState } from 'react';
import { Loader2, Trash2 } from 'lucide-react';
import { api, ApiError } from '../lib/api';
import { isExpired } from '../lib/access';
import { useAuth } from '../lib/auth';
import type { User } from '../types';

function formatDataHora(iso: string | null | undefined): string {
  if (!iso) return '-';
  const match = iso.trim().match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
  if (!match) return iso;
  const [, year, month, day, hour, minute] = match;
  return `${day}/${month}/${year} ${hour}:${minute}`;
}

function UserRowActions({
  target,
  onChanged,
}: {
  target: User;
  onChanged: (updated: User) => void;
}) {
  const { token } = useAuth();
  const [days, setDays] = useState('30');
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // pending_payment (cadastro novo que ainda nao pagou) tambem conta como
  // "locked" pra mostrar o botao "Liberar acesso" -- so 'active' e nao-expirado
  // conta como liberado de verdade.
  const locked = target.status !== 'active' || isExpired(target);

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
      const response = await api.adminGrantAccess(target.id, parsedDays, token);
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
      onChanged({ ...target, id: -1 }); // sinaliza remocao pro pai via id invalido
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Nao foi possivel excluir.');
      setDeleting(false);
    }
  };

  return (
    <div className="admin-user-actions">
      <div className="admin-user-actions-row">
        {locked ? (
          <>
            <input
              type="number"
              min={1}
              max={3650}
              value={days}
              onChange={(e) => setDays(e.target.value)}
              className="admin-user-days-input"
            />
            <button type="button" className="mold-secondary-button" onClick={() => void handleGrantAccess()} disabled={busy}>
              {busy ? <Loader2 size={14} className="mold-import-spinner" /> : null}
              Liberar acesso
            </button>
          </>
        ) : (
          <button type="button" className="mold-secondary-button rifa-recusar-button" onClick={() => void handleBlock()} disabled={busy}>
            {busy ? <Loader2 size={14} className="mold-import-spinner" /> : null}
            Bloquear acesso
          </button>
        )}
        <button
          type="button"
          className="mold-secondary-button rifa-recusar-button"
          onClick={() => void handleDelete()}
          disabled={deleting}
          title="Excluir usuario"
        >
          {deleting ? <Loader2 size={14} className="mold-import-spinner" /> : <Trash2 size={14} />}
          Excluir
        </button>
      </div>
      {error ? <small className="auth-error">{error}</small> : null}
    </div>
  );
}

export function AdminUsersPage() {
  const { user: currentUser, token } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const response = await api.adminListUsers(token);
      setUsers(response.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Nao foi possivel carregar os usuarios.');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleRowChanged = (updated: User) => {
    if (updated.id === -1) {
      // exclusao: precisa do id original pra filtrar -- refaz o load em vez de tentar adivinhar
      void load();
      return;
    }
    setUsers((prev) => prev.map((u) => (u.id === updated.id ? updated : u)));
  };

  return (
    <div className="bandeira-workspace">
      <div className="bandeira-main-panel">
        <div className="bandeira-panel-header">
          <h2>Usuarios</h2>
          <p>Todos os usuarios cadastrados no sistema.</p>
        </div>

        {loading ? (
          <p className="bandeira-size-hint">
            <Loader2 size={14} className="mold-import-spinner" /> Carregando usuarios...
          </p>
        ) : error ? (
          <p className="mold-import-error">{error}</p>
        ) : (
          <div className="table-scroll">
            <table className="rifa-compradores-table">
              <thead>
                <tr>
                  <th>Nome</th>
                  <th>Email</th>
                  <th>Papel</th>
                  <th>Status</th>
                  <th>Acesso ate</th>
                  <th>Criado em</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id}>
                    <td>{u.name}</td>
                    <td>{u.email}</td>
                    <td>{u.role === 'admin' ? 'Administrador' : 'Usuario'}</td>
                    <td>
                      {u.status === 'active'
                        ? isExpired(u)
                          ? 'Expirado'
                          : 'Ativo'
                        : u.status === 'pending_payment'
                          ? 'Aguardando pagamento'
                          : 'Bloqueado'}
                    </td>
                    <td>{u.access_expires_at ? formatDataHora(u.access_expires_at) : 'Sem limite'}</td>
                    <td>{formatDataHora(u.created_at)}</td>
                    <td className="rifa-compradores-actions">
                      {u.id === currentUser?.id ? (
                        <span className="bandeira-size-hint">Sua conta</span>
                      ) : (
                        <UserRowActions target={u} onChanged={handleRowChanged} />
                      )}
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
