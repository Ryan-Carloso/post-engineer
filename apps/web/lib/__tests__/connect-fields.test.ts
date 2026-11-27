// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { isFilled, readConnectFields } from '@/lib/connect-fields';

function jsonRequest(body: string): Request {
  return new Request('https://post-engineer.test/api/x', { method: 'POST', headers: { 'content-type': 'application/json' }, body });
}

describe('readConnectFields', () => {
  it('returns the JSON body as the fields', async () => {
    await expect(readConnectFields(jsonRequest('{"handle":"a","extra":1}'), ['handle'])).resolves.toEqual({ ok: true, fields: { handle: 'a', extra: 1 } });
  });

  it('rejects malformed JSON and a JSON body that is not an object', async () => {
    await expect(readConnectFields(jsonRequest('{'), ['handle'])).resolves.toEqual({ ok: false, error: 'Invalid JSON payload.' });
    await expect(readConnectFields(jsonRequest('null'), ['handle'])).resolves.toEqual({ ok: false, error: 'Invalid JSON payload.' });
    await expect(readConnectFields(jsonRequest('["a"]'), ['handle'])).resolves.toEqual({ ok: false, error: 'Invalid JSON payload.' });
  });

  it('reads only the named multipart fields, missing ones as null', async () => {
    const form = new FormData();
    form.append('handle', 'a');
    form.append('other', 'b');
    const request = new Request('https://post-engineer.test/api/x', { method: 'POST', body: form });
    await expect(readConnectFields(request, ['handle', 'secret'])).resolves.toEqual({ ok: true, fields: { handle: 'a', secret: null } });
  });

  it('rejects a body that is neither JSON nor multipart', async () => {
    const request = new Request('https://post-engineer.test/api/x', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: 'x' });
    await expect(readConnectFields(request, ['handle'])).resolves.toEqual({ ok: false, error: 'Invalid multipart payload.' });
  });
});

describe('isFilled', () => {
  it('accepts a string with non-blank text only', () => {
    expect(isFilled('a')).toBe(true);
    expect(isFilled('  ')).toBe(false);
    expect(isFilled('')).toBe(false);
    expect(isFilled(null)).toBe(false);
    expect(isFilled(1)).toBe(false);
  });
});
