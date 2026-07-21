import { useMemo } from 'react';

export type NumeroCellStatus = 'disponivel' | 'reservado' | 'vendido' | 'meu';

export interface NumeroCellState {
  status: NumeroCellStatus;
  /** Tooltip — ex: nome do comprador (so faz sentido no painel do dono). */
  label?: string;
}

/** Acima disso a grade nao renderiza mais (rifa gigante travaria o navegador
 * com um botao por numero) — quem precisar de tudo usa a busca em vez da grade. */
const MAX_GRID_RENDER = 5000;

export function NumeroGrid({
  total,
  getState,
  selecionados,
  onToggle,
  highlightNumero,
}: {
  total: number;
  getState: (numero: number) => NumeroCellState;
  selecionados: Set<number>;
  onToggle?: (numero: number) => void;
  highlightNumero?: number | null;
}) {
  const cappedTotal = Math.min(total, MAX_GRID_RENDER);
  const numeros = useMemo(() => Array.from({ length: cappedTotal }, (_, i) => i + 1), [cappedTotal]);

  return (
    <div>
      <div className="rifa-numero-grid">
        {numeros.map((n) => {
          const state = getState(n);
          const clickable = state.status === 'disponivel' && Boolean(onToggle);
          const selected = selecionados.has(n);
          return (
            <button
              key={n}
              type="button"
              title={state.label}
              className={[
                'rifa-numero-cell',
                `rifa-numero-${state.status}`,
                selected ? 'selected' : '',
                n === highlightNumero ? 'highlight' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              onClick={clickable ? () => onToggle?.(n) : undefined}
              disabled={!clickable}
            >
              {n}
            </button>
          );
        })}
      </div>
      {total > cappedTotal ? (
        <p className="bandeira-size-hint">
          Mostrando so os primeiros {cappedTotal} numeros — rifa grande demais pra mostrar todos na grade. Use a busca.
        </p>
      ) : null}
    </div>
  );
}
