import { useAuth } from './lib/auth';
import { adminNavItems } from './config/userNavigation';
import { LoginPage } from './pages/LoginPage';
import { EmailVerificationGate } from './pages/EmailVerificationGate';
import { PhoneVerificationGate } from './pages/PhoneVerificationGate';
import { UserArea } from './pages/UserArea';
import { AdminUsersPage } from './pages/AdminUsersPage';
import { AdminSocialPage } from './pages/AdminSocialPage';
import { AdminTabsPage } from './pages/AdminTabsPage';
import { AdminPlanoPage } from './pages/AdminPlanoPage';
import { AdminCuponsPage } from './pages/AdminCuponsPage';
import { AdminSolicitacaoMoldePage } from './pages/AdminSolicitacaoMoldePage';
import { AdminLojaPage } from './pages/AdminLojaPage';
import { AdminComunicadosPage } from './pages/AdminComunicadosPage';
import { AdminNotificacoesPage } from './pages/AdminNotificacoesPage';
import { AdminWhatsAppPage } from './pages/AdminWhatsAppPage';
import { AdminWhatsAppChatPage } from './pages/AdminWhatsAppChatPage';
import { AdminChatbotPage } from './pages/AdminChatbotPage';

export function App() {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="auth-screen">
        <p className="loading-text">Carregando...</p>
      </div>
    );
  }

  if (!user) {
    return <LoginPage />;
  }

  // Usuario (nunca admin) que ainda nao confirmou o e-mail fica travado no card
  // ate digitar o codigo de 6 digitos. "bloqueia tudo".
  if (user.role !== 'admin' && user.email_verified === false) {
    return <EmailVerificationGate />;
  }

  // Depois do e-mail, o telefone (WhatsApp) só vira portão obrigatório SE o
  // admin ligou "exigir validação de telefone". Admin nunca passa por aqui.
  if (user.role !== 'admin' && user.phone_validation_required === true && user.phone_verified === false) {
    return <PhoneVerificationGate />;
  }

  if (user.role === 'admin') {
    return (
      <UserArea
        extraNavGroups={[adminNavItems]}
        extraRoutes={(activeId) => {
          if (activeId === 'admin-usuarios') return <AdminUsersPage />;
          if (activeId === 'admin-redes-sociais') return <AdminSocialPage />;
          if (activeId === 'admin-abas') return <AdminTabsPage />;
          if (activeId === 'admin-plano') return <AdminPlanoPage />;
          if (activeId === 'admin-cupons') return <AdminCuponsPage />;
          if (activeId === 'admin-solicitacao-molde') return <AdminSolicitacaoMoldePage />;
          if (activeId === 'admin-loja') return <AdminLojaPage />;
          if (activeId === 'admin-notificacoes') return <AdminNotificacoesPage />;
          if (activeId === 'admin-comunicacao') return <AdminComunicadosPage />;
          if (activeId === 'admin-whatsapp') return <AdminWhatsAppPage />;
          if (activeId === 'admin-whatsapp-mensagens') return <AdminWhatsAppChatPage />;
          if (activeId === 'admin-chatbot') return <AdminChatbotPage />;
          return null;
        }}
      />
    );
  }

  return <UserArea />;
}
