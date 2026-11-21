import { describe, expect, it } from 'vitest';
import { readBody } from '@/lib/contracts-server';
import { createUserPrompt } from '@/lib/contracts/prompts';
import { generateAndSchedule } from '@/lib/contracts/videos';

const VALID = { slug: 'hook-test', title: 'Hook test', prompt: 'Write a hook.', visibility: 'private' };

function postRequest(body: unknown): Request {
  return new Request('http://localhost/api/prompts', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) });
}

describe('readBody', () => {
  it('returns the validated body for a valid payload', async () => {
    const result = await readBody(createUserPrompt, postRequest(VALID), { logMessage: 'Invalid prompt request.' });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.body.title).toBe('Hook test');
  });

  it('returns the exact Invalid JSON payload response', async () => {
    const result = await readBody(createUserPrompt, postRequest('nope'), { logMessage: 'Invalid prompt request.' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(400);
      await expect(result.response.json()).resolves.toMatchObject({ success: false, error: 'Invalid JSON payload.', code: 'VALIDATION_FAILED' });
    }
  });

  it('returns the first issue with its field on a validation failure', async () => {
    const result = await readBody(createUserPrompt, postRequest({ ...VALID, visibility: 'approved' }), { logMessage: 'Invalid prompt request.' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(400);
      const json = await result.response.json() as { code: string; field: string; error: string };
      expect(json.code).toBe('VALIDATION_FAILED');
      expect(json.field).toBe('visibility');
      expect(json.error.startsWith('Invalid request: visibility: ')).toBe(true);
    }
  });

  it('has no field prefix for a root-level issue', async () => {
    const result = await readBody(createUserPrompt, postRequest([]), { logMessage: 'Invalid prompt request.' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const json = await result.response.json() as { field: string; error: string };
      expect(json.field).toBe('');
      expect(json.error.startsWith('Invalid request: ')).toBe(true);
      expect(json.error.startsWith('Invalid request: : ')).toBe(false);
    }
  });

  it('joins a nested path with dots', async () => {
    const body = { title: 'T', description: 'D', publishing: { providers: ['youtube', 1] } };
    const result = await readBody(generateAndSchedule, postRequest(body), { logMessage: 'Invalid video request.' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const json = await result.response.json() as { field: string; error: string };
      expect(json.field).toBe('publishing.providers.1');
    }
  });

  it('truncates an over-long message to 500 characters and the field to 200', async () => {
    const longKey = 'k'.repeat(600);
    const result = await readBody(createUserPrompt, postRequest({ ...VALID, [longKey]: true }), { logMessage: 'Invalid prompt request.' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const json = await result.response.json() as { field: string; error: string };
      expect(json.error.length).toBeLessThanOrEqual(500);
      expect(json.field.length).toBeLessThanOrEqual(200);
    }
  });

  it('rejects an unknown key without renaming a field', async () => {
    const result = await readBody(createUserPrompt, postRequest({ ...VALID, nome: 'Hook test' }), { logMessage: 'Invalid prompt request.' });
    expect(result.ok).toBe(false);
  });
});
