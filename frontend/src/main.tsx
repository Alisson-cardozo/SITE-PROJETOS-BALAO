import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { AuthProvider } from './lib/auth';
import { LojaPublicPage } from './pages/LojaPublicPage';
import { RifaPublicPage } from './pages/RifaPublicPage';
import { SolicitarMoldePublicPage } from './pages/SolicitarMoldePublicPage';
import './lib/pwaInstall';
import './styles.css';

// Proteções contra inspeção de código e engenharia reversa básica
document.addEventListener('contextmenu', (e) => e.preventDefault());
document.addEventListener('keydown', (e) => {
  if (e.key === 'F12') {
    e.preventDefault();
  }
  if (e.ctrlKey && e.shiftKey && ['I', 'i', 'J', 'j', 'C', 'c'].includes(e.key)) {
    e.preventDefault();
  }
  if (e.ctrlKey && ['U', 'u', 'S', 's'].includes(e.key)) {
    e.preventDefault();
  }
});
// Limpa console constantemente
setInterval(() => {
  console.clear();
}, 1000);

// Rotas publicas do app (nao precisam de login): o link de uma rifa
// especifica, e a vitrine da Loja (unica, sem slug). Checagem simples de
// pathname em vez de trazer uma lib de rotas so pra isso.
const rifaMatch = window.location.pathname.match(/^\/rifa\/([^/]+)\/?$/);
const lojaMatch = window.location.pathname.match(/^\/loja\/?$/);
const solicitarMoldeMatch = window.location.pathname.match(/^\/solicitar-molde\/?$/);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {rifaMatch ? (
      <RifaPublicPage slug={decodeURIComponent(rifaMatch[1])} />
    ) : lojaMatch ? (
      <LojaPublicPage />
    ) : solicitarMoldeMatch ? (
      <SolicitarMoldePublicPage />
    ) : (
      <AuthProvider>
        <App />
      </AuthProvider>
    )}
  </StrictMode>
);
