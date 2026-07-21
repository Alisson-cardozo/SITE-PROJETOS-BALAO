import { useEffect, useState, type ReactNode } from 'react';
import { ChevronDown, Menu, PanelLeftClose, PanelLeftOpen, X } from 'lucide-react';
import type { NavItem } from '../config/userNavigation';
import type { User } from '../types';

const COLLAPSE_STORAGE_KEY = 'sidebar_collapsed';

interface AppShellProps {
  user: User;
  navGroups: NavItem[][];
  activeId: string;
  onSelect: (id: string) => void;
  onLogout: () => void;
  children: ReactNode;
}

function findOpenParentId(navGroups: NavItem[][], activeId: string): string | null {
  for (const group of navGroups) {
    for (const item of group) {
      if (item.children?.some((child) => child.id === activeId)) {
        return item.id;
      }
    }
  }
  return null;
}

export function AppShell({ user, navGroups, activeId, onSelect, onLogout, children }: AppShellProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(COLLAPSE_STORAGE_KEY) === '1');
  const [openIds, setOpenIds] = useState<Set<string>>(() => {
    const parentId = findOpenParentId(navGroups, activeId);
    return parentId ? new Set([parentId]) : new Set();
  });

  useEffect(() => {
    localStorage.setItem(COLLAPSE_STORAGE_KEY, collapsed ? '1' : '0');
  }, [collapsed]);

  function handleSelect(id: string) {
    onSelect(id);
    setSidebarOpen(false);
    // fecha flyout do menu minimizado apos escolher
    setOpenIds(new Set());
  }

  function toggleGroup(id: string) {
    // Mantem o menu minimizado e so abre/fecha o subgrupo (flyout).
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.clear();
        next.add(id);
      }
      return next;
    });
  }

  return (
    <div className="app-shell">
      <header className="app-topbar">
        <div className="app-topbar-left">
          <button
            type="button"
            className="menu-toggle"
            aria-label={sidebarOpen ? 'Fechar menu' : 'Abrir menu'}
            onClick={() => setSidebarOpen((open) => !open)}
          >
            {sidebarOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
          <div>
            <h1>Ola, {user.name}</h1>
            <span className={`role-badge role-${user.role}`}>
              {user.role === 'admin' ? 'Administrador' : 'Usuario'}
            </span>
          </div>
        </div>
        <button type="button" className="topbar-logout" onClick={onLogout}>
          Sair
        </button>
      </header>

      <div className="app-body">
        {sidebarOpen && <div className="app-sidebar-backdrop" onClick={() => setSidebarOpen(false)} />}

        <aside className={`app-sidebar ${sidebarOpen ? 'open' : ''} ${collapsed ? 'collapsed' : ''}`}>
          {navGroups.map((group, groupIndex) => (
            <nav className="app-nav-group" key={groupIndex}>
              {group.map((item) => {
                const Icon = item.icon;
                const hasChildren = !!item.children?.length;

                if (hasChildren) {
                  const isOpen = openIds.has(item.id);
                  const isActiveParent = item.children!.some((child) => child.id === activeId);

                  return (
                    <div key={item.id} className="app-nav-parent">
                      <button
                        type="button"
                        className={`app-nav-item ${isActiveParent ? 'active-parent' : ''}`}
                        onClick={() => toggleGroup(item.id)}
                        aria-expanded={isOpen}
                        title={item.label}
                      >
                        <Icon size={18} />
                        <span>{item.label}</span>
                        <ChevronDown size={16} className={`app-nav-chevron ${isOpen ? 'open' : ''}`} />
                      </button>

                      {isOpen && (
                        <div className="app-nav-children">
                          {item.children!.map((child) => (
                            <button
                              key={child.id}
                              type="button"
                              className={`app-nav-subitem ${child.id === activeId ? 'active' : ''}`}
                              onClick={() => handleSelect(child.id)}
                            >
                              {child.label}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                }

                const isActive = item.id === activeId;
                return (
                  <button
                    key={item.id}
                    type="button"
                    className={`app-nav-item ${isActive ? 'active' : ''}`}
                    onClick={() => handleSelect(item.id)}
                    aria-current={isActive ? 'page' : undefined}
                    title={item.label}
                  >
                    <Icon size={18} />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </nav>
          ))}

          <button
            type="button"
            className="sidebar-collapse-toggle"
            onClick={() => setCollapsed((value) => !value)}
            aria-label={collapsed ? 'Expandir menu' : 'Minimizar menu'}
            title={collapsed ? 'Expandir menu' : 'Minimizar menu'}
          >
            {collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
            {!collapsed && <span>Minimizar</span>}
          </button>
        </aside>

        <main className="app-content">{children}</main>
      </div>
    </div>
  );
}
