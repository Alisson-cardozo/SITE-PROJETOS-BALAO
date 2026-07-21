import { useMemo, useState, useSyncExternalStore } from 'react';
import { Check, Download, Share, SquarePlus } from 'lucide-react';
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
        setFeedback('Instalacao cancelada.');
      }
    } finally {
      setInstalling(false);
    }
  }

  return (
    <div className="bandeira-workspace">
      <div className="bandeira-main-panel">
        <div className="bandeira-panel-header">
          <h2>Baixar App</h2>
          <p>Instale o Alisson Projetos no computador ou celular pra abrir direto, sem navegador, como um app de verdade.</p>
        </div>

        <div className="bandeira-create-panel pwa-install-panel">
          <div className="pwa-install-hero">
            <img src="/pwa-192.png" alt="Alisson Projetos" className="pwa-install-icon" />
            <div>
              <h3>Alisson Projetos</h3>
              <p className="bandeira-size-hint">Acesso rapido, tela cheia e o icone na sua tela inicial.</p>
            </div>
          </div>

          {state.installed ? (
            <div className="pwa-install-status pwa-install-status-ok">
              <Check size={18} />
              <span>App ja instalado neste dispositivo.</span>
            </div>
          ) : state.canPrompt ? (
            <>
              <button
                type="button"
                className="mold-save-button"
                onClick={() => void handleInstall()}
                disabled={installing}
              >
                <Download size={16} />
                {installing ? 'Aguarde...' : 'Instalar agora'}
              </button>
              {feedback ? <p className="bandeira-size-hint">{feedback}</p> : null}
            </>
          ) : platform === 'ios' ? (
            <div className="pwa-install-steps">
              <p className="bandeira-size-hint">O iPhone/iPad nao tem botao de instalar — e pelo Safari, em 2 toques:</p>
              <ol>
                <li>
                  Toque em <Share size={14} className="pwa-inline-icon" /> <strong>Compartilhar</strong>, na barra do
                  Safari.
                </li>
                <li>
                  Escolha <SquarePlus size={14} className="pwa-inline-icon" /> <strong>Adicionar a Tela de Inicio</strong>.
                </li>
              </ol>
            </div>
          ) : (
            <div className="pwa-install-steps">
              <p className="bandeira-size-hint">
                Seu navegador ainda nao liberou o botao de instalar automatico. Da pra instalar manualmente:
              </p>
              <ol>
                <li>Abra o menu do navegador (geralmente os tres pontinhos, no canto superior).</li>
                <li>
                  Procure <strong>Instalar app</strong> ou <strong>Adicionar a tela inicial</strong>.
                </li>
              </ol>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
