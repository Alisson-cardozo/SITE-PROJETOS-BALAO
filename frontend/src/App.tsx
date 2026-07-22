import { useAuth } from './lib/auth';
import { adminNavItems } from './config/userNavigation';
import { LoginPage } from './pages/LoginPage';
import { UserArea } from './pages/UserArea';
import { AdminUsersPage } from './pages/AdminUsersPage';
import { AdminSocialPage } from './pages/AdminSocialPage';
import { AdminTabsPage } from './pages/AdminTabsPage';
import { AdminPlanoPage } from './pages/AdminPlanoPage';

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

  if (user.role === 'admin') {
    return (
      <UserArea
        extraNavGroups={[adminNavItems]}
        extraRoutes={(activeId) => {
          if (activeId === 'admin-usuarios') return <AdminUsersPage />;
          if (activeId === 'admin-redes-sociais') return <AdminSocialPage />;
          if (activeId === 'admin-abas') return <AdminTabsPage />;
          if (activeId === 'admin-plano') return <AdminPlanoPage />;
          return null;
        }}
      />
    );
  }

  return <UserArea />;
}
