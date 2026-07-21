import { colorDistance } from './colorMath';

export interface BandeiraCatalogColor {
  name: string;
  hex: string;
}

/** Catalogo de cores nomeadas em portugues, pra rotular a cor mais proxima de
 * cada tom detectado na imagem (ex: relatorio "Azul Royal - 3821 pixels"). */
export const BANDEIRA_COLOR_CATALOG: BandeiraCatalogColor[] = [
  { name: 'Branco', hex: '#ffffff' },
  { name: 'Branco Neve', hex: '#fffafa' },
  { name: 'Branco Fantasma', hex: '#f8f8ff' },
  { name: 'Gelo', hex: '#f0ffff' },
  { name: 'Preto', hex: '#000000' },
  { name: 'Preto Suave', hex: '#0a0a0a' },
  { name: 'Preto Grafite', hex: '#1c1c1c' },
  { name: 'Preto Carvao', hex: '#111111' },
  { name: 'Cinza Claro', hex: '#d3d3d3' },
  { name: 'Cinza', hex: '#808080' },
  { name: 'Cinza Escuro', hex: '#505050' },
  { name: 'Cinza Chumbo', hex: '#2f4f4f' },
  { name: 'Cinza Prata', hex: '#c0c0c0' },
  { name: 'Cinza Azulado', hex: '#454a5b' },
  { name: 'Cinza Clarissimo', hex: '#dadada' },
  { name: 'Vermelho', hex: '#ff0000' },
  { name: 'Vermelho Escuro', hex: '#8b0000' },
  { name: 'Vermelho Vinho', hex: '#800000' },
  { name: 'Vermelho Cereja', hex: '#de3163' },
  { name: 'Vermelho Sangue', hex: '#7f0000' },
  { name: 'Vermelho Rosa', hex: '#ff4d6d' },
  { name: 'Vermelho Tomate', hex: '#ff6347' },
  { name: 'Vermelho Rubi', hex: '#e0115f' },
  { name: 'Rosa', hex: '#ff69b4' },
  { name: 'Rosa Claro', hex: '#ffb6c1' },
  { name: 'Rosa Pink', hex: '#ff1493' },
  { name: 'Rosa Bebe', hex: '#ffc0cb' },
  { name: 'Rosa Choque', hex: '#ff007f' },
  { name: 'Rosa Salmao', hex: '#ff8c69' },
  { name: 'Rosa Goiaba', hex: '#ff7e7e' },
  { name: 'Magenta', hex: '#ff00ff' },
  { name: 'Magenta Escuro', hex: '#8b008b' },
  { name: 'Roxo', hex: '#800080' },
  { name: 'Roxo Claro', hex: '#9370db' },
  { name: 'Roxo Escuro', hex: '#4b0082' },
  { name: 'Roxo Violeta', hex: '#8a2be2' },
  { name: 'Roxo Lavanda', hex: '#e6e6fa' },
  { name: 'Roxo Ametista', hex: '#9966cc' },
  { name: 'Azul', hex: '#0000ff' },
  { name: 'Azul Claro', hex: '#87cefa' },
  { name: 'Azul Bebe', hex: '#bfefff' },
  { name: 'Azul Ceu', hex: '#00bfff' },
  { name: 'Azul Turquesa', hex: '#40e0d0' },
  { name: 'Azul Marinho', hex: '#000080' },
  { name: 'Azul Petroleo', hex: '#003f5c' },
  { name: 'Azul Royal', hex: '#4169e1' },
  { name: 'Azul Escuro', hex: '#00008b' },
  { name: 'Azul Eletrico', hex: '#7df9ff' },
  { name: 'Azul Anil', hex: '#1f75fe' },
  { name: 'Azul Pastel', hex: '#aec6cf' },
  { name: 'Verde', hex: '#008000' },
  { name: 'Verde Claro', hex: '#90ee90' },
  { name: 'Verde Limao', hex: '#32cd32' },
  { name: 'Verde Fluorescente', hex: '#39ff14' },
  { name: 'Verde Musgo', hex: '#556b2f' },
  { name: 'Verde Oliva', hex: '#6b8e23' },
  { name: 'Verde Esmeralda', hex: '#50c878' },
  { name: 'Verde Agua', hex: '#00fa9a' },
  { name: 'Verde Bandeira', hex: '#009b3a' },
  { name: 'Verde Escuro', hex: '#006400' },
  { name: 'Verde Tiffany', hex: '#0abab5' },
  { name: 'Verde Neon', hex: '#66ff00' },
  { name: 'Amarelo', hex: '#ffff00' },
  { name: 'Amarelo Claro', hex: '#ffffe0' },
  { name: 'Amarelo Ouro', hex: '#ffd700' },
  { name: 'Amarelo Mostarda', hex: '#ffdb58' },
  { name: 'Amarelo Gema', hex: '#ffcc00' },
  { name: 'Amarelo Canario', hex: '#ffff99' },
  { name: 'Amarelo Neon', hex: '#fff700' },
  { name: 'Laranja', hex: '#ffa500' },
  { name: 'Laranja Escuro', hex: '#ff8c00' },
  { name: 'Laranja Queimado', hex: '#cc5500' },
  { name: 'Laranja Claro', hex: '#ffb347' },
  { name: 'Laranja Neon', hex: '#ff5f1f' },
  { name: 'Laranja Salmao', hex: '#fa8072' },
  { name: 'Marrom', hex: '#8b4513' },
  { name: 'Marrom Claro', hex: '#a0522d' },
  { name: 'Marrom Escuro', hex: '#5c4033' },
  { name: 'Marrom Cafe', hex: '#4b3621' },
  { name: 'Marrom Chocolate', hex: '#7b3f00' },
  { name: 'Marrom Caramelo', hex: '#af6e4d' },
  { name: 'Marrom Areia', hex: '#c2b280' },
  { name: 'Bege', hex: '#f5f5dc' },
  { name: 'Creme', hex: '#fffdd0' },
  { name: 'Palha', hex: '#f0e68c' },
  { name: 'Areia', hex: '#c2b280' },
  { name: 'Bege Amarelado', hex: '#fcce9e' },
  { name: 'Doce de Leite', hex: '#edad75' },
  { name: 'Vinho', hex: '#722f37' },
  { name: 'Marsala', hex: '#964f4c' },
  { name: 'Marsala Escuro', hex: '#7b3f3f' },
  { name: 'Turquesa', hex: '#40e0d0' },
  { name: 'Ciano', hex: '#00ffff' },
  { name: 'Dourado', hex: '#ffd700' },
  { name: 'Ouro Velho', hex: '#cfb53b' },
  { name: 'Bronze', hex: '#cd7f32' },
];

export function findClosestCatalogColor(hex: string): BandeiraCatalogColor {
  let best = BANDEIRA_COLOR_CATALOG[0];
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const entry of BANDEIRA_COLOR_CATALOG) {
    const distance = colorDistance(hex, entry.hex);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = entry;
    }
  }

  return best;
}
