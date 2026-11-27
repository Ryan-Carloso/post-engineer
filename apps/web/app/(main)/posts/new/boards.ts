'use client';

import { useQuery } from '@tanstack/react-query';

export interface BoardOption {
  id: string;
  name: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseBoards(payload: unknown): BoardOption[] {
  if (!isRecord(payload) || !Array.isArray(payload.boards)) return [];
  const boards: BoardOption[] = [];
  for (const item of payload.boards) {
    if (!isRecord(item) || typeof item.id !== 'string') continue;
    const name = typeof item.name === 'string' && item.name !== '' ? item.name : item.id;
    boards.push({ id: item.id, name });
  }
  return boards;
}

async function fetchPinterestBoards(accountId: string): Promise<BoardOption[]> {
  const response = await fetch(
    `/api/pinterest/boards?accountId=${encodeURIComponent(accountId)}`,
  );
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok || !isRecord(payload) || payload.success !== true) {
    throw new Error('pinterest boards request failed');
  }
  return parseBoards(payload);
}

export function usePinterestBoardsQuery(accountId: string | null) {
  return useQuery<BoardOption[]>({
    queryKey: ['pinterest-boards', accountId],
    queryFn: () => fetchPinterestBoards(accountId ?? ''),
    enabled: accountId !== null,
    staleTime: 5 * 60_000,
    retry: false,
  });
}
