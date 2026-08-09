import { useCallback, useEffect, useState } from 'react';
import { Check, ChevronLeft, Copy, ImagePlus, Loader2, QrCode } from 'lucide-react';
import { api, ApiError } from '../lib/api';
import type { LojaPagamento, LojaProdutoPublic } from '../types';

const POLL_INTERVAL_MS = 3500;

function formatMoeda(valor: number): string {
  return valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function ProdutoDetail({ produto, onBack }: { produto: LojaProdutoPublic; onBack: () => void }) {
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [pagamento, setPagamento] = useState<LojaPagamento | null>(null);
  const [pixCopied, setPixCopied] = useState(false);

  const handleComprar = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (email.trim() === '' || !email.includes('@')) {
      setFormError('Informe um email valido.');
      return;
    }

    setSubmitting(true);
    try {
      const response = await api.comprarLojaProduto(produto.id, email.trim());
      setPagamento(response.data);
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Nao foi possivel gerar o Pix.');
    } finally {
      setSubmitting(false);
    }
  };

  // Poll do status do pagamento enquanto estiver pendente.
  useEffect(() => {
    if (!pagamento || pagamento.status !== 'pendente') return;

    let cancelled = false;
    const interval = window.setInterval(async () => {
      try {
        const response = await api.getLojaPagamentoStatus(pagamento.id);
        if (cancelled) return;
        setPagamento(response.data);
      } catch {
        // silencioso -- tenta de novo no proximo poll
      }
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [pagamento]);

  return (
    <div className="rifa-public-card">
      <button type="button" className="mold-secondary-button" onClick={onBack}>
        <ChevronLeft size={16} />
        Voltar pra vitrine
      </button>

      {produto.imagens.length > 0 ? (
        <div className="rifa-public-gallery">
          {produto.imagens.map((imagem, i) => (
            <img key={i} src={imagem} alt={`${produto.nome} - imagem ${i + 1}`} />
          ))}
        </div>
      ) : null}

      <h1>{produto.nome}</h1>
      <p className="rifa-public-desc">{produto.descricao}</p>

      <div className="rifa-public-stats">
        <div>
          <span>Valor</span>
          <strong>{formatMoeda(produto.valor)}</strong>
        </div>
      </div>

      {produto.status === 'vendido' ? (
        <div className="rifa-public-message">
          <h2>Esse produto ja foi vendido</h2>
          <p>Fique de olho na vitrine — sempre pode aparecer coisa nova.</p>
        </div>
      ) : pagamento?.status === 'aprovado' ? (
        <div className="rifa-public-message rifa-public-success">
          <h2>Pagamento confirmado!</h2>
          <p>Enviamos o link pra baixar os arquivos no seu email. Confira tambem a caixa de spam.</p>
        </div>
      ) : pagamento?.status === 'pendente' ? (
        <div className="rifa-public-pix">
          <h2>Pague com Pix pra liberar o download</h2>
          {pagamento.qr_code_base64 ? (
            <img src={`data:image/png;base64,${pagamento.qr_code_base64}`} alt="QR Code Pix" className="solicitar-acesso-qr" />
          ) : (
            <QrCode size={64} />
          )}
          {pagamento.qr_code ? (
            <button
              type="button"
              className="mold-secondary-button"
              onClick={() => {
                void navigator.clipboard.writeText(pagamento.qr_code ?? '');
                setPixCopied(true);
                setTimeout(() => setPixCopied(false), 2000);
              }}
            >
              {pixCopied ? <Check size={16} /> : <Copy size={16} />}
              {pixCopied ? 'Copiado' : 'Copiar codigo Pix (copia e cola)'}
            </button>
          ) : null}
          <p className="bandeira-size-hint">
            <Loader2 size={14} className="mold-import-spinner" /> Aguardando confirmacao do pagamento...
          </p>
        </div>
      ) : pagamento?.status === 'rejeitado' ? (
        <div className="rifa-public-message">
          <p className="mold-import-error">O pagamento nao foi aprovado.</p>
          <button type="button" className="mold-save-button" onClick={() => setPagamento(null)}>
            Tentar novamente
          </button>
        </div>
      ) : (
        <form className="rifa-public-form" onSubmit={handleComprar}>
          <label className="auth-field">
            <span>Seu email *</span>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="voce@email.com" />
          </label>
          <p className="bandeira-size-hint">
            O link pra baixar os arquivos e enviado pra esse email assim que o Pix for aprovado.
          </p>

          {formError ? <p className="mold-import-error">{formError}</p> : null}

          <button type="submit" className="mold-save-button" disabled={submitting}>
            {submitting ? <Loader2 size={16} className="mold-import-spinner" /> : null}
            Comprar com Pix
          </button>
        </form>
      )}
    </div>
  );
}

export function LojaPublicPage() {
  const [produtos, setProdutos] = useState<LojaProdutoPublic[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<LojaProdutoPublic | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const response = await api.listLojaProdutosPublic();
      setProdutos(response.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Nao foi possivel carregar a loja.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (produtos === null && !error) {
    return (
      <div className="rifa-public-screen">
        <div className="rifa-public-loading">
          <Loader2 size={28} className="mold-import-spinner" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rifa-public-screen">
        <div className="rifa-public-card rifa-public-message">
          <h1>Loja</h1>
          <p>{error}</p>
        </div>
      </div>
    );
  }

  if (selected) {
    return (
      <div className="rifa-public-screen">
        <ProdutoDetail
          produto={selected}
          onBack={() => {
            setSelected(null);
            void load();
          }}
        />
      </div>
    );
  }

  return (
    <div className="rifa-public-screen">
      <div className="rifa-public-card">
        <h1>Loja</h1>
        <p className="rifa-public-desc">Produtos avulsos — cada um so pode ser comprado 1 vez, entao corre!</p>

        {produtos && produtos.length === 0 ? (
          <p className="bandeira-size-hint">Nenhum produto disponivel no momento.</p>
        ) : (
          <div className="rifa-card-grid">
            {produtos?.map((produto) => (
              <article key={produto.id} className="rifa-card solicitar-acesso-card">
                {produto.imagens[0] ? (
                  <img src={produto.imagens[0]} alt={produto.nome} />
                ) : (
                  <div className="rifa-card-foto-placeholder">
                    <ImagePlus size={24} opacity={0.4} />
                  </div>
                )}
                <h3>{produto.nome}</h3>
                <p className="solicitar-acesso-valor">{formatMoeda(produto.valor)}</p>
                {produto.status !== 'disponivel' ? (
                  <p className="bandeira-size-hint">{produto.status === 'vendido' ? 'Vendido' : 'Reservado'}</p>
                ) : null}
                <button
                  type="button"
                  className="mold-save-button"
                  onClick={() => setSelected(produto)}
                  disabled={produto.status === 'vendido'}
                >
                  {produto.status === 'vendido' ? 'Vendido' : 'Ver produto'}
                </button>
              </article>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
