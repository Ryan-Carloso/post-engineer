import {
  DIRECT_CONNECT_PROVIDERS,
  OAUTH_CONNECT_PROVIDERS,
  SOCIAL_PROVIDERS,
} from '@/lib/contracts/providers';
import type { DocPage } from '../types';

export const integrationsGuide: DocPage = {
  section: 'docs',
  slug: 'integrations',
  title: { en: 'Integrations' },
  description: {
    en: 'Every network Post Engineer publishes to, and how each account connects.',
  },
  updatedAt: '2026-11-26',
  contentHash: 'e027a88d8198086470911c7f8aee998105ce61a2ca217cae66cbb74db42b91b3',
  blocks: [
    {
      kind: 'paragraph',
      text: {
        en: 'Post Engineer publishes to eleven networks. A persona only publishes to the accounts linked to it, and a video goes out to every linked account at its slot.',
      },
    },
    { kind: 'heading', level: 2, text: { en: 'Networks' } },
    { kind: 'providerList', providers: SOCIAL_PROVIDERS },
    { kind: 'heading', level: 2, text: { en: 'OAuth sign-in' } },
    {
      kind: 'paragraph',
      text: {
        en: 'Most networks connect with OAuth: sign in once in the app and the account stays linked until the token is revoked.',
      },
    },
    { kind: 'providerList', providers: OAUTH_CONNECT_PROVIDERS },
    { kind: 'heading', level: 2, text: { en: 'Direct connect' } },
    {
      kind: 'paragraph',
      text: {
        en: 'Four networks connect directly, with credentials instead of OAuth.',
      },
    },
    { kind: 'providerList', providers: DIRECT_CONNECT_PROVIDERS },
  ],
};
