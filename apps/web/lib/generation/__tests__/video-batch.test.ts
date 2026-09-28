import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { startEngineVideoBatch } from '../video-generation';
import { buildJobPayload, type JobPersona } from '../video-job-payload';

const ENGINE_URL = 'https://engine.test';

function mockFetchJson(body: unknown, init: { ok: boolean; status: number }) {
  global.fetch = vi.fn().mockResolvedValue({
    ok: init.ok,
    status: init.status,
    json: async () => body,
  });
}

describe('startEngineVideoBatch', () => {
  const previousUrl = process.env.MONEYPRINT_API_URL;
  const previousSecret = process.env.MONEYPRINT_API_SECRET;

  beforeEach(() => {
    process.env.MONEYPRINT_API_URL = ENGINE_URL;
    process.env.MONEYPRINT_API_SECRET = 'test-secret';
  });

  afterEach(() => {
    if (previousUrl === undefined) delete process.env.MONEYPRINT_API_URL;
    else process.env.MONEYPRINT_API_URL = previousUrl;
    if (previousSecret === undefined) delete process.env.MONEYPRINT_API_SECRET;
    else process.env.MONEYPRINT_API_SECRET = previousSecret;
    vi.restoreAllMocks();
  });

  it('POSTs the batch payload to /api/v1/persona-videos/batch and returns the task ids', async () => {
    mockFetchJson({ status: 202, data: { task_ids: ['task-a', 'task-b'] } }, { ok: true, status: 202 });
    const payload = {
      persona: { name: 'Debug persona', language: 'pt-BR', voice_id: 'voice-1' },
      items: [{ topic: 'topic one' }, { topic: 'topic two' }],
      face_mix_percent: 0,
      face_quality: 'ok',
    };

    const result = await startEngineVideoBatch('user-1', payload);

    expect(global.fetch).toHaveBeenCalledWith(
      `${ENGINE_URL}/api/v1/persona-videos/batch`,
      expect.objectContaining({ method: 'POST' }),
    );
    const sent = vi.mocked(global.fetch).mock.calls[0]?.[1];
    expect(JSON.parse(String(sent?.body))).toEqual(payload);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.taskIds).toEqual(['task-a', 'task-b']);
  });

  it('returns the upstream error response when the engine rejects the batch', async () => {
    mockFetchJson({ status: 400, message: 'INSUFFICIENT_TOKENS' }, { ok: false, status: 400 });

    const result = await startEngineVideoBatch('user-1', { items: [] });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.upstreamStatus).toBe(400);
      expect(result.upstreamBody).toEqual({ status: 400, message: 'INSUFFICIENT_TOKENS' });
    }
  });

  it('returns a 502 response when the engine is unreachable', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('connection refused'));

    const result = await startEngineVideoBatch('user-1', { items: [] });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.upstreamStatus).toBeUndefined();
      const body = await result.response.json();
      expect(body.error).toBe('Video service is unavailable.');
    }
  });

  it('returns a 500 response when MONEYPRINT_API_URL is not defined', async () => {
    delete process.env.MONEYPRINT_API_URL;

    const result = await startEngineVideoBatch('user-1', { items: [] });

    expect(result.ok).toBe(false);
  });
});

describe('buildJobPayload webhook_url', () => {
  const persona: JobPersona = { name: 'P', voice_id: 'voice-1' };

  it('forwards webhook_url to the engine payload', () => {
    const payload = buildJobPayload(persona, {
      video_subject: 'topic',
      webhook_url: 'https://example.com/hook',
    });
    expect(payload.webhook_url).toBe('https://example.com/hook');
  });

  it('still drops unknown fields while forwarding webhook_url', () => {
    const payload = buildJobPayload(persona, {
      video_subject: 'topic',
      webhook_url: 'https://example.com/hook',
      bogus_field: 'nope',
    });
    expect(payload.webhook_url).toBe('https://example.com/hook');
    expect('bogus_field' in payload).toBe(false);
  });
});
