import {
  Antenna,
  Bell,
  Box,
  Cookie,
  Drum,
  EyeOff,
  FilePlus2,
  Flag,
  FolderKanban,
  Hammer,
  KeyRound,
  LayoutGrid,
  MonitorSmartphone,
  PenTool,
  Printer,
  Settings,
  Shapes,
  Share2,
  ShoppingBasket,
  Ticket,
  Users,
  Wallet,
  Wrench,
  Mail,
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
    label: 'Plotar (Moldes Tacos)',
    icon: Printer,
    description: 'Geracao e envio de plotagem por tacos.',
  },
  {
    id: 'plotter-riscado',
    label: 'Plotar (Molde Riscado)',
    icon: PenTool,
    description: 'Lek no modo riscado.',
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
    id: 'acabamentos',
    label: 'Acabamentos',
    icon: Wrench,
    description: 'Ferramentas de acabamento: lanternagem, biscoito, cesto, pandeiro e antena.',
    children: [
      {
        id: 'acabamento-lanternagem-bojo',
        label: 'Lanternagem de Bojo',
        icon: Hammer,
        description: 'Acabamento de lanternagem do bojo do balao.',
      },
      {
        id: 'acabamento-biscoito-golfier',
        label: 'Biscoito de Golfier',
        icon: Cookie,
        description: 'Molde do biscoito de Golfier.',
      },
      {
        id: 'acabamento-cesto',
        label: 'Cesto',
        icon: ShoppingBasket,
        description: 'Molde e acabamento do cesto.',
      },
      {
        id: 'acabamento-pandeiro',
        label: 'Pandeiro',
        icon: Drum,
        description: 'Molde e acabamento do pandeiro.',
      },
      {
        id: 'acabamento-desenho-antena',
        label: 'Desenho de Antena',
        icon: Antenna,
        description: 'Desenho e medidas da antena.',
      },
    ],
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
        id: 'projetos-lanternagem-bojo',
        label: 'Lanternagem de Bojo',
        icon: Hammer,
        description: 'Projetos de lanternagem salvos como arquivo editavel (nao imagem).',
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
  {
    id: 'admin-notificacoes',
    label: 'Notificações',
    icon: Bell,
    description: 'Avisos de venda (push no celular) e histórico dos pagamentos confirmados.',
  },
  {
    id: 'admin-comunicacao',
    label: 'Comunicação',
    icon: Mail,
    description: 'Envie avisos aos clientes por e-mail e pop-up na tela.',
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

/** Itens que podem ser escondidos dos usuarios comuns pelo admin — sempre a
 * FOLHA final (ex.: "Galeria de Moldes" e "Adicionar sua Tabela de Molde"
 * aparecem separados, nao o grupo "Moldes" inteiro), pra dar controle fino
 * por tela. Se as duas folhas de um grupo ficarem escondidas, o grupo some
 * sozinho do menu (ver filterHiddenNavItems). Nunca inclui os itens
 * exclusivos do admin. */
export const hideableNavItems: NavItem[] = flattenNavItems([...mainNavItems, ...accountNavItems]);

/**
 * Grupos de aba que um PLANO pode liberar — granularidade mais grossa que o
 * menu (`mainNavItems`), porque o backend so consegue proteger por
 * prefixo/controller de API: "Galeria de Moldes" e "Adicionar sua Tabela"
 * dividem a mesma rota (/api/molds), assim como "Plotter Tacos" e "Meus
 * Projetos > Moldes Taqueados" (/api/projects). Ver AbaAccessMiddleware e
 * PlanoService::ALL_ABAS no backend — os ids aqui tem que bater exatamente.
 */
export interface PlanoAbaGroup {
  id: string;
  label: string;
  icon: LucideIcon;
  description: string;
}

export const PLANO_ABA_GROUPS: PlanoAbaGroup[] = [
  {
    id: 'moldes',
    label: 'Moldes',
    icon: Shapes,
    description: 'Galeria de Moldes + Adicionar sua Tabela de Molde.',
  },
  {
    id: 'plotter-tacos',
    label: 'Plotar (Moldes Tacos)',
    icon: Printer,
    description: 'Plotar de tacos + Meus Projetos > Moldes Taqueados.',
  },
  {
    id: 'plotter-riscado',
    label: 'Plotar (Molde Riscado)',
    icon: PenTool,
    description: 'Lek no modo riscado.',
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
    description: 'Modelos 3D e fotos do trabalho.',
  },
  {
    id: 'profissionais',
    label: 'Rifas',
    icon: Ticket,
    description: 'Criacao de rifas com link publico.',
  },
  {
    id: 'acabamentos',
    label: 'Acabamentos',
    icon: Wrench,
    description: 'Lanternagem de Bojo, Biscoito de Golfier, Cesto, Pandeiro e Desenho de Antena.',
  },
];

/** De qual grupo (PLANO_ABA_GROUPS) cada item SELECIONAVEL do menu depende —
 * usado pra saber se a aba atual esta bloqueada pelo plano do usuario (ver
 * UserArea.tsx). Ids que nao aparecem aqui (configuracoes, solicitar-acesso)
 * nunca ficam bloqueados por plano. */
export const PLANO_ABA_GROUP_BY_NAV_ID: Record<string, string> = {
  'moldes-galeria': 'moldes',
  'moldes-tabela': 'moldes',
  'plotter-tacos': 'plotter-tacos',
  'projetos-moldes-taqueados': 'plotter-tacos',
  'plotter-riscado': 'plotter-riscado',
  bandeiras: 'bandeiras',
  'painel-letreiros': 'painel-letreiros',
  '3d-fotos': '3d-fotos',
  profissionais: 'profissionais',
  'acabamento-lanternagem-bojo': 'acabamentos',
  'acabamento-biscoito-golfier': 'acabamentos',
  'acabamento-cesto': 'acabamentos',
  'acabamento-pandeiro': 'acabamentos',
  'acabamento-desenho-antena': 'acabamentos',
  'projetos-lanternagem-bojo': 'acabamentos',
};

export function flattenNavItems(items: NavItem[]): NavItem[] {
  return items.flatMap((item) => (item.children && item.children.length > 0 ? item.children : [item]));
}

/**
 * Esconder e sempre por folha (ver hideableNavItems) — usado tanto pra
 * montar o menu quanto pra tirar atalhos escondidos de outros lugares do
 * sistema (ex: o botao "Plotar Risco" na galeria, que pula direto pro
 * Plotter Riscado sem passar pelo menu).
 */
export function isNavItemHidden(id: string, hiddenIds: ReadonlySet<string>): boolean {
  return hiddenIds.has(id);
}

/**
 * Filtra um array de grupos/itens de nav tirando as folhas escondidas — se
 * TODAS as folhas de um grupo (ex.: "Moldes") ficarem escondidas, o grupo
 * inteiro some do menu (nao faz sentido mostrar uma seta pra abrir um grupo
 * vazio). Usado em UserArea pra montar visibleMainNavItems/visibleAccountNavItems.
 */
export function filterHiddenNavItems(items: NavItem[], hiddenIds: ReadonlySet<string>): NavItem[] {
  return items
    .filter((item) => !hiddenIds.has(item.id))
    .map((item) =>
      item.children ? { ...item, children: item.children.filter((child) => !hiddenIds.has(child.id)) } : item
    )
    .filter((item) => !item.children || item.children.length > 0);
}
