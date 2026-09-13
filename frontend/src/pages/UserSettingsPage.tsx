import { useState } from 'react';
import { Loader2, Trash2, AlertTriangle } from 'lucide-react';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { PushActivationCard } from '../components/PushActivationCard';

/** Zona de perigo: o proprio usuario exclui a conta (pede a senha atual). */
function DeleteAccountPanel() {
  const { token, logout } = useAuth();
  const [confirming, setConfirming] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    if (!token) return;
    if (password.trim() === '') {
      setError('Digite sua senha para confirmar.');
      return;
    }
    if (!window.confirm('Tem certeza? Sua conta e todos os seus dados serão apagados para sempre. Esta ação não pode ser desfeita.')) {
      return;
    }
    setError(null);
    setDeleting(true);
    try {
      await api.deleteAccount(password, token);
      alert('Sua conta foi excluída. Você será desconectado.');
      await logout();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível excluir a conta.');
      setDeleting(false);
    }
  };

  return (
    <div
      className="bandeira-create-panel"
      style={{ border: '1px solid rgba(229,62,62,0.4)', background: 'rgba(229,62,62,0.04)' }}
    >
      <h4 style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#f56565' }}>
        <AlertTriangle size={18} /> Excluir minha conta
      </h4>
      <p className="bandeira-size-hint">
        Apaga sua conta e todos os seus dados <strong>permanentemente</strong>. Esta ação não pode ser desfeita.
      </p>

      {!confirming ? (
        <button
          type="button"
          onClick={() => {
            setConfirming(true);
            setError(null);
          }}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            background: 'transparent',
            color: '#f56565',
            border: '1px solid #f56565',
            borderRadius: '8px',
            padding: '10px 16px',
            fontSize: '14px',
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          <Trash2 size={16} /> Quero excluir minha conta
        </button>
      ) : (
        <>
          <label className="auth-field">
            <span>Confirme sua senha</span>
            <input
              type="password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setError(null);
              }}
              autoComplete="current-password"
              placeholder="Sua senha atual"
            />
          </label>

          {error ? <p className="mold-import-error">{error}</p> : null}

          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={() => void handleDelete()}
              disabled={deleting}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                background: '#e53e3e',
                color: '#fff',
                border: 'none',
                borderRadius: '8px',
                padding: '10px 16px',
                fontSize: '14px',
                fontWeight: 600,
                cursor: deleting ? 'default' : 'pointer',
              }}
            >
              {deleting ? <Loader2 size={16} className="mold-import-spinner" /> : <Trash2 size={16} />}
              Excluir para sempre
            </button>
            <button
              type="button"
              onClick={() => {
                setConfirming(false);
                setPassword('');
                setError(null);
              }}
              disabled={deleting}
              style={{
                background: '#2d3748',
                color: '#cbd5e0',
                border: '1px solid #4a5568',
                borderRadius: '8px',
                padding: '10px 16px',
                fontSize: '14px',
                cursor: 'pointer',
              }}
            >
              Cancelar
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function ChangeEmailPanel() {
  const { user, token, updateUser } = useAuth();
  const [step, setStep] = useState<'pedir' | 'confirmar'>('pedir');
  const [currentPassword, setCurrentPassword] = useState(() => sessionStorage.getItem('temp_user_pwd') || '');
  const [newEmail, setNewEmail] = useState('');
  const [code, setCode] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [saving, setSaving] = useState(false);

  /** Passo 1: valida senha + e-mail novo e dispara o código pro e-mail NOVO. */
  const handleEnviarCodigo = async () => {
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
      await api.changeEmail({ current_password: currentPassword, new_email: newEmail.trim().toLowerCase() }, token);
      setStep('confirmar');
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.errors) setFieldErrors(err.errors);
        setFormError(err.message);
      } else {
        setFormError('Nao foi possivel enviar o código.');
      }
    } finally {
      setSaving(false);
    }
  };

  /** Passo 2: confirma com o código que chegou no e-mail novo. */
  const handleConfirmar = async () => {
    if (!token) return;
    setFieldErrors({});
    setFormError(null);

    if (!/^\d{6}$/.test(code.trim())) {
      setFieldErrors({ code: 'Digite o código de 6 dígitos.' });
      return;
    }

    setSaving(true);
    try {
      const response = await api.confirmEmailChange(code.trim(), token);
      updateUser({ email: response.user.email });
      setCurrentPassword('');
      setNewEmail('');
      setCode('');
      setStep('pedir');
      setSuccess(true);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.errors) setFieldErrors(err.errors);
        setFormError(err.message);
      } else {
        setFormError('Nao foi possivel confirmar o código.');
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

      {step === 'pedir' ? (
        <>
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

          <button type="button" className="mold-save-button" onClick={() => void handleEnviarCodigo()} disabled={saving}>
            {saving ? <Loader2 size={16} className="mold-import-spinner" /> : null}
            Enviar código de confirmação
          </button>
        </>
      ) : (
        <>
          <p className="bandeira-size-hint">
            Enviamos um código de 6 dígitos para <strong>{newEmail}</strong>. Digite-o abaixo para confirmar a troca.
          </p>
          <label className="auth-field">
            <span>Código de confirmação</span>
            <input
              type="text"
              inputMode="numeric"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              placeholder="000000"
              style={{ letterSpacing: '6px', textAlign: 'center', fontSize: '18px', fontWeight: 700 }}
            />
            {fieldErrors.code && <small className="auth-error">{fieldErrors.code}</small>}
          </label>

          {formError ? <p className="mold-import-error">{formError}</p> : null}

          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            <button type="button" className="mold-save-button" onClick={() => void handleConfirmar()} disabled={saving}>
              {saving ? <Loader2 size={16} className="mold-import-spinner" /> : null}
              Confirmar novo e-mail
            </button>
            <button
              type="button"
              onClick={() => { setStep('pedir'); setCode(''); setFormError(null); setFieldErrors({}); }}
              disabled={saving}
              style={{ background: '#2d3748', color: '#cbd5e0', border: '1px solid #4a5568', borderRadius: '8px', padding: '10px 16px', fontSize: '14px', cursor: 'pointer' }}
            >
              Voltar
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/** Validação de telefone por código no WhatsApp (2 passos, igual o e-mail). */
function PhoneValidationPanel() {
  const { user, token, updateUser } = useAuth();
  const verified = !!user?.phone_verified;
  const [step, setStep] = useState<'pedir' | 'confirmar'>('pedir');
  const [phone, setPhone] = useState(user?.phone ?? '');
  const [code, setCode] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const handleEnviar = async () => {
    if (!token) return;
    setFieldErrors({});
    setFormError(null);
    const digits = phone.replace(/\D/g, '');
    if (digits.length < 10) { setFieldErrors({ phone: 'Informe o número com DDD (ex: 21 99999-9999).' }); return; }
    setSaving(true);
    try {
      await api.sendPhoneCode(digits, token);
      setStep('confirmar');
    } catch (err) {
      if (err instanceof ApiError) { if (err.errors) setFieldErrors(err.errors); setFormError(err.message); }
      else setFormError('Não foi possível enviar o código.');
    } finally { setSaving(false); }
  };

  const handleConfirmar = async () => {
    if (!token) return;
    setFieldErrors({});
    setFormError(null);
    if (!/^\d{6}$/.test(code.trim())) { setFieldErrors({ code: 'Digite o código de 6 dígitos.' }); return; }
    setSaving(true);
    try {
      const r = await api.confirmPhoneCode(code.trim(), token);
      updateUser({ phone: r.user.phone, phone_verified: r.user.phone_verified });
      setCode('');
      setStep('pedir');
    } catch (err) {
      if (err instanceof ApiError) { if (err.errors) setFieldErrors(err.errors); setFormError(err.message); }
      else setFormError('Não foi possível confirmar o código.');
    } finally { setSaving(false); }
  };

  return (
    <div
      className="bandeira-create-panel"
      style={verified ? undefined : { border: '1px solid rgba(37,211,102,0.45)', background: 'rgba(37,211,102,0.05)', boxShadow: '0 0 22px rgba(37,211,102,0.12)' }}
    >
      <h4 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>📱 Validar telefone (WhatsApp)</h4>
      {verified ? (
        <p className="mold-form-success" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
          ✅ Telefone validado: <strong>{user?.phone}</strong>
        </p>
      ) : step === 'pedir' ? (
        <>
          <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start', background: 'rgba(37,211,102,0.1)', border: '1px solid rgba(37,211,102,0.3)', borderRadius: '10px', padding: '12px 14px', marginBottom: '14px' }}>
            <span style={{ fontSize: '20px', flexShrink: 0 }}>🔒</span>
            <span style={{ color: '#cbd5e0', fontSize: '13.5px', lineHeight: 1.5 }}>
              <strong>Pela segurança de todos os usuários</strong>, estamos confirmando o número de telefone —
              para a <strong>sua segurança</strong> e para manter a <strong>qualidade do sistema</strong>. É rápido:
              você recebe um código no WhatsApp e confirma abaixo.
            </span>
          </div>
          <label className="auth-field">
            <span>Seu número (com DDD)</span>
            <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="21 99999-9999" />
            {fieldErrors.phone && <small className="auth-error">{fieldErrors.phone}</small>}
          </label>
          {formError ? <p className="mold-import-error">{formError}</p> : null}
          <button type="button" className="mold-save-button" onClick={() => void handleEnviar()} disabled={saving}>
            {saving ? <Loader2 size={16} className="mold-import-spinner" /> : null}
            Enviar código no WhatsApp
          </button>
        </>
      ) : (
        <>
          <p className="bandeira-size-hint">Código enviado no WhatsApp de <strong>{phone}</strong>. Digite-o abaixo.</p>
          <label className="auth-field">
            <span>Código de confirmação</span>
            <input
              type="text"
              inputMode="numeric"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              placeholder="000000"
              style={{ letterSpacing: '6px', textAlign: 'center', fontSize: '18px', fontWeight: 700 }}
            />
            {fieldErrors.code && <small className="auth-error">{fieldErrors.code}</small>}
          </label>
          {formError ? <p className="mold-import-error">{formError}</p> : null}
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            <button type="button" className="mold-save-button" onClick={() => void handleConfirmar()} disabled={saving}>
              {saving ? <Loader2 size={16} className="mold-import-spinner" /> : null}
              Confirmar telefone
            </button>
            <button type="button" onClick={() => { setStep('pedir'); setCode(''); setFormError(null); setFieldErrors({}); }} disabled={saving} style={{ background: '#2d3748', color: '#cbd5e0', border: '1px solid #4a5568', borderRadius: '8px', padding: '10px 16px', fontSize: '14px', cursor: 'pointer' }}>
              Voltar
            </button>
          </div>
        </>
      )}
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
          <p>Dados da conta, troca de senha e e-mail.</p>
        </div>

        <div className="bandeira-create-panel">
          <h4>Sua conta</h4>
          <p className="bandeira-size-hint">
            Nome: <strong>{user?.name}</strong> — Email: <strong>{user?.email}</strong>
          </p>
        </div>

        {/* Validação de telefone em destaque (logo no topo) */}
        <div style={{ marginTop: '16px' }}>
          <PhoneValidationPanel />
        </div>

        {/* Notificacoes do sistema (push) — pra receber os comunicados/novidades. */}
        <div style={{ margin: '16px 0' }}>
          <PushActivationCard variant="inline" />
        </div>

        <ChangeEmailPanel />

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

        {user?.role !== 'admin' ? <DeleteAccountPanel /> : null}
      </div>
    </div>
  );
}
