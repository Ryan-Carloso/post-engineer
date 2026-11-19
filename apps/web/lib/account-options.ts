import type { PublicAccountItem, SocialProvider } from '@/lib/providers/registry';

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
  fanvue: 'Fanvue',
};

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
  fanvueAccountIds?: string[];
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
    ...(schedule.fanvueAccountIds ?? []),
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

const ACCOUNT_OPTION_BUILDERS: Record<SocialProvider, (account: PublicAccountItem) => AccountOption> = {
  youtube: (account) => {
    if (account.provider !== 'youtube') throw new Error(`accountOption: youtube builder got a ${account.provider} account`);
    return { id: account.channelId, provider: 'youtube', label: account.channelName };
  },
  instagram: (account) => {
    if (account.provider !== 'instagram') throw new Error(`accountOption: instagram builder got a ${account.provider} account`);
    return { id: account.igUserId, provider: 'instagram', label: formatSocialHandle(account.username) };
  },
  bluesky: (account) => {
    if (account.provider !== 'bluesky') throw new Error(`accountOption: bluesky builder got a ${account.provider} account`);
    return { id: account.did, provider: 'bluesky', label: formatSocialHandle(account.handle) };
  },
  linkedin: (account) => {
    if (account.provider !== 'linkedin') throw new Error(`accountOption: linkedin builder got a ${account.provider} account`);
    return { id: account.providerAccountId, provider: 'linkedin', label: account.accountName ?? account.providerAccountId };
  },
  threads: (account) => {
    if (account.provider !== 'threads') throw new Error(`accountOption: threads builder got a ${account.provider} account`);
    return {
      id: account.providerAccountId,
      provider: 'threads',
      label: account.accountName === null ? account.providerAccountId : formatSocialHandle(account.accountName),
    };
  },
  facebook: (account) => {
    if (account.provider !== 'facebook') throw new Error(`accountOption: facebook builder got a ${account.provider} account`);
    return { id: account.providerAccountId, provider: 'facebook', label: account.accountName ?? account.providerAccountId };
  },
  pinterest: (account) => {
    if (account.provider !== 'pinterest') throw new Error(`accountOption: pinterest builder got a ${account.provider} account`);
    return { id: account.providerAccountId, provider: 'pinterest', label: account.accountName ?? account.providerAccountId };
  },
  '3speak': (account) => {
    if (account.provider !== '3speak') throw new Error(`accountOption: 3speak builder got a ${account.provider} account`);
    return { id: account.providerAccountId, provider: '3speak', label: account.accountName ?? account.providerAccountId };
  },
  rumble: (account) => {
    if (account.provider !== 'rumble') throw new Error(`accountOption: rumble builder got a ${account.provider} account`);
    return { id: account.providerAccountId, provider: 'rumble', label: account.accountName ?? account.providerAccountId };
  },
  fanvue: (account) => {
    if (account.provider !== 'fanvue') throw new Error(`accountOption: fanvue builder got a ${account.provider} account`);
    return { id: account.providerAccountId, provider: 'fanvue', label: account.accountName ?? account.providerAccountId };
  },
};

export function accountOption(account: PublicAccountItem): AccountOption {
  return ACCOUNT_OPTION_BUILDERS[account.provider](account);
}
