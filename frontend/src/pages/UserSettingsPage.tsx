import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';

function ChangeEmailPanel() {
  const { user, token, updateUser } = useAuth();
  const [currentPassword, setCurrentPassword] = useState(() => sessionStorage.getItem('temp_user_pwd') || '');
  const [newEmail, setNewEmail] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!token) return;
    setFieldErrors({});
    setFormError(null);
    setSuccess(false);

    if (currentPassword.trim() === '') {
      setFieldErrors({ current_password: 'Informe sua senha atual.' });
      return;
    }
    if (newEmail.trim() === '') {
      setFieldErrors({ new_email: 'Informe o novo e-mail.' });
      return;
    }

    setSaving(true);
    try {
      const response = await api.changeEmail({ current_password: currentPassword, new_email: newEmail.trim() }, token);
      updateUser({ email: response.user.email });
      setCurrentPassword('');
      setNewEmail('');
      setSuccess(true);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.errors) setFieldErrors(err.errors);
        setFormError(err.message);
      } else {
        setFormError('Nao foi possivel trocar o e-mail.');
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bandeira-create-panel">
      <h4>Trocar e-mail</h4>
      <p className="bandeira-size-hint">
        E-mail atual: <strong>{user?.email}</strong>
      </p>

      <label className="auth-field">
        <span>Novo e-mail</span>
        <input type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} autoComplete="email" />
        {fieldErrors.new_email && <small className="auth-error">{fieldErrors.new_email}</small>}
      </label>

      <label className="auth-field">
        <span>Senha atual</span>
        <input
          type="password"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          autoComplete="current-password"
        />
        {fieldErrors.current_password && <small className="auth-error">{fieldErrors.current_password}</small>}
      </label>

      {formError ? <p className="mold-import-error">{formError}</p> : null}
      {success ? <p className="mold-form-success">E-mail atualizado com sucesso.</p> : null}

      <button type="button" className="mold-save-button" onClick={() => void handleSave()} disabled={saving}>
        {saving ? <Loader2 size={16} className="mold-import-spinner" /> : null}
        Salvar novo e-mail
      </button>
    </div>
  );
}

export function UserSettingsPage() {
  const { user, token } = useAuth();
  const [currentPassword, setCurrentPassword] = useState(() => sessionStorage.getItem('temp_user_pwd') || '');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!token) return;
    setFieldErrors({});
    setFormError(null);
    setSuccess(false);

    if (currentPassword.trim() === '') {
      setFieldErrors({ current_password: 'Informe sua senha atual.' });
      return;
    }
    if (newPassword.length < 8) {
      setFieldErrors({ new_password: 'A nova senha precisa ter pelo menos 8 caracteres.' });
      return;
    }
    if (newPassword !== confirmPassword) {
      setFieldErrors({ confirm_password: 'As senhas nao sao iguais.' });
      return;
    }

    setSaving(true);
    try {
      await api.changePassword({ current_password: currentPassword, new_password: newPassword }, token);
      sessionStorage.setItem('temp_user_pwd', newPassword);
      setCurrentPassword(newPassword);
      setNewPassword('');
      setConfirmPassword('');
      setSuccess(true);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.errors) setFieldErrors(err.errors);
        setFormError(err.message);
      } else {
        setFormError('Nao foi possivel trocar a senha.');
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bandeira-workspace">
      <div className="bandeira-main-panel">
        <div className="bandeira-panel-header">
          <h2>Configuracoes do Usuario</h2>
          <p>Dados da conta, troca de senha{user?.role === 'admin' ? ' e e-mail' : ''}.</p>
        </div>

        <div className="bandeira-create-panel">
          <h4>Sua conta</h4>
          <p className="bandeira-size-hint">
            Nome: <strong>{user?.name}</strong> — Email: <strong>{user?.email}</strong>
          </p>
        </div>

        {user?.role === 'admin' ? <ChangeEmailPanel /> : null}

        <div className="bandeira-create-panel">
          <h4>Trocar senha</h4>

          <label className="auth-field">
            <span>Senha atual</span>
            <input
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              autoComplete="current-password"
            />
            {fieldErrors.current_password && <small className="auth-error">{fieldErrors.current_password}</small>}
          </label>

          <label className="auth-field">
            <span>Nova senha</span>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoComplete="new-password"
              minLength={8}
            />
            {fieldErrors.new_password && <small className="auth-error">{fieldErrors.new_password}</small>}
          </label>

          <label className="auth-field">
            <span>Repita a nova senha</span>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              autoComplete="new-password"
              minLength={8}
            />
            {fieldErrors.confirm_password && <small className="auth-error">{fieldErrors.confirm_password}</small>}
          </label>

          {formError ? <p className="mold-import-error">{formError}</p> : null}
          {success ? <p className="mold-form-success">Senha atualizada com sucesso.</p> : null}

          <button type="button" className="mold-save-button" onClick={() => void handleSave()} disabled={saving}>
            {saving ? <Loader2 size={16} className="mold-import-spinner" /> : null}
            Salvar nova senha
          </button>
        </div>
      </div>
    </div>
  );
}
