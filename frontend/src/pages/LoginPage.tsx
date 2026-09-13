import { useState, useMemo, useSyncExternalStore, useEffect, type FormEvent } from 'react';
import { useAuth, ApiError } from '../lib/auth';
import { Smartphone, X, Download, Trophy } from 'lucide-react';
import { getPwaInstallState, promptPwaInstall, subscribePwaInstall } from '../lib/pwaInstall';
import { api } from '../lib/api';
import type { PlanoPublic } from '../types';

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

  // PWA and Ranking state
  const pwaState = useSyncExternalStore(subscribePwaInstall, getPwaInstallState, getPwaInstallState);
  const [showPwaPromo, setShowPwaPromo] = useState(() => localStorage.getItem('plotar_pwa_dismissed') !== '1');
  const [publicPlanos, setPublicPlanos] = useState<PlanoPublic[]>([]);

  useEffect(() => {
    api.listPublicPlanos()
      .then((res) => {
        setPublicPlanos(res.data);
      })
      .catch(() => {
        // ignore fetch failures on login screen
      });
  }, []);

  // Filter plans configured to show in ranking, sorted descending by override count
  const rankedPlanos = useMemo(() => {
    return publicPlanos
      .filter((p) => p.show_in_ranking === true)
      .sort((a, b) => (b.sales_override_count ?? 0) - (a.sales_override_count ?? 0));
  }, [publicPlanos]);

  async function handlePwaInstall() {
    try {
      await promptPwaInstall();
    } catch (err) {
      console.error('Failed to trigger PWA prompt', err);
    }
  }

  function handleDismissPwaPromo() {
    setShowPwaPromo(false);
    localStorage.setItem('plotar_pwa_dismissed', '1');
  }

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
      
      <div className="auth-container">
        {/* Card de Formulario */}
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

          {/* Atalho pra página pública de molde sob encomenda (sem login) */}
          <a href="/solicitar-molde" className="auth-molde-cta">
            <span className="auth-molde-cta-icon">🤖</span>
            <span className="auth-molde-cta-text">
              <strong>Molde sob medida com nossa Inteligência Artificial</strong>
              <small>Peça já — sem precisar de conta</small>
            </span>
          </a>
        </div>

        {/* Card do Ranking de Planos */}
        {rankedPlanos.length > 0 && (
          <div className="auth-ranking-card">
            <div className="auth-ranking-title-area">
              <h2>
                <Trophy size={20} style={{ color: '#ffd700' }} />
                Mais Vendidos
              </h2>
              <p>Os planos preferidos dos nossos clientes e parceiros.</p>
            </div>

            <div className="auth-ranking-list">
              {rankedPlanos.map((plano, index) => {
                const rank = index + 1;
                const badgeClass = rank === 1 ? 'rank-1' : rank === 2 ? 'rank-2' : rank === 3 ? 'rank-3' : 'rank-default';
                return (
                  <div key={plano.id} className="auth-ranking-item">
                    <div className={`auth-ranking-badge ${badgeClass}`}>
                      {rank}º
                    </div>
                    <div className="auth-ranking-info">
                      <span className="auth-ranking-name">{plano.nome}</span>
                      <span className="auth-ranking-sold-count">
                        🔥 {plano.sales_override_count} vendas realizadas
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Card Flutuante PWA Promo */}
      {showPwaPromo && pwaState.canPrompt && !pwaState.installed && (
        <div className="pwa-promo-card">
          <div className="pwa-promo-header">
            <div className="pwa-promo-icon-wrapper">
              <Smartphone size={20} />
            </div>
            <button
              type="button"
              className="pwa-promo-close"
              onClick={handleDismissPwaPromo}
              aria-label="Fechar promoção de aplicativo"
            >
              <X size={16} />
            </button>
          </div>

          <div className="pwa-promo-body">
            <h3>Baixe o Aplicativo Celular</h3>
            <p>
              Instale o Alisson Projetos direto no seu aparelho. Ocupa menos espaço, funciona offline e abre sem barra do navegador!
            </p>
          </div>

          <div className="pwa-promo-action">
            <button
              type="button"
              className="pwa-promo-btn"
              onClick={() => void handlePwaInstall()}
            >
              <Download size={14} />
              <span>Instalar Aplicativo</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
