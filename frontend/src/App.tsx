import { useAuth } from './lib/auth';
import { LoginPage } from './pages/LoginPage';
import { UserArea } from './pages/UserArea';

function AdminPlaceholder() {
  const { user, logout } = useAuth();
  if (!user) {
    return null;
  }

  return (
    <div className="dashboard-screen">
      <header className="dashboard-header">
        <div>
          <h1>Ola, {user.name}</h1>
          <span className="role-badge role-admin">Administrador</span>
        </div>
        <button type="button" onClick={() => void logout()}>
          Sair
        </button>
      </header>

      <main className="dashboard-body">
        <p>Area administrativa - proximos modulos entram aqui.</p>
      </main>
    </div>
  );
}

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

  return user.role === 'admin' ? <AdminPlaceholder /> : <UserArea />;
}
