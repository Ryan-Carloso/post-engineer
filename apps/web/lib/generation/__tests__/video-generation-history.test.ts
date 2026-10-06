import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { recordGenerationStart, recordGenerationUpdate } from '../video-generation';

function mockSupabase() {
  const insert = vi.fn().mockResolvedValue({ error: null });
  const eq = vi.fn().mockResolvedValue({ error: null });
  const update = vi.fn().mockReturnValue({ eq });
  const from = vi.fn().mockReturnValue({ insert, update });
  const supabase = { from } as unknown as SupabaseClient;
  return { supabase, from, insert, update, eq };
}

describe('recordGenerationStart', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('inserts a pending row with the generation snapshot', async () => {
    const { supabase, from, insert } = mockSupabase();
    await recordGenerationStart({
      supabase,
      userId: 'user-1',
      generationId: 'gen-1',
      personaId: 'persona-1',
      personaName: 'Viva Leve',
      videoSubject: 'myth busting',
    });
    expect(from).toHaveBeenCalledWith('video_generations');
    expect(insert).toHaveBeenCalledWith({
      user_id: 'user-1',
      generation_id: 'gen-1',
      persona_id: 'persona-1',
      persona_name: 'Viva Leve',
      video_subject: 'myth busting',
      status: 'pending',
    });
  });

  it('never throws when the insert fails', async () => {
    const { supabase, insert } = mockSupabase();
    insert.mockResolvedValue({ error: new Error('db down') });
    await expect(
      recordGenerationStart({ supabase, userId: 'u', generationId: 'g' }),
    ).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalled();
  });
});

describe('recordGenerationUpdate', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('moves a generation to running with the engine task id', async () => {
    const { supabase, update, eq } = mockSupabase();
    await recordGenerationUpdate({
      supabase,
      generationId: 'gen-1',
      status: 'running',
      engineTaskId: 'task-1',
    });
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'running', engine_task_id: 'task-1' }),
    );
    expect(eq).toHaveBeenCalledWith('generation_id', 'gen-1');
  });

  it('records a failed generation with error details, refund flag and completion time', async () => {
    const { supabase, update } = mockSupabase();
    await recordGenerationUpdate({
      supabase,
      generationId: 'gen-1',
      status: 'failed',
      errorCode: 'custom_audio_invalid',
      errorMessage: 'custom audio file is invalid: boom',
      tokensRefunded: true,
    });
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'failed',
        error_code: 'custom_audio_invalid',
        error_message: 'custom audio file is invalid: boom',
        tokens_refunded: true,
        completed_at: expect.any(String),
      }),
    );
  });

  it('records a completed generation with a completion time', async () => {
    const { supabase, update } = mockSupabase();
    await recordGenerationUpdate({
      supabase,
      generationId: 'gen-1',
      status: 'completed',
    });
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'completed', completed_at: expect.any(String) }),
    );
  });

  it('leaves optional fields out of the patch when they are not provided', async () => {
    const { supabase, update } = mockSupabase();
    await recordGenerationUpdate({
      supabase,
      generationId: 'gen-1',
      status: 'running',
    });
    expect(update).toHaveBeenCalledWith({
      status: 'running',
      updated_at: expect.any(String),
    });
  });

  it('never throws when the update fails', async () => {
    const { supabase, eq } = mockSupabase();
    eq.mockResolvedValue({ error: new Error('db down') });
    await expect(
      recordGenerationUpdate({ supabase, generationId: 'g', status: 'failed' }),
    ).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalled();
  });
});
