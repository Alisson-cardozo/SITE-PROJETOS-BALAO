import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowLeft, ChevronDown, ChevronUp, ChevronsDown, ChevronsUp, Loader2, Plus, Printer, Save, Trash2 } from 'lucide-react';
import { GomoTacoPreview } from '../components/GomoTacoPreview';
import { PlotterCarlaChat } from '../components/PlotterCarlaChat';
import { buildPlotterConfig, type ChatParte } from '../lib/solicitacaoTaqueado';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import {
  buildMoldProfile,
  buildTacoDivisions,
  createDefaultTacoConfigs,
  createPartition,
  DEFAULT_SECTION_RATIOS,
  expandSectionPartitions,
  PARTITION_DIVISION_COLORS,
  SECTION_COLORS,
  type MoldSection,
  type SectionPartition,
  type SectionRatios,
  type SectionTacoConfigMap,
} from '../lib/moldGeometry';
import type { MoldDetail } from '../types';

interface PlotterTacosPageProps {
  moldId: number | null;
  moldHint?: { id: number; nome: string; modelo: string } | null;
  /** Quando presente, edita ESSE projeto ja salvo (usado em "Modificar" de Meus
   * Projetos) — "Salvar configuracao" atualiza o mesmo projeto. Quando null/
   * undefined, comeca do zero (3 partes padrao, taco 5cm) e "Salvar
   * configuracao" cria um projeto NOVO (usado em "Plotar no Taco" da Galeria —
   * nunca reaproveita um projeto existente desse molde). */
  projectId?: number | null;
  isBlank?: boolean;
  onBackToGallery?: () => void;
  /** Fecha o plotter e vai pra aba Meus Projetos → Moldes Taqueados (usado
   * quando a Carla termina de montar e salvar um molde). */
  onGoToTaqueados?: () => void;
}

type SectionColors = Record<MoldSection['id'], string>;

const DEFAULT_COLORS: SectionColors = { ...SECTION_COLORS };
const MAX_PARTITIONS = 40;

/** Paleta de preenchimento ao criar novas reparticoes (cores distintas). */
const PART_FILL_COLORS = [
  '#f4e64a',
  '#f8b26a',
  '#77e6f2',
  '#b7e36f',
  '#f062b8',
  '#a78bfa',
  '#fb7185',
  '#38bdf8',
];

function sectionColorOffset(sectionId: MoldSection['id']): number {
  if (sectionId === 'bico') return 0;
  if (sectionId === 'bojo') return 2;
  return 4;
}

function formatCm(value: number): string {
  const n = Number(value);
  const text = Number.isFinite(n) ? n.toFixed(1).replace(/\.0$/, '').replace('.', ',') : '0';
  return `${text} cm`;
}

export function PlotterTacosPage({ moldId, moldHint, projectId = null, isBlank = false, onBackToGallery, onGoToTaqueados }: PlotterTacosPageProps) {
  const { token, user } = useAuth();
  const [mold, setMold] = useState<MoldDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [sectionColors, setSectionColors] = useState<SectionColors>(DEFAULT_COLORS);
  const [tacoConfigs, setTacoConfigs] = useState<SectionTacoConfigMap>(() => createDefaultTacoConfigs(1));
  const [sectionRatios, setSectionRatios] = useState<SectionRatios>(() => ({ ...DEFAULT_SECTION_RATIOS }));

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);
  /** Projeto que "Salvar configuracao" vai atualizar. Comeca com `projectId`
   * (editando via Modificar); apos o 1o salvamento de uma plotagem nova, passa
   * a apontar pro projeto recem-criado — assim salvar de novo na MESMA sessao
   * atualiza, em vez de criar mais um projeto a cada clique. */
  const [currentProjectId, setCurrentProjectId] = useState<number | null>(projectId);

  /** Controla quais secoes ja foram desbloqueadas no fluxo guiado.
   * Boca sempre comeca ativa; Bojo e Bico desbloqueiam conforme o usuario avanca. */
  const [unlockedSections, setUnlockedSections] = useState<Set<MoldSection['id']>>(() => new Set<MoldSection['id']>(['boca']));

  /** Modo de entrada dos tacos: painel manual (padrao) ou chat da Carla. */
  const [inputMode, setInputMode] = useState<'manual' | 'carla'>('manual');

  /** A Assistente-IA Carla só fica disponível se o plano do usuário liberar
   * (recurso a parte). Admin sempre tem. */
  const carlaDisponivel = user?.role === 'admin' || user?.carla_ia_disponivel === true;

  /** Controle de cards minimizados por secao (Boca, Bojo, Bico) */
  const [collapsedSections, setCollapsedSections] = useState<Record<MoldSection['id'], boolean>>({
    boca: false,
    bojo: false,
    bico: false,
  });

  /** Controle de cards minimizados por reparticao individual */
  const [collapsedPartitions, setCollapsedPartitions] = useState<Record<string, boolean>>({});

  const toggleSectionCollapse = (sectionId: MoldSection['id']) => {
    setCollapsedSections((prev) => ({ ...prev, [sectionId]: !prev[sectionId] }));
  };

  const togglePartitionCollapse = (partitionId: string) => {
    setCollapsedPartitions((prev) => ({ ...prev, [partitionId]: !prev[partitionId] }));
  };

  const handleCollapseAllSections = () => {
    setCollapsedSections({ boca: true, bojo: true, bico: true });
  };

  const handleExpandAllSections = () => {
    setCollapsedSections({ boca: false, bojo: false, bico: false });
  };

  /** Aviso temporario por reparticao quando um valor digitado e ajustado
   * automaticamente (ex.: Bico sem espaco pro tanto de taco pedido). */
  const [clampWarnings, setClampWarnings] = useState<Record<string, string>>({});

  // Estados do Mecanismo de Rascunho
  const [hasDraftLoaded, setHasDraftLoaded] = useState(false);
  const [reloadTrigger, setReloadTrigger] = useState(0);

  const draftKey = useMemo(() => {
    if (!user || moldId == null) return '';
    return `sistema-novo:draft:user-${user.id}:mold-${moldId}:project-${currentProjectId || 'new'}`;
  }, [user, moldId, currentProjectId]);

  // Hook de Auto-salvamento silencioso
  useEffect(() => {
    if (loading || !mold || !draftKey) return;
    try {
      const draft = {
        sectionColors,
        sectionRatios,
        tacoConfigs,
        unlockedSectionsArray: Array.from(unlockedSections)
      };
      window.localStorage.setItem(draftKey, JSON.stringify(draft));
    } catch {}
  }, [sectionColors, sectionRatios, tacoConfigs, unlockedSections, loading, mold, draftKey]);

  const handleDiscardDraft = () => {
    if (draftKey) {
      try {
        window.localStorage.removeItem(draftKey);
      } catch {}
    }
    setHasDraftLoaded(false);
    setSaveSuccess(null);
    setReloadTrigger((prev) => prev + 1); // Dispara carregamento limpo
  };

  const handleBack = () => {
    if (draftKey) {
      try {
        window.localStorage.removeItem(draftKey);
      } catch {}
    }
    onBackToGallery?.();
  };

  function flashClampWarning(partitionId: string, message: string) {
    setClampWarnings((prev) => ({ ...prev, [partitionId]: message }));
    window.setTimeout(() => {
      setClampWarnings((prev) => {
        if (!(partitionId in prev)) {
          return prev;
        }
        const next = { ...prev };
        delete next[partitionId];
        return next;
      });
    }, 5000);
  }

  useEffect(() => {
    setCurrentProjectId(projectId);
  }, [projectId, moldId]);

  useEffect(() => {
    if (!token || moldId == null) {
      setMold(null);
      setError(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    setSaveError(null);
    setSaveSuccess(null);

    const moldRequest = api.getMold(moldId, token);
    const projectRequest = projectId != null ? api.getProject(projectId, token) : null;

    Promise.all([moldRequest, projectRequest])
      .then(([moldResponse, projectResponse]) => {
        if (cancelled) {
          return;
        }
        setMold(moldResponse.data);

        // Tentar carregar rascunho local antes dos dados padrão/banco
        const savedDraftRaw = draftKey ? window.localStorage.getItem(draftKey) : null;
        if (savedDraftRaw) {
          try {
            const draft = JSON.parse(savedDraftRaw);
            setSectionColors(draft.sectionColors);
            setSectionRatios(draft.sectionRatios);
            setTacoConfigs(draft.tacoConfigs);
            setUnlockedSections(new Set(draft.unlockedSectionsArray || ['boca']));
            setHasDraftLoaded(true);
            setSaveSuccess('Rascunho não salvo recuperado do seu navegador.');
            return; // Nao processa o resto para manter o rascunho
          } catch {
            // Ignora erro e continua
          }
        }

        const saved = projectResponse?.data.plotter_config ?? null;
        if (saved) {
          setSectionColors({ ...DEFAULT_COLORS, ...saved.section_colors });
          
          const loadedConfigs = JSON.parse(JSON.stringify(saved.taco_configs));
          const tempProfile = buildMoldProfile(moldResponse.data.pontos, saved.section_ratios || DEFAULT_SECTION_RATIOS);
          if (tempProfile) {
            for (const secao of tempProfile.secoes) {
              const cfg = loadedConfigs[secao.id];
              if (cfg && cfg.partitions) {
                const parts = cfg.partitions;
                const weights = parts.map((p: any) => Math.max(0.01, Number(p.peso) || 1));
                const weightSum = weights.reduce((s: number, w: number) => s + w, 0) || 1;
                cfg.partitions = parts.map((part: any, index: number) => {
                  if (part.tacosSubindo === undefined) {
                    const frac = weights[index] / weightSum;
                    const bandHeight = secao.alturaCm * frac;
                    const calculated = Math.max(1, Math.floor(bandHeight / part.alturaTacoCm));
                    return { ...part, tacosSubindo: calculated };
                  }
                  return part;
                });
              }
            }
          }

          setTacoConfigs(loadedConfigs);
          setSectionRatios(saved.section_ratios);
          // Desbloqueia automaticamente as secoes que ja tem particoes salvas
          const unlocked = new Set<MoldSection['id']>(['boca']);
          if ((loadedConfigs.bojo?.partitions?.length ?? 0) > 0) unlocked.add('bojo');
          if ((loadedConfigs.bico?.partitions?.length ?? 0) > 0) unlocked.add('bico');
          setUnlockedSections(unlocked);
        } else if (isBlank) {
          setSectionColors(DEFAULT_COLORS);
          // Inicia com 1 reparticao padrao ja na Boca para guiar o fluxo
          const bocaInicial = createPartition(4, 5, 10, PART_FILL_COLORS[4], PARTITION_DIVISION_COLORS[0]);
          setTacoConfigs({
            boca: { partitions: [bocaInicial] },
            bojo: { partitions: [] },
            bico: { partitions: [] },
          });
          setSectionRatios({ ...DEFAULT_SECTION_RATIOS });
          setUnlockedSections(new Set<MoldSection['id']>(['boca']));
        } else {
          setSectionColors(DEFAULT_COLORS);
          const defaultConfigs = createDefaultTacoConfigs(moldResponse.data.bainha_cm || 1);
          const tempProfile = buildMoldProfile(moldResponse.data.pontos, DEFAULT_SECTION_RATIOS);
          if (tempProfile) {
            for (const secao of tempProfile.secoes) {
              const cfg = defaultConfigs[secao.id];
              if (cfg && cfg.partitions[0]) {
                const part = cfg.partitions[0];
                part.tacosSubindo = Math.max(1, Math.floor(secao.alturaCm / part.alturaTacoCm));
              }
            }
          }
          setTacoConfigs(defaultConfigs);
          setSectionRatios({ ...DEFAULT_SECTION_RATIOS });
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setMold(null);
          setError(err instanceof ApiError ? err.message : 'Nao foi possivel carregar o molde.');
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [moldId, projectId, token, reloadTrigger, draftKey]);

  /** Persiste um payload de config (cria projeto novo se currentProjectId==null,
   * senão atualiza). Núcleo compartilhado por "Salvar configuração" e pela Carla. */
  async function persistConfig(payload: {
    section_colors: SectionColors;
    section_ratios: SectionRatios;
    taco_configs: SectionTacoConfigMap;
  }): Promise<boolean> {
    if (!token || moldId == null || saving) {
      return false;
    }

    setSaving(true);
    setSaveError(null);
    setSaveSuccess(null);

    try {
      if (currentProjectId != null) {
        await api.updateProject(currentProjectId, payload, token);
        setSaveSuccess('Configuracao atualizada neste projeto.');
      } else {
        const response = await api.createProject(moldId, payload, token);
        setCurrentProjectId(response.data.id);
        setSaveSuccess(`Novo projeto "${response.data.display_nome}" salvo em Meus Projetos.`);
      }

      // Limpa o rascunho temporario local apos salvar com sucesso
      if (draftKey) {
        try {
          window.localStorage.removeItem(draftKey);
        } catch {}
      }
      setHasDraftLoaded(false);
      return true;
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : 'Nao foi possivel salvar a configuracao.');
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveConfig() {
    await persistConfig({
      section_colors: sectionColors,
      section_ratios: sectionRatios,
      taco_configs: tacoConfigs,
    });
  }

  /**
   * Compara a altura "so o que foi configurado" (editor ao vivo) com a altura
   * "completa" (o que vai sair de verdade no molde salvo/plotado) por seção.
   * Onde a diferença for real, avisa o cliente ANTES de salvar — pra ele nao
   * ser pego de surpresa com o sistema completando a sequencia sozinho.
   */
  function computeFillWarnings(): Array<{ id: MoldSection['id']; label: string; addedCm: number }> {
    if (!mold || !profile) {
      return [];
    }
    const filledProfile = buildMoldProfile(mold.pontos, sectionRatios, tacoConfigs, true);
    if (!filledProfile) {
      return [];
    }
    const warnings: Array<{ id: MoldSection['id']; label: string; addedCm: number }> = [];
    for (const id of ['bico', 'bojo', 'boca'] as const) {
      const raw = profile.secoes.find((s) => s.id === id);
      const filled = filledProfile.secoes.find((s) => s.id === id);
      if (!raw || !filled) {
        continue;
      }
      const addedCm = Math.round((filled.alturaCm - raw.alturaCm) * 10) / 10;
      if (addedCm > 1) {
        warnings.push({ id, label: raw.nome, addedCm });
      }
    }
    return warnings;
  }

  const [pendingFillWarnings, setPendingFillWarnings] = useState<Array<{
    id: MoldSection['id'];
    label: string;
    addedCm: number;
  }> | null>(null);

  /** Chamado pelos botoes "Salvar" — avisa antes se algo vai ser completado sozinho. */
  function handleSaveClick() {
    const warnings = computeFillWarnings();
    if (warnings.length > 0) {
      setPendingFillWarnings(warnings);
      return;
    }
    void handleSaveConfig();
  }

  /** Salva o molde montado pela Carla DIRETO das partes finais (inclui o
   * "bico"/última parte que completa o molde) — sem depender do estado do
   * preview, evitando qualquer perda de última parte por timing. */
  async function saveCarlaMold(partes: ChatParte[], tipo: 'unico' | 'progressivo', tamanhoUnico: number) {
    const cfg = buildPlotterConfig(partes, tipo, tamanhoUnico);
    // Reflete no preview também
    setSectionColors((prev) => ({ ...prev, ...cfg.section_colors }));
    setSectionRatios(cfg.section_ratios);
    setTacoConfigs(cfg.taco_configs);
    const ok = await persistConfig({
      section_colors: { ...DEFAULT_COLORS, ...cfg.section_colors },
      section_ratios: cfg.section_ratios,
      taco_configs: cfg.taco_configs,
    });
    if (!ok) {
      throw new Error('Não foi possível salvar.');
    }
    // Fecha o plotter e vai direto pra Meus Projetos → Moldes Taqueados.
    onGoToTaqueados?.();
  }

  const profile = useMemo(
    () => (mold ? buildMoldProfile(mold.pontos, sectionRatios, tacoConfigs) : null),
    [mold, sectionRatios, tacoConfigs]
  );

  /**
   * Boca e Bojo definem a propria altura pela soma dos proprios tacos (sem
   * teto fixo pra eles mesmos). O Bico e o que SOBRA do molde (altura total -
   * Boca - Bojo) — entao e o unico que pode "estourar": se os tacos do Bico
   * somarem mais cm do que sobrou, o molde passa do tamanho real.
   */
  function bicoBudgetCm(configs: SectionTacoConfigMap): number {
    if (!profile) {
      return Infinity;
    }
    const bocaAltura = configs.boca.partitions.reduce(
      (sum, p) => sum + (p.tacosSubindo ?? 0) * p.alturaTacoCm,
      0
    );
    const bojoAltura = configs.bojo.partitions.reduce(
      (sum, p) => sum + (p.tacosSubindo ?? 0) * p.alturaTacoCm,
      0
    );
    return Math.max(0, profile.alturaTotalCm - bocaAltura - bojoAltura);
  }

  /** Quanto (cm) essa reparticao do Bico ainda pode crescer sem passar do
   * restante do molde — orcamento do Bico menos o que as OUTRAS reparticoes
   * do Bico ja ocupam. */
  function maxHeightForBicoPartition(configs: SectionTacoConfigMap, partitionId: string): number {
    const othersHeight = configs.bico.partitions.reduce(
      (sum, p) => (p.id === partitionId ? sum : sum + (p.tacosSubindo ?? 0) * p.alturaTacoCm),
      0
    );
    return Math.max(0, bicoBudgetCm(configs) - othersHeight);
  }

  const sectionStats = useMemo(() => {
    if (!profile) {
      return null;
    }
    // Ordem visual: Bico no topo -> Bojo -> Boca embaixo (espelha a ponta/base do
    // molde no preview). Uma secao recem-desbloqueada some sempre ACIMA das
    // anteriores, nunca embaixo.
    const ordemMolde: Array<MoldSection['id']> = ['bico', 'bojo', 'boca'];
    return ordemMolde
      .map((id) => profile.secoes.find((secao) => secao.id === id))
      .filter((secao): secao is MoldSection => secao != null)
      .map((secao) => {
        const config = tacoConfigs[secao.id];
        const bands = expandSectionPartitions(secao, config);
        const bandStats = bands.map((band) => ({
          band,
          divisions: buildTacoDivisions(band, band.flatConfig, profile.points),
        }));
        const totalTacos = bandStats.reduce((sum, b) => sum + b.divisions.totalTacos, 0);
        return { secao, config, bandStats, totalTacos };
      });
  }, [profile, tacoConfigs]);



  function updatePartitionMeta(
    sectionId: MoldSection['id'],
    partitionId: string,
    patch: Partial<Pick<SectionPartition, 'cor' | 'corDivisao'>>
  ) {
    const isFirst = tacoConfigs[sectionId]?.partitions[0]?.id === partitionId;
    setTacoConfigs((prev) => ({
      ...prev,
      [sectionId]: {
        partitions: prev[sectionId].partitions.map((p) =>
          p.id === partitionId ? { ...p, ...patch } : p
        ),
      },
    }));
    if (patch.cor && isFirst) {
      setSectionColors((colors) => ({ ...colors, [sectionId]: patch.cor as string }));
    }
  }

  function updatePartitionSubindo(
    sectionId: MoldSection['id'],
    partitionId: string,
    nextSubindo: number
  ) {
    setTacoConfigs((prev) => {
      const currentSectionConfig = prev[sectionId];
      const partIndex = currentSectionConfig.partitions.findIndex((p) => p.id === partitionId);
      if (partIndex < 0) {
        return prev;
      }
      const partition = currentSectionConfig.partitions[partIndex];

      // Bico e o que sobra do molde: nao deixa o usuario colocar mais tacos
      // subindo do que cabe no restante (ex.: falta 1m, taco de 5cm -> maximo
      // 20 subindo, nunca 300).
      let clampedSubindo = Math.max(1, Math.floor(nextSubindo) || 1);
      if (sectionId === 'bico') {
        const maxHeight = maxHeightForBicoPartition(prev, partitionId);
        const maxSubindo = Math.max(1, Math.floor(maxHeight / Math.max(1, partition.alturaTacoCm)));
        clampedSubindo = Math.min(clampedSubindo, maxSubindo);
      }

      const prevSubindo = partition.tacosSubindo ?? 0;
      const diff = clampedSubindo - prevSubindo;

      const nextConfigs = { ...prev };
      nextConfigs[sectionId] = {
        ...nextConfigs[sectionId],
        partitions: nextConfigs[sectionId].partitions.map((p) =>
          p.id === partitionId ? { ...p, tacosSubindo: clampedSubindo } : p
        ),
      };

      if (sectionId === 'boca') {
        const bojoParts = nextConfigs['bojo'].partitions;
        if (bojoParts.length > 0) {
          const firstBojo = bojoParts[0];
          const newBojoSubindo = Math.max(1, (firstBojo.tacosSubindo ?? 1) - diff);
          nextConfigs['bojo'] = {
            ...nextConfigs['bojo'],
            partitions: nextConfigs['bojo'].partitions.map((p, idx) =>
              idx === 0 ? { ...p, tacosSubindo: newBojoSubindo } : p
            ),
          };
        }
      } else if (sectionId === 'bojo') {
        const bicoParts = nextConfigs['bico'].partitions;
        if (bicoParts.length > 0) {
          const firstBico = bicoParts[0];
          const newBicoSubindo = Math.max(1, (firstBico.tacosSubindo ?? 1) - diff);
          nextConfigs['bico'] = {
            ...nextConfigs['bico'],
            partitions: nextConfigs['bico'].partitions.map((p, idx) =>
              idx === 0 ? { ...p, tacosSubindo: newBicoSubindo } : p
            ),
          };
        }
      }

      return nextConfigs;
    });
  }

  function updatePartitionAlturaTaco(
    sectionId: MoldSection['id'],
    partitionId: string,
    nextAltura: number
  ) {
    setTacoConfigs((prev) => {
      const partition = prev[sectionId].partitions.find((p) => p.id === partitionId);
      if (!partition) {
        return prev;
      }

      // Aceita passos de 0.5 cm (ex: 1.5, 2, 2.5, 3...) — antes so inteiro.
      let clampedAltura = Math.max(0.5, Math.round((Number(nextAltura) || 1) * 2) / 2);
      if (sectionId === 'bico') {
        const maxHeight = maxHeightForBicoPartition(prev, partitionId);
        const subindo = Math.max(1, partition.tacosSubindo ?? 1);
        const maxAltura = Math.max(0.5, Math.floor((maxHeight / subindo) * 2) / 2);
        clampedAltura = Math.min(clampedAltura, maxAltura);
      }

      return {
        ...prev,
        [sectionId]: {
          partitions: prev[sectionId].partitions.map((p) =>
            p.id === partitionId ? { ...p, alturaTacoCm: clampedAltura } : p
          ),
        },
      };
    });
  }

  function updatePartitionTacosPorGomo(
    sectionId: MoldSection['id'],
    partitionId: string,
    nextTpg: number
  ) {
    setTacoConfigs((prev) => ({
      ...prev,
      [sectionId]: {
        partitions: prev[sectionId].partitions.map((p) =>
          p.id === partitionId ? { ...p, tacosPorGomo: nextTpg } : p
        ),
      },
    }));
  }

  /**
   * Adiciona reparticao nova. Sem `beforePartitionId`, entra no TOPO da secao
   * (padrao do botao geral). Com `beforePartitionId`, entra imediatamente ACIMA
   * daquele card especifico (botao "+" de cada card) — permite empilhar a
   * partir de qualquer ponto, nao so do topo absoluto.
   */
  function addPartition(sectionId: MoldSection['id'], _secaoAlturaCm: number, beforePartitionId?: string) {
    setTacoConfigs((prev) => {
      const current = prev[sectionId].partitions;
      if (current.length >= MAX_PARTITIONS) {
        return prev;
      }
      const last = current[current.length - 1];
      const nextIndex = current.length;
      const corNova = PART_FILL_COLORS[(nextIndex + sectionColorOffset(sectionId)) % PART_FILL_COLORS.length];
      const corDivisao = PARTITION_DIVISION_COLORS[nextIndex % PARTITION_DIVISION_COLORS.length];
      let created = createPartition(
        last?.tacosPorGomo ?? 4,
        last?.alturaTacoCm ?? 5,
        last?.tacosSubindo ?? 10,
        corNova,
        corDivisao
      );

      // Bico: a nova reparticao tambem nao pode nascer maior do que o que
      // sobrou do molde (as outras reparticoes do Bico ja existentes contam
      // como ocupadas).
      if (sectionId === 'bico') {
        const othersHeight = current.reduce(
          (sum, p) => sum + (p.tacosSubindo ?? 0) * p.alturaTacoCm,
          0
        );
        const budget = Math.max(0, bicoBudgetCm(prev) - othersHeight);
        const maxSubindo = Math.max(1, Math.floor(budget / Math.max(1, created.alturaTacoCm)));
        created = { ...created, tacosSubindo: Math.min(created.tacosSubindo ?? 10, maxSubindo) };
      }

      const foundAt = beforePartitionId ? current.findIndex((p) => p.id === beforePartitionId) : 0;
      const insertAt = foundAt < 0 ? 0 : foundAt;
      return {
        ...prev,
        [sectionId]: {
          partitions: [...current.slice(0, insertAt), created, ...current.slice(insertAt)],
        },
      };
    });
  }

  function removePartition(sectionId: MoldSection['id'], partitionId: string) {
    setTacoConfigs((prev) => {
      const current = prev[sectionId].partitions;
      const next = current.filter((p) => p.id !== partitionId);
      return {
        ...prev,
        [sectionId]: {
          partitions: next,
        },
      };
    });
  }

  /** Desbloqueia uma secao no fluxo guiado e adiciona 1 reparticao padrao se ainda estiver vazia. */
  function unlockSection(sectionId: MoldSection['id']) {
    setUnlockedSections((prev) => {
      const next = new Set(prev);
      next.add(sectionId);
      return next;
    });
    setTacoConfigs((prev) => {
      const current = prev[sectionId].partitions;
      if (current.length > 0) return prev;
      const offset = sectionColorOffset(sectionId);
      const corNova = PART_FILL_COLORS[offset % PART_FILL_COLORS.length];
      const corDivisao = PARTITION_DIVISION_COLORS[0];
      const created = createPartition(4, 5, 10, corNova, corDivisao);
      return { ...prev, [sectionId]: { partitions: [created] } };
    });
  }

  /** Altura total do molde carregado — o alvo que a Carla vai preencher. */
  const alvoCarlaCm = profile?.alturaTotalCm ?? 0;

  /** Zera o molde (sem tacos) e volta os ratios ao padrão — usado ao entrar na
   * Carla e ao "montar outro" do zero. */
  function resetCarlaMold() {
    setTacoConfigs({
      boca: { partitions: [] },
      bojo: { partitions: [] },
      bico: { partitions: [] },
    });
    setSectionRatios({ ...DEFAULT_SECTION_RATIOS });
    setUnlockedSections(new Set<MoldSection['id']>(['boca']));
    // Cada molde montado na Carla vira um projeto NOVO (não sobrescreve o anterior).
    setCurrentProjectId(null);
    setSaveSuccess(null);
  }

  /** Entra no modo Carla ZERANDO o molde — o preview começa só com a silhueta e
   * vai sendo montado conforme a conversa. */
  function enterCarlaMode() {
    resetCarlaMold();
    setInputMode('carla');
  }

  /** A Carla montou N partes (igual à venda): converte pra config do plotter
   * (todas as partes viram partições da Boca cobrindo 100% do molde) e joga no
   * preview ao vivo. */
  function applyCarlaPartes(partes: ChatParte[], tipo: 'unico' | 'progressivo', tamanhoUnico: number) {
    const cfg = buildPlotterConfig(partes, tipo, tamanhoUnico);
    setSectionColors((prev) => ({ ...prev, ...cfg.section_colors }));
    setSectionRatios(cfg.section_ratios);
    setTacoConfigs(cfg.taco_configs);
    setUnlockedSections(new Set<MoldSection['id']>(['boca']));
  }

  if (moldId == null) {
    return (
      <div className="plotter-empty">
        <div className="plotter-empty-card">
          <Printer size={28} />
          <h2>Plotar (Moldes Tacos)</h2>
          <p>
            Selecione um molde na Galeria e clique em <strong>Plotar no Taco</strong> para ver o gomo
            dividido.
          </p>
          {onBackToGallery ? (
            <button type="button" className="mold-add-point" onClick={onBackToGallery}>
              <ArrowLeft size={16} />
              Ir para Galeria de Moldes
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  // moldHint traz o nome de exibicao certo (ex.: "JZ10 (2)" ao editar um
  // projeto especifico) — prioriza ele sobre o nome cru do molde.
  const titleName = moldHint?.nome || mold?.nome || `Molde #${moldId}`;
  const titleModel = moldHint?.modelo || mold?.modelo || '';

  return (
    <div className="plotter-page">
      <div className="plotter-toolbar">
        <div className="plotter-toolbar-text">
          <h2>Plotar — {titleName}</h2>
          <p>
            {titleModel ? `${titleModel} · ` : ''}
            Gomo em escala real · Boca/Bojo/Bico com totais ligados
          </p>
        </div>
        <div className="plotter-toolbar-actions">
          {mold ? (
            <button
              type="button"
              className="mold-save-button"
              onClick={handleSaveClick}
              disabled={saving || loading}
            >
              {saving ? <Loader2 size={16} className="mold-import-spinner" /> : <Save size={16} />}
              {saving ? 'Salvando...' : 'Salvar configuracao'}
            </button>
          ) : null}
          {onBackToGallery ? (
            <button type="button" className="mold-import-button plotter-back-btn" onClick={handleBack}>
              <ArrowLeft size={16} />
              Voltar
            </button>
          ) : null}
        </div>
      </div>

      {error ? <p className="mold-import-error">{error}</p> : null}
      {saveError ? <p className="mold-import-error">{saveError}</p> : null}
      {saveSuccess ? (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          background: 'rgba(72,187,120,0.1)',
          padding: '10px 14px',
          borderRadius: '8px',
          border: '1px solid #48bb78',
          marginBottom: '16px'
        }}>
          <p className="mold-form-success" style={{ margin: 0, flex: 1, padding: 0 }}>{saveSuccess}</p>
          {hasDraftLoaded && (
            <button
              type="button"
              onClick={handleDiscardDraft}
              style={{
                background: '#e53e3e',
                color: '#fff',
                border: 'none',
                padding: '4px 10px',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '11px',
                fontWeight: 600
              }}
            >
              Descartar Rascunho Local
            </button>
          )}
        </div>
      ) : null}

      {loading ? (
        <div className="plotter-loading">
          <Loader2 size={22} className="mold-import-spinner" />
          <span>Carregando molde e calculando secoes...</span>
        </div>
      ) : null}

      {!loading && !error && !mold ? (
        <div className="plotter-loading">
          <span>Molde nao encontrado. Volte a galeria e tente de novo.</span>
        </div>
      ) : null}

      {!loading && mold && !profile ? (
        <div className="plotter-loading">
          <span>
            Este molde nao tem pontos suficientes para desenhar o gomo (precisa de altura e largura).
          </span>
        </div>
      ) : null}

      {!loading && mold && profile && sectionStats ? (
        <div className="plotter-workspace">
          <div className="plotter-canvas-card plotter-canvas-left">
            <div className="plotter-canvas">
              <GomoTacoPreview
                pontos={mold.pontos}
                sectionColors={sectionColors}
                tacoConfigs={tacoConfigs}
                sectionRatios={sectionRatios}
                bainhaCm={mold.bainha_cm}
                showDetails
                fillDeficit={false}
              />
            </div>
          </div>

          <aside className="plotter-config-panel">
            <div className="plotter-config-head">
              <div className="plotter-config-head-top">
                <h3>Configuracao dos tacos</h3>
                <div className="plotter-quick-toggles" style={{ display: inputMode === 'manual' ? undefined : 'none' }}>
                  <button
                    type="button"
                    className="plotter-quick-toggle-btn"
                    onClick={handleCollapseAllSections}
                    title="Minimizar todas as seções"
                  >
                    <ChevronsUp size={13} />
                    Minimizar todas
                  </button>
                  <button
                    type="button"
                    className="plotter-quick-toggle-btn"
                    onClick={handleExpandAllSections}
                    title="Expandir todas as seções"
                  >
                    <ChevronsDown size={13} />
                    Expandir todas
                  </button>
                </div>
              </div>
              <p>
                Menos <strong>tacos por gomo</strong> no bico = grade sobe mais (mais estreito
                aguenta) e a quantidade <strong>subindo/total sobe</strong>. Totais entre partes
                se compensam (50→60, outro 40). Boca ↔ Bojo trocam altura.
              </p>

              {/* Alternar entre preencher na mão (Manual) ou conversar com a Carla.
                  A Carla só aparece se o plano do usuário liberar (admin sempre). */}
              {carlaDisponivel && (
                <div className="plotter-mode-toggle" style={{ display: 'flex', gap: '6px', marginTop: '10px', background: '#0b0f18', border: '1px solid #23304d', borderRadius: '10px', padding: '4px' }}>
                  <button
                    type="button"
                    onClick={() => setInputMode('manual')}
                    style={{ flex: 1, padding: '8px', borderRadius: '7px', fontSize: '13px', fontWeight: 700, cursor: 'pointer', border: 'none', background: inputMode === 'manual' ? '#3182ce' : 'transparent', color: inputMode === 'manual' ? '#fff' : '#a0aec0' }}
                  >
                    Manual
                  </button>
                  <button
                    type="button"
                    onClick={enterCarlaMode}
                    style={{ flex: 1, padding: '8px', borderRadius: '7px', fontSize: '13px', fontWeight: 700, cursor: 'pointer', border: 'none', background: inputMode === 'carla' ? '#805ad5' : 'transparent', color: inputMode === 'carla' ? '#fff' : '#a0aec0', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}
                  >
                    🤖 Assistente-IA Carla
                  </button>
                </div>
              )}
            </div>

            {inputMode === 'carla' && carlaDisponivel && (
              <PlotterCarlaChat
                userName={(user?.name ?? '').split(' ')[0] ?? ''}
                alvoCm={alvoCarlaCm}
                onUpdatePreview={applyCarlaPartes}
                onSave={saveCarlaMold}
                savedMessage={saveSuccess}
              />
            )}

            {(inputMode === 'manual' || !carlaDisponivel) && sectionStats.map(({ secao, config, bandStats, totalTacos }) => {
              // Fluxo guiado: so mostra secoes desbloqueadas
              if (!unlockedSections.has(secao.id)) return null;

              const cor = sectionColors[secao.id] ?? secao.cor;
              const partCount = config.partitions.length;
              const isSectionCollapsed = Boolean(collapsedSections[secao.id]);

              // Progresso: cm preenchidos pelos tacos vs total da secao
              const filledCm = config.partitions.reduce(
                (sum, p) => sum + (p.tacosSubindo ?? 0) * (p.alturaTacoCm ?? 5),
                0
              );
              const progressPct = secao.alturaCm > 0 ? Math.min(100, (filledCm / secao.alturaCm) * 100) : 0;

              // Qual e a proxima secao a desbloquear
              const nextSection: MoldSection['id'] | null =
                secao.id === 'boca' ? 'bojo' : secao.id === 'bojo' ? 'bico' : null;
              const nextLabel = nextSection === 'bojo' ? 'Bojo' : nextSection === 'bico' ? 'Bico' : '';

              return (
                <section
                  key={secao.id}
                  className={`plotter-config-card ${isSectionCollapsed ? 'is-collapsed' : ''}`}
                  style={{ borderColor: cor }}
                >
                  <header
                    className="plotter-config-card-head"
                    onClick={() => toggleSectionCollapse(secao.id)}
                    title={isSectionCollapsed ? "Clique para expandir" : "Clique para minimizar"}
                  >
                    <div className="plotter-config-card-title">
                      <div className="plotter-card-title-row">
                        <h4>{secao.nome}</h4>
                        {isSectionCollapsed && (
                          <span className="plotter-card-badge-summary">
                            {formatCm(filledCm)} / {formatCm(secao.alturaCm)} · {totalTacos} tacos
                          </span>
                        )}
                      </div>
                      <p>
                        {formatCm(secao.alturaCm)} · {secao.percentual}%
                        {partCount > 1 ? ` · ${partCount} partes` : ''}
                      </p>
                    </div>

                    <button
                      type="button"
                      className="plotter-card-collapse-toggle"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleSectionCollapse(secao.id);
                      }}
                      title={isSectionCollapsed ? "Expandir seção" : "Minimizar seção"}
                      aria-expanded={!isSectionCollapsed}
                    >
                      {isSectionCollapsed ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
                    </button>
                  </header>

                  {!isSectionCollapsed && (
                    <>
                      {/* Botao para avancar para a proxima secao — sempre no topo do card */}
                      {nextSection && !unlockedSections.has(nextSection) && (
                        <div className="plotter-unlock-next">
                          <button
                            type="button"
                            className="plotter-unlock-btn"
                            onClick={() => unlockSection(nextSection)}
                          >
                            Pronto! Iniciar {nextLabel} →
                          </button>
                        </div>
                      )}

                      {/* Barra de progresso da secao */}
                      <div className="plotter-section-progress-wrap">
                        <div className="rifa-public-progress">
                          <div
                            className="rifa-public-progress-fill"
                            style={{ width: `${progressPct}%`, background: cor }}
                          />
                        </div>
                        <span className="plotter-section-progress-label">
                          {formatCm(filledCm)} preenchidos de {formatCm(secao.alturaCm)} ({Math.round(progressPct)}%)
                        </span>
                      </div>

                      <div className="plotter-partitions">
                        {partCount === 0 ? (
                          <div className="plotter-partition-empty-state">
                            <p>Nenhum taco nesta seção. Clique em "Adicionar repartição" abaixo para começar.</p>
                          </div>
                        ) : (
                          bandStats.map(({ band, divisions }, index) => {
                          const partition = band.partition;
                          const isPartCollapsed = Boolean(collapsedPartitions[partition.id]);
                          // Numeracao cresce de baixo pra cima
                          const label = partCount > 1 ? `${secao.nome} ${partCount - index}` : secao.nome;
                          const maxAlturaTaco = Math.max(1, Math.floor(band.alturaCm));
                          const bicoMaxHeightCm =
                            secao.id === 'bico' ? maxHeightForBicoPartition(tacoConfigs, partition.id) : Infinity;
                          const maxSubindo =
                            secao.id === 'bico'
                              ? Math.max(1, Math.floor(bicoMaxHeightCm / Math.max(1, partition.alturaTacoCm)))
                              : undefined;
                          const maxAlturaTacoEfetivo =
                            secao.id === 'bico'
                              ? Math.min(
                                  maxAlturaTaco,
                                  Math.max(1, Math.floor(bicoMaxHeightCm / Math.max(1, partition.tacosSubindo ?? 1)))
                                )
                              : maxAlturaTaco;
                          const warning = clampWarnings[partition.id];
                          const partColor = partition.cor || cor;
                          const divisionColor =
                            partition.corDivisao ||
                            PARTITION_DIVISION_COLORS[index % PARTITION_DIVISION_COLORS.length];

                          return (
                            <div key={partition.id}>
                              <div className={`plotter-partition ${isPartCollapsed ? 'is-collapsed' : ''}`} style={{ borderColor: partColor }}>
                                <div
                                  className="plotter-partition-head"
                                  onClick={() => togglePartitionCollapse(partition.id)}
                                  title={isPartCollapsed ? "Clique para expandir repartição" : "Clique para minimizar repartição"}
                                >
                                  <span
                                    className="plotter-config-color-swatch"
                                    style={{ background: partColor }}
                                    aria-hidden
                                  />
                                  <strong>{label}</strong>
                                  <span>{formatCm(band.alturaCm)} · {divisions.totalTacos} tacos</span>
                                  <button
                                    type="button"
                                    className="plotter-partition-add-above"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      addPartition(secao.id, secao.alturaCm, partition.id);
                                    }}
                                    disabled={partCount >= MAX_PARTITIONS}
                                    title="Adicionar repartição acima deste card"
                                  >
                                    <Plus size={14} />
                                  </button>
                                  <button
                                    type="button"
                                    className="plotter-partition-remove"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      removePartition(secao.id, partition.id);
                                    }}
                                    title="Remover repartição"
                                  >
                                    <Trash2 size={14} />
                                  </button>
                                  <button
                                    type="button"
                                    className="plotter-partition-collapse-toggle"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      togglePartitionCollapse(partition.id);
                                    }}
                                    title={isPartCollapsed ? "Expandir repartição" : "Minimizar repartição"}
                                  >
                                    {isPartCollapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
                                  </button>
                                </div>

                                {!isPartCollapsed && (
                                  <>
                                    <div className="plotter-config-fields">
                                      <label className="plotter-field plotter-field-color">
                                        <span>Cor desta parte</span>
                                        <span className="plotter-color-control">
                                          <input
                                            type="color"
                                            value={normalizeHexColor(partColor)}
                                            onChange={(event) =>
                                              updatePartitionMeta(secao.id, partition.id, {
                                                cor: event.target.value,
                                              })
                                            }
                                            aria-label={`Cor de ${label}`}
                                          />
                                          <em style={{ background: partColor }} />
                                          <code>{normalizeHexColor(partColor)}</code>
                                        </span>
                                      </label>

                                      <label className="plotter-field">
                                        <span>
                                          Quantidade de tacos subindo
                                          {maxSubindo !== undefined ? ` (max. ${maxSubindo} · restam ${formatCm(bicoMaxHeightCm)})` : ''}
                                        </span>
                                        <input
                                          type="number"
                                          min={1}
                                          max={maxSubindo}
                                          step={1}
                                          inputMode="numeric"
                                          defaultValue={partition.tacosSubindo}
                                          key={`subindo-${partition.id}`}
                                          onChange={(event) => {
                                            // Atualiza ao vivo a cada tecla — a previa (e o resto do
                                            // card) tem que acompanhar o que o cliente esta digitando,
                                            // nao so quando ele clica fora do campo.
                                            const raw = Math.floor(Number(event.target.value));
                                            if (Number.isFinite(raw) && raw > 0) {
                                              updatePartitionSubindo(secao.id, partition.id, raw);
                                            }
                                          }}
                                          onBlur={(event) => {
                                            let next = Math.max(
                                              1,
                                              Math.floor(Number(event.target.value)) || partition.tacosSubindo || 10
                                            );
                                            if (maxSubindo !== undefined && next > maxSubindo) {
                                              next = maxSubindo;
                                              event.target.value = String(next);
                                              flashClampWarning(
                                                partition.id,
                                                `Ajustado para ${maxSubindo} — só cabem ${maxSubindo} tacos de ${formatCm(partition.alturaTacoCm)} no restante do Bico (${formatCm(bicoMaxHeightCm)}).`
                                              );
                                            }
                                            if (next !== partition.tacosSubindo) {
                                              updatePartitionSubindo(secao.id, partition.id, next);
                                            }
                                          }}
                                          onKeyDown={(event) => {
                                            if (event.key === 'Enter') {
                                              (event.target as HTMLInputElement).blur();
                                            }
                                          }}
                                        />
                                      </label>

                                      <label className="plotter-field">
                                        <span>Tacos por gomo</span>
                                        <input
                                          type="number"
                                          min={1}
                                          max={64}
                                          step={1}
                                          inputMode="numeric"
                                          defaultValue={partition.tacosPorGomo}
                                          key={`tpg-${partition.id}`}
                                          onChange={(event) => {
                                            const raw = Math.floor(Number(event.target.value));
                                            if (Number.isFinite(raw) && raw > 0) {
                                              updatePartitionTacosPorGomo(secao.id, partition.id, Math.min(64, raw));
                                            }
                                          }}
                                          onBlur={(event) => {
                                            const next = Math.max(
                                              1,
                                              Math.min(64, Math.floor(Number(event.target.value)) || 1)
                                            );
                                            if (next !== partition.tacosPorGomo) {
                                              updatePartitionTacosPorGomo(secao.id, partition.id, next);
                                            }
                                          }}
                                          onKeyDown={(event) => {
                                            if (event.key === 'Enter') {
                                              (event.target as HTMLInputElement).blur();
                                            }
                                          }}
                                        />
                                      </label>

                                      <label className="plotter-field">
                                        <span>Altura do taco (cm)</span>
                                        <input
                                          type="number"
                                          min={0.5}
                                          max={maxAlturaTacoEfetivo}
                                          step={0.5}
                                          inputMode="decimal"
                                          defaultValue={partition.alturaTacoCm}
                                          key={`at-${partition.id}`}
                                          onChange={(event) => {
                                            // Mesma logica do campo de tacos subindo: atualiza ao vivo,
                                            // sem esperar sair do campo.
                                            const raw = Number(event.target.value);
                                            if (Number.isFinite(raw) && raw > 0) {
                                              updatePartitionAlturaTaco(secao.id, partition.id, raw);
                                            }
                                          }}
                                          onBlur={(event) => {
                                            // arredonda pra 0.5 mais proximo (aceita 1.5, 2, 2.5...)
                                            let next = Math.max(
                                              0.5,
                                              Math.min(maxAlturaTaco, Math.round((Number(event.target.value) || 1) * 2) / 2)
                                            );
                                            if (secao.id === 'bico' && next > maxAlturaTacoEfetivo) {
                                              next = maxAlturaTacoEfetivo;
                                              event.target.value = String(next);
                                              flashClampWarning(
                                                partition.id,
                                                `Ajustado para ${next} cm — com ${partition.tacosSubindo} tacos subindo só cabe essa altura no restante do Bico (${formatCm(bicoMaxHeightCm)}).`
                                              );
                                            }
                                            if (next !== partition.alturaTacoCm) {
                                              updatePartitionAlturaTaco(secao.id, partition.id, next);
                                            }
                                          }}
                                          onKeyDown={(event) => {
                                            if (event.key === 'Enter') {
                                              (event.target as HTMLInputElement).blur();
                                            }
                                          }}
                                        />
                                        {/* Presets rapidos de tamanho de taco */}
                                        <div className="plotter-taco-presets" style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '6px' }}>
                                          {[1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5].map((preset) => {
                                            const disabled = preset > maxAlturaTacoEfetivo;
                                            const active = Math.abs((partition.alturaTacoCm ?? 0) - preset) < 0.01;
                                            return (
                                              <button
                                                key={preset}
                                                type="button"
                                                disabled={disabled}
                                                onClick={() => {
                                                  if (!disabled && !active) {
                                                    updatePartitionAlturaTaco(secao.id, partition.id, preset);
                                                  }
                                                }}
                                                title={disabled ? 'Não cabe no espaço restante' : `Taco de ${preset} cm`}
                                                style={{
                                                  padding: '4px 10px',
                                                  borderRadius: '6px',
                                                  fontSize: '12px',
                                                  fontWeight: 600,
                                                  cursor: disabled ? 'not-allowed' : 'pointer',
                                                  border: `1px solid ${active ? '#48bb78' : '#2d3748'}`,
                                                  background: active ? 'rgba(72,187,120,0.15)' : '#1a2233',
                                                  color: disabled ? '#4a5568' : active ? '#48bb78' : '#cbd5e0',
                                                  opacity: disabled ? 0.5 : 1,
                                                }}
                                              >
                                                {preset} cm
                                              </button>
                                            );
                                          })}
                                        </div>
                                      </label>
                                    </div>

                                    {warning ? <p className="plotter-clamp-warning">{warning}</p> : null}

                                    <div className="plotter-config-summary">
                                      <span>
                                        <em>Subindo</em> {divisions.quantidadeVertical}
                                      </span>
                                      <span>
                                        <em>Por gomo</em> {partition.tacosPorGomo}
                                      </span>
                                      <span>
                                        <em>Total</em> {divisions.totalTacos}
                                      </span>
                                    </div>
                                  </>
                                )}
                              </div>

                              {!isPartCollapsed && partCount > 1 && index < partCount - 1 ? (
                                <div
                                  className="plotter-division-bar"
                                  style={{ borderColor: divisionColor }}
                                >
                                  <span
                                    className="plotter-division-bar-line"
                                    style={{ background: divisionColor }}
                                  />
                                  <label className="plotter-field plotter-field-color">
                                    <span>Cor da linha de divisao</span>
                                    <span className="plotter-color-control">
                                      <input
                                        type="color"
                                        value={normalizeHexColor(divisionColor)}
                                        onChange={(event) =>
                                          updatePartitionMeta(secao.id, partition.id, {
                                            corDivisao: event.target.value,
                                          })
                                        }
                                        aria-label={`Cor da linha de divisao abaixo de ${label}`}
                                      />
                                      <em style={{ background: divisionColor }} />
                                      <code>{normalizeHexColor(divisionColor)}</code>
                                    </span>
                                  </label>
                                </div>
                              ) : null}
                            </div>
                          );
                        })
                      )}
                      </div>

                      <div className="plotter-partition-actions">
                        <button
                          type="button"
                          className="plotter-add-partition"
                          onClick={() => addPartition(secao.id, secao.alturaCm)}
                          disabled={partCount >= MAX_PARTITIONS}
                        >
                          <Plus size={15} />
                          Adicionar reparticao
                        </button>
                        <span className="plotter-config-total">
                          Total {secao.nome}: <strong>{totalTacos}</strong> tacos · {secao.percentual}%
                        </span>
                      </div>
                    </>
                  )}
                </section>
              );
            })}
          </aside>
        </div>
      ) : null}

      <nav className="plotter-mobile-bottom-bar" aria-label="Navegação móvel de seções">
        <button
          type="button"
          className={`mobile-bar-btn ${!collapsedSections['boca'] ? 'active' : ''}`}
          onClick={() => {
            setCollapsedSections((prev) => ({ ...prev, boca: false }));
            document.querySelector('.plotter-config-card')?.scrollIntoView({ behavior: 'smooth' });
          }}
        >
          <span>Boca</span>
        </button>
        <button
          type="button"
          className={`mobile-bar-btn ${!collapsedSections['bojo'] ? 'active' : ''}`}
          onClick={() => {
            unlockSection('bojo');
            setCollapsedSections((prev) => ({ ...prev, bojo: false }));
            const cards = document.querySelectorAll('.plotter-config-card');
            cards[1]?.scrollIntoView({ behavior: 'smooth' });
          }}
        >
          <span>Bojo</span>
        </button>
        <button
          type="button"
          className={`mobile-bar-btn ${!collapsedSections['bico'] ? 'active' : ''}`}
          onClick={() => {
            unlockSection('bico');
            setCollapsedSections((prev) => ({ ...prev, bico: false }));
            const cards = document.querySelectorAll('.plotter-config-card');
            cards[2]?.scrollIntoView({ behavior: 'smooth' });
          }}
        >
          <span>Bico</span>
        </button>
        <button
          type="button"
          className="mobile-bar-btn"
          onClick={handleCollapseAllSections}
          title="Minimizar todos os cards"
        >
          <ChevronsUp size={18} />
          <span>Fechar</span>
        </button>
        {mold && (
          <button
            type="button"
            className="mobile-bar-btn save-btn"
            onClick={handleSaveClick}
            disabled={saving || loading}
          >
            <Save size={18} />
            <span>{saving ? 'Salvar...' : 'Salvar'}</span>
          </button>
        )}
      </nav>

      {pendingFillWarnings && (
        <div
          className="plotter-fill-warning-overlay"
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '16px' }}
        >
          <div style={{ background: '#141b2b', border: '1px solid #2d3748', borderRadius: '14px', padding: '24px', maxWidth: '420px', width: '100%' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
              <AlertTriangle size={22} color="#ecc94b" />
              <h3 style={{ margin: 0, color: '#f7fafc', fontSize: '17px' }}>Vai completar o molde</h3>
            </div>
            <p style={{ color: '#a0aec0', fontSize: '14px', lineHeight: 1.5, margin: '0 0 12px' }}>
              Você não preencheu tudo ainda. Ao salvar, o sistema vai continuar a última sequência configurada até o fim de:
            </p>
            <ul style={{ margin: '0 0 16px', paddingLeft: '20px', color: '#f7fafc', fontSize: '14px' }}>
              {pendingFillWarnings.map((w) => (
                <li key={w.id} style={{ marginBottom: '4px' }}>
                  <strong>{w.label}</strong> — mais {formatCm(w.addedCm)} de taco
                </li>
              ))}
            </ul>
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={() => setPendingFillWarnings(null)}
                style={{ background: '#1a202c', border: '1px solid #2d3748', color: '#cbd5e0', borderRadius: '8px', padding: '10px 16px', fontSize: '13.5px', fontWeight: 600, cursor: 'pointer' }}
              >
                Cancelar, quero ajustar
              </button>
              <button
                type="button"
                onClick={() => {
                  setPendingFillWarnings(null);
                  void handleSaveConfig();
                }}
                style={{ background: '#25d366', border: 'none', color: '#06210f', borderRadius: '8px', padding: '10px 16px', fontSize: '13.5px', fontWeight: 700, cursor: 'pointer' }}
              >
                Continuar e salvar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function normalizeHexColor(value: string): string {
  const raw = value.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(raw)) {
    return raw.toLowerCase();
  }
  if (/^#[0-9a-fA-F]{3}$/.test(raw)) {
    const r = raw[1];
    const g = raw[2];
    const b = raw[3];
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  return '#77e6f2';
}
