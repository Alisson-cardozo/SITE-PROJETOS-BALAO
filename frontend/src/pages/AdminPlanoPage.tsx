import { useCallback, useEffect, useState } from 'react';
import { Check, Loader2, Pencil, Plus, Trash2 } from 'lucide-react';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { numericFieldProps } from '../lib/numericInput';
import { PLANO_ABA_GROUPS } from '../config/userNavigation';
import type { Plano } from '../types';

const ALL_ABA_IDS = PLANO_ABA_GROUPS.map((g) => g.id);

function formatMoeda(valor: number): string {
  return valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function AdminPlanoPage() {
  const { token } = useAuth();

  // --- Mercado Pago (credenciais globais, compartilhadas por todos os planos) ---
  const [mercadoPagoPublicKey, setMercadoPagoPublicKey] = useState('');
  const [mercadoPagoAccessToken, setMercadoPagoAccessToken] = useState('');
  const [accessTokenConfigured, setAccessTokenConfigured] = useState(false);
  const [loadingSettings, setLoadingSettings] = useState(true);
  const [savingSettings, setSavingSettings] = useState(false);
  const [removingToken, setRemovingToken] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [settingsSuccess, setSettingsSuccess] = useState(false);
  // So pra mostrar o aviso "Em breve" (etc) no checklist -- ver AdminTabsPage,
  // onde esses rotulos sao configurados por aba escondida.
  const [hiddenAbaIds, setHiddenAbaIds] = useState<Set<string>>(new Set());
  const [abaLabels, setAbaLabels] = useState<Record<string, string>>({});

  const loadSettings = useCallback(async () => {
    if (!token) return;
    setLoadingSettings(true);
    setSettingsError(null);
    try {
      const response = await api.getSystemSettings(token);
      setMercadoPagoPublicKey(response.data.mercado_pago_public_key ?? '');
      setAccessTokenConfigured(response.data.mercado_pago_access_token_configured);
      setMercadoPagoAccessToken('');
      setHiddenAbaIds(new Set(response.data.hidden_nav_items));
      setAbaLabels(response.data.nav_item_labels);
    } catch (err) {
      setSettingsError(err instanceof ApiError ? err.message : 'Nao foi possivel carregar as credenciais.');
    } finally {
      setLoadingSettings(false);
    }
  }, [token]);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  const handleSaveSettings = async () => {
    if (!token) return;
    setSettingsError(null);
    setSettingsSuccess(false);
    setSavingSettings(true);
    try {
      const response = await api.adminUpdateSystemSettings(
        {
          mercado_pago_public_key: mercadoPagoPublicKey.trim(),
          ...(mercadoPagoAccessToken.trim() !== '' ? { mercado_pago_access_token: mercadoPagoAccessToken.trim() } : {}),
        },
        token
      );
      setAccessTokenConfigured(response.data.mercado_pago_access_token_configured);
      setMercadoPagoAccessToken('');
      setSettingsSuccess(true);
    } catch (err) {
      setSettingsError(err instanceof ApiError ? err.message : 'Nao foi possivel salvar.');
    } finally {
      setSavingSettings(false);
    }
  };

  const handleRemoveToken = async () => {
    if (!token) return;
    if (!window.confirm('Remover o Access Token do Mercado Pago salvo? Os pagamentos param de funcionar ate voce colocar um novo.')) {
      return;
    }
    setSettingsError(null);
    setSettingsSuccess(false);
    setRemovingToken(true);
    try {
      const response = await api.adminUpdateSystemSettings({ mercado_pago_access_token: '' }, token);
      setAccessTokenConfigured(response.data.mercado_pago_access_token_configured);
      setMercadoPagoAccessToken('');
      setSettingsSuccess(true);
    } catch (err) {
      setSettingsError(err instanceof ApiError ? err.message : 'Nao foi possivel remover o token.');
    } finally {
      setRemovingToken(false);
    }
  };

  // --- Planos (CRUD) ---
  const [planos, setPlanos] = useState<Plano[]>([]);
  const [loadingPlanos, setLoadingPlanos] = useState(true);
  const [planosError, setPlanosError] = useState<string | null>(null);
  const [busyPlanoId, setBusyPlanoId] = useState<number | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [formNome, setFormNome] = useState('');
  const [formValor, setFormValor] = useState('');
  const [formDias, setFormDias] = useState(0);
  const [formAbas, setFormAbas] = useState<Set<string>>(new Set(ALL_ABA_IDS));
  const [formShowInRanking, setFormShowInRanking] = useState(false);
  const [formSalesOverrideCount, setFormSalesOverrideCount] = useState(0);
  const [formCarlaIa, setFormCarlaIa] = useState(false);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [savingPlano, setSavingPlano] = useState(false);

  const loadPlanos = useCallback(async () => {
    if (!token) return;
    setLoadingPlanos(true);
    setPlanosError(null);
    try {
      const response = await api.adminListPlanos(token);
      setPlanos(response.data);
    } catch (err) {
      setPlanosError(err instanceof ApiError ? err.message : 'Nao foi possivel carregar os planos.');
    } finally {
      setLoadingPlanos(false);
    }
  }, [token]);

  useEffect(() => {
    void loadPlanos();
  }, [loadPlanos]);

  const handleStartCreate = () => {
    setEditingId(null);
    setFormNome('');
    setFormValor('');
    setFormDias(0);
    setFormAbas(new Set(ALL_ABA_IDS));
    setFormShowInRanking(false);
    setFormSalesOverrideCount(0);
    setFormCarlaIa(false);
    setFormErrors({});
    setShowForm(true);
  };

  const handleStartEdit = (plano: Plano) => {
    setEditingId(plano.id);
    setFormNome(plano.nome);
    setFormValor(String(plano.valor));
    setFormDias(plano.dias_acesso);
    setFormAbas(new Set(plano.abas));
    setFormShowInRanking(plano.show_in_ranking ?? false);
    setFormSalesOverrideCount(plano.sales_override_count ?? 0);
    setFormCarlaIa(plano.carla_ia ?? false);
    setFormErrors({});
    setShowForm(true);
  };

  const handleCancelForm = () => {
    setShowForm(false);
    setEditingId(null);
  };

  const toggleAba = (id: string) => {
    setFormAbas((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSavePlano = async () => {
    if (!token) return;

    const errors: Record<string, string> = {};
    const nome = formNome.trim();
    const valor = Number(formValor);
    if (nome === '') errors.nome = 'Informe o nome do plano.';
    if (formValor.trim() === '' || Number.isNaN(valor) || valor < 0) errors.valor = 'Informe um valor valido.';
    if (formDias < 1) errors.dias_acesso = 'Informe a quantidade de dias.';
    if (Object.keys(errors).length > 0) {
      setFormErrors(errors);
      return;
    }

    setSavingPlano(true);
    setFormErrors({});
    try {
      const payload = {
        nome,
        valor: round2(valor),
        dias_acesso: formDias,
        abas: [...formAbas],
        show_in_ranking: formShowInRanking,
        sales_override_count: formSalesOverrideCount,
        carla_ia: formCarlaIa,
      };
      if (editingId !== null) {
        await api.adminUpdatePlano(editingId, payload, token);
      } else {
        await api.adminCreatePlano(payload, token);
      }
      setShowForm(false);
      setEditingId(null);
      await loadPlanos();
    } catch (err) {
      setFormErrors({ nome: err instanceof ApiError ? err.message : 'Nao foi possivel salvar o plano.' });
    } finally {
      setSavingPlano(false);
    }
  };

  const handleToggleAtivo = async (plano: Plano) => {
    if (!token) return;
    setBusyPlanoId(plano.id);
    try {
      await api.adminSetPlanoAtivo(plano.id, !plano.ativo, token);
      await loadPlanos();
    } catch (err) {
      setPlanosError(err instanceof ApiError ? err.message : 'Nao foi possivel atualizar o plano.');
    } finally {
      setBusyPlanoId(null);
    }
  };

  const handleDelete = async (plano: Plano) => {
    if (!token) return;
    if (!window.confirm(`Excluir o plano "${plano.nome}" para sempre?`)) return;
    setBusyPlanoId(plano.id);
    try {
      await api.adminDeletePlano(plano.id, token);
      await loadPlanos();
    } catch (err) {
      setPlanosError(
        err instanceof ApiError
          ? err.message
          : 'Nao foi possivel excluir o plano.'
      );
    } finally {
      setBusyPlanoId(null);
    }
  };

  return (
    <div className="bandeira-workspace">
      <div className="bandeira-main-panel">
        <div className="bandeira-panel-header">
          <h2>Plano</h2>
          <p>Credenciais do Mercado Pago e os planos pagos que os clientes veem em "Solicitar Acesso".</p>
        </div>

        {loadingSettings ? (
          <p className="bandeira-size-hint">
            <Loader2 size={14} className="mold-import-spinner" /> Carregando...
          </p>
        ) : (
          <div className="bandeira-create-panel">
            <h3>Mercado Pago</h3>

            <label className="auth-field">
              <span>Public Key</span>
              <input
                type="text"
                value={mercadoPagoPublicKey}
                onChange={(e) => setMercadoPagoPublicKey(e.target.value)}
                placeholder="APP_USR-xxxxxxxx-xxxxxx-xxxxxxxxxxxxxxxxxxxxxxxx-xxxxxxxxx"
              />
            </label>

            <label className="auth-field">
              <span>
                Access Token{' '}
                {accessTokenConfigured ? (
                  <span className="admin-plano-token-status configured">
                    <Check size={12} /> configurado
                  </span>
                ) : (
                  <span className="admin-plano-token-status">nao configurado</span>
                )}
              </span>
              <input
                type="password"
                value={mercadoPagoAccessToken}
                onChange={(e) => setMercadoPagoAccessToken(e.target.value)}
                placeholder={accessTokenConfigured ? 'Deixe em branco pra manter o atual' : 'Cole o Access Token aqui'}
                autoComplete="off"
              />
            </label>
            {accessTokenConfigured ? (
              <button
                type="button"
                className="mold-secondary-button rifa-recusar-button"
                onClick={() => void handleRemoveToken()}
                disabled={removingToken}
              >
                {removingToken ? <Loader2 size={14} className="mold-import-spinner" /> : null}
                Remover token salvo
              </button>
            ) : null}

            {settingsError ? <p className="mold-import-error">{settingsError}</p> : null}
            {settingsSuccess ? <p className="mold-form-success">Salvo com sucesso.</p> : null}

            <button type="button" className="mold-save-button" onClick={() => void handleSaveSettings()} disabled={savingSettings}>
              {savingSettings ? <Loader2 size={16} className="mold-import-spinner" /> : null}
              Salvar credenciais
            </button>
          </div>
        )}

        <div className="bandeira-panel-header">
          <h3>Planos</h3>
          <p>Cada plano aparece pro cliente escolher em "Solicitar Acesso". Pode ter varios (ex: mensal, anual).</p>
        </div>

        {loadingPlanos ? (
          <p className="bandeira-size-hint">
            <Loader2 size={14} className="mold-import-spinner" /> Carregando planos...
          </p>
        ) : (
          <>
            {planosError ? <p className="mold-import-error">{planosError}</p> : null}

            {planos.length === 0 ? (
              <p className="bandeira-size-hint">Nenhum plano cadastrado ainda.</p>
            ) : (
              <div className="table-scroll">
                <table className="rifa-compradores-table">
                  <thead>
                    <tr>
                      <th>Nome</th>
                      <th>Valor</th>
                      <th>Dias de acesso</th>
                      <th>Abas</th>
                      <th>Status</th>
                      <th>Ranking</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {planos.map((plano) => (
                      <tr key={plano.id}>
                        <td>{plano.nome}</td>
                        <td>{formatMoeda(plano.valor)}</td>
                        <td>{plano.dias_acesso}</td>
                        <td
                          title={PLANO_ABA_GROUPS.filter((g) => plano.abas.includes(g.id))
                            .map((g) => g.label)
                            .join(', ')}
                        >
                          {plano.abas.length}/{PLANO_ABA_GROUPS.length}
                        </td>
                        <td>{plano.ativo ? 'Ativo' : 'Inativo'}</td>
                        <td>{plano.show_in_ranking ? `✨ Sim (${plano.sales_override_count})` : 'Não'}</td>
                        <td className="rifa-compradores-actions">
                          <button
                            type="button"
                            className="mold-secondary-button"
                            onClick={() => handleStartEdit(plano)}
                            title="Editar plano"
                          >
                            <Pencil size={14} />
                            Editar
                          </button>
                          <button
                            type="button"
                            className="mold-secondary-button"
                            onClick={() => void handleToggleAtivo(plano)}
                            disabled={busyPlanoId === plano.id}
                          >
                            {busyPlanoId === plano.id ? <Loader2 size={14} className="mold-import-spinner" /> : null}
                            {plano.ativo ? 'Desativar' : 'Ativar'}
                          </button>
                          <button
                            type="button"
                            className="mold-secondary-button rifa-recusar-button"
                            onClick={() => void handleDelete(plano)}
                            disabled={busyPlanoId === plano.id}
                            title="Excluir plano"
                          >
                            <Trash2 size={14} />
                            Excluir
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {showForm ? (
              <div className="bandeira-create-panel">
                <h3>{editingId !== null ? 'Editar plano' : 'Novo plano'}</h3>

                <label className="auth-field">
                  <span>Nome</span>
                  <input
                    type="text"
                    value={formNome}
                    onChange={(e) => setFormNome(e.target.value)}
                    placeholder="Ex: Plano Mensal"
                  />
                  {formErrors.nome ? <small className="auth-error">{formErrors.nome}</small> : null}
                </label>

                <div className="bandeira-size-fields">
                  <label className="auth-field">
                    <span>Valor (R$)</span>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={formValor}
                      onChange={(e) => setFormValor(e.target.value)}
                      placeholder="Ex: 49.90"
                    />
                    {formErrors.valor ? <small className="auth-error">{formErrors.valor}</small> : null}
                  </label>

                  <label className="auth-field">
                    <span>Dias de acesso</span>
                    <input type="number" min={1} {...numericFieldProps(formDias, setFormDias, 1)} placeholder="Ex: 30" />
                    {formErrors.dias_acesso ? <small className="auth-error">{formErrors.dias_acesso}</small> : null}
                  </label>
                </div>

                <div className="bandeira-size-fields" style={{ marginTop: '12px' }}>
                  <label className="auth-field" style={{ flexDirection: 'row', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={formShowInRanking}
                      onChange={(e) => setFormShowInRanking(e.target.checked)}
                      style={{ width: 'auto', margin: 0 }}
                    />
                    <span>Mostrar no Ranking Público</span>
                  </label>

                  <label className="auth-field" style={{ flexDirection: 'row', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={formCarlaIa}
                      onChange={(e) => setFormCarlaIa(e.target.checked)}
                      style={{ width: 'auto', margin: 0 }}
                    />
                    <span>🤖 Assistente-IA Carla disponível</span>
                  </label>

                  <label className="auth-field">
                    <span>Vendas no Ranking (Simulado)</span>
                    <input
                      type="number"
                      min={0}
                      {...numericFieldProps(formSalesOverrideCount, setFormSalesOverrideCount, 0)}
                      placeholder="Ex: 150"
                    />
                  </label>
                </div>

                <div className="auth-field">
                  <span>Abas liberadas</span>
                  <small className="bandeira-size-hint">
                    O cliente que pagar esse plano so consegue usar as abas marcadas abaixo — as demais aparecem
                    bloqueadas no menu dele, com opcao de fazer upgrade.
                  </small>
                </div>
                <div className="admin-tabs-list">
                  {PLANO_ABA_GROUPS.map((group) => {
                    const Icon = group.icon;
                    const checked = formAbas.has(group.id);
                    const isHiddenSystemWide = hiddenAbaIds.has(group.id);
                    const aviso = isHiddenSystemWide ? abaLabels[group.id] : undefined;
                    return (
                      <label key={group.id} className={`admin-tabs-row${checked ? '' : ' is-hidden'}`}>
                        <div className="admin-tabs-row-info">
                          <Icon size={18} />
                          <div>
                            <strong>
                              {group.label}
                              {isHiddenSystemWide ? (
                                <em className="solicitar-acesso-aba-aviso admin-tabs-aba-aviso">
                                  {aviso || 'aba oculta no sistema'}
                                </em>
                              ) : null}
                            </strong>
                            <span>{group.description}</span>
                          </div>
                        </div>
                        <span className="rifa-checkbox-row admin-tabs-toggle">
                          <input type="checkbox" checked={checked} onChange={() => toggleAba(group.id)} />
                          <span>{checked ? 'Liberada' : 'Bloqueada'}</span>
                        </span>
                      </label>
                    );
                  })}
                </div>

                <div className="admin-plano-form-actions">
                  <button type="button" className="mold-save-button" onClick={() => void handleSavePlano()} disabled={savingPlano}>
                    {savingPlano ? <Loader2 size={16} className="mold-import-spinner" /> : null}
                    Salvar plano
                  </button>
                  <button type="button" className="mold-secondary-button" onClick={handleCancelForm} disabled={savingPlano}>
                    Cancelar
                  </button>
                </div>
              </div>
            ) : (
              <button type="button" className="mold-save-button" onClick={handleStartCreate}>
                <Plus size={16} />
                Criar plano
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
