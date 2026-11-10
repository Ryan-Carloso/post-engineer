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
  threads: 'Threads',
  facebook: 'Facebook',
  pinterest: 'Pinterest',
  '3speak': '3Speak',
  rumble: 'Rumble',
};

// Every account a schedule targets, across all networks.
export function scheduleAccountIds(schedule: {
  youtubeAccountIds?: string[];
  instagramAccountIds?: string[];
  linkedinAccountIds?: string[];
  blueskyAccountIds?: string[];
  threadsAccountIds?: string[];
  facebookAccountIds?: string[];
  pinterestAccountIds?: string[];
  threespeakAccountIds?: string[];
  rumbleAccountIds?: string[];
}): string[] {
  return [
    ...(schedule.youtubeAccountIds ?? []),
    ...(schedule.instagramAccountIds ?? []),
    ...(schedule.linkedinAccountIds ?? []),
    ...(schedule.blueskyAccountIds ?? []),
    ...(schedule.threadsAccountIds ?? []),
    ...(schedule.facebookAccountIds ?? []),
    ...(schedule.pinterestAccountIds ?? []),
    ...(schedule.threespeakAccountIds ?? []),
    ...(schedule.rumbleAccountIds ?? []),
  ];
}

export interface AccountOption {
  id: string;
  provider: SocialProvider;
  label: string;
}

export function formatSocialHandle(handle: string): string {
  const trimmed = handle.trim().replace(/^@+/, '');
  return `@${trimmed}`;
}

export function accountOption(account: PublicAccountItem): AccountOption {
  if (account.provider === 'bluesky') return { id: account.did, provider: 'bluesky', label: formatSocialHandle(account.handle) };
  if (account.provider === 'linkedin') {
    return { id: account.providerAccountId, provider: 'linkedin', label: account.accountName ?? account.providerAccountId };
  }
  if (account.provider === 'threads') {
    return {
      id: account.providerAccountId,
      provider: 'threads',
      label: account.accountName === null ? account.providerAccountId : formatSocialHandle(account.accountName),
    };
  }
  if (account.provider === 'facebook') {
    return { id: account.providerAccountId, provider: 'facebook', label: account.accountName ?? account.providerAccountId };
  }
  if (account.provider === 'pinterest') {
    return { id: account.providerAccountId, provider: 'pinterest', label: account.accountName ?? account.providerAccountId };
  }
  if (account.provider === '3speak') {
    return { id: account.providerAccountId, provider: '3speak', label: account.accountName ?? account.providerAccountId };
  }
  if (account.provider === 'rumble') {
    return { id: account.providerAccountId, provider: 'rumble', label: account.accountName ?? account.providerAccountId };
  }
  if (account.provider === 'instagram') return { id: account.igUserId, provider: 'instagram', label: formatSocialHandle(account.username) };
  return { id: account.channelId, provider: 'youtube', label: account.channelName };
}
