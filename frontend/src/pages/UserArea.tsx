import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { AppShell } from '../components/AppShell';
import { SectionPlaceholder } from '../components/SectionPlaceholder';
import {
  accountNavItems,
  flattenNavItems,
  isNavItemHidden,
  mainNavItems,
  solicitarAcessoNavItem,
  type NavItem,
} from '../config/userNavigation';
import { api } from '../lib/api';
import { hasPaidAccess } from '../lib/access';
import { useAuth } from '../lib/auth';
import type { MoldProjectSummary, MoldSummary, SystemSettings } from '../types';
import { BaixarAppPage } from './BaixarAppPage';
import { BandeiraWorkspace } from './BandeiraWorkspace';
import { Modelo3DWorkspace } from './Modelo3DWorkspace';
import { MoldGallery } from './MoldGallery';
import { MoldTableForm } from './MoldTableForm';
import { PainelWorkspace } from './PainelWorkspace';
import { PlotterRiscadoPage } from './PlotterRiscadoPage';
import { PlotterTacosPage } from './PlotterTacosPage';
import { ProjectGallery } from './ProjectGallery';
import { RifasWorkspace } from './RifasWorkspace';
import { SolicitarAcessoPage } from './SolicitarAcessoPage';
import { UserSettingsPage } from './UserSettingsPage';

interface PlotterTarget {
  moldId: number;
  projectId: number | null;
  nome: string;
  modelo: string;
}

interface PlotterRiscadoTarget {
  moldId: number;
  nome: string;
  modelo: string;
}

interface UserAreaProps {
  /** Grupos de navegacao extras (ex: "Usuarios" no menu do admin), somados aos padroes. */
  extraNavGroups?: NavItem[][];
  /** Rotas extras — recebe o activeId e devolve o conteudo, ou null se nao for dela. */
  extraRoutes?: (activeId: string) => ReactNode | null;
}

export function UserArea({ extraNavGroups = [], extraRoutes }: UserAreaProps) {
  const { user, token, logout } = useAuth();
  const [systemSettings, setSystemSettings] = useState<SystemSettings | null>(null);

  useEffect(() => {
    if (!token) return;
    api
      .getSystemSettings(token)
      .then((response) => setSystemSettings(response.data))
      .catch(() => {
        // silencioso -- rodape/ocultar abas sao cosmeticos, nao pode travar o app se falhar
      });
  }, [token]);

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
  const visibleMainNavItems = useMemo(
    () => (locked ? [] : mainNavItems.filter((item) => !hiddenIds.has(item.id))),
    [hiddenIds, locked]
  );
  const visibleAccountNavItems = useMemo(
    () =>
      locked
        ? accountNavItems.filter((item) => item.id === 'configuracoes')
        : accountNavItems.filter((item) => !hiddenIds.has(item.id)),
    [hiddenIds, locked]
  );

  const navGroups = useMemo(
    () => (locked ? [[solicitarAcessoNavItem], visibleAccountNavItems] : [visibleMainNavItems, visibleAccountNavItems, ...extraNavGroups]),
    [locked, visibleMainNavItems, visibleAccountNavItems, extraNavGroups]
  );
  const selectableItems = useMemo(() => navGroups.flatMap((group) => flattenNavItems(group)), [navGroups]);

  /** Uma aba escondida some do menu E de qualquer atalho que pule direto pra
   * ela (ex: "Plotar Risco" na galeria) — vale pra todo mundo, admin incluso.
   * Independente do bloqueio por falta de pagamento (ver `locked` acima). */
  const canUse = (id: string) => !isNavItemHidden(id, hiddenIds) && (!locked || id === 'solicitar-acesso' || id === 'configuracoes');

  const [activeId, setActiveId] = useState(selectableItems[0].id);
  const [editingMoldId, setEditingMoldId] = useState<number | null>(null);
  const [plotterTarget, setPlotterTarget] = useState<PlotterTarget | null>(null);
  const [plotterRiscadoTarget, setPlotterRiscadoTarget] = useState<PlotterRiscadoTarget | null>(null);

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
    if (id !== 'plotter-riscado') {
      setPlotterRiscadoTarget(null);
    }
    setActiveId(id);
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

  /** "Plotar no Taco" na Galeria: sempre comeca do zero, sem projeto — salvar
   * cria um projeto NOVO, nunca reaproveita um ja existente desse molde. */
  function handlePlotTaco(mold: MoldSummary) {
    setPlotterTarget({ moldId: mold.id, projectId: null, nome: mold.nome, modelo: mold.modelo });
    setActiveId('plotter-tacos');
  }

  function handlePlotRiscado(mold: MoldSummary) {
    setPlotterRiscadoTarget({ moldId: mold.id, nome: mold.nome, modelo: mold.modelo });
    setActiveId('plotter-riscado');
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

  return (
    <AppShell
      user={user}
      navGroups={navGroups}
      activeId={activeId}
      onSelect={handleSelect}
      onLogout={() => void logout()}
      socialLinks={systemSettings}
    >
      {blocked ? (
        <SectionPlaceholder item={activeItem} note="Essa area nao esta disponivel no momento." />
      ) : activeId === 'solicitar-acesso' ? (
        <SolicitarAcessoPage />
      ) : activeId === 'moldes-galeria' ? (
        <MoldGallery
          onEdit={handleEditMold}
          onCopied={handleCopiedMold}
          onPlotTaco={handlePlotTaco}
          onPlotRiscado={handlePlotRiscado}
          showPlotTaco={canUse('plotter-tacos')}
          showPlotRiscado={canUse('plotter-riscado')}
        />
      ) : activeId === 'projetos-moldes-taqueados' ? (
        <ProjectGallery onModify={handleModifyProject} showModify={canUse('plotter-tacos')} />
      ) : activeId === 'bandeiras' ? (
        <BandeiraWorkspace />
      ) : activeId === 'painel-letreiros' ? (
        <PainelWorkspace />
      ) : activeId === '3d-fotos' ? (
        <Modelo3DWorkspace />
      ) : activeId === 'profissionais' ? (
        <RifasWorkspace />
      ) : activeId === 'baixar-app' ? (
        <BaixarAppPage />
      ) : activeId === 'configuracoes' ? (
        <UserSettingsPage />
      ) : activeId === 'projetos-moldes-riscados' ? (
        <SectionPlaceholder
          item={activeItem}
          note="Assim que voce plotar por aqui, os projetos salvos vao aparecer nesta aba."
        />
      ) : activeId === 'plotter-riscado' ? (
        <PlotterRiscadoPage
          moldId={plotterRiscadoTarget?.moldId ?? null}
          moldHint={
            plotterRiscadoTarget
              ? { id: plotterRiscadoTarget.moldId, nome: plotterRiscadoTarget.nome, modelo: plotterRiscadoTarget.modelo }
              : null
          }
          onBackToGallery={() => {
            setPlotterRiscadoTarget(null);
            setActiveId('moldes-galeria');
          }}
        />
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
          onBackToGallery={() => {
            setPlotterTarget(null);
            setActiveId('moldes-galeria');
          }}
        />
      ) : extraContent ? (
        extraContent
      ) : (
        <SectionPlaceholder item={activeItem} />
      )}
    </AppShell>
  );
}
