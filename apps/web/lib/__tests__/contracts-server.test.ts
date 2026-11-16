import { describe, expect, it } from 'vitest';
import { readBody } from '@/lib/contracts-server';
import { createExperiment } from '@/lib/contracts/experiments';

//---------------
// readBody: the shared-contract body reader. The route (POST
// /api/experiments) now goes through it, so its 400 behavior is pinned
// here directly: invalid JSON, the first-issue message, the field
// extra and the VALIDATION_FAILED code must stay exact.
//---------------

const VARIANTS = [
  { variantId: 'hook-calm', name: 'Calm', description: 'calm' },
  { variantId: 'hook-aggressive', name: 'Aggressive', description: 'direct' },
];

const VALID = { name: 'Hook test', variable: 'hook', personaId: '11111111-2222-4333-8444-555555555555', targetPairs: 6, variants: VARIANTS };

function postRequest(body: unknown): Request {
  return new Request('http://localhost/api/experiments', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) });
}

describe('readBody', () => {
  it('returns the validated body for a valid payload', async () => {
    const result = await readBody(createExperiment, postRequest(VALID), { logMessage: 'Invalid experiment request.' });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.body.name).toBe('Hook test');
  });

  it('returns the exact Invalid JSON payload response', async () => {
    const result = await readBody(createExperiment, postRequest('nope'), { logMessage: 'Invalid experiment request.' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(400);
      await expect(result.response.json()).resolves.toMatchObject({ success: false, error: 'Invalid JSON payload.', code: 'VALIDATION_FAILED' });
    }
  });

  it('returns the first issue with its field on a validation failure', async () => {
    const result = await readBody(createExperiment, postRequest({ ...VALID, targetPairs: 2 }), { logMessage: 'Invalid experiment request.' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(400);
      const json = await result.response.json() as { code: string; field: string; error: string };
      expect(json.code).toBe('VALIDATION_FAILED');
      expect(json.field).toBe('targetPairs');
      expect(json.error.startsWith('Invalid request: targetPairs: ')).toBe(true);
    }
  });

  it('has no field prefix for a root-level issue', async () => {
    const result = await readBody(createExperiment, postRequest([]), { logMessage: 'Invalid experiment request.' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const json = await result.response.json() as { field: string; error: string };
      expect(json.field).toBe('');
      expect(json.error.startsWith('Invalid request: ')).toBe(true);
      expect(json.error.startsWith('Invalid request: : ')).toBe(false);
    }
  });

  it('joins a nested path with dots', async () => {
    const body = { ...VALID, variants: [VARIANTS[0], { ...VARIANTS[1], variantId: 'A' }] };
    const result = await readBody(createExperiment, postRequest(body), { logMessage: 'Invalid experiment request.' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const json = await result.response.json() as { field: string; error: string };
      expect(json.field).toBe('variants.1.variantId');
    }
  });

  it('truncates an over-long message to 500 characters and the field to 200', async () => {
    const longKey = 'k'.repeat(600);
    const result = await readBody(createExperiment, postRequest({ ...VALID, [longKey]: true }), { logMessage: 'Invalid experiment request.' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const json = await result.response.json() as { field: string; error: string };
      expect(json.error.length).toBeLessThanOrEqual(500);
      expect(json.field.length).toBeLessThanOrEqual(200);
    }
  });

  it('rejects an unknown key without renaming a field', async () => {
    const result = await readBody(createExperiment, postRequest({ ...VALID, nome: 'Hook test' }), { logMessage: 'Invalid experiment request.' });
    expect(result.ok).toBe(false);
  });
});
