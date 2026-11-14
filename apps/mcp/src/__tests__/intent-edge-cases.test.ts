import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { actionShape } from '../action-tool.js';
import type { PostEngineerClient } from '../client.js';
import { GenerateVideoSchema, handleGenerateVideo } from '../generate-video.js';
import { createRefResolvers, resolveAccountRef, withOptionalPersona, withPersona } from '../refs.js';
import { handleAddExperimentPair, AddExperimentPairSchema } from '../tools-experiments.js';
import type { McpToolResponse } from '../tools-call.js';

// Edge cases of the intent-tool plumbing: malformed listings are never read
// as "no match", references that fail stop the call before any request, and
// the action-tool builders refuse an ill-formed definition.

const MARIA = '11111111-1111-4111-8111-111111111111';
const text = (response: McpToolResponse): string => response.content.map((part) => (part.type === 'text' ? part.text : '')).join('\n');

function client(parts: Partial<Record<'listPersonas' | 'listSocialAccounts', unknown>>): PostEngineerClient {
  return {
    listPersonas: vi.fn(async () => {
      const value = parts.listPersonas;
      if (value instanceof Error) throw value;
      return value;
    }),
    listSocialAccounts: vi.fn(async () => {
      const value = parts.listSocialAccounts;
      if (value instanceof Error) throw value;
      return value;
    }),
  } as unknown as PostEngineerClient;
}

describe('actionShape and defaults', () => {
  it('refuses a tool with no actions and an action that declares a field named action', () => {
    expect(() => actionShape({})).toThrow(/at least one action/);
    expect(() => actionShape({ list: { action: z.string() } })).toThrow(/named "action"/);
  });

  it('strips a default even when the field has no description', () => {
    const shape = actionShape({ list: { limit: z.number().default(5) } });
    expect(shape.limit.safeParse(undefined)).toMatchObject({ success: true, data: undefined });
  });
});

describe('reference resolution on malformed listings', () => {
  it('skips persona entries that are not records or lack an id or a name', async () => {
    const resolvers = createRefResolvers(client({ listPersonas: { personas: [null, 'x', { id: MARIA }, { name: 'Maria' }, { id: MARIA, name: 'Maria' }] } }));
    expect(await resolvers.persona('Maria')).toEqual({ kind: 'ok', value: { id: MARIA, name: 'Maria' } });
  });

  it('skips account entries without a provider or an id and reads the provider-specific id', async () => {
    const accounts = {
      accounts: [
        null,
        { provider: 'youtube' },
        { channelId: 'UC0' },
        { provider: 'bluesky', did: 'did:plc:abc', handle: 'a.bsky.social' },
        { provider: 'instagram', igUserId: '17', username: 'ig' },
        { provider: 'linkedin', providerAccountId: 'li-1' },
      ],
    };
    const resolvers = createRefResolvers(client({ listSocialAccounts: accounts }));
    expect(await resolvers.account('did:plc:abc')).toMatchObject({ kind: 'ok', value: { provider: 'bluesky' } });
    expect(await resolvers.account('17')).toMatchObject({ kind: 'ok', value: { provider: 'instagram' } });
    // An account with no name is addressed by its id, and is labelled with it.
    expect(await resolvers.account('li-1')).toEqual({ kind: 'ok', value: { provider: 'linkedin', id: 'li-1', label: 'li-1' } });
  });

  it('reports a failed or malformed accounts listing and an empty reference as errors', async () => {
    const failed = await resolveAccountRef(client({ listSocialAccounts: new Error('down') }), 'x');
    expect(failed.kind === 'response' && text(failed.response)).toContain('down');
    const malformed = await resolveAccountRef(client({ listSocialAccounts: { accounts: 'nope' } }), 'x');
    expect(malformed.kind === 'response' && text(malformed.response)).toContain('malformed');
    const empty = await resolveAccountRef(client({ listSocialAccounts: { accounts: [] } }), '  ');
    expect(empty.kind === 'response' && empty.response.isError).toBe(true);
  });

  it('names the provider when no account matches on it', async () => {
    const outcome = await resolveAccountRef(client({ listSocialAccounts: { accounts: [{ provider: 'youtube', channelId: 'UC1', channelName: 'Maria' }] } }), 'Maria', 'instagram');
    expect(outcome.kind === 'response' && text(outcome.response)).toContain('on instagram');
  });
});

describe('persona helpers', () => {
  it('withPersona stops at an unknown persona before running', async () => {
    const run = vi.fn();
    const response = await withPersona(client({ listPersonas: { personas: [] } }), { persona: 'Ghost' }, run);
    expect(response.isError).toBe(true);
    expect(run).not.toHaveBeenCalled();
  });

  it('withOptionalPersona passes through without a persona, resolves a name, and stops at an unknown one', async () => {
    const ok: McpToolResponse = { content: [{ type: 'text', text: 'ok' }] };
    const run = vi.fn(async (_args: { name: string; personaId?: string }) => ok);
    expect(await withOptionalPersona<{ persona?: string; name: string }>(client({}), { name: 'x' }, run)).toBe(ok);
    expect(run).toHaveBeenLastCalledWith({ name: 'x' });
    await withOptionalPersona<{ persona?: string; name: string }>(client({ listPersonas: { personas: [{ id: MARIA, name: 'Maria' }] } }), { persona: 'maria', name: 'x' }, run);
    expect(run).toHaveBeenLastCalledWith({ name: 'x', personaId: MARIA });
    const unknown = await withOptionalPersona<{ persona?: string; name: string }>(client({ listPersonas: { personas: [] } }), { persona: 'Ghost', name: 'x' }, run);
    expect(unknown.isError).toBe(true);
    expect(run).toHaveBeenCalledTimes(2);
  });
});

const HOOK = 'Most people burn out because they train every single day without any plan, and here is the simple weekly structure that fixes it for good.';
const SEGMENTS = [
  { kind: 'hook' as const, text: HOOK },
  { kind: 'content' as const, text: 'Start with three focused sessions a week, each one built around a single goal, so your body can recover and your progress keeps moving forward instead of stalling.' },
  { kind: 'content' as const, text: 'Track every session in a simple notebook, review it on Sunday, and change only one thing at a time, because small and steady adjustments beat dramatic restarts.' },
];
const baseVideo = { title: 'T', description: 'D', segments: SEGMENTS, mode: 'asap' as const, options: { videoType: 'full_lipsync' as const } };

describe('generate_video reference failures', () => {
  it('stops at an account that does not exist, and says which video of a batch', async () => {
    const generate = vi.fn();
    const c = {
      listPersonas: vi.fn(async () => ({ personas: [{ id: MARIA, name: 'Maria' }] })),
      listSocialAccounts: vi.fn(async () => ({ accounts: [{ provider: 'youtube', channelId: 'UC1', channelName: 'Maria' }] })),
      generatePersonaVideo: generate,
      request: vi.fn(),
      getHeaders: () => ({}),
    } as unknown as PostEngineerClient;
    const args = GenerateVideoSchema.parse({ videos: [{ ...baseVideo, persona: 'Maria', accounts: ['Maria'] }, { ...baseVideo, persona: 'Maria', accounts: ['Nobody'] }], batchKey: 'b1' });
    const response = await handleGenerateVideo(c, args);
    expect(response.isError).toBe(true);
    expect(text(response)).toContain('Video 2 of 2: No account matches "Nobody"');
    expect(generate).not.toHaveBeenCalled();
  });

  it('deduplicates repeated providers', async () => {
    const generate = vi.fn(async (_input: { providers: string[] }) => ({ success: true, schedule: { id: 's' }, slots: [] }));
    const c = { generatePersonaVideo: generate, getHeaders: () => ({}) } as unknown as PostEngineerClient;
    await handleGenerateVideo(c, GenerateVideoSchema.parse({ videos: [{ ...baseVideo, persona: MARIA, providers: ['youtube', 'youtube'] }] }));
    expect(generate.mock.calls[0]?.[0].providers).toEqual(['youtube']);
  });
});

describe('experiments add_pair reference failures', () => {
  it('stops before the first video when the persona does not exist', async () => {
    const generate = vi.fn();
    const c = { listPersonas: vi.fn(async () => ({ personas: [] })), generatePersonaVideo: generate } as unknown as PostEngineerClient;
    const args = AddExperimentPairSchema.parse({
      experimentId: '33333333-3333-4333-8333-333333333333',
      pair: 1,
      title: 'T',
      description: 'D',
      persona: 'Ghost',
      providers: ['youtube'],
      mode: 'asap',
      options: { videoType: 'full_lipsync' },
      segments: [SEGMENTS[1], SEGMENTS[2]],
      hooks: [
        { variantId: 'hook-calm', text: HOOK },
        { variantId: 'hook-bold', text: HOOK.replace('Most people', 'Almost everyone') },
      ],
    });
    const response = await handleAddExperimentPair(c, args);
    expect(response.isError).toBe(true);
    expect(text(response)).toContain('No persona named "Ghost"');
    expect(generate).not.toHaveBeenCalled();
  });
});
