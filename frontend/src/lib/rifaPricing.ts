import type { RifaPromocao } from '../types';

/**
 * Espelha EXATAMENTE `RifaPromocaoService::calcularValorTotal` do backend —
 * so pra mostrar o preco ao vivo enquanto o cliente seleciona numeros. O
 * preco de verdade (o que realmente e cobrado) e sempre recalculado no
 * servidor na hora de reservar, nunca confia nesse calculo do navegador.
 */
export function calcularValorTotal(promocoes: RifaPromocao[], valorBase: number, quantidade: number): number {
  const ativas = promocoes.filter((p) => p.ativo);

  const pacoteExato = ativas.find((p) => p.tipo === 'pacote' && p.quantidade === quantidade);
  if (pacoteExato && pacoteExato.valor_total !== null) {
    return round2(pacoteExato.valor_total);
  }

  let melhorUnidade: number | null = null;
  for (const p of ativas) {
    if (p.tipo === 'faixa' && quantidade >= p.quantidade && p.valor_unidade !== null) {
      if (melhorUnidade === null || p.valor_unidade < melhorUnidade) {
        melhorUnidade = p.valor_unidade;
      }
    }
  }
  if (melhorUnidade !== null) {
    return round2(melhorUnidade * quantidade);
  }

  return round2(valorBase * quantidade);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
