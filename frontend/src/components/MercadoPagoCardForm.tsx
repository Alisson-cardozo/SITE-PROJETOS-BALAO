import { useEffect, useRef, useState } from 'react';
import { CreditCard, Loader2, Lock, ShieldCheck } from 'lucide-react';
import { api, ApiError } from '../lib/api';
import type { Pagamento, UserStatus } from '../types';

/** Ate 4x (decisao de produto). O backend tambem blinda esse limite. */
const MAX_INSTALLMENTS = 4;
/** O Mercado Pago nao aceita cartao para valores abaixo de R$ 0,50. */
const MIN_CARD_AMOUNT = 0.5;
const DEVICE_ID_WAIT_MS = 2500;

interface CardUser {
  status: UserStatus;
  access_expires_at: string | null;
}

interface MercadoPagoCardFormProps {
  publicKey: string;
  planoId: number;
  /** Valor do plano em reais (ex.: 110.0). */
  valor: number;
  authToken: string;
  onSuccess: (pagamento: Pagamento, user: CardUser | null) => void;
  onCancel: () => void;
}

interface MpField {
  mount: (containerId: string) => void;
  unmount: () => void;
  on: (event: string, cb: (data: unknown) => void) => void;
}

interface MpPayerCost {
  installments: number;
  recommended_message: string;
  installment_amount: number;
  total_amount: number;
}

interface MpInstance {
  fields: {
    create: (type: string, opts?: object) => MpField;
    createCardToken: (data: {
      cardholderName?: string;
      identificationType?: string;
      identificationNumber?: string;
    }) => Promise<{ id: string } | null>;
  };
  getPaymentMethods: (opts: { bin: string }) => Promise<{
    results: Array<{ id: string; issuer?: { id?: number } }>;
  }>;
  getInstallments: (opts: { amount: string; bin: string }) => Promise<
    Array<{ payer_costs?: MpPayerCost[] }>
  >;
}

declare global {
  interface Window {
    MP_DEVICE_SESSION_ID?: string;
    MercadoPago?: new (key: string, options: { locale: string }) => MpInstance;
  }
}

function waitForDeviceId(timeoutMs = DEVICE_ID_WAIT_MS): Promise<string> {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const read = () => {
      const deviceId = window.MP_DEVICE_SESSION_ID?.trim();
      if (deviceId || Date.now() - startedAt >= timeoutMs) {
        resolve(deviceId || '');
        return;
      }
      window.setTimeout(read, 100);
    };
    read();
  });
}

function formatCpf(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 11);
  return digits
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d{1,2})$/, '$1-$2');
}

function formatMoeda(valor: number): string {
  return valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

// Estilo dos campos seguros do MP (iframe) pra casar com o tema escuro do app.
const MP_FIELD_STYLE = {
  customization: {
    visual: {
      style: {
        color: '#e6edf5',
        placeholderColor: '#5a6b85',
        fontFamily: 'inherit',
        fontSize: '15px',
      },
    },
  },
};

export function MercadoPagoCardForm({
  publicKey,
  planoId,
  valor,
  authToken,
  onSuccess,
  onCancel,
}: MercadoPagoCardFormProps) {
  const [sdkReady, setSdkReady] = useState(false);
  const [fieldsReady, setFieldsReady] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cardholderName, setCardholderName] = useState('');
  const [cpf, setCpf] = useState('');
  const [paymentMethodId, setPaymentMethodId] = useState<string | null>(null);
  const [issuerId, setIssuerId] = useState<number | null>(null);
  const [installmentOptions, setInstallmentOptions] = useState<MpPayerCost[]>([]);
  const [selectedInstallments, setSelectedInstallments] = useState(1);

  const mpRef = useRef<MpInstance | null>(null);
  const mountedRef = useRef(false);
  const onSuccessRef = useRef(onSuccess);
  useEffect(() => {
    onSuccessRef.current = onSuccess;
  }, [onSuccess]);

  const amountTooLow = valor < MIN_CARD_AMOUNT;

  // Carrega o SDK v2 do Mercado Pago.
  useEffect(() => {
    if (amountTooLow || typeof window === 'undefined') return;
    if (window.MercadoPago) {
      setSdkReady(true);
      return;
    }
    const existing = document.getElementById('mp-sdk-v2');
    if (existing) {
      existing.addEventListener('load', () => setSdkReady(true), { once: true });
      return;
    }
    const script = document.createElement('script');
    script.id = 'mp-sdk-v2';
    script.src = 'https://sdk.mercadopago.com/js/v2';
    script.onload = () => setSdkReady(true);
    script.onerror = () =>
      setError('Não foi possível carregar o Mercado Pago. Verifique a conexão e tente novamente.');
    document.head.appendChild(script);
  }, [amountTooLow]);

  // Carrega o security.js (gera o device fingerprint antifraude em MP_DEVICE_SESSION_ID).
  useEffect(() => {
    if (amountTooLow || typeof window === 'undefined') return;
    if (document.getElementById('mp-security-checkout')) return;
    const script = document.createElement('script');
    script.id = 'mp-security-checkout';
    script.src = 'https://www.mercadopago.com/v2/security.js';
    script.setAttribute('view', 'checkout');
    script.setAttribute('output', 'MP_DEVICE_SESSION_ID');
    document.head.appendChild(script);
  }, [amountTooLow]);

  // Monta os campos seguros (numero/validade/cvv) — os dados nunca tocam o React.
  useEffect(() => {
    if (!sdkReady || mountedRef.current || amountTooLow || !window.MercadoPago) return;
    mountedRef.current = true;

    const mp = new window.MercadoPago(publicKey, { locale: 'pt-BR' });
    mpRef.current = mp;

    const cardNumber = mp.fields.create('cardNumber', {
      placeholder: '0000 0000 0000 0000',
      ...MP_FIELD_STYLE,
    });
    cardNumber.on('binChange', async (evt) => {
      const bin = (evt as { bin?: string }).bin;
      if (!bin || bin.length < 6) {
        setPaymentMethodId(null);
        setIssuerId(null);
        setInstallmentOptions([]);
        setSelectedInstallments(1);
        return;
      }
      try {
        const methods = await mp.getPaymentMethods({ bin });
        const method = methods.results[0];
        if (method) {
          setPaymentMethodId(method.id);
          setIssuerId(method.issuer?.id ?? null);
        }
      } catch {
        /* best-effort: sem bandeira o submit avisa */
      }
      try {
        const options = await mp.getInstallments({ amount: valor.toFixed(2), bin });
        const payerCosts = (options[0]?.payer_costs ?? []).filter(
          (c) => c.installments >= 1 && c.installments <= MAX_INSTALLMENTS
        );
        setInstallmentOptions(payerCosts);
        setSelectedInstallments(payerCosts[0]?.installments ?? 1);
      } catch {
        setInstallmentOptions([]);
        setSelectedInstallments(1);
      }
    });
    cardNumber.mount('mp-form-card-number');

    const expirationDate = mp.fields.create('expirationDate', {
      placeholder: 'MM/AA',
      ...MP_FIELD_STYLE,
    });
    expirationDate.mount('mp-form-expiration-date');

    const securityCode = mp.fields.create('securityCode', { placeholder: 'CVV', ...MP_FIELD_STYLE });
    securityCode.mount('mp-form-security-code');

    setFieldsReady(true);

    return () => {
      cardNumber.unmount();
      expirationDate.unmount();
      securityCode.unmount();
      mountedRef.current = false;
      mpRef.current = null;
      setFieldsReady(false);
    };
  }, [amountTooLow, publicKey, sdkReady, valor]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting || !mpRef.current) return;

    setSubmitting(true);
    setError(null);

    try {
      const deviceId = await waitForDeviceId();
      if (!cardholderName.trim()) throw new Error('Informe o nome impresso no cartão.');
      const cpfDigits = cpf.replace(/\D/g, '');
      if (cpfDigits.length !== 11) throw new Error('Informe um CPF válido (11 dígitos).');
      if (!paymentMethodId) throw new Error('Número do cartão inválido ou bandeira não reconhecida.');

      const tokenData = {
        cardholderName: cardholderName.trim(),
        identificationType: 'CPF',
        identificationNumber: cpfDigits,
      };

      const token = await mpRef.current.fields.createCardToken(tokenData);
      if (!token?.id) {
        throw new Error('Não foi possível validar o cartão. Confira os dados e tente novamente.');
      }

      const response = await api.createPagamentoCartao(
        {
          plano_id: planoId,
          token: token.id,
          payment_method_id: paymentMethodId,
          installments: selectedInstallments,
          issuer_id: issuerId,
          device_id: deviceId || null,
          identification: { type: 'CPF', number: cpfDigits },
        },
        authToken
      );

      if (response.data.status === 'rejeitado') {
        throw new Error('Pagamento recusado. Verifique os dados do cartão ou tente outro.');
      }

      onSuccessRef.current(response.data, response.user);
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Erro ao processar o pagamento.';
      setError(message);
      setSubmitting(false);
    }
  };

  if (amountTooLow) {
    return (
      <div className="bandeira-create-panel">
        <p className="mold-import-error">
          O Mercado Pago não permite pagamento por cartão para valores abaixo de {formatMoeda(MIN_CARD_AMOUNT)}.
        </p>
        <button type="button" className="mold-secondary-button" onClick={onCancel}>
          Voltar
        </button>
      </div>
    );
  }

  return (
    <div className="bandeira-create-panel mp-card-panel">
      <div className="mp-card-header">
        <CreditCard size={20} />
        <h3>Pagar com cartão de crédito</h3>
      </div>

      <div className="mp-card-secure">
        <ShieldCheck size={18} className="mp-card-secure-icon" />
        <p>
          Pagamento <strong>100% seguro</strong> processado pelo Mercado Pago. Os dados do seu cartão são
          criptografados e enviados direto ao Mercado Pago — <strong>nenhum dado do cartão fica salvo</strong> em
          nossos servidores.
        </p>
      </div>

      {(!sdkReady || !fieldsReady) && (
        <p className="bandeira-size-hint">
          <Loader2 size={14} className="mold-import-spinner" /> Carregando formulário seguro...
        </p>
      )}

      <form
        onSubmit={handleSubmit}
        className={!fieldsReady ? 'mp-card-form mp-card-form-hidden' : 'mp-card-form'}
      >
        <label className="auth-field">
          <span>Número do cartão</span>
          <div id="mp-form-card-number" className="mp-card-field" />
        </label>

        <div className="mp-card-row">
          <label className="auth-field">
            <span>Validade</span>
            <div id="mp-form-expiration-date" className="mp-card-field" />
          </label>
          <label className="auth-field">
            <span>CVV</span>
            <div id="mp-form-security-code" className="mp-card-field" />
          </label>
        </div>

        <label className="auth-field">
          <span>Nome impresso no cartão</span>
          <input
            type="text"
            value={cardholderName}
            onChange={(e) => setCardholderName(e.target.value.toUpperCase())}
            placeholder="NOME COMPLETO"
            autoComplete="cc-name"
            disabled={submitting}
          />
        </label>

        <label className="auth-field">
          <span>CPF do titular</span>
          <input
            type="text"
            value={cpf}
            onChange={(e) => setCpf(formatCpf(e.target.value))}
            placeholder="000.000.000-00"
            inputMode="numeric"
            autoComplete="off"
            disabled={submitting}
          />
        </label>

        <label className="auth-field">
          <span>Parcelas</span>
          <select
            value={selectedInstallments}
            onChange={(e) => setSelectedInstallments(Number(e.target.value))}
            disabled={submitting || installmentOptions.length === 0}
          >
            {installmentOptions.length === 0 ? (
              <option value={1}>{`1x de ${formatMoeda(valor)} sem juros`}</option>
            ) : (
              installmentOptions.map((c) => (
                <option key={c.installments} value={c.installments}>
                  {c.recommended_message}
                </option>
              ))
            )}
          </select>
        </label>

        {error ? <p className="mold-import-error">{error}</p> : null}

        <button type="submit" className="mold-save-button" disabled={submitting || !fieldsReady}>
          {submitting ? (
            <>
              <Loader2 size={16} className="mold-import-spinner" /> Processando pagamento...
            </>
          ) : (
            <>
              <Lock size={16} /> Pagar {formatMoeda(valor)}
            </>
          )}
        </button>

        <button
          type="button"
          className="mold-secondary-button rifa-recusar-button"
          onClick={onCancel}
          disabled={submitting}
        >
          Cancelar
        </button>
      </form>
    </div>
  );
}
