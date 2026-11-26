import type { DocPage } from '../types';

export const helpTokens: DocPage = {
  section: 'help',
  slug: 'tokens',
  title: { pt: 'Tokens', en: 'Tokens' },
  description: {
    pt: 'Quanto custa cada vídeo e como funciona o saldo de tokens.',
    en: 'What each video costs and how the token balance works.',
  },
  updatedAt: '2026-11-26',
  contentHash: '6e1231d495d7027d60ca451752c45abc4d4a87e137ffac4aea0bb06265403454',
  blocks: [
    {
      kind: 'paragraph',
      text: {
        pt: 'Cada vídeo custa tokens, e o valor depende do tipo de vídeo e da qualidade do rosto. O saldo é pré-pago e o custo é cobrado por vídeo gerado.',
        en: 'Each video costs tokens, and the price depends on the video type and the face quality. The balance is prepaid and the cost is charged per generated video.',
      },
    },
    { kind: 'heading', level: 2, text: { pt: 'Preços por vídeo', en: 'Price per video' } },
    { kind: 'tokenCostTable' },
    {
      kind: 'paragraph',
      text: {
        pt: 'Se a geração falhar por um problema do sistema, os tokens voltam. Se o vídeo já foi gerado, não há reembolso.',
        en: 'If generation fails because of a system problem, the tokens come back. If the video was already generated, there is no refund.',
      },
    },
  ],
};
