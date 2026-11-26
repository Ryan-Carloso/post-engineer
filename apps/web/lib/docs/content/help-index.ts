import type { DocPage } from '../types';

export const helpIndex: DocPage = {
  section: 'help',
  slug: null,
  title: { pt: 'Ajuda', en: 'Help' },
  description: {
    pt: 'Guias para usar o Post Engineer: primeiros passos, tokens e contas conectadas.',
    en: 'Guides for using Post Engineer: first steps, tokens and connected accounts.',
  },
  updatedAt: '2026-11-26',
  contentHash: '43d8e6dc9288d10e0bc3b172bdb0278ba2e2fd2f08a5adf8231f902e2abc1551',
  blocks: [
    {
      kind: 'paragraph',
      text: {
        pt: 'Estes guias explicam como usar o Post Engineer: criar sua persona, entender os custos e ligar suas contas para publicar.',
        en: 'These guides explain how to use Post Engineer: create your persona, understand the costs and connect your accounts to publish.',
      },
    },
    {
      kind: 'link',
      href: { pt: '/help/primeiros-passos', en: '/en/help/primeiros-passos' },
      text: { pt: 'Primeiros passos', en: 'First steps' },
    },
    {
      kind: 'link',
      href: { pt: '/help/tokens', en: '/en/help/tokens' },
      text: { pt: 'Tokens', en: 'Tokens' },
    },
    {
      kind: 'link',
      href: { pt: '/help/conectar-contas', en: '/en/help/conectar-contas' },
      text: { pt: 'Conectar contas', en: 'Connect accounts' },
    },
  ],
};
