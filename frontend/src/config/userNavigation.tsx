import {
  Box,
  EyeOff,
  FilePlus2,
  Flag,
  FolderKanban,
  KeyRound,
  LayoutGrid,
  MonitorSmartphone,
  PenTool,
  Printer,
  Settings,
  Shapes,
  Share2,
  Ticket,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  id: string;
  label: string;
  icon: LucideIcon;
  description: string;
  children?: NavItem[];
}

export const mainNavItems: NavItem[] = [
  {
    id: 'moldes',
    label: 'Moldes',
    icon: Shapes,
    description: 'Catalogo de moldes e cadastro da sua propria tabela.',
    children: [
      {
        id: 'moldes-galeria',
        label: 'Galeria de Moldes',
        icon: LayoutGrid,
        description: 'Catalogo de moldes organizado por categoria.',
      },
      {
        id: 'moldes-tabela',
        label: 'Adicionar sua Tabela de Molde',
        icon: FilePlus2,
        description: 'Cadastre as medidas e a tabela de pontos do seu proprio molde.',
      },
    ],
  },
  {
    id: 'plotter-tacos',
    label: 'Plotter (Moldes Tacos)',
    icon: Printer,
    description: 'Geracao e envio de plotagem por tacos.',
  },
  {
    id: 'plotter-riscado',
    label: 'Plotter (Molde Riscado)',
    icon: PenTool,
    description: 'Geracao e envio de plotagem no modo riscado.',
  },
  {
    id: 'bandeiras',
    label: 'Bandeiras (Tacos)',
    icon: Flag,
    description: 'Modulo de bandeiras pixeladas por taco.',
  },
  {
    id: 'painel-letreiros',
    label: 'Painel e Letreiros',
    icon: MonitorSmartphone,
    description: 'Criacao de paineis e letreiros luminosos.',
  },
  {
    id: '3d-fotos',
    label: '3D e Fotos',
    icon: Box,
    description: 'Modelos 3D e fotos do seu trabalho.',
  },
  {
    id: 'profissionais',
    label: 'Rifas',
    icon: Ticket,
    description: 'Crie rifas com link publico pros seus clientes comprarem numeros.',
  },
  {
    id: 'meus-projetos',
    label: 'Meus Projetos',
    icon: FolderKanban,
    description: 'Projetos salvos e historico de trabalhos.',
    children: [
      {
        id: 'projetos-moldes-taqueados',
        label: 'Moldes Taqueados',
        icon: Printer,
        description: 'Moldes ja plotados no modo tacos.',
      },
      {
        id: 'projetos-moldes-riscados',
        label: 'Moldes Riscados',
        icon: PenTool,
        description: 'Moldes ja plotados no modo riscado.',
      },
    ],
  },
];

export const accountNavItems: NavItem[] = [
  {
    id: 'configuracoes',
    label: 'Configuracoes do Usuario',
    icon: Settings,
    description: 'Dados da conta e troca de senha.',
  },
];

export const adminNavItems: NavItem[] = [
  {
    id: 'admin-usuarios',
    label: 'Usuarios',
    icon: Users,
    description: 'Todos os usuarios cadastrados no sistema.',
  },
  {
    id: 'admin-redes-sociais',
    label: 'Redes Sociais',
    icon: Share2,
    description: 'Telegram, Instagram e WhatsApp mostrados no rodape do sistema.',
  },
  {
    id: 'admin-abas',
    label: 'Abas',
    icon: EyeOff,
    description: 'Escolha quais abas do menu ficam visiveis pros usuarios.',
  },
  {
    id: 'admin-plano',
    label: 'Plano',
    icon: Wallet,
    description: 'Credenciais do Mercado Pago e os planos pagos (valor e dias de acesso).',
  },
];

/** So aparece pra quem nao tem plano pago ativo (ver hasPaidAccess em
 * lib/access.ts) — nao faz parte de mainNavItems/accountNavItems porque nao
 * e um item "escondivel" pelo admin, e sim condicional ao status de
 * pagamento de cada usuario. */
export const solicitarAcessoNavItem: NavItem = {
  id: 'solicitar-acesso',
  label: 'Solicitar Acesso',
  icon: KeyRound,
  description: 'Escolha um plano e pague pra liberar o acesso ao sistema.',
};

/** Itens de nivel superior que podem ser escondidos dos usuarios comuns pelo
 * admin — mesma granularidade do menu (esconder um grupo esconde os filhos
 * dele junto). Nunca inclui os itens exclusivos do admin. */
export const hideableNavItems: NavItem[] = [...mainNavItems, ...accountNavItems];

export function flattenNavItems(items: NavItem[]): NavItem[] {
  return items.flatMap((item) => (item.children && item.children.length > 0 ? item.children : [item]));
}

/**
 * Um id conta como escondido se ele mesmo estiver na lista, OU se for filho
 * de um grupo escondido (esconder "Moldes" esconde "Galeria de Moldes" e
 * "Adicionar sua Tabela de Molde" junto). Usado tanto pra montar o menu
 * quanto pra tirar atalhos escondidos de outros lugares do sistema (ex: o
 * botao "Plotar Risco" na galeria, que pula direto pro Plotter Riscado sem
 * passar pelo menu).
 */
export function isNavItemHidden(id: string, hiddenTopLevelIds: ReadonlySet<string>): boolean {
  if (hiddenTopLevelIds.has(id)) {
    return true;
  }
  return hideableNavItems.some(
    (item) => hiddenTopLevelIds.has(item.id) && (item.children ?? []).some((child) => child.id === id)
  );
}
