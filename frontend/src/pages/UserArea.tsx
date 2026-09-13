import { lazy, Suspense, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { AppShell } from '../components/AppShell';
import { SectionPlaceholder } from '../components/SectionPlaceholder';
import { PushActivationCard } from '../components/PushActivationCard';
import {
  accountNavItems,
  filterHiddenNavItems,
  flattenNavItems,
  isNavItemHidden,
  mainNavItems,
  PLANO_ABA_GROUP_BY_NAV_ID,
  solicitarAcessoNavItem,
  type NavItem,
} from '../config/userNavigation';
import { api } from '../lib/api';
import { hasPaidAccess } from '../lib/access';
import { useAuth } from '../lib/auth';
import type { LanternaProject, MoldProjectSummary, MoldSummary, SystemSettings, Comunicado } from '../types';
// Tela de planos fica "eager" — e o que o cliente SEM plano ve (caso mais
// comum), entao nao vale a pena separar num pedaco a parte.
import { SolicitarAcessoPage } from './SolicitarAcessoPage';

// CODE SPLITTING: cada ferramenta vira um ARQUIVO JS separado, baixado SO
// quando o cliente abre a aba. Cliente sem o plano nunca abre -> nunca baixa o
// codigo daquela ferramenta. O 3D (Three.js), que e o maior, sai do pacote
// principal.
const BaixarAppPage = lazy(() => import('./BaixarAppPage').then((m) => ({ default: m.BaixarAppPage })));
const BandeiraWorkspace = lazy(() => import('./BandeiraWorkspace').then((m) => ({ default: m.BandeiraWorkspace })));
const BiscoitoGolfierWorkspace = lazy(() => import('./BiscoitoGolfierWorkspace').then((m) => ({ default: m.BiscoitoGolfierWorkspace })));
const LanternagemBojoWorkspace = lazy(() => import('./LanternagemBojoWorkspace').then((m) => ({ default: m.LanternagemBojoWorkspace })));
const LanternagemProjectGallery = lazy(() => import('./LanternagemProjectGallery').then((m) => ({ default: m.LanternagemProjectGallery })));
const Modelo3DWorkspace = lazy(() => import('./Modelo3DWorkspace').then((m) => ({ default: m.Modelo3DWorkspace })));
const MoldGallery = lazy(() => import('./MoldGallery').then((m) => ({ default: m.MoldGallery })));
const MoldTableForm = lazy(() => import('./MoldTableForm').then((m) => ({ default: m.MoldTableForm })));
const PainelWorkspace = lazy(() => import('./PainelWorkspace').then((m) => ({ default: m.PainelWorkspace })));
const PlotterRiscadoPage = lazy(() => import('./PlotterRiscadoPage').then((m) => ({ default: m.PlotterRiscadoPage })));
const PlotterTacosPage = lazy(() => import('./PlotterTacosPage').then((m) => ({ default: m.PlotterTacosPage })));
const ProjectGallery = lazy(() => import('./ProjectGallery').then((m) => ({ default: m.ProjectGallery })));
const ReduzirImagemPage = lazy(() => import('./ReduzirImagemPage').then((m) => ({ default: m.ReduzirImagemPage })));
const RifasWorkspace = lazy(() => import('./RifasWorkspace').then((m) => ({ default: m.RifasWorkspace })));
const UserSettingsPage = lazy(() => import('./UserSettingsPage').then((m) => ({ default: m.UserSettingsPage })));

interface PlotterTarget {
  moldId: number;
  projectId: number | null;
  nome: string;
  modelo: string;
  isBlank?: boolean;
}

/** Ultima aba visitada (ver useState de activeId) -- so a aba em si, nao o
 * projeto especifico que estava aberto (ex: "Modificar" um molde nao
 * reabre sozinho depois de um F5). */
const LAST_TAB_STORAGE_KEY = 'sistema-novo:user-area:last-tab';



interface UserAreaProps {
  /** Grupos de navegacao extras (ex: "Usuarios" no menu do admin), somados aos padroes. */
  extraNavGroups?: NavItem[][];
  /** Rotas extras — recebe o activeId e devolve o conteudo, ou null se nao for dela. */
  extraRoutes?: (activeId: string) => ReactNode | null;
}

export function UserArea({ extraNavGroups = [], extraRoutes }: UserAreaProps) {
  const { user, token, logout } = useAuth();
  const [systemSettings, setSystemSettings] = useState<SystemSettings | null>(null);
  const [pendingComm, setPendingComm] = useState<Comunicado | null>(null);

  // Card flutuante "ativar notificacoes" — so pra usuario que ainda nao ativou
  // e nao dispensou. Some sozinho se o push ja estiver ativo (onAlreadyActive).
  const [pushCardVisible, setPushCardVisible] = useState(
    () => typeof window !== 'undefined' && window.localStorage.getItem('push_card_dismissed') !== '1'
  );
  const dismissPushCard = useCallback(() => {
    window.localStorage.setItem('push_card_dismissed', '1');
    setPushCardVisible(false);
  }, []);
  const hidePushCard = useCallback(() => setPushCardVisible(false), []);

  useEffect(() => {
    if (!token) return;
    api
      .getSystemSettings(token)
      .then((response) => setSystemSettings(response.data))
      .catch(() => {
        // silencioso -- rodape/ocultar abas sao cosmeticos, nao pode travar o app se falhar
      });

    // Carregar comunicados pendentes
    api
      .getPendingComunicado(token)
      .then((res) => {
        if (res.data) {
          setPendingComm(res.data);
        }
      })
      .catch(() => {});
  }, [token]);

  const handleCloseComunicado = async () => {
    if (!pendingComm || !token) return;
    try {
      await api.markComunicadoAsRead(pendingComm.id, token);
      setPendingComm(null);
    } catch {
      setPendingComm(null);
    }
  };

  const hiddenIds = useMemo(() => new Set(systemSettings?.hidden_nav_items ?? []), [systemSettings]);

  // Cadastro novo sem plano pago ativo: so pode usar "Solicitar Acesso" e
  // "Configuracoes do Usuario" -- todo o resto do menu some ate ele pagar.
  // Admin nunca fica bloqueado (ver hasPaidAccess). Independente da aba
  // escondida pelo admin (hiddenIds/isNavItemHidden), que e um mecanismo
  // cosmetico separado.
  const locked = user !== null && !hasPaidAccess(user);

  // Aba oculta some pra todo mundo, admin incluso — "Usuarios"/"Redes Sociais"/
  // "Abas" ficam de fora dessa lista (sao um grupo de nav a parte, sempre
  // visivel), entao o admin nunca perde acesso a tela que desfaz o ocultar.
  // Esconder e por FOLHA (ex.: so "Galeria de Moldes", nao o grupo "Moldes"
  // inteiro) — filterHiddenNavItems tira as folhas escondidas e some com o
  // grupo sozinho se todas as folhas dele sumirem.
  const visibleMainNavItems = useMemo(() => filterHiddenNavItems(mainNavItems, hiddenIds), [hiddenIds]);
  const visibleAccountNavItems = useMemo(() => filterHiddenNavItems(accountNavItems, hiddenIds), [hiddenIds]);

  const navGroups = useMemo(
    () => {
      // Sem plano pago: menu mostra "Solicitar Acesso" (os planos) + as opcoes de
      // conta ("Configuracoes do Usuario" — trocar senha/e-mail). O resto some.
      if (locked) {
        return [[solicitarAcessoNavItem], visibleAccountNavItems];
      }
      // Com plano: mostra SO as abas que o plano do usuario libera (allowed_abas).
      // As que o plano nao inclui somem do menu (nao aparecem mais com cadeado).
      // Admin (allowed_abas === null) ve tudo.
      const keepByPlano = (id: string): boolean => {
        if (!user || user.role === 'admin' || !user.allowed_abas) return true;
        const group = PLANO_ABA_GROUP_BY_NAV_ID[id];
        if (!group) return true; // configuracoes etc — sempre visivel
        return user.allowed_abas.includes(group);
      };
      const planoMainNavItems = visibleMainNavItems
        .filter((item) => (item.children ? true : keepByPlano(item.id)))
        .map((item) =>
          item.children ? { ...item, children: item.children.filter((child) => keepByPlano(child.id)) } : item
        )
        .filter((item) => !item.children || item.children.length > 0);
      return [planoMainNavItems, visibleAccountNavItems, ...extraNavGroups];
    },
    [locked, visibleMainNavItems, visibleAccountNavItems, extraNavGroups, user]
  );
  const selectableItems = useMemo(() => navGroups.flatMap((group) => flattenNavItems(group)), [navGroups]);

  /** Uma aba escondida some do menu E de qualquer atalho que pule direto pra
   * ela (ex: "Plotar Risco" na galeria) — vale pra todo mundo, admin incluso. */
  const canUse = (id: string) => !isNavItemHidden(id, hiddenIds);

  /**
   * O plano do usuario nao inclui essa aba? `allowed_abas === null` (admin,
   * ou plano que libera tudo) nunca bloqueia aqui — so entra em jogo quando
   * o usuario JA tem acesso pago (nao confundir com `locked`, que e "nao
   * pagou nada ainda"). Ids fora de PLANO_ABA_GROUP_BY_NAV_ID (configuracoes,
   * solicitar-acesso) nunca ficam bloqueados por plano.
   */
  const isBlockedByPlano = (id: string) => {
    if (!user || user.role === 'admin' || !user.allowed_abas) return false;
    const group = PLANO_ABA_GROUP_BY_NAV_ID[id];
    if (!group) return false;
    return !user.allowed_abas.includes(group);
  };

  // Lembra a ultima aba visitada -- atualizar a pagina (F5) tem que manter o
  // usuario onde ele estava, nao voltar pra "Galeria de Moldes" (1o item).
  const [activeId, setActiveId] = useState(() => {
    try {
      const saved = window.localStorage.getItem(LAST_TAB_STORAGE_KEY);
      if (saved && selectableItems.some((item) => item.id === saved)) {
        return saved;
      }
    } catch {
      // localStorage indisponivel (modo privado etc) -- comeca na 1a aba
    }
    return selectableItems[0].id;
  });

  /** Imagem ja reduzida em "Reduzir Imagem HD", a caminho da aba Bandeira ou
   * Painel (botao "Usar na aba X") — entregue via prop pra ferramenta destino
   * assim que ela monta, depois zerada (ver onInitialFileConsumed). */
  const [imageHandoff, setImageHandoff] = useState<File | null>(null);
  const handleUseReducedImage = useCallback((imageFile: File, target: 'bandeiras' | 'painel-letreiros') => {
    setImageHandoff(imageFile);
    setActiveId(target);
  }, []);

  const [editingMoldId, setEditingMoldId] = useState<number | null>(() => {
    try {
      const saved = window.localStorage.getItem('sistema-novo:user-area:editing-mold-id');
      return saved ? Number(saved) : null;
    } catch {
      return null;
    }
  });

  const [plotterTarget, setPlotterTarget] = useState<PlotterTarget | null>(() => {
    try {
      const saved = window.localStorage.getItem('sistema-novo:user-area:plotter-target');
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });

  const [lanternaProjectId, setLanternaProjectId] = useState<number | null>(() => {
    try {
      const saved = window.localStorage.getItem('sistema-novo:user-area:lanterna-project-id');
      return saved ? Number(saved) : null;
    } catch {
      return null;
    }
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(LAST_TAB_STORAGE_KEY, activeId);
    } catch {
      // ignora se localStorage nao gravar (modo privado etc)
    }
  }, [activeId]);

  // Se a aba ativa nao existe mais no menu (ex: ficou sem plano -> so sobra
  // "Solicitar Acesso"; ou o plano nao inclui a aba salva) manda pra 1a aba
  // disponivel.
  useEffect(() => {
    if (!selectableItems.some((item) => item.id === activeId)) {
      setActiveId(selectableItems[0].id);
    }
  }, [selectableItems, activeId]);

  useEffect(() => {
    try {
      if (editingMoldId !== null) {
        window.localStorage.setItem('sistema-novo:user-area:editing-mold-id', String(editingMoldId));
      } else {
        window.localStorage.removeItem('sistema-novo:user-area:editing-mold-id');
      }
    } catch {}
  }, [editingMoldId]);

  useEffect(() => {
    try {
      if (plotterTarget !== null) {
        window.localStorage.setItem('sistema-novo:user-area:plotter-target', JSON.stringify(plotterTarget));
      } else {
        window.localStorage.removeItem('sistema-novo:user-area:plotter-target');
      }
    } catch {}
  }, [plotterTarget]);

  useEffect(() => {
    try {
      if (lanternaProjectId !== null) {
        window.localStorage.setItem('sistema-novo:user-area:lanterna-project-id', String(lanternaProjectId));
      } else {
        window.localStorage.removeItem('sistema-novo:user-area:lanterna-project-id');
      }
    } catch {}
  }, [lanternaProjectId]);

  // Reporta pro admin qual aba/ferramenta o cliente esta usando agora.
  // Manda ao trocar de aba e a cada 40s pra manter o "online" fresco.
  useEffect(() => {
    if (!token || user?.role === 'admin') return;
    const current = selectableItems.find((item) => item.id === activeId) ?? selectableItems[0];
    const label = current?.label;
    if (!label) return;
    const report = () => {
      void api.reportActivity(label, token).catch(() => {});
    };
    report();
    const id = window.setInterval(report, 40000);
    return () => window.clearInterval(id);
  }, [token, activeId, selectableItems, user?.role]);

  if (!user) {
    return null;
  }

  const activeItem = selectableItems.find((item) => item.id === activeId) ?? selectableItems[0];

  function handleSelect(id: string) {
    // Navegacao pelo menu sempre abre a secao limpa; edicao so via botao "Modificar".
    setEditingMoldId(null);
    if (id !== 'plotter-tacos') {
      setPlotterTarget(null);
    }
    if (id !== 'acabamento-lanternagem-bojo') {
      setLanternaProjectId(null);
    }
    setActiveId(id);
  }

  function handleOpenLanternaProject(project: LanternaProject) {
    setLanternaProjectId(project.id);
    setActiveId('acabamento-lanternagem-bojo');
  }

  function handleEditMold(moldId: number) {
    setEditingMoldId(moldId);
    setActiveId('moldes-tabela');
  }

  function handleCopiedMold(moldId: number) {
    // Copia criada no nome do usuario atual; abre para ele ajustar e salvar.
    setEditingMoldId(moldId);
    setActiveId('moldes-tabela');
  }

  /** "Plotar no Taco" na Galeria: sempre comeca do zero, sem projeto, molde em branco —
   * salvar cria um projeto NOVO, nunca reaproveita um ja existente desse molde. */
  function handlePlotTaco(mold: MoldSummary) {
    setPlotterTarget({
      moldId: mold.id,
      projectId: null,
      nome: mold.nome,
      modelo: mold.modelo,
      isBlank: true,
    });
    setActiveId('plotter-tacos');
  }


  /** "Modificar" em Meus Projetos: edita ESSE projeto especifico. */
  function handleModifyProject(project: MoldProjectSummary) {
    setPlotterTarget({
      moldId: project.mold_id,
      projectId: project.id,
      nome: project.display_nome,
      modelo: project.modelo,
    });
    setActiveId('plotter-tacos');
  }

  function handleMoldSaved() {
    setEditingMoldId(null);
    setActiveId('moldes-galeria');
  }

  function handleCancelEdit() {
    setEditingMoldId(null);
    setActiveId('moldes-galeria');
  }

  const extraContent = extraRoutes?.(activeId) ?? null;

  // Rede de seguranca: se o activeId atual corresponde a uma aba escondida
  // (chegou ali por algum atalho que a gente deixou passar), mostra o
  // placeholder generico em vez do conteudo de verdade.
  const blocked = !canUse(activeId);
  // Trava por 2 motivos possiveis: nao pagou plano nenhum ainda (`locked`),
  // ou ja paga mas o PLANO especifico dele nao inclui essa aba
  // (`isBlockedByPlano`) — os dois casos reaproveitam a mesma tela de
  // "Solicitar Acesso" com o aviso de aba bloqueada.
  const isLockedTab =
    activeId !== 'solicitar-acesso' &&
    activeId !== 'configuracoes' &&
    (locked || isBlockedByPlano(activeId));

  return (
    <>
    <AppShell
      user={user}
      navGroups={navGroups}
      activeId={activeId}
      onSelect={handleSelect}
      onLogout={() => void logout()}
      socialLinks={systemSettings}
    >
      <Suspense fallback={<div style={{ padding: '48px', textAlign: 'center', color: '#94a3b8' }}>Carregando…</div>}>
      {blocked ? (
        <SectionPlaceholder item={activeItem} note="Essa area nao esta disponivel no momento." />
      ) : isLockedTab ? (
        <SolicitarAcessoPage lockedTabLabel={activeItem.label} systemSettings={systemSettings} />
      ) : activeId === 'solicitar-acesso' ? (
        <SolicitarAcessoPage systemSettings={systemSettings} />
      ) : activeId === 'moldes-galeria' ? (
        <MoldGallery
          onEdit={handleEditMold}
          onCopied={handleCopiedMold}
          onPlotTaco={handlePlotTaco}
          showPlotTaco={canUse('plotter-tacos')}
        />
      ) : activeId === 'projetos-moldes-taqueados' ? (
        <ProjectGallery onModify={handleModifyProject} showModify={canUse('plotter-tacos')} />
      ) : activeId === 'bandeiras' ? (
        <BandeiraWorkspace initialFile={imageHandoff} onInitialFileConsumed={() => setImageHandoff(null)} />
      ) : activeId === 'acabamento-lanternagem-bojo' ? (
        <LanternagemBojoWorkspace projectId={lanternaProjectId} />
      ) : activeId === 'acabamento-biscoito-golfier' ? (
        <BiscoitoGolfierWorkspace />
      ) : activeId === 'projetos-lanternagem-bojo' ? (
        <LanternagemProjectGallery onOpen={handleOpenLanternaProject} />
      ) : activeId === 'painel-letreiros' ? (
        <PainelWorkspace initialFile={imageHandoff} onInitialFileConsumed={() => setImageHandoff(null)} />
      ) : activeId === '3d-fotos' ? (
        <Modelo3DWorkspace />
      ) : activeId === 'reduzir-imagem' ? (
        <ReduzirImagemPage onUseIn={handleUseReducedImage} />
      ) : activeId === 'profissionais' ? (
        <RifasWorkspace />
      ) : activeId === 'baixar-app' ? (
        <BaixarAppPage />
      ) : activeId === 'configuracoes' ? (
        <UserSettingsPage />
      ) : activeId === 'plotter-riscado' ? (
        <PlotterRiscadoPage />
      ) : activeId === 'moldes-tabela' ? (
        <MoldTableForm
          editMoldId={editingMoldId}
          onSaved={handleMoldSaved}
          onCancelEdit={editingMoldId != null ? handleCancelEdit : undefined}
        />
      ) : activeId === 'plotter-tacos' ? (
        <PlotterTacosPage
          moldId={plotterTarget?.moldId ?? null}
          moldHint={
            plotterTarget
              ? { id: plotterTarget.moldId, nome: plotterTarget.nome, modelo: plotterTarget.modelo }
              : null
          }
          projectId={plotterTarget?.projectId ?? null}
          isBlank={plotterTarget?.isBlank}
          onBackToGallery={() => {
            setPlotterTarget(null);
            setActiveId('moldes-galeria');
          }}
          onGoToTaqueados={() => {
            setPlotterTarget(null);
            setActiveId('projetos-moldes-taqueados');
          }}
        />
      ) : extraContent ? (
        extraContent
      ) : (
        <SectionPlaceholder item={activeItem} />
      )}
      </Suspense>
    </AppShell>

    {/* Card flutuante pra ativar as notificacoes push (so usuario). */}
    {user?.role === 'user' && pushCardVisible && (
      <PushActivationCard variant="floating" onClose={dismissPushCard} onAlreadyActive={hidePushCard} />
    )}

    {/* Pop-up de Comunicado (exibido apenas 1 vez para cada cliente) */}
    {pendingComm && (
      <div style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.8)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 99999,
        padding: '20px',
        backdropFilter: 'blur(4px)'
      }}>
        <div style={{
          background: '#111622',
          border: '2px solid #3182ce',
          borderRadius: '12px',
          padding: '28px',
          maxWidth: '520px',
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
          gap: '16px',
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5), 0 10px 10px -5px rgba(0, 0, 0, 0.4)'
        }}>
          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', borderBottom: '1px solid #1f293d', paddingBottom: '12px' }}>
            <div style={{ background: 'rgba(49,130,206,0.1)', padding: '8px', borderRadius: '8px' }}>
              <span style={{ fontSize: '20px' }}>📢</span>
            </div>
            <div>
              <h3 style={{ fontSize: '18px', fontWeight: 700, color: '#fff', margin: 0 }}>Aviso Importante</h3>
              <span style={{ fontSize: '11px', color: '#718096' }}>Comunicado oficial</span>
            </div>
          </div>

          {/* Titulo & Conteudo */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <h4 style={{ fontSize: '16px', fontWeight: 600, color: '#3182ce', margin: 0 }}>{pendingComm.titulo}</h4>
            <p style={{
              color: '#cbd5e0',
              fontSize: '14px',
              lineHeight: '1.5',
              whiteSpace: 'pre-wrap',
              margin: '6px 0 0 0',
              maxHeight: '260px',
              overflowY: 'auto',
              paddingRight: '6px'
            }}>
              {pendingComm.conteudo}
            </p>
          </div>

          {/* Action */}
          <button
            type="button"
            onClick={() => void handleCloseComunicado()}
            style={{
              background: '#3182ce',
              color: '#fff',
              border: 'none',
              padding: '12px',
              borderRadius: '8px',
              cursor: 'pointer',
              fontWeight: 700,
              fontSize: '14px',
              marginTop: '8px',
              textAlign: 'center',
              boxShadow: '0 4px 6px rgba(0, 0, 0, 0.2)',
              transition: 'background 0.2s'
            }}
          >
            Entendi / Fechar
          </button>
        </div>
      </div>
    )}

    </>
  );
}
