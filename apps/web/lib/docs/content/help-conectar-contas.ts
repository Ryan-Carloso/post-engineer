import { SOCIAL_PROVIDERS } from '@/lib/contracts/providers';
import type { DocPage } from '../types';

export const helpConnectAccounts: DocPage = {
  section: 'help',
  slug: 'conectar-contas',
  title: { pt: 'Conectar contas', en: 'Connect accounts' },
  description: {
    pt: 'Ligue suas contas sociais para publicar vídeos nelas automaticamente.',
    en: 'Connect your social accounts to publish videos to them automatically.',
  },
  updatedAt: '2026-11-26',
  contentHash: '4698c0d04e38085784e934cb931a0b4964f1c749a1dac31bb58df45528e1fa00',
  blocks: [
    {
      kind: 'paragraph',
      text: {
        pt: 'O Post Engineer publica nas contas ligadas à sua persona. Sem nenhuma conta ligada, não há onde publicar: a publicação falha em vez de sair em todas as contas.',
        en: 'Post Engineer publishes to the accounts linked to your persona. With no account linked, there is nowhere to publish: publishing fails instead of going out to every account.',
      },
    },
    { kind: 'heading', level: 2, text: { pt: 'Redes', en: 'Networks' } },
    { kind: 'providerList', providers: SOCIAL_PROVIDERS },
    {
      kind: 'paragraph',
      text: {
        pt: 'Ligue cada conta na aba Contas. Se um token expirar, desligue a conta e ligue de novo.',
        en: 'Connect each account on the Accounts tab. If a token expires, disconnect the account and connect it again.',
      },
    },
  ],
};
