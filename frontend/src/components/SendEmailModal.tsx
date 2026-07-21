import { useState, type FormEvent } from 'react';
import { CheckCircle2, Loader2, Send, X } from 'lucide-react';
import { buildMoldPdf } from '../lib/moldPdf';
import { ApiError, sendProjectEmail } from '../lib/api';
import { slugifyFilename } from '../lib/pdfExport';
import { useAuth } from '../lib/auth';
import type { MoldProjectSummary } from '../types';

interface SendEmailModalProps {
  project: MoldProjectSummary;
  onClose: () => void;
}

export function SendEmailModal({ project, onClose }: SendEmailModalProps) {
  const { token } = useAuth();
  const [clientEmail, setClientEmail] = useState('');
  const [clientName, setClientName] = useState('');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!token || sending) {
      return;
    }

    const email = clientEmail.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError('Informe um e-mail valido do cliente.');
      return;
    }

    setSending(true);
    setError(null);

    try {
      const blob = buildMoldPdf({
        nome: project.nome,
        modelo: project.modelo,
        quantidadeGomos: project.quantidade_gomos,
        bainhaCm: project.bainha_cm,
        alturaTotalCm: project.altura_total_cm,
        pontos: project.pontos,
        plotterConfig: project.plotter_config,
        mode: 'pieces',
        clientName: clientName.trim() || undefined,
        message: message.trim() || undefined,
      });
      const filename = `${slugifyFilename(project.display_nome)}.pdf`;

      const formData = new FormData();
      formData.append('client_email', email);
      formData.append('client_name', clientName.trim());
      formData.append('message', message.trim());
      formData.append('pdf', blob, filename);

      await sendProjectEmail(project.id, formData, token);
      setSuccess(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Nao foi possivel enviar o email.');
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="pieces-modal-backdrop" onClick={onClose}>
      <div className="pieces-modal email-modal" onClick={(event) => event.stopPropagation()}>
        <div className="pieces-modal-header">
          <div>
            <h2>Enviar por email — {project.display_nome}</h2>
            <p>O cliente recebe um PDF organizado com nome, modelo, tamanho e a quantidade de tacos de cada parte.</p>
          </div>
          <button type="button" className="pieces-modal-close" onClick={onClose} aria-label="Fechar">
            <X size={20} />
          </button>
        </div>

        {success ? (
          <div className="email-success">
            <CheckCircle2 size={30} />
            <strong>Email enviado!</strong>
            <span>Enviado para {clientEmail}.</span>
            <button type="button" className="mold-save-button" onClick={onClose}>
              Fechar
            </button>
          </div>
        ) : (
          <form className="email-form" onSubmit={(event) => void handleSubmit(event)}>
            <label className="auth-field">
              <span>Email do cliente *</span>
              <input
                type="email"
                required
                value={clientEmail}
                onChange={(event) => setClientEmail(event.target.value)}
                disabled={sending}
                placeholder="cliente@exemplo.com"
              />
            </label>

            <label className="auth-field">
              <span>Nome do cliente</span>
              <input
                type="text"
                value={clientName}
                onChange={(event) => setClientName(event.target.value)}
                disabled={sending}
                placeholder="Opcional"
              />
            </label>

            <label className="auth-field">
              <span>Mensagem (opcional)</span>
              <textarea
                rows={3}
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                disabled={sending}
                placeholder="Escreva algo pro cliente, se quiser"
              />
            </label>

            {error ? <p className="mold-import-error">{error}</p> : null}

            <button type="submit" className="mold-save-button" disabled={sending}>
              {sending ? <Loader2 size={16} className="mold-import-spinner" /> : <Send size={16} />}
              {sending ? 'Enviando...' : 'Enviar para o cliente'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
