import type { ChangeEvent, Dispatch, SetStateAction } from 'react';

/**
 * Campos numericos controlados com um minimo (cores, espessura, tacos por
 * folha etc) nao podem forcar esse minimo a cada tecla digitada — senao o
 * campo fica preso nele e o usuario nunca consegue apagar tudo pra digitar
 * outro numero (trava sobretudo no teclado numerico do celular, onde apagar
 * o ultimo digito faz o campo "pular" de volta pro minimo). O minimo so e
 * aplicado ao sair do campo (blur); durante a digitacao ele aceita ficar
 * vazio — representado aqui por 0, que nunca e um valor real valido pra
 * nenhum desses campos.
 */
export function numericFieldProps(
  value: number,
  setValue: Dispatch<SetStateAction<number>>,
  min: number
): {
  value: number | string;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onBlur: () => void;
} {
  return {
    value: value === 0 ? '' : value,
    onChange: (event: ChangeEvent<HTMLInputElement>) => {
      const raw = event.target.value;
      setValue(raw === '' ? 0 : Math.max(0, Number(raw) || 0));
    },
    onBlur: () => setValue((current) => (current < min ? min : current)),
  };
}
