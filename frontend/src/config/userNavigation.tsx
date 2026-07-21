import {
  Box,
  Download,
  FilePlus2,
  Flag,
  FolderKanban,
  LayoutGrid,
  MonitorSmartphone,
  PenTool,
  Printer,
  Settings,
  Shapes,
  Ticket,
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
  {
    id: 'baixar-app',
    label: 'Baixar App',
    icon: Download,
    description: 'Instale o sistema como app no computador ou celular.',
  },
];

export function flattenNavItems(items: NavItem[]): NavItem[] {
  return items.flatMap((item) => (item.children && item.children.length > 0 ? item.children : [item]));
}
