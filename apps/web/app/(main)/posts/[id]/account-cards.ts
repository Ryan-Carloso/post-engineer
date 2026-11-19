'use client';

import { useMemo } from 'react';
import {
  useYouTubeAccountsQuery,
  useInstagramAccountsQuery,
  useLinkedinAccountsQuery,
  useThreadsAccountsQuery,
  useBlueskyAccountsQuery,
  useFacebookAccountsQuery,
} from '@/lib/api';
import { useRumbleAccountsQuery } from '@/lib/social-accounts-queries';
import { usePinterestAccountsQuery } from '@/lib/pinterest-accounts';
import { useFanvueAccountsQuery } from '@/lib/fanvue-accounts';
import type { SocialProvider } from '@/lib/providers/registry';

export interface AccountCardData {
  id: string;
  type: SocialProvider;
  name: string;
  email?: string;
  thumbnail?: string;
  handle?: string;
}

export function usePostAccountCards(): AccountCardData[] {
  const youtubeQuery = useYouTubeAccountsQuery();
  const instagramQuery = useInstagramAccountsQuery();
  const linkedinQuery = useLinkedinAccountsQuery();
  const blueskyQuery = useBlueskyAccountsQuery();
  const threadsQuery = useThreadsAccountsQuery();
  const facebookQuery = useFacebookAccountsQuery();
  const pinterestQuery = usePinterestAccountsQuery();
  const rumbleQuery = useRumbleAccountsQuery();
  const fanvueQuery = useFanvueAccountsQuery();

  return useMemo(
    () => [
      ...(youtubeQuery.data?.accounts ?? []).map((account) => ({
        id: account.channelId,
        type: 'youtube' as const,
        name: account.channelName,
        email: account.email,
        thumbnail: account.thumbnail,
      })),
      ...(instagramQuery.data?.accounts ?? []).map((account) => ({
        id: account.igUserId,
        type: 'instagram' as const,
        name: `@${account.username}`,
        thumbnail: account.profilePictureUrl,
      })),
      ...(linkedinQuery.data?.accounts ?? []).map((account) => ({
        id: account.providerAccountId,
        type: 'linkedin' as const,
        name: account.accountName ?? account.providerAccountId,
      })),
      ...(blueskyQuery.data?.accounts ?? []).map((account) => ({
        id: account.did,
        type: 'bluesky' as const,
        name: account.handle,
        handle: `@${account.handle}`,
      })),
      ...(threadsQuery.data?.accounts ?? []).map((account) => ({
        id: account.providerAccountId,
        type: 'threads' as const,
        name: account.accountName ?? account.providerAccountId,
        thumbnail: account.profilePictureUrl,
      })),
      ...(facebookQuery.data?.accounts ?? []).map((account) => ({
        id: account.providerAccountId,
        type: 'facebook' as const,
        name: account.accountName ?? account.providerAccountId,
        thumbnail: account.profilePictureUrl,
      })),
      ...(pinterestQuery.data?.accounts ?? []).map((account) => ({
        id: account.providerAccountId,
        type: 'pinterest' as const,
        name: account.accountName ?? account.providerAccountId,
        thumbnail: account.profilePictureUrl,
      })),
      ...(rumbleQuery.data?.accounts ?? []).map((account) => ({
        id: account.providerAccountId,
        type: 'rumble' as const,
        name: account.accountName ?? account.providerAccountId,
      })),
      ...(fanvueQuery.data?.accounts ?? []).map((account) => ({
        id: account.providerAccountId,
        type: 'fanvue' as const,
        name: account.accountName ?? account.providerAccountId,
        thumbnail: account.profilePictureUrl,
      })),
    ],
    [youtubeQuery.data, instagramQuery.data, linkedinQuery.data, blueskyQuery.data, threadsQuery.data, facebookQuery.data, pinterestQuery.data, rumbleQuery.data, fanvueQuery.data],
  );
}
