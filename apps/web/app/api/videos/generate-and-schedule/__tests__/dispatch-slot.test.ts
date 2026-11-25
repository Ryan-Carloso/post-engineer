import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock('@/lib/generation/video-generation', () => ({
  startEngineVideoTask: vi.fn(),
  recordGenerationStart: vi.fn().mockResolvedValue(undefined),
  recordGenerationUpdate: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/persona-images', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/persona-images')>();
  return {
    ...actual,
    resolveVideoImage: vi.fn().mockResolvedValue({ ok: true, image: null }),
    recordRecentImageId: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock('@/lib/billing/refund-tokens', () => ({
  refundSlotTokens: vi.fn().mockResolvedValue({ refunded: true, alreadyRefunded: false }),
}));

import { dispatchSlot, type SlotDispatchContext, type SlotDispatchInput } from '../dispatch-slot';
import { recordGenerationStart, recordGenerationUpdate, startEngineVideoTask } from '@/lib/generation/video-generation';
import { refundSlotTokens } from '@/lib/billing/refund-tokens';
import { recordRecentImageId, resolveVideoImage } from '@/lib/persona-images';
import type { PersonaPrep } from '../persona-prep';

interface UpdateCall {
  values: Record<string, unknown>;
  filters: Array<[string, unknown]>;
}

function fakeClient(bindError: unknown = null): { client: SupabaseClient; updates: UpdateCall[] } {
  const updates: UpdateCall[] = [];
  const from = vi.fn(() => ({
    update: (values: Record<string, unknown>) => {
      const call: UpdateCall = { values, filters: [] };
      updates.push(call);
      const chain = {
        eq: (column: string, value: unknown) => {
          call.filters.push([column, value]);
          return call.filters.length < 2 ? chain : Promise.resolve({ error: updates.length === 1 ? bindError : null });
        },
      };
      return chain;
    },
  }));
  return { client: { from } as unknown as SupabaseClient, updates };
}

const PREP: PersonaPrep = {
  personaName: 'Ana',
  voiceover: true,
  faceQuality: 'ok',
  voiceIdValue: 'chatterbox:kokoro_af_heart',
  avatarUrl: null,
  photoPath: null,
  niche: 'fitness',
  cta: null,
  language: 'en',
  videoAspect: '9:16',
  videoLayout: null,
  hookPanel: false,
  paragraphNumber: 5,
  photoRequired: false,
};

const SLOT: SlotDispatchInput = {
  id: 'slot-1',
  slotAt: '2026-12-01T12:00:00.000Z',
  title: 'Hook one',
  description: 'Copy one',
  script: 'Hello there. Second line.',
  segments: undefined,
};

function context(client: SupabaseClient, overrides: Partial<SlotDispatchContext> = {}): SlotDispatchContext {
  return {
    supabase: client,
    userId: 'user-1',
    personaId: null,
    prep: PREP,
    validatedOptions: { videoType: 'voiceover' },
    effectiveCta: null,
    requestedImageId: null,
    generationId: 'gen-1',
    scheduleId: 'schedule-1',
    perVideoCost: 1,
    mode: 'scheduled',
    recentIds: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(refundSlotTokens).mockResolvedValue({ refunded: true, alreadyRefunded: false });
});

describe('dispatchSlot', () => {
  it('binds the engine task to the slot and reports it as generating', async () => {
    vi.mocked(startEngineVideoTask).mockResolvedValue({ ok: true, taskId: 'task-9', body: {} });
    const { client, updates } = fakeClient();

    const result = await dispatchSlot(context(client), SLOT);

    expect(result).toEqual({
      slotId: 'slot-1',
      slotAt: '2026-12-01T12:00:00.000Z',
      title: 'Hook one',
      taskId: 'task-9',
      status: 'generating',
    });
    expect(updates).toHaveLength(1);
    expect(updates[0].values).toEqual({ status: 'generating', task_id: 'task-9' });
    expect(updates[0].filters).toEqual([['id', 'slot-1'], ['user_id', 'user-1']]);
    expect(refundSlotTokens).not.toHaveBeenCalled();
    expect(recordGenerationUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ generationId: 'gen-1:slot:slot-1', status: 'running', engineTaskId: 'task-9' }),
    );
  });

  it('sends the slot title, script and slot id to the engine and records the slot time', async () => {
    vi.mocked(startEngineVideoTask).mockResolvedValue({ ok: true, taskId: 'task-1', body: {} });
    const { client } = fakeClient();

    await dispatchSlot(context(client), SLOT);

    const payload = vi.mocked(startEngineVideoTask).mock.calls[0][1] as Record<string, unknown>;
    expect(payload.video_title).toBe('Hook one');
    expect(payload.video_script).toBe('Hello there. Second line.');
    expect(payload.slot_id).toBe('slot-1');
    expect(payload.generation_id).toBe('gen-1:slot:slot-1');
    expect(recordGenerationStart).toHaveBeenCalledWith(
      expect.objectContaining({
        generationId: 'gen-1:slot:slot-1',
        videoSubject: 'Hook one',
        persistence: expect.objectContaining({ mode: 'scheduled', slotAt: '2026-12-01T12:00:00.000Z' }),
      }),
    );
  });

  it('marks the slot failed and refunds it when the engine rejects the job', async () => {
    vi.mocked(startEngineVideoTask).mockResolvedValue({
      ok: false,
      response: new Response(null) as never,
      upstreamStatus: 422,
    });
    const { client, updates } = fakeClient();

    const result = await dispatchSlot(context(client, { perVideoCost: 2 }), SLOT);

    expect(result).toMatchObject({
      slotId: 'slot-1',
      taskId: null,
      status: 'failed',
      errorCode: 'engine_rejected',
      tokensRefunded: true,
    });
    expect(updates[0].values).toEqual({ status: 'failed' });
    expect(refundSlotTokens).toHaveBeenCalledWith(
      expect.objectContaining({ scheduleId: 'schedule-1', slotId: 'slot-1', amount: 2, kind: 'dispatch_failed' }),
    );
    expect(recordGenerationUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed', errorCode: 'engine_rejected', tokensRefunded: true }),
    );
  });

  it('reports engine_unavailable when the engine call has no upstream status', async () => {
    vi.mocked(startEngineVideoTask).mockResolvedValue({ ok: false, response: new Response(null) as never });
    const { client } = fakeClient();

    const result = await dispatchSlot(context(client), SLOT);

    expect(result.errorCode).toBe('engine_unavailable');
    expect(result.status).toBe('failed');
  });

  it('reports no_task_id when the engine accepts without a task id', async () => {
    vi.mocked(startEngineVideoTask).mockResolvedValue({ ok: true, body: {} });
    const { client } = fakeClient();

    const result = await dispatchSlot(context(client), SLOT);

    expect(result.errorCode).toBe('no_task_id');
  });

  it('fails and refunds the slot when the task id cannot be bound', async () => {
    vi.mocked(startEngineVideoTask).mockResolvedValue({ ok: true, taskId: 'task-3', body: {} });
    const { client, updates } = fakeClient({ message: 'db down' });

    const result = await dispatchSlot(context(client), SLOT);

    expect(result).toMatchObject({ status: 'failed', errorCode: 'bind_failed', taskId: null });
    expect(updates.map((call) => call.values)).toEqual([
      { status: 'generating', task_id: 'task-3' },
      { status: 'failed' },
    ]);
    expect(refundSlotTokens).toHaveBeenCalledTimes(1);
  });

  it('reports tokensRefunded false when the refund does not land', async () => {
    vi.mocked(startEngineVideoTask).mockResolvedValue({ ok: false, response: new Response(null) as never });
    vi.mocked(refundSlotTokens).mockResolvedValue({ refunded: false, alreadyRefunded: false, error: new Error('rpc') });
    const { client } = fakeClient();

    const result = await dispatchSlot(context(client), SLOT);

    expect(result.tokensRefunded).toBe(false);
    expect(recordGenerationUpdate).toHaveBeenCalledWith(expect.objectContaining({ tokensRefunded: false }));
  });

  it('turns an unexpected throw into slot_failed', async () => {
    vi.mocked(startEngineVideoTask).mockRejectedValue(new Error('boom'));
    const { client } = fakeClient();

    const result = await dispatchSlot(context(client), SLOT);

    expect(result).toMatchObject({ status: 'failed', errorCode: 'slot_failed' });
  });

  it('fails the slot when the persona image cannot be resolved', async () => {
    vi.mocked(resolveVideoImage).mockResolvedValueOnce({ ok: false, error: 'no images' } as never);
    const { client } = fakeClient();

    const result = await dispatchSlot(
      context(client, { personaId: 'persona-1', validatedOptions: { videoType: 'hook_lipsync' } }),
      SLOT,
    );

    expect(result).toMatchObject({ status: 'failed', errorCode: 'image_resolve_failed' });
    expect(startEngineVideoTask).not.toHaveBeenCalled();
  });

  it('records the picked library image in the rotation after the engine accepts', async () => {
    vi.mocked(resolveVideoImage).mockResolvedValueOnce({
      ok: true,
      image: { id: 'img-1', image_path: 'p/img-1.png' },
    } as never);
    vi.mocked(startEngineVideoTask).mockResolvedValue({ ok: true, taskId: 'task-4', body: {} });
    const { client } = fakeClient();
    (client as unknown as { storage: unknown }).storage = {
      from: () => ({ createSignedUrl: async () => ({ data: { signedUrl: 'https://cdn.example/img-1.png' }, error: null }) }),
    };
    const ctx = context(client, { personaId: 'persona-1', validatedOptions: { videoType: 'hook_lipsync' } });

    const result = await dispatchSlot(ctx, SLOT);

    expect(result.status).toBe('generating');
    expect(recordRecentImageId).toHaveBeenCalledWith(client, 'persona-1', 'img-1', 'user-1');
    expect(ctx.recentIds).toEqual(['img-1']);
  });
});
