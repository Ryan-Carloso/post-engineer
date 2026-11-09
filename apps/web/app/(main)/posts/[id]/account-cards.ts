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
import type { SocialProvider } from '@/lib/providers/registry';

//---------------
// usePostAccountCards — every connected account, resolved from the same
// account queries the accounts screen uses and mapped to the shared
// AccountCard props (real thumbnails and names). The post detail page
// filters this list down to the accounts its schedule targets.
//---------------

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
      // No thumbnail: Rumble has no profile API, so there is no avatar to show.
      ...(rumbleQuery.data?.accounts ?? []).map((account) => ({
        id: account.providerAccountId,
        type: 'rumble' as const,
        name: account.accountName ?? account.providerAccountId,
      })),
    ],
    [youtubeQuery.data, instagramQuery.data, linkedinQuery.data, blueskyQuery.data, threadsQuery.data, facebookQuery.data, pinterestQuery.data, rumbleQuery.data],
  );
}
