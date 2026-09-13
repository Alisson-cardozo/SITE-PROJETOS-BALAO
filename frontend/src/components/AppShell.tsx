import { useEffect, useState, type ReactNode } from 'react';
import { ChevronDown, Lock, Menu, PanelLeftClose, PanelLeftOpen, Sparkles, X, Smartphone, Play, Minimize2, Maximize2 } from 'lucide-react';
import { InstagramIcon, TelegramIcon, WhatsAppIcon } from './BrandIcons';
import type { NavItem } from '../config/userNavigation';
import { buildSocialUrl } from '../lib/socialLinks';
import type { SystemSettings, User } from '../types';
import { hasPaidAccess } from '../lib/access';
import { api } from '../lib/api';

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
        Tenha um sistema próprio! <span className="app-footer-cta">Entre em contato</span>
      </p>

      <div className="app-footer-actions">
        <button type="button" className="app-footer-download app-footer-download-glow" onClick={onDownloadApp}>
          <Smartphone size={15} />
          Baixe o App no Celular
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

  const [tutorialOpen, setTutorialOpen] = useState(false);
  const [tutorialMinimized, setTutorialMinimized] = useState(false);

  useEffect(() => {
    setTutorialOpen(false);
    setTutorialMinimized(false);
  }, [activeId]);

  const activeTutorial = socialLinks?.tutorials?.[activeId];
  const showTutorialButton = activeTutorial && activeTutorial.show && !!activeTutorial.video_url;
  const embedUrl = showTutorialButton ? getYoutubeEmbedUrl(activeTutorial.video_url) : null;

  // Cliente SEM acesso pago vê um botão do YouTube no topo, que leva direto pro
  // canal (admin configura o link em Redes Sociais) — pra ver as funcionalidades.
  const youtubeCta = user && !hasPaidAccess(user) && socialLinks?.youtube ? socialLinks.youtube : null;

  const activeItem = navGroups
    .flatMap((g) => g.flatMap((item) => (item.children?.length ? item.children : [item])))
    .find((item) => item.id === activeId);

  useEffect(() => {
    localStorage.setItem(COLLAPSE_STORAGE_KEY, collapsed ? '1' : '0');
  }, [collapsed]);

  // Periodic session heartbeat to keep user session alive
  useEffect(() => {
    const token = localStorage.getItem('plotter_token');
    if (!token) return;

    const sendHeartbeat = () => {
      api.heartbeat(token).catch(() => {
        // If the heartbeat fails (e.g. 401 Unauthorized because session was revoked/expired),
        // trigger logout to clean client state and redirect to login screen
        onLogout();
      });
    };

    sendHeartbeat();
    const interval = setInterval(sendHeartbeat, 25000);

    return () => clearInterval(interval);
  }, [onLogout]);

  function handleSelect(id: string) {
    onSelect(id);
    setSidebarOpen(false);
    setOpenIds(new Set());
  }

  function toggleGroup(id: string) {
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

  const isUserLocked = !hasPaidAccess(user);

  const isItemLocked = (id: string) => {
    if (!isUserLocked) return false;
    if (id === 'solicitar-acesso' || id === 'configuracoes' || id === 'baixar-app') {
      return false;
    }
    return true;
  };

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
            <h1>Olá, {user.name}</h1>
            <span className={`role-badge role-${user.role}`}>
              {user.role === 'admin' ? 'Administrador' : 'Usuário'}
            </span>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {youtubeCta && (
            <a
              href={youtubeCta}
              target="_blank"
              rel="noreferrer"
              className="topbar-youtube-btn"
              title="Veja as funcionalidades no nosso canal do YouTube"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.5 12 3.5 12 3.5s-7.5 0-9.4.6A3 3 0 0 0 .5 6.2 31 31 0 0 0 0 12a31 31 0 0 0 .5 5.8 3 3 0 0 0 2.1 2.1c1.9.6 9.4.6 9.4.6s7.5 0 9.4-.6a3 3 0 0 0 2.1-2.1A31 31 0 0 0 24 12a31 31 0 0 0-.5-5.8zM9.5 15.5v-7l6.5 3.5-6.5 3.5z" />
              </svg>
              <span>Ver funcionalidades</span>
            </a>
          )}
          {showTutorialButton && embedUrl && !tutorialOpen && (
            <button
              type="button"
              className="tutorial-pulse-btn"
              onClick={() => setTutorialOpen(true)}
              style={{
                background: 'linear-gradient(135deg, #3182ce 0%, #2b6cb0 100%)',
                color: '#fff',
                border: 'none',
                borderRadius: '10px',
                padding: '10px 16px',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                fontWeight: 600,
                fontSize: '13px',
                cursor: 'pointer',
                transition: 'all 0.2s ease-in-out',
                height: '38px',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = 'translateY(-1px) scale(1.02)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'none';
              }}
            >
              <Play size={14} fill="currentColor" />
              <span>Vídeo Tutorial</span>
            </button>
          )}

          <button type="button" className="topbar-logout" onClick={onLogout}>
            Sair
          </button>
        </div>
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
                        {isItemLocked(item.id) && <Lock size={12} className="app-nav-lock-icon" />}
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
                              <span>{child.label}</span>
                              {isItemLocked(child.id) && <Lock size={11} className="app-nav-lock-icon" />}
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
                    {isItemLocked(item.id) && <Lock size={12} className="app-nav-lock-icon" />}
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

      {/* Card Flutuante do Vídeo Tutorial */}
      {showTutorialButton && embedUrl && tutorialOpen && (
        <div
          style={{
            position: 'fixed',
            bottom: '80px',
            right: '24px',
            width: '380px',
            maxWidth: 'calc(100vw - 48px)',
            background: '#111622',
            border: '2px solid #3182ce',
            boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.7), 0 0 15px rgba(49, 130, 206, 0.2)',
            borderRadius: '12px',
            zIndex: 9999,
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            transition: 'all 0.3s ease-in-out',
            height: tutorialMinimized ? '44px' : '294px',
          }}
        >
          {/* Card Header */}
          <div
            style={{
              background: '#182030',
              padding: '10px 16px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              borderBottom: '1px solid #1f293d',
              height: '44px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
              <span style={{ fontSize: '16px', flexShrink: 0 }}>🎥</span>
              <span
                style={{
                  color: '#fff',
                  fontSize: '13px',
                  fontWeight: 600,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                Tutorial: {activeItem?.label}
              </span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              {/* Minimize / Maximize */}
              <button
                type="button"
                onClick={() => setTutorialMinimized(!tutorialMinimized)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: '#718096',
                  cursor: 'pointer',
                  padding: '4px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: '4px',
                  transition: 'color 0.2s',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.color = '#fff')}
                onMouseLeave={(e) => (e.currentTarget.style.color = '#718096')}
                title={tutorialMinimized ? 'Maximizar' : 'Minimizar'}
              >
                {tutorialMinimized ? <Maximize2 size={14} /> : <Minimize2 size={14} />}
              </button>

              {/* Close */}
              <button
                type="button"
                onClick={() => setTutorialOpen(false)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: '#718096',
                  cursor: 'pointer',
                  padding: '4px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: '4px',
                  transition: 'color 0.2s',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.color = '#e53e3e')}
                onMouseLeave={(e) => (e.currentTarget.style.color = '#718096')}
                title="Fechar"
              >
                <X size={14} />
              </button>
            </div>
          </div>

          {/* Card Body - Video Player */}
          <div style={{ 
            flex: 1, 
            position: 'relative', 
            background: '#000',
            display: tutorialMinimized ? 'none' : 'block'
          }}>
            <iframe
              width="100%"
              height="246"
              src={embedUrl}
              title="Vídeo Tutorial"
              frameBorder="0"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowFullScreen
              style={{ border: 'none', display: 'block' }}
            ></iframe>
          </div>
        </div>
      )}
    </div>
  );
}

function getYoutubeEmbedUrl(url: string): string | null {
  if (!url) return null;
  let videoId: string | null = null;
  try {
    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=|shorts\/)([^#\&\?]*).*/;
    const match = url.match(regExp);
    if (match && match[2].length === 11) {
      videoId = match[2];
    }
  } catch (e) {
    return null;
  }
  return videoId ? `https://www.youtube.com/embed/${videoId}` : null;
}
