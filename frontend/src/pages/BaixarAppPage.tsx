import { useMemo, useState, useSyncExternalStore } from 'react';
import { Check, Download, Share, Smartphone, Monitor, AlertCircle } from 'lucide-react';
import { getPwaInstallState, promptPwaInstall, subscribePwaInstall } from '../lib/pwaInstall';

type Platform = 'ios' | 'android' | 'desktop';

function detectPlatform(): Platform {
  const ua = navigator.userAgent;
  if (/iphone|ipad|ipod/i.test(ua)) return 'ios';
  if (/android/i.test(ua)) return 'android';
  return 'desktop';
}

export function BaixarAppPage() {
  const state = useSyncExternalStore(subscribePwaInstall, getPwaInstallState, getPwaInstallState);
  const platform = useMemo(detectPlatform, []);
  const [installing, setInstalling] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  async function handleInstall() {
    setInstalling(true);
    setFeedback(null);
    try {
      const outcome = await promptPwaInstall();
      if (outcome === 'dismissed') {
        setFeedback('Instalação cancelada pelo usuário.');
      }
    } finally {
      setInstalling(false);
    }
  }

  return (
    <div className="bandeira-workspace">
      <div className="bandeira-main-panel pwa-install-main-panel">
        <div className="bandeira-panel-header pwa-install-header">
          <h2>Baixar Aplicativo</h2>
          <p>Tenha o Alisson Projetos sempre à mão no seu celular ou computador.</p>
        </div>

        <div className="pwa-install-container">
          <div className="pwa-install-card">
            <div className="pwa-install-glow-overlay" />
            
            <div className="pwa-install-hero-section">
              <div className="pwa-icon-glow-wrapper">
                <img src="/pwa-512-v3.png" alt="Alisson Projetos" className="pwa-install-large-icon" />
              </div>
              <h1 className="pwa-install-title-glow">Baixe o App em seu Celular</h1>
              <p className="pwa-install-subtitle">
                Abra o sistema direto da sua tela inicial em tela cheia, sem barra de navegação. Rápido, leve e prático!
              </p>
            </div>

            {state.installed ? (
              <div className="pwa-install-status-badge success">
                <Check size={20} />
                <span>Aplicativo já instalado neste dispositivo!</span>
              </div>
            ) : state.canPrompt ? (
              <div className="pwa-install-action-box">
                <button
                  type="button"
                  className="pwa-install-cta-button"
                  onClick={() => void handleInstall()}
                  disabled={installing}
                >
                  <Download size={18} />
                  <span>{installing ? 'Instalando...' : 'Instalar Agora'}</span>
                </button>
                {feedback && (
                  <p className="pwa-install-feedback">
                    <AlertCircle size={14} /> {feedback}
                  </p>
                )}
              </div>
            ) : null}

            <div className="pwa-install-devices-info">
              {/* Celular Guide */}
              <div className="pwa-device-column">
                <div className="pwa-device-header">
                  <Smartphone size={24} className="pwa-device-icon" />
                  <h4>No Celular (Android & iOS)</h4>
                </div>
                
                {platform === 'ios' ? (
                  <div className="pwa-steps-list">
                    <p className="pwa-step-hint">Dispositivos Apple (iPhone/iPad):</p>
                    <ol>
                      <li>
                        Toque no botão de <strong>Compartilhar</strong> <Share size={15} className="pwa-inline-icon inline-share" /> na barra inferior do Safari.
                      </li>
                      <li>
                        Role a lista de opções para baixo e clique em <strong>Adicionar à Tela de Início</strong>.
                      </li>
                      <li>
                        Toque em <strong>Adicionar</strong> no canto superior direito para confirmar.
                      </li>
                    </ol>
                  </div>
                ) : (
                  <div className="pwa-steps-list">
                    <p className="pwa-step-hint">Dispositivos Android:</p>
                    <ol>
                      <li>
                        Clique nos <strong>três pontinhos</strong> no canto superior do navegador Chrome.
                      </li>
                      <li>
                        Selecione a opção <strong>Instalar aplicativo</strong> ou <strong>Adicionar à tela inicial</strong>.
                      </li>
                      <li>
                        Confirme a instalação e o ícone do app aparecerá na tela do seu celular.
                      </li>
                    </ol>
                  </div>
                )}
              </div>

              {/* Desktop Guide */}
              <div className="pwa-device-column">
                <div className="pwa-device-header">
                  <Monitor size={24} className="pwa-device-icon" />
                  <h4>No Computador</h4>
                </div>
                <div className="pwa-steps-list">
                  <p className="pwa-step-hint">Instalação via Chrome / Edge:</p>
                  <ol>
                    <li>
                      Olhe para a <strong>barra de endereço</strong> no topo do seu navegador.
                    </li>
                    <li>
                      Clique no ícone de <strong>instalação</strong> (um computador com uma seta para baixo ou sinal de +).
                    </li>
                    <li>
                      Clique em <strong>Instalar</strong> na janela flutuante que aparecer.
                    </li>
                  </ol>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
