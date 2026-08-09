import { useCallback, useEffect, useState } from 'react';
import { ImagePlus, Loader2, Pencil, Plus, Trash2 } from 'lucide-react';
import { api, ApiError, createLojaProduto } from '../lib/api';
import { useAuth } from '../lib/auth';
import type { LojaProdutoAdmin } from '../types';

function formatMoeda(valor: number): string {
  return valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

const STATUS_LABEL: Record<string, string> = {
  disponivel: 'Disponivel',
  reservado: 'Reservado (Pix pendente)',
  vendido: 'Vendido',
};

function ImagemUploadBox({ label, file, onChange }: { label: string; file: File | null; onChange: (file: File | null) => void }) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!file) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  return (
    <label className={`rifa-foto-upload${previewUrl ? ' has-image' : ''}`}>
      {previewUrl ? (
        <img src={previewUrl} alt={label} />
      ) : (
        <>
          <ImagePlus size={20} />
          <span>{label}</span>
        </>
      )}
      <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => onChange(e.target.files?.[0] ?? null)} />
    </label>
  );
}

interface ProdutoFormProps {
  produto: LojaProdutoAdmin | null;
  onCancel: () => void;
  onSaved: () => void;
}

function ProdutoForm({ produto, onCancel, onSaved }: ProdutoFormProps) {
  const { token } = useAuth();
  const isEdit = produto !== null;
  const [nome, setNome] = useState(produto?.nome ?? '');
  const [descricao, setDescricao] = useState(produto?.descricao ?? '');
  const [valor, setValor] = useState(produto ? String(produto.valor) : '');
  const [linkArquivo, setLinkArquivo] = useState(produto?.link_arquivo ?? '');
  const [imagens, setImagens] = useState<Array<File | null>>([null, null, null, null]);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const handleSave = async () => {
    if (!token) return;
    setFormError(null);

    if (nome.trim() === '') return setFormError('Informe o nome do produto.');
    if (!valor || Number(valor) <= 0) return setFormError('Informe o valor do produto.');
    if (linkArquivo.trim() === '') return setFormError('Informe o link dos arquivos.');

    setSaving(true);
    try {
      if (isEdit) {
        await api.adminUpdateLojaProduto(
          produto.id,
          { nome: nome.trim(), descricao: descricao.trim(), valor: Number(valor), link_arquivo: linkArquivo.trim() },
          token
        );
      } else {
        const formData = new FormData();
        formData.append('nome', nome.trim());
        formData.append('descricao', descricao.trim());
        formData.append('valor', valor);
        formData.append('link_arquivo', linkArquivo.trim());
        imagens.forEach((imagem, i) => {
          if (imagem) formData.append(`imagem${i + 1}`, imagem);
        });
        await createLojaProduto(formData, token);
      }
      onSaved();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Nao foi possivel salvar o produto.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bandeira-create-panel">
      <h3>{isEdit ? 'Editar produto' : 'Novo produto'}</h3>

      <label className="auth-field">
        <span>Nome</span>
        <input type="text" value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex: Molde do Balao Pipoca" />
      </label>

      <label className="auth-field">
        <span>Descricao</span>
        <textarea value={descricao} onChange={(e) => setDescricao(e.target.value)} rows={3} placeholder="Conte o que o cliente vai receber..." />
      </label>

      <div className="bandeira-size-fields">
        <label className="auth-field">
          <span>Valor (R$)</span>
          <input type="number" min={0} step="0.01" value={valor} onChange={(e) => setValor(e.target.value)} placeholder="Ex: 29.90" />
        </label>
        <label className="auth-field">
          <span>Link dos arquivos</span>
          <input
            type="text"
            value={linkArquivo}
            onChange={(e) => setLinkArquivo(e.target.value)}
            placeholder="https://drive.google.com/..."
          />
        </label>
      </div>
      <p className="bandeira-size-hint">
        Esse link so e enviado por email pro comprador DEPOIS que o Pix for aprovado — nunca aparece na vitrine
        publica.
      </p>

      {!isEdit ? (
        <>
          <h4>Imagens (ate 4, opcional)</h4>
          <div className="rifa-foto-row">
            {[0, 1, 2, 3].map((i) => (
              <ImagemUploadBox
                key={i}
                label={`Imagem ${i + 1}`}
                file={imagens[i]}
                onChange={(file) => setImagens((prev) => prev.map((f, idx) => (idx === i ? file : f)))}
              />
            ))}
          </div>
        </>
      ) : (
        <p className="bandeira-size-hint">
          Pra trocar as imagens, exclua esse produto e cadastre de novo (edicao so muda nome/descricao/valor/link).
        </p>
      )}

      {formError ? <p className="mold-import-error">{formError}</p> : null}

      <div className="admin-plano-form-actions">
        <button type="button" className="mold-save-button" onClick={() => void handleSave()} disabled={saving}>
          {saving ? <Loader2 size={16} className="mold-import-spinner" /> : null}
          Salvar produto
        </button>
        <button type="button" className="mold-secondary-button" onClick={onCancel} disabled={saving}>
          Cancelar
        </button>
      </div>
    </div>
  );
}

export function AdminLojaPage() {
  const { token } = useAuth();
  const [produtos, setProdutos] = useState<LojaProdutoAdmin[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<LojaProdutoAdmin | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const response = await api.adminListLojaProdutos(token);
      setProdutos(response.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Nao foi possivel carregar os produtos.');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleDelete = async (produto: LojaProdutoAdmin) => {
    if (!token) return;
    if (!window.confirm(`Excluir o produto "${produto.nome}" da loja pra sempre?`)) return;
    setBusyId(produto.id);
    try {
      await api.adminDeleteLojaProduto(produto.id, token);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Nao foi possivel excluir o produto.');
    } finally {
      setBusyId(null);
    }
  };

  if (showForm) {
    return (
      <div className="bandeira-workspace">
        <div className="bandeira-main-panel">
          <div className="bandeira-panel-header">
            <h2>Loja</h2>
            <p>Produtos avulsos vendidos por Pix — cada um so pode ser vendido 1 vez.</p>
          </div>
          <ProdutoForm
            produto={editing}
            onCancel={() => {
              setShowForm(false);
              setEditing(null);
            }}
            onSaved={() => {
              setShowForm(false);
              setEditing(null);
              void load();
            }}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="bandeira-workspace">
      <div className="bandeira-main-panel">
        <div className="bandeira-panel-header">
          <h2>Loja</h2>
          <p>
            Produtos avulsos vendidos por Pix (Mercado Pago). Vitrine publica em{' '}
            <code>/loja</code> — cada produto some da lista assim que e vendido.
          </p>
        </div>

        <button
          type="button"
          className="mold-save-button"
          onClick={() => {
            setEditing(null);
            setShowForm(true);
          }}
        >
          <Plus size={16} />
          Novo produto
        </button>

        {error ? <p className="mold-import-error">{error}</p> : null}

        {loading ? (
          <p className="bandeira-size-hint">
            <Loader2 size={14} className="mold-import-spinner" /> Carregando produtos...
          </p>
        ) : produtos.length === 0 ? (
          <p className="bandeira-size-hint">Nenhum produto cadastrado ainda.</p>
        ) : (
          <div className="mold-gallery-grid">
            {produtos.map((produto) => (
              <article key={produto.id} className="mold-card">
                <div className="mold-card-preview riscado-project-preview">
                  {produto.imagens[0] ? (
                    <img className="riscado-project-png" src={produto.imagens[0]} alt={produto.nome} />
                  ) : (
                    <div className="riscado-project-svg-empty">
                      <ImagePlus size={28} opacity={0.4} />
                    </div>
                  )}
                </div>
                <div className="mold-card-body">
                  <h3>{produto.nome}</h3>
                  <p className="mold-card-meta">{formatMoeda(produto.valor)}</p>
                  <p className="mold-card-meta">{STATUS_LABEL[produto.status] ?? produto.status}</p>
                  {produto.comprador_email ? <p className="mold-card-meta">Comprado por {produto.comprador_email}</p> : null}
                  <div className="mold-card-actions">
                    <button
                      type="button"
                      className="mold-secondary-button"
                      onClick={() => {
                        setEditing(produto);
                        setShowForm(true);
                      }}
                    >
                      <Pencil size={15} /> Editar
                    </button>
                    <button
                      type="button"
                      className="mold-import-button"
                      disabled={busyId === produto.id}
                      onClick={() => void handleDelete(produto)}
                    >
                      {busyId === produto.id ? <Loader2 size={15} className="mold-import-spinner" /> : <Trash2 size={15} />}
                      Excluir
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
