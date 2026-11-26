import type { DocPage } from '../types';

export const helpIndex: DocPage = {
  section: 'help',
  slug: null,
  title: { pt: 'Ajuda', en: 'Help' },
  description: {
    pt: 'Guias para usar o Post Engineer: primeiros passos e contas conectadas.',
    en: 'Guides for using Post Engineer: first steps and connected accounts.',
  },
  updatedAt: '2026-11-26',
  contentHash: '997c4da5f9219e30a9c6556426f1c36e25da1d7c34a070f90e582f5454ca14ef',
  blocks: [
    {
      kind: 'paragraph',
      text: {
        pt: 'Estes guias explicam como usar o Post Engineer: criar sua persona, enviar sua mídia e ligar suas contas para publicar. Toda conta nova tem 7 dias grátis.',
        en: 'These guides explain how to use Post Engineer: create your persona, upload your media and connect your accounts to publish. Every new account gets a 7-day free trial.',
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
