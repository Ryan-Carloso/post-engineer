import { describe, it, expect } from 'vitest';
import {
  DCR_MAX_BODY_BYTES,
  DCR_MAX_CLIENT_NAME_LENGTH,
  DCR_MAX_REDIRECT_URIS,
  DCR_MAX_REDIRECT_URI_LENGTH,
  readBoundedText,
} from '../dcr-limits';

function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

function streamedRequest(chunks: string[], headers: Record<string, string> = {}): Request {
  return new Request('https://post-engineer.com/oauth/register', {
    method: 'POST',
    headers,
    body: streamOf(chunks),
    duplex: 'half',
  } as RequestInit);
}

describe('DCR limits', () => {
  it('exports the documented caps', () => {
    expect(DCR_MAX_BODY_BYTES).toBe(32 * 1024);
    expect(DCR_MAX_REDIRECT_URIS).toBe(10);
    expect(DCR_MAX_REDIRECT_URI_LENGTH).toBe(2048);
    expect(DCR_MAX_CLIENT_NAME_LENGTH).toBe(128);
  });

  it('fits the largest valid registration inside the body cap', () => {
    const uri = `https://a.example/${'x'.repeat(DCR_MAX_REDIRECT_URI_LENGTH - 18)}`;
    const body = JSON.stringify({
      redirect_uris: Array.from({ length: DCR_MAX_REDIRECT_URIS }, () => uri),
      client_name: 'n'.repeat(DCR_MAX_CLIENT_NAME_LENGTH),
    });
    expect(new TextEncoder().encode(body).byteLength).toBeLessThanOrEqual(DCR_MAX_BODY_BYTES);
  });
});

describe('readBoundedText', () => {
  it('returns the body when it is within the cap', async () => {
    const result = await readBoundedText(streamedRequest(['{"a":', '1}']), 16);
    expect(result).toEqual({ ok: true, text: '{"a":1}' });
  });

  it('accepts a body of exactly the cap', async () => {
    const result = await readBoundedText(streamedRequest(['12345678']), 8);
    expect(result).toEqual({ ok: true, text: '12345678' });
  });

  it('rejects a streamed body one byte over the cap', async () => {
    const result = await readBoundedText(streamedRequest(['1234', '56789']), 8);
    expect(result).toEqual({ ok: false });
  });

  it('counts bytes, not characters', async () => {
    const result = await readBoundedText(streamedRequest(['ééééé']), 8);
    expect(result).toEqual({ ok: false });
  });

  it('rejects on a declared Content-Length over the cap without reading the body', async () => {
    let pulled = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled = true;
        controller.enqueue(new TextEncoder().encode('x'));
        controller.close();
      },
    }, { highWaterMark: 0 });
    const request = new Request('https://post-engineer.com/oauth/register', {
      method: 'POST',
      headers: { 'content-length': '9' },
      body,
      duplex: 'half',
    } as RequestInit);
    const result = await readBoundedText(request, 8);
    expect(result).toEqual({ ok: false });
    expect(pulled).toBe(false);
    expect(request.bodyUsed).toBe(false);
  });

  it('still enforces the cap when Content-Length understates the body', async () => {
    const result = await readBoundedText(
      streamedRequest(['123456789'], { 'content-length': '2' }),
      8,
    );
    expect(result).toEqual({ ok: false });
  });

  it('treats a missing body as empty text', async () => {
    const request = new Request('https://post-engineer.com/oauth/register', { method: 'POST' });
    expect(await readBoundedText(request, 8)).toEqual({ ok: true, text: '' });
  });
});
