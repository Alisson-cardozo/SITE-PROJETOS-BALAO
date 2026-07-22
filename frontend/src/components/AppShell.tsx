import { useEffect, useState, type ReactNode } from 'react';
import { ChevronDown, Download, Menu, PanelLeftClose, PanelLeftOpen, Sparkles, X } from 'lucide-react';
import { InstagramIcon, TelegramIcon, WhatsAppIcon } from './BrandIcons';
import type { NavItem } from '../config/userNavigation';
import { buildSocialUrl } from '../lib/socialLinks';
import type { SystemSettings, User } from '../types';

const COLLAPSE_STORAGE_KEY = 'sidebar_collapsed';

interface AppShellProps {
  user: User;
  navGroups: NavItem[][];
  activeId: string;
  onSelect: (id: string) => void;
  onLogout: () => void;
  socialLinks?: SystemSettings | null;
  children: ReactNode;
}

function AppFooter({
  socialLinks,
  onDownloadApp,
}: {
  socialLinks?: SystemSettings | null;
  onDownloadApp: () => void;
}) {
  const socials = [
    { platform: 'telegram' as const, value: socialLinks?.telegram, Icon: TelegramIcon },
    { platform: 'instagram' as const, value: socialLinks?.instagram, Icon: InstagramIcon },
    { platform: 'whatsapp' as const, value: socialLinks?.whatsapp, Icon: WhatsAppIcon },
  ].filter((s) => s.value);

  return (
    <footer className="app-footer">
      <p className="app-footer-text">
        <Sparkles size={15} className="app-footer-sparkle" />
        Tenha um sistema proprio! <span className="app-footer-cta">Entre em contato</span>
      </p>

      <div className="app-footer-actions">
        <button type="button" className="app-footer-download" onClick={onDownloadApp}>
          <Download size={15} />
          Baixar App
        </button>

        {socials.length > 0 ? (
          <div className="app-footer-socials">
            {socials.map(({ platform, value, Icon }) => (
              <a
                key={platform}
                className={`app-footer-social-link ${platform}`}
                href={buildSocialUrl(platform, value!)}
                target="_blank"
                rel="noreferrer"
                title={platform === 'telegram' ? 'Telegram' : platform === 'instagram' ? 'Instagram' : 'WhatsApp'}
              >
                <Icon size={17} />
              </a>
            ))}
          </div>
        ) : null}
      </div>
    </footer>
  );
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

export function AppShell({ user, navGroups, activeId, onSelect, onLogout, socialLinks, children }: AppShellProps) {
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

      <AppFooter socialLinks={socialLinks} onDownloadApp={() => handleSelect('baixar-app')} />
    </div>
  );
}
