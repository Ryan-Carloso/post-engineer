import type { PublicAccountItem, SocialProvider } from '@/lib/providers/registry';

//---------------
// account-options — the account filter shared by the posts list and the
// metrics dashboard: one id per connected account (the id publish_results
// and post_metrics store) plus a display label, and the network names.
//---------------

// A record (not a ternary chain) so every network gets its own label, and
// a new provider fails the typecheck until it has one.
export const PROVIDER_LABELS: Record<SocialProvider, string> = {
  youtube: 'YouTube',
  instagram: 'Instagram',
  linkedin: 'LinkedIn',
  bluesky: 'Bluesky',
};

export interface AccountOption {
  id: string;
  provider: SocialProvider;
  label: string;
}

export function accountOption(account: PublicAccountItem): AccountOption {
  if (account.provider === 'bluesky') return { id: account.did, provider: 'bluesky', label: `@${account.handle}` };
  if (account.provider === 'linkedin') {
    return { id: account.providerAccountId, provider: 'linkedin', label: account.accountName ?? account.providerAccountId };
  }
  if (account.provider === 'instagram') return { id: account.igUserId, provider: 'instagram', label: `@${account.username}` };
  return { id: account.channelId, provider: 'youtube', label: account.channelName };
}
