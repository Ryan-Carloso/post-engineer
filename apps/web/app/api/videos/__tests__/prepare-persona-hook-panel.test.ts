import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/lib/analytics', () => ({ trackApiEvent: vi.fn() }));
vi.mock('@/lib/posthog-server', () => ({ getPostHogServer: vi.fn(() => ({ captureAs: vi.fn() })) }));
vi.mock('../generate-and-schedule/persona-prep', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../generate-and-schedule/persona-prep')>();
  return { ...actual, signedUrl: vi.fn().mockResolvedValue(null) };
});

import { preparePersona } from '../generate-and-schedule/prepare-persona';

const PERSONA = {
  id: 'persona-1',
  name: 'Ana',
  photo_path: null,
  avatar_url: 'https://cdn.example/avatar.png',
  voice_id: 'kokoro:af_heart',
  voice_audio_path: null,
  language: 'en',
  video_aspect: '9:16',
  video_layout: null,
  cta_type: 'follow',
  cta_url: null,
  cta_instruction: null,
  paragraph_number: 2,
  niche: 'travel',
  face_quality: 'ok',
};

function supabaseWith(hookPanel: boolean): { client: SupabaseClient; selects: string[] } {
  const selects: string[] = [];
  const chain: Record<string, unknown> = {
    select: (columns: string) => {
      selects.push(columns);
      return chain;
    },
    eq: () => chain,
    single: async () => ({ data: { ...PERSONA, hook_panel: hookPanel }, error: null }),
  };
  return { client: { from: () => chain } as unknown as SupabaseClient, selects };
}

async function hookPanelFor(stored: boolean, requested?: boolean): Promise<boolean> {
  const { client, selects } = supabaseWith(stored);
  const prep = await preparePersona(client, 'user-1', 'persona-1', {
    videoType: 'hook_lipsync',
    hookPanel: requested,
  });
  if (prep instanceof NextResponse) throw new Error(`unexpected ${prep.status}`);
  expect(selects[0]).toContain('hook_panel');
  return prep.hookPanel;
}

describe('preparePersona hookPanel', () => {
  it('uses the persona default when the video does not choose', async () => {
    expect(await hookPanelFor(true)).toBe(true);
    expect(await hookPanelFor(false)).toBe(false);
  });

  it('lets the video override the persona default either way', async () => {
    expect(await hookPanelFor(true, false)).toBe(false);
    expect(await hookPanelFor(false, true)).toBe(true);
  });
});
