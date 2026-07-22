import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Loader2, Plus, Printer, Save, Trash2 } from 'lucide-react';
import { GomoTacoPreview } from '../components/GomoTacoPreview';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import {
  alturaTacoToKeepTotal,
  balancePartitionTotals,
  buildMoldProfile,
  buildTacoDivisions,
  createDefaultTacoConfigs,
  createPartition,
  DEFAULT_SECTION_RATIOS,
  expandSectionPartitions,
  PARTITION_DIVISION_COLORS,
  ratiosFromSectionTotals,
  redistributePartitionPesos,
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
}

type SectionColors = Record<MoldSection['id'], string>;

const DEFAULT_COLORS: SectionColors = { ...SECTION_COLORS };
const MAX_PARTITIONS = 6;

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

export function PlotterTacosPage({ moldId, moldHint, projectId = null, isBlank = false, onBackToGallery }: PlotterTacosPageProps) {
  const { token } = useAuth();
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
        const saved = projectResponse?.data.plotter_config ?? null;
        if (saved) {
          setSectionColors({ ...DEFAULT_COLORS, ...saved.section_colors });
          setTacoConfigs(saved.taco_configs);
          setSectionRatios(saved.section_ratios);
        } else if (isBlank) {
          setSectionColors(DEFAULT_COLORS);
          setTacoConfigs({
            boca: { partitions: [] },
            bojo: { partitions: [] },
            bico: { partitions: [] },
          });
          setSectionRatios({ ...DEFAULT_SECTION_RATIOS });
        } else {
          setSectionColors(DEFAULT_COLORS);
          setTacoConfigs(createDefaultTacoConfigs(moldResponse.data.bainha_cm || 1));
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
  }, [moldId, projectId, token]);

  async function handleSaveConfig() {
    if (!token || moldId == null || saving) {
      return;
    }

    setSaving(true);
    setSaveError(null);
    setSaveSuccess(null);

    const payload = {
      section_colors: sectionColors,
      section_ratios: sectionRatios,
      taco_configs: tacoConfigs,
    };

    try {
      if (currentProjectId != null) {
        await api.updateProject(currentProjectId, payload, token);
        setSaveSuccess('Configuracao atualizada neste projeto.');
      } else {
        const response = await api.createProject(moldId, payload, token);
        setCurrentProjectId(response.data.id);
        setSaveSuccess(`Novo projeto "${response.data.display_nome}" salvo em Meus Projetos.`);
      }
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : 'Nao foi possivel salvar a configuracao.');
    } finally {
      setSaving(false);
    }
  }

  const profile = useMemo(
    () => (mold ? buildMoldProfile(mold.pontos, sectionRatios) : null),
    [mold, sectionRatios]
  );

  const sectionStats = useMemo(() => {
    if (!profile) {
      return null;
    }
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

  const totalsBySection = useMemo(() => {
    const map: Record<MoldSection['id'], number> = { boca: 0, bojo: 0, bico: 0 };
    if (!sectionStats) {
      return map;
    }
    for (const row of sectionStats) {
      map[row.secao.id] = row.totalTacos;
    }
    return map;
  }, [sectionStats]);

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

  /** Total de tacos da parte: as outras partes da secao compensam (50|50 → 60|40). */
  function updatePartitionTotal(
    sectionId: MoldSection['id'],
    partitionId: string,
    nextTotal: number
  ) {
    if (!sectionStats || !profile) {
      return;
    }
    const row = sectionStats.find((s) => s.secao.id === sectionId);
    if (!row) {
      return;
    }

    const parts = tacoConfigs[sectionId].partitions;
    const idx = parts.findIndex((p) => p.id === partitionId);
    if (idx < 0) {
      return;
    }

    const currentTotals = row.bandStats.map((b) => b.divisions.totalTacos);
    const sectionBudget = currentTotals.reduce((s, t) => s + t, 0);

    // Uma unica parte na secao → muda o total da secao inteira (Boca↔Bojo ou Bico↔Bojo)
    if (parts.length === 1) {
      applySectionTotalChange(sectionId, Math.max(parts[0].tacosPorGomo, Math.floor(nextTotal) || 1));
      return;
    }

    const balanced = balancePartitionTotals(parts, currentTotals, idx, nextTotal);
    const withPesos = redistributePartitionPesos(parts, balanced);

    // Ajusta altura do taco para caber o total-alvo em cada faixa (apos o novo peso)
    const secao = profile.secoes.find((s) => s.id === sectionId);
    if (!secao) {
      setTacoConfigs((prev) => ({ ...prev, [sectionId]: { partitions: withPesos } }));
      return;
    }

    const bands = expandSectionPartitions(secao, { partitions: withPesos });
    const tuned = withPesos.map((p, i) => {
      const h = bands[i]?.alturaCm ?? secao.alturaCm / parts.length;
      const target = balanced[i];
      const at = alturaTacoToKeepTotal(h, target, p.tacosPorGomo);
      return { ...p, alturaTacoCm: at };
    });

    setTacoConfigs((prev) => ({ ...prev, [sectionId]: { partitions: tuned } }));

    // Se a soma da secao mudou (clamp), e for boca/bojo/bico, nao mexe em ratio aqui —
    // so redistribui interno. sectionBudget preservado por balancePartitionTotals.
    void sectionBudget;
  }

  /**
   * Muda o total de uma secao e rebalanceia a altura Boca↔Bojo (ou Bico↔Bojo).
   * Ex.: mais tacos na Boca → Boca maior, Bojo menor.
   */
  function applySectionTotalChange(sectionId: MoldSection['id'], nextTotal: number) {
    if (!sectionStats || !mold) {
      return;
    }

    const parts = tacoConfigs[sectionId].partitions;
    const part0 = parts[0];
    if (!part0) {
      return;
    }

    const currentTotals: Record<MoldSection['id'], number> = { ...totalsBySection };
    const minTotal = Math.max(1, part0.tacosPorGomo);

    // Par que compensa: Boca↔Bojo; Bico↔Bojo
    const donor: MoldSection['id'] = sectionId === 'bojo' ? 'boca' : 'bojo';
    const donorParts = tacoConfigs[donor].partitions;
    const donorMin = Math.max(1, donorParts[0]?.tacosPorGomo ?? 1) * Math.max(1, donorParts.length);
    const pairBudget = currentTotals[sectionId] + currentTotals[donor];
    const clamped = Math.min(
      Math.max(minTotal, Math.floor(nextTotal) || minTotal),
      Math.max(minTotal, pairBudget - donorMin)
    );
    const donorTotal = Math.max(donorMin, pairBudget - clamped);

    currentTotals[sectionId] = clamped;
    currentTotals[donor] = donorTotal;

    const nextRatios = ratiosFromSectionTotals(sectionRatios, currentTotals, sectionId, donor);
    setSectionRatios(nextRatios);

    const nextProfile = buildMoldProfile(mold.pontos, nextRatios);
    if (!nextProfile) {
      return;
    }

    setTacoConfigs((prev) => {
      const next = { ...prev };

      // Secao alterada: 1 parte → ajusta altura do taco; N partes → escala pesos
      next[sectionId] = tuneSectionToTotal(
        next[sectionId].partitions,
        nextProfile.secoes.find((s) => s.id === sectionId)!,
        clamped,
        sectionStats.find((s) => s.secao.id === sectionId)?.bandStats.map((b) => b.divisions.totalTacos)
      );

      next[donor] = tuneSectionToTotal(
        next[donor].partitions,
        nextProfile.secoes.find((s) => s.id === donor)!,
        donorTotal,
        sectionStats.find((s) => s.secao.id === donor)?.bandStats.map((b) => b.divisions.totalTacos)
      );

      return next;
    });
  }

  /** Ajusta pesos + alturaTaco de uma secao para caber `targetTotal` na altura dada. */
  function tuneSectionToTotal(
    partitions: SectionPartition[],
    secao: MoldSection,
    targetTotal: number,
    previousTotals?: number[]
  ): { partitions: SectionPartition[] } {
    if (partitions.length === 1) {
      const p = partitions[0];
      const at = alturaTacoToKeepTotal(secao.alturaCm, targetTotal, p.tacosPorGomo);
      return {
        partitions: [{ ...p, alturaTacoCm: at, peso: Math.max(0.01, targetTotal) }],
      };
    }

    const prev = previousTotals ?? partitions.map((p) => p.tacosPorGomo * 4);
    const prevSum = prev.reduce((s, t) => s + Math.max(0, t), 0) || 1;
    const scaled = prev.map((t, i) => {
      const min = partitions[i].tacosPorGomo;
      return Math.max(min, Math.round((Math.max(0, t) / prevSum) * targetTotal));
    });
    const scaledSum = scaled.reduce((s, t) => s + t, 0);
    if (scaled.length > 0 && scaledSum !== targetTotal) {
      scaled[scaled.length - 1] = Math.max(
        partitions[scaled.length - 1].tacosPorGomo,
        scaled[scaled.length - 1] + (targetTotal - scaledSum)
      );
    }

    const withPesos = redistributePartitionPesos(partitions, scaled);
    const bands = expandSectionPartitions(secao, { partitions: withPesos });
    const tuned = withPesos.map((p, i) => ({
      ...p,
      alturaTacoCm: alturaTacoToKeepTotal(bands[i]?.alturaCm ?? secao.alturaCm, scaled[i], p.tacosPorGomo),
    }));
    return { partitions: tuned };
  }

  /**
   * Tacos por gomo: NAO trava o total.
   * Menos tacos/gomo → grade sobe mais no bico (mais largura util) →
   * mais fileiras "subindo" e total MAIOR com a mesma altura de taco.
   */
  function updateTacosPorGomo(sectionId: MoldSection['id'], partitionId: string, nextTpg: number) {
    setTacoConfigs((prev) => ({
      ...prev,
      [sectionId]: {
        partitions: prev[sectionId].partitions.map((p) =>
          p.id === partitionId
            ? {
                ...p,
                tacosPorGomo: nextTpg,
                // mantem a altura do taco escolhida — a quantidade sobe/desce sozinha
              }
            : p
        ),
      },
    }));
  }

  /**
   * Altura do taco: muda o total da parte → redistribui nas outras partes
   * (ou Boca↔Bojo se for secao unica).
   */
  function updateAlturaTaco(sectionId: MoldSection['id'], partitionId: string, nextAltura: number) {
    if (!sectionStats) {
      return;
    }
    const row = sectionStats.find((s) => s.secao.id === sectionId);
    if (!row) {
      return;
    }
    const bandIndex = row.bandStats.findIndex((b) => b.band.partition.id === partitionId);
    if (bandIndex < 0) {
      return;
    }
    const band = row.bandStats[bandIndex];
    const tpg = band.band.partition.tacosPorGomo;
    const rows = Math.max(1, Math.floor(band.band.alturaCm / Math.max(1, nextAltura)));
    const newTotal = rows * tpg;

    if (row.config.partitions.length === 1) {
      // Rebalanceia secao inteira (Boca↔Bojo / Bico↔Bojo) com o novo total
      applySectionTotalChange(sectionId, newTotal);
      return;
    }

    const parts = tacoConfigs[sectionId].partitions.map((p) =>
      p.id === partitionId ? { ...p, alturaTacoCm: nextAltura } : p
    );
    const currentTotals = row.bandStats.map((b) => b.divisions.totalTacos);
    const balanced = balancePartitionTotals(parts, currentTotals, bandIndex, newTotal);
    const withPesos = redistributePartitionPesos(parts, balanced);

    const secao = row.secao;
    const bands = expandSectionPartitions(secao, { partitions: withPesos });
    const tuned = withPesos.map((p, i) => {
      if (i === bandIndex) {
        return { ...p, alturaTacoCm: nextAltura };
      }
      const h = bands[i]?.alturaCm ?? secao.alturaCm / parts.length;
      return {
        ...p,
        alturaTacoCm: alturaTacoToKeepTotal(h, balanced[i], p.tacosPorGomo),
      };
    });

    setTacoConfigs((prev) => ({ ...prev, [sectionId]: { partitions: tuned } }));
  }

  function addPartition(sectionId: MoldSection['id'], secaoAlturaCm: number) {
    setTacoConfigs((prev) => {
      const current = prev[sectionId].partitions;
      if (current.length >= MAX_PARTITIONS) {
        return prev;
      }
      const last = current[current.length - 1] ?? createPartition();
      const nextIndex = current.length;
      const corNova = PART_FILL_COLORS[(nextIndex + sectionColorOffset(sectionId)) % PART_FILL_COLORS.length];
      const corDivisao = PARTITION_DIVISION_COLORS[nextIndex % PARTITION_DIVISION_COLORS.length];
      // Divide pesos igualmente (50|50, 33|33|33...)
      const equalPeso = 1;
      const existing = current.map((p) => ({ ...p, peso: equalPeso }));
      const created = createPartition(
        last.tacosPorGomo,
        Math.min(last.alturaTacoCm, Math.max(1, Math.floor(secaoAlturaCm / (current.length + 1)))),
        corNova,
        corDivisao,
        equalPeso
      );
      return {
        ...prev,
        [sectionId]: {
          partitions: [...existing, created],
        },
      };
    });
  }

  function removePartition(sectionId: MoldSection['id'], partitionId: string) {
    setTacoConfigs((prev) => {
      const current = prev[sectionId].partitions;
      if (current.length <= 1) {
        return prev;
      }
      const next = current.filter((p) => p.id !== partitionId);
      // redistribui pesos iguais
      return {
        ...prev,
        [sectionId]: {
          partitions: next.map((p) => ({ ...p, peso: 1 })),
        },
      };
    });
  }

  if (moldId == null) {
    return (
      <div className="plotter-empty">
        <div className="plotter-empty-card">
          <Printer size={28} />
          <h2>Plotter (Moldes Tacos)</h2>
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
          <h2>Plotter — {titleName}</h2>
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
              onClick={() => void handleSaveConfig()}
              disabled={saving || loading}
            >
              {saving ? <Loader2 size={16} className="mold-import-spinner" /> : <Save size={16} />}
              {saving ? 'Salvando...' : 'Salvar configuracao'}
            </button>
          ) : null}
          {onBackToGallery ? (
            <button type="button" className="mold-import-button plotter-back-btn" onClick={onBackToGallery}>
              <ArrowLeft size={16} />
              Voltar
            </button>
          ) : null}
        </div>
      </div>

      {error ? <p className="mold-import-error">{error}</p> : null}
      {saveError ? <p className="mold-import-error">{saveError}</p> : null}
      {saveSuccess ? <p className="mold-form-success">{saveSuccess}</p> : null}

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
              />
            </div>
          </div>

          <aside className="plotter-config-panel">
            <div className="plotter-config-head">
              <h3>Configuracao dos tacos</h3>
              <p>
                Menos <strong>tacos por gomo</strong> no bico = grade sobe mais (mais estreito
                aguenta) e a quantidade <strong>subindo/total sobe</strong>. Totais entre partes
                se compensam (50→60, outro 40). Boca ↔ Bojo trocam altura.
              </p>
            </div>

            {sectionStats.map(({ secao, config, bandStats, totalTacos }) => {
              const cor = sectionColors[secao.id] ?? secao.cor;
              const partCount = config.partitions.length;

              return (
                <section key={secao.id} className="plotter-config-card" style={{ borderColor: cor }}>
                  <header className="plotter-config-card-head">
                    <div className="plotter-config-card-title">
                      <h4>{secao.nome}</h4>
                      <p>
                        {formatCm(secao.alturaCm)} · {secao.percentual}%
                        {partCount > 1 ? ` · ${partCount} partes` : ''}
                      </p>
                    </div>
                  </header>

                  <div className="plotter-partitions">
                    {partCount === 0 ? (
                      <div className="plotter-partition-empty-state">
                        <p>Nenhum taco nesta seção. Clique em "Adicionar repartição" abaixo para começar.</p>
                      </div>
                    ) : (
                      bandStats.map(({ band, divisions }, index) => {
                      const partition = band.partition;
                      const label = partCount > 1 ? `${secao.nome} ${index + 1}` : secao.nome;
                      const maxAlturaTaco = Math.max(1, Math.floor(band.alturaCm));
                      const partColor = partition.cor || cor;
                      const divisionColor =
                        partition.corDivisao ||
                        PARTITION_DIVISION_COLORS[index % PARTITION_DIVISION_COLORS.length];

                      return (
                        <div key={partition.id}>
                          <div className="plotter-partition" style={{ borderColor: partColor }}>
                            <div className="plotter-partition-head">
                              <span
                                className="plotter-config-color-swatch"
                                style={{ background: partColor }}
                                aria-hidden
                              />
                              <strong>{label}</strong>
                              <span>{formatCm(band.alturaCm)}</span>
                              {partCount > 1 ? (
                                <button
                                  type="button"
                                  className="plotter-partition-remove"
                                  onClick={() => removePartition(secao.id, partition.id)}
                                  title="Remover reparticao"
                                >
                                  <Trash2 size={14} />
                                </button>
                              ) : null}
                            </div>

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
                                <span>Quantidade de tacos subindo</span>
                                <input
                                  type="number"
                                  min={1}
                                  step={1}
                                  inputMode="numeric"
                                  defaultValue={divisions.quantidadeVertical}
                                  key={`subindo-${partition.id}-${divisions.quantidadeVertical}`}
                                  onBlur={(event) => {
                                    const nextSubindo = Math.max(
                                      1,
                                      Math.floor(Number(event.target.value)) || divisions.quantidadeVertical
                                    );
                                    const nextTotal = nextSubindo * partition.tacosPorGomo;
                                    if (nextSubindo !== divisions.quantidadeVertical) {
                                      updatePartitionTotal(secao.id, partition.id, nextTotal);
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
                                  key={`tpg-${partition.id}-${partition.tacosPorGomo}`}
                                  onBlur={(event) => {
                                    const next = Math.max(
                                      1,
                                      Math.min(64, Math.floor(Number(event.target.value)) || 1)
                                    );
                                    if (next !== partition.tacosPorGomo) {
                                      updateTacosPorGomo(secao.id, partition.id, next);
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
                                  min={1}
                                  max={maxAlturaTaco}
                                  step={1}
                                  inputMode="numeric"
                                  defaultValue={partition.alturaTacoCm}
                                  key={`at-${partition.id}-${partition.alturaTacoCm}`}
                                  onBlur={(event) => {
                                    const next = Math.max(
                                      1,
                                      Math.min(maxAlturaTaco, Math.floor(Number(event.target.value)) || 1)
                                    );
                                    if (next !== partition.alturaTacoCm) {
                                      updateAlturaTaco(secao.id, partition.id, next);
                                    }
                                  }}
                                  onKeyDown={(event) => {
                                    if (event.key === 'Enter') {
                                      (event.target as HTMLInputElement).blur();
                                    }
                                  }}
                                />
                              </label>
                            </div>

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
                          </div>

                          {partCount > 1 && index < partCount - 1 ? (
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
                </section>
              );
            })}
          </aside>
        </div>
      ) : null}
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
