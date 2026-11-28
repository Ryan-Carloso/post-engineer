import type { DocPage } from '../types';

export const helpIndex: DocPage = {
  section: 'help',
  slug: null,
  title: { pt: 'Ajuda', en: 'Help' },
  description: {
    pt: 'Guias para usar o Post Engineer: primeiros passos e contas conectadas.',
    en: 'Guides for using Post Engineer: first steps and connected accounts.',
  },
  updatedAt: '2026-11-28',
  contentHash: '001853066c5f0c73a235c18d66dd7c4c7bd96a553f667354f089bba52b021f60',
  blocks: [
    {
      kind: 'paragraph',
      text: {
        pt: 'Estes guias explicam como usar o Post Engineer: criar sua persona, enviar sua mídia e ligar suas contas para publicar. O beta é fechado e grátis: peça acesso no Discord.',
        en: 'These guides explain how to use Post Engineer: create your persona, upload your media and connect your accounts to publish. The beta is closed and free: request access on Discord.',
      },
    },
    {
      kind: 'link',
      href: { pt: '/help/primeiros-passos', en: '/en/help/primeiros-passos' },
      text: { pt: 'Primeiros passos', en: 'First steps' },
    },
    {
      kind: 'link',
      href: { pt: '/help/conectar-contas', en: '/en/help/conectar-contas' },
      text: { pt: 'Conectar contas', en: 'Connect accounts' },
    },
  ],
};
