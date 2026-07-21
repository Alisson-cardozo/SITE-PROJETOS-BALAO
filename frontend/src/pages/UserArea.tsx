import { useState } from 'react';
import { AppShell } from '../components/AppShell';
import { SectionPlaceholder } from '../components/SectionPlaceholder';
import { accountNavItems, flattenNavItems, mainNavItems } from '../config/userNavigation';
import { useAuth } from '../lib/auth';
import type { MoldProjectSummary, MoldSummary } from '../types';
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
import { UserSettingsPage } from './UserSettingsPage';

const selectableItems = [...flattenNavItems(mainNavItems), ...flattenNavItems(accountNavItems)];

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

export function UserArea() {
  const { user, logout } = useAuth();
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

  return (
    <AppShell
      user={user}
      navGroups={[mainNavItems, accountNavItems]}
      activeId={activeId}
      onSelect={handleSelect}
      onLogout={() => void logout()}
    >
      {activeId === 'moldes-galeria' ? (
        <MoldGallery
          onEdit={handleEditMold}
          onCopied={handleCopiedMold}
          onPlotTaco={handlePlotTaco}
          onPlotRiscado={handlePlotRiscado}
        />
      ) : activeId === 'projetos-moldes-taqueados' ? (
        <ProjectGallery onModify={handleModifyProject} />
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
      ) : (
        <SectionPlaceholder item={activeItem} />
      )}
    </AppShell>
  );
}
