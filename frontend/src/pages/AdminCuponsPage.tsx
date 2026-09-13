import { useCallback, useEffect, useState } from 'react';
import { Loader2, Ticket, Trash2, Star, Pencil, Plus, X } from 'lucide-react';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import type { Cupom, CupomPayload, Plano } from '../types';

const emptyForm: CupomPayload = { codigo: '', nome: '', percentual: 10, valido_ate: '', ativo: true, max_usos: null, planos: [] };

/** Seleção de planos no formulário: por plano_id, ligado? e qual %. */
type PlanoSel = Record<number, { on: boolean; pct: number }>;

function formatDate(iso: string | null): string {
  if (!iso) return 'Sem validade';
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

function formatMoeda(valor: number): string {
  return valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

/** Valor do plano já com o desconto (piso de R$0,50, igual ao backend). */
function comDesconto(valor: number, pct: number): number {
  return Math.max(0.5, Math.round(valor * (1 - pct / 100) * 100) / 100);
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 12px',
  background: '#0b0f18',
  border: '1px solid #2d3748',
  borderRadius: '8px',
  color: '#fff',
  fontSize: '14px',
  outline: 'none',
  boxSizing: 'border-box',
};

export function AdminCuponsPage() {
  const { token } = useAuth();
  const [cupons, setCupons] = useState<Cupom[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [planos, setPlanos] = useState<Plano[]>([]);

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<CupomPayload>(emptyForm);
  const [escopoTodos, setEscopoTodos] = useState(true);
  const [planoSel, setPlanoSel] = useState<PlanoSel>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.adminListCupons(token);
      setCupons(res.data);
      const pl = await api.adminListPlanos(token);
      setPlanos(pl.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível carregar os cupons.');
    } finally {
      setLoading(false);
    }
  }, [token]);

  const nomePlano = (id: number): string => planos.find((p) => p.id === id)?.nome ?? `Plano #${id}`;

  useEffect(() => {
    void load();
  }, [load]);

  const openCreate = () => {
    setEditingId(null);
    setForm(emptyForm);
    setEscopoTodos(true);
    setPlanoSel({});
    setFieldErrors({});
    setFormError(null);
    setShowForm(true);
  };

  const openEdit = (c: Cupom) => {
    setEditingId(c.id);
    setForm({
      codigo: c.codigo,
      nome: c.nome,
      percentual: c.percentual,
      valido_ate: c.valido_ate ? c.valido_ate.slice(0, 10) : '',
      ativo: c.ativo,
      max_usos: c.max_usos,
      planos: c.planos,
    });
    setEscopoTodos(c.aplica_todos);
    const sel: PlanoSel = {};
    for (const r of c.planos) sel[r.plano_id] = { on: true, pct: r.percentual };
    setPlanoSel(sel);
    setFieldErrors({});
    setFormError(null);
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!token) return;
    setFieldErrors({});
    setFormError(null);

    // Monta as regras por plano quando o escopo é "planos específicos".
    const planosPayload = escopoTodos
      ? []
      : planos
          .filter((p) => planoSel[p.id]?.on)
          .map((p) => ({ plano_id: p.id, percentual: planoSel[p.id]?.pct || form.percentual }));

    if (!escopoTodos && planosPayload.length === 0) {
      setFieldErrors({ planos: 'Selecione ao menos um plano.' });
      return;
    }

    const payload: CupomPayload = { ...form, planos: planosPayload };
    setSaving(true);
    try {
      if (editingId) {
        await api.adminUpdateCupom(editingId, payload, token);
      } else {
        await api.adminCreateCupom(payload, token);
      }
      setShowForm(false);
      await load();
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.errors) setFieldErrors(err.errors);
        setFormError(err.message);
      } else {
        setFormError('Não foi possível salvar o cupom.');
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (c: Cupom) => {
    if (!token) return;
    if (!window.confirm(`Excluir o cupom "${c.codigo}"?`)) return;
    try {
      await api.adminDeleteCupom(c.id, token);
      await load();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : 'Não foi possível excluir.');
    }
  };

  const handleSetCampanha = async (c: Cupom) => {
    if (!token) return;
    if (!window.confirm(`Marcar "${c.codigo}" como o cupom da campanha diária? Ele será enviado aos clientes inativos.`)) return;
    try {
      await api.adminSetCupomCampanha(c.id, token);
      await load();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : 'Não foi possível marcar a campanha.');
    }
  };

  return (
    <div className="bandeira-workspace" style={{ padding: '24px' }}>
      <div className="bandeira-main-panel" style={{ width: '100%', maxWidth: '100%', background: '#111622', border: '1px solid #1f293d', borderRadius: '12px', padding: '24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '16px', marginBottom: '20px', borderBottom: '1px solid #1f293d', paddingBottom: '16px', flexWrap: 'wrap' }}>
          <div>
            <h2 style={{ fontSize: '24px', fontWeight: 600, color: '#f7fafc', margin: 0, display: 'flex', alignItems: 'center', gap: '10px' }}>
              <Ticket size={24} /> Cupons de Desconto
            </h2>
            <p style={{ color: '#a0aec0', margin: '4px 0 0 0', fontSize: '14px' }}>
              Crie códigos de desconto e escolha qual é o cupom da campanha diária (enviado aos clientes inativos).
            </p>
          </div>
          <button
            type="button"
            onClick={openCreate}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', background: '#3182ce', color: '#fff', border: 'none', borderRadius: '8px', padding: '10px 16px', fontSize: '14px', fontWeight: 600, cursor: 'pointer' }}
          >
            <Plus size={16} /> Novo cupom
          </button>
        </div>

        {loading ? (
          <p style={{ textAlign: 'center', color: '#a0aec0', padding: '24px' }}>
            <Loader2 size={20} className="mold-import-spinner" style={{ marginRight: '8px' }} /> Carregando...
          </p>
        ) : error ? (
          <p className="mold-import-error" style={{ textAlign: 'center' }}>{error}</p>
        ) : cupons.length === 0 ? (
          <p style={{ textAlign: 'center', color: '#718096', padding: '32px' }}>
            Nenhum cupom criado ainda. Clique em "Novo cupom" para começar.
          </p>
        ) : (
          <div style={{ overflowX: 'auto', borderRadius: '8px', border: '1px solid #1f293d' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', minWidth: '760px' }}>
              <thead>
                <tr style={{ background: '#161e2e', borderBottom: '1px solid #1f293d' }}>
                  {['Código', 'Nome', 'Desconto', 'Planos', 'Usos', 'Validade', 'Status', 'Campanha', 'Ações'].map((h) => (
                    <th key={h} style={{ padding: '12px 16px', color: '#a0aec0', fontWeight: 600, fontSize: '13px' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {cupons.map((c) => (
                  <tr key={c.id} style={{ borderBottom: '1px solid #1f293d', background: '#111622' }}>
                    <td style={{ padding: '12px 16px' }}>
                      <span style={{ fontFamily: 'monospace', fontWeight: 700, color: '#f7fafc', background: '#0b0f18', padding: '3px 8px', borderRadius: '6px', border: '1px solid #2d3748' }}>{c.codigo}</span>
                    </td>
                    <td style={{ padding: '12px 16px', color: '#e2e8f0', fontSize: '14px' }}>{c.nome}</td>
                    <td style={{ padding: '12px 16px', color: '#48bb78', fontWeight: 700, fontSize: '14px' }}>
                      {c.aplica_todos ? `${c.percentual}%` : `até ${Math.max(...c.planos.map((p) => p.percentual))}%`}
                    </td>
                    <td style={{ padding: '12px 16px', color: '#cbd5e0', fontSize: '12px', maxWidth: '220px' }}>
                      {c.aplica_todos ? (
                        <span style={{ color: '#a0aec0' }}>Todos os planos</span>
                      ) : (
                        c.planos.map((p) => `${nomePlano(p.plano_id)} (${p.percentual}%)`).join(', ')
                      )}
                    </td>
                    <td style={{ padding: '12px 16px', fontSize: '13px' }}>
                      {c.max_usos !== null ? (
                        <span style={{ color: c.usos >= c.max_usos ? '#fc8181' : '#cbd5e0', fontWeight: 600 }}>
                          {c.usos}/{c.max_usos}
                          {c.usos >= c.max_usos && <span style={{ display: 'block', fontSize: '11px', color: '#fc8181' }}>esgotado</span>}
                        </span>
                      ) : (
                        <span style={{ color: '#a0aec0' }}>{c.usos} · <span title="ilimitado">∞</span></span>
                      )}
                    </td>
                    <td style={{ padding: '12px 16px', color: '#cbd5e0', fontSize: '13px' }}>{formatDate(c.valido_ate)}</td>
                    <td style={{ padding: '12px 16px' }}>
                      <span style={{ padding: '3px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', background: c.ativo ? 'rgba(72,187,120,0.12)' : 'rgba(160,174,192,0.12)', color: c.ativo ? '#48bb78' : '#a0aec0' }}>
                        {c.ativo ? 'Ativo' : 'Inativo'}
                      </span>
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      {c.is_campanha ? (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', color: '#ecc94b', fontSize: '12px', fontWeight: 600 }}>
                          <Star size={13} fill="#ecc94b" /> Campanha
                        </span>
                      ) : (
                        <button type="button" onClick={() => void handleSetCampanha(c)} title="Usar como cupom da campanha diária" style={{ background: 'none', border: '1px solid #4a5568', color: '#a0aec0', borderRadius: '6px', padding: '4px 8px', fontSize: '12px', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                          <Star size={13} /> Marcar
                        </button>
                      )}
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <button type="button" onClick={() => openEdit(c)} title="Editar" style={{ background: '#2b6cb0', border: 'none', color: '#fff', borderRadius: '6px', padding: '6px 8px', cursor: 'pointer' }}>
                          <Pencil size={14} />
                        </button>
                        <button type="button" onClick={() => void handleDelete(c)} title="Excluir" style={{ background: '#e53e3e', border: 'none', color: '#fff', borderRadius: '6px', padding: '6px 8px', cursor: 'pointer' }}>
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showForm && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: '20px', backdropFilter: 'blur(4px)' }}>
          <div style={{ width: '100%', maxWidth: '440px', background: '#111622', border: '1px solid #23304d', borderRadius: '14px', padding: '24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h3 style={{ color: '#f7fafc', fontSize: '18px', fontWeight: 600, margin: 0 }}>{editingId ? 'Editar cupom' : 'Novo cupom'}</h3>
              <button type="button" onClick={() => setShowForm(false)} style={{ background: 'none', border: 'none', color: '#718096', cursor: 'pointer' }}><X size={18} /></button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div>
                <label style={{ display: 'block', color: '#cbd5e0', fontSize: '13px', marginBottom: '6px' }}>Código</label>
                <input style={inputStyle} value={form.codigo} onChange={(e) => setForm({ ...form, codigo: e.target.value.toUpperCase() })} placeholder="Ex: VOLTA20" />
                {fieldErrors.codigo && <small style={{ color: '#fc8181' }}>{fieldErrors.codigo}</small>}
              </div>
              <div>
                <label style={{ display: 'block', color: '#cbd5e0', fontSize: '13px', marginBottom: '6px' }}>Nome</label>
                <input style={inputStyle} value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} placeholder="Ex: Campanha de retorno" />
                {fieldErrors.nome && <small style={{ color: '#fc8181' }}>{fieldErrors.nome}</small>}
              </div>
              <div style={{ display: 'flex', gap: '12px' }}>
                <div style={{ flex: 1 }}>
                  <label style={{ display: 'block', color: '#cbd5e0', fontSize: '13px', marginBottom: '6px' }}>
                    Desconto {escopoTodos ? '(%)' : 'padrão (%)'}
                  </label>
                  <input type="number" min={1} max={95} style={inputStyle} value={form.percentual} onChange={(e) => setForm({ ...form, percentual: Number(e.target.value) })} />
                  {fieldErrors.percentual && <small style={{ color: '#fc8181' }}>{fieldErrors.percentual}</small>}
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ display: 'block', color: '#cbd5e0', fontSize: '13px', marginBottom: '6px' }}>Validade (opcional)</label>
                  <input type="date" style={inputStyle} value={form.valido_ate} onChange={(e) => setForm({ ...form, valido_ate: e.target.value })} />
                  {fieldErrors.valido_ate && <small style={{ color: '#fc8181' }}>{fieldErrors.valido_ate}</small>}
                </div>
              </div>

              <div>
                <label style={{ display: 'block', color: '#cbd5e0', fontSize: '13px', marginBottom: '6px' }}>Quantidade disponível (limite de usos)</label>
                <input
                  type="number"
                  min={0}
                  style={inputStyle}
                  value={form.max_usos ?? ''}
                  onChange={(e) => setForm({ ...form, max_usos: e.target.value === '' || Number(e.target.value) <= 0 ? null : Number(e.target.value) })}
                  placeholder="Deixe vazio = ilimitado"
                />
                <small style={{ color: '#718096' }}>Vazio ou 0 = ilimitado. Ex: 100 = o cupom para de funcionar após 100 usos.</small>
              </div>

              {/* Escopo: todos os planos ou planos específicos (com % por plano). */}
              <div>
                <label style={{ display: 'block', color: '#cbd5e0', fontSize: '13px', marginBottom: '8px', fontWeight: 600 }}>Onde o cupom vale</label>
                <div style={{ display: 'flex', gap: '8px', marginBottom: '10px' }}>
                  <button
                    type="button"
                    onClick={() => setEscopoTodos(true)}
                    style={{ flex: 1, padding: '8px', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer', border: escopoTodos ? '1px solid #3182ce' : '1px solid #2d3748', background: escopoTodos ? 'rgba(49,130,206,0.15)' : '#0b0f18', color: escopoTodos ? '#63b3ed' : '#a0aec0' }}
                  >
                    Todos os planos
                  </button>
                  <button
                    type="button"
                    onClick={() => setEscopoTodos(false)}
                    style={{ flex: 1, padding: '8px', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer', border: !escopoTodos ? '1px solid #3182ce' : '1px solid #2d3748', background: !escopoTodos ? 'rgba(49,130,206,0.15)' : '#0b0f18', color: !escopoTodos ? '#63b3ed' : '#a0aec0' }}
                  >
                    Escolher planos
                  </button>
                </div>

                {!escopoTodos && (
                  <div style={{ border: '1px solid #2d3748', borderRadius: '8px', padding: '10px', maxHeight: '200px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {planos.length === 0 ? (
                      <span style={{ color: '#718096', fontSize: '13px' }}>Nenhum plano cadastrado.</span>
                    ) : (
                      planos.map((p) => {
                        const sel = planoSel[p.id];
                        const on = sel?.on ?? false;
                        const pct = sel?.pct ?? form.percentual;
                        return (
                          <div key={p.id} style={{ display: 'flex', flexDirection: 'column', gap: '4px', paddingBottom: '6px', borderBottom: '1px solid #1a2233' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1, cursor: 'pointer', color: '#e2e8f0', fontSize: '13px' }}>
                                <input
                                  type="checkbox"
                                  checked={on}
                                  onChange={(e) =>
                                    setPlanoSel({ ...planoSel, [p.id]: { on: e.target.checked, pct: sel?.pct ?? form.percentual } })
                                  }
                                />
                                {p.nome}
                              </label>
                              <input
                                type="number"
                                min={1}
                                max={95}
                                disabled={!on}
                                value={pct}
                                onChange={(e) => setPlanoSel({ ...planoSel, [p.id]: { on: true, pct: Number(e.target.value) } })}
                                style={{ width: '64px', padding: '6px 8px', background: on ? '#0b0f18' : '#161e2e', border: '1px solid #2d3748', borderRadius: '6px', color: '#fff', fontSize: '13px', opacity: on ? 1 : 0.5 }}
                              />
                              <span style={{ color: '#718096', fontSize: '12px' }}>%</span>
                            </div>
                            {/* Preview: valor cheio -> valor com desconto */}
                            <div style={{ paddingLeft: '24px', fontSize: '12px', color: on ? '#a0aec0' : '#4a5568' }}>
                              <span style={{ textDecoration: 'line-through', opacity: 0.7 }}>{formatMoeda(p.valor)}</span>
                              <span style={{ margin: '0 6px' }}>→</span>
                              <span style={{ color: on ? '#48bb78' : '#4a5568', fontWeight: 600 }}>
                                {formatMoeda(comDesconto(p.valor, pct))}
                              </span>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                )}
                {fieldErrors.planos && <small style={{ color: '#fc8181' }}>{fieldErrors.planos}</small>}
              </div>

              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#cbd5e0', fontSize: '14px', cursor: 'pointer' }}>
                <input type="checkbox" checked={form.ativo} onChange={(e) => setForm({ ...form, ativo: e.target.checked })} />
                Cupom ativo
              </label>

              {formError && <p className="mold-import-error" style={{ margin: 0 }}>{formError}</p>}

              <button type="button" onClick={() => void handleSave()} disabled={saving} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '8px', background: '#3182ce', color: '#fff', border: 'none', borderRadius: '8px', padding: '12px', fontSize: '15px', fontWeight: 600, cursor: saving ? 'default' : 'pointer' }}>
                {saving ? <Loader2 size={16} className="mold-import-spinner" /> : null}
                {editingId ? 'Salvar alterações' : 'Criar cupom'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
