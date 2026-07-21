import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { AuthProvider } from './lib/auth';
import { RifaPublicPage } from './pages/RifaPublicPage';
import './lib/pwaInstall';
import './styles.css';

// Unica rota publica do app (nao precisa de login) — o link que o dono da
// rifa manda pro cliente. Checagem simples de pathname em vez de trazer uma
// lib de rotas so pra isso; se um dia surgir mais de uma pagina publica, aí
// sim vale a pena um router de verdade.
const rifaMatch = window.location.pathname.match(/^\/rifa\/([^/]+)\/?$/);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {rifaMatch ? (
      <RifaPublicPage slug={decodeURIComponent(rifaMatch[1])} />
    ) : (
      <AuthProvider>
        <App />
      </AuthProvider>
    )}
  </StrictMode>
);
