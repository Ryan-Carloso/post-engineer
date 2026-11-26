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
  contentHash: 'a6902f986278617541d68d61ab5fd9b9248aaddc9e5f107e01b321cce36cafda',
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
        pt: 'Ligue cada conta em Perfil, na aba Contas. Se um token expirar, desligue a conta e ligue de novo.',
        en: 'Connect each account in Profile, on the Accounts tab. If a token expires, disconnect the account and connect it again.',
      },
    },
  ],
};
