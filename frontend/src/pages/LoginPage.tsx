import { useState, type FormEvent } from 'react';
import { useAuth, ApiError } from '../lib/auth';

type Mode = 'login' | 'register';

export function LoginPage() {
  const { login, register } = useAuth();
  const [mode, setMode] = useState<Mode>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  function switchMode(nextMode: Mode) {
    setMode(nextMode);
    setFieldErrors({});
    setFormError(null);
    setConfirmPassword('');
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setFieldErrors({});
    setFormError(null);

    if (mode === 'register' && password !== confirmPassword) {
      setFieldErrors({ confirmPassword: 'As senhas nao sao iguais.' });
      return;
    }

    setIsSubmitting(true);

    try {
      if (mode === 'login') {
        await login(email, password);
      } else {
        await register(name, email, password);
      }
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.errors) {
          setFieldErrors(error.errors);
        }
        setFormError(error.message);
      } else {
        setFormError('Nao foi possivel conectar ao servidor. Tente novamente.');
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="auth-screen">
      <div className="auth-glow auth-glow-a" aria-hidden="true" />
      <div className="auth-glow auth-glow-b" aria-hidden="true" />
      <div className="auth-glow auth-glow-c" aria-hidden="true" />
      <img src="/logo-bg.webp" alt="" aria-hidden="true" className="auth-logo-watermark" />
      <div className="auth-card">
        <div className="auth-brand">
          <img src="/logo-badge.png" alt="" className="auth-brand-badge" />
          <div>
            <h1>Alisson Projetos</h1>
            <p>Acesse com sua conta de usuario ou administrador.</p>
          </div>
        </div>

        <div className="auth-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'login'}
            className={mode === 'login' ? 'active' : ''}
            onClick={() => switchMode('login')}
          >
            Entrar
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'register'}
            className={mode === 'register' ? 'active' : ''}
            onClick={() => switchMode('register')}
          >
            Criar conta
          </button>
        </div>

        <form className="auth-form" onSubmit={handleSubmit} noValidate>
          {mode === 'register' && (
            <label className="auth-field">
              <span>Nome completo</span>
              <input
                type="text"
                value={name}
                onChange={(event) => setName(event.target.value)}
                autoComplete="name"
                required
              />
              {fieldErrors.name && <small className="auth-error">{fieldErrors.name}</small>}
            </label>
          )}

          <label className="auth-field">
            <span>E-mail</span>
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              required
            />
            {fieldErrors.email && <small className="auth-error">{fieldErrors.email}</small>}
          </label>

          <label className="auth-field">
            <span>Senha</span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              required
              minLength={mode === 'register' ? 8 : undefined}
            />
            {fieldErrors.password && <small className="auth-error">{fieldErrors.password}</small>}
          </label>

          {mode === 'register' && (
            <label className="auth-field">
              <span>Repita a senha</span>
              <input
                type="password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                autoComplete="new-password"
                required
                minLength={8}
              />
              {fieldErrors.confirmPassword && <small className="auth-error">{fieldErrors.confirmPassword}</small>}
            </label>
          )}

          {formError && <p className="auth-form-error">{formError}</p>}

          <button type="submit" className="auth-submit" disabled={isSubmitting}>
            {isSubmitting ? 'Aguarde...' : mode === 'login' ? 'Entrar' : 'Criar conta'}
          </button>
        </form>
      </div>
    </div>
  );
}
