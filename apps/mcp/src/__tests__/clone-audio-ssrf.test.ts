import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EventEmitter } from 'node:events';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchCloneReferenceAudio, type HostLookup } from '../cloned-voice-client.js';
import { createPostEngineerMcpServer } from '../index.js';
import type { PostEngineerClient } from '../client.js';
import { isPublicIp } from '../public-ip.js';

const { httpsRequestMock } = vi.hoisted(() => ({ httpsRequestMock: vi.fn() }));

// The remote download goes through node:https with a pinned lookup, not the
// global fetch: the mock below stands in for the socket.
vi.mock('node:https', () => ({ request: httpsRequestMock }));

vi.mock('../analytics.js', () => ({
  mcpTelemetryHeaders: () => ({}),
  withTelemetryHeaders: (_headers: unknown, run: () => Promise<unknown>) => run(),
  withToolCall: (_tool: string, _action: string, run: () => Promise<unknown>) => run(),
  withTracking: (_toolName: string, handler: (args: unknown) => Promise<unknown>) => async (args: unknown) => handler(args),
}));

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

interface PublicIpCases {
  blocked: string[];
  allowed: string[];
  blockedBeyondPython: string[];
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function loadCases(): PublicIpCases {
  const raw: unknown = JSON.parse(readFileSync(join(root, 'shared', 'ssrf', 'public-ip-cases.json'), 'utf8'));
  if (
    typeof raw !== 'object' ||
    raw === null ||
    !('blocked' in raw) ||
    !('allowed' in raw) ||
    !('blockedBeyondPython' in raw) ||
    !isStringArray(raw.blocked) ||
    !isStringArray(raw.allowed) ||
    !isStringArray(raw.blockedBeyondPython)
  ) {
    throw new Error('shared/ssrf/public-ip-cases.json has an unexpected shape');
  }
  return { blocked: raw.blocked, allowed: raw.allowed, blockedBeyondPython: raw.blockedBeyondPython };
}

describe('isPublicIp matches the shared SSRF cases', () => {
  const cases = loadCases();

  it('has non-empty case lists', () => {
    expect(cases.blocked.length).toBeGreaterThan(0);
    expect(cases.allowed.length).toBeGreaterThan(0);
    expect(cases.blockedBeyondPython.length).toBeGreaterThan(0);
  });

  it('blocks every blocked and blockedBeyondPython address', () => {
    for (const ip of [...cases.blocked, ...cases.blockedBeyondPython]) {
      expect(isPublicIp(ip), ip).toBe(false);
    }
  });

  it('allows every allowed address', () => {
    for (const ip of cases.allowed) {
      expect(isPublicIp(ip), ip).toBe(true);
    }
  });
});

const realFetch = global.fetch;

function okAudio(): Response {
  return new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'audio/mpeg' } });
}

function lookupOf(addresses: string[]): ReturnType<typeof vi.fn<HostLookup>> {
  return vi.fn<HostLookup>().mockResolvedValue(addresses.map((address) => ({ address })));
}

describe('fetchCloneReferenceAudio on the remote server', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  // Captured https.request call: url, options (incl. the pinned lookup),
  // and the response callback.
  let capturedRequest: {
    url: unknown;
    options: { lookup?: (...args: never[]) => unknown; signal?: unknown };
    callback: (res: unknown) => void;
  } | null = null;

  // Fake IncomingMessage: an async-iterable body plus the status, headers
  // and stream controls the download reads.
  function httpsAudioResponse(
    chunks: Uint8Array[],
    statusCode = 200,
    contentType = 'audio/mpeg',
  ): unknown {
    const stream = (async function* () {
      for (const chunk of chunks) yield chunk;
    })();
    return Object.assign(stream, {
      statusCode,
      headers: { 'content-type': contentType },
      resume: vi.fn(),
      destroy: vi.fn(),
    });
  }

  // Arm the https mock: end() either delivers the armed response or emits
  // the armed socket error, mirroring a real request.
  function armHttps(response: unknown, error: Error | null = null): void {
    capturedRequest = null;
    httpsRequestMock.mockImplementation(
      (
        url: unknown,
        options: { lookup?: (...args: never[]) => unknown; signal?: unknown },
        callback: (res: unknown) => void,
      ) => {
        const req = new EventEmitter() as EventEmitter & {
          end: () => void;
          destroy: () => void;
        };
        req.end = () => {
          if (error !== null) req.emit('error', error);
          else callback(response);
        };
        req.destroy = () => {};
        capturedRequest = { url, options, callback };
        return req;
      },
    );
  }

  // Call the lookup pinned into the captured request and collect its answer.
  function pinnedLookupAnswer(
    hostname: string,
    options: { family?: number; all?: boolean },
  ): Promise<{ error: unknown; address: unknown; family: unknown }> {
    const lookup = capturedRequest?.options.lookup;
    if (typeof lookup !== 'function') throw new Error('no pinned lookup captured');
    return new Promise((resolvePromise) => {
      (
        lookup as (
          hostname: string,
          options: { family?: number; all?: boolean },
          callback: (error: unknown, address: unknown, family?: unknown) => void,
        ) => void
      )(hostname, options, (error, address, family) => {
        resolvePromise({ error, address, family });
      });
    });
  }

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    httpsRequestMock.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    global.fetch = realFetch;
  });

  it('rejects http on loopback', async () => {
    const lookup = lookupOf(['127.0.0.1']);
    await expect(
      fetchCloneReferenceAudio('http://127.0.0.1:8080/ref.wav', { remote: true, lookup }),
    ).rejects.toThrow(/must use https/);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(httpsRequestMock).not.toHaveBeenCalled();
  });

  it('rejects a host that resolves to a private address', async () => {
    const lookup = lookupOf(['10.0.0.5']);
    await expect(
      fetchCloneReferenceAudio('https://audio.example.com/ref.mp3', { remote: true, lookup }),
    ).rejects.toThrow(/public host/);
    expect(lookup).toHaveBeenCalledWith('audio.example.com');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(httpsRequestMock).not.toHaveBeenCalled();
  });

  it('rejects when any resolved address is private', async () => {
    const lookup = lookupOf(['93.184.216.34', '169.254.169.254']);
    await expect(
      fetchCloneReferenceAudio('https://audio.example.com/ref.mp3', { remote: true, lookup }),
    ).rejects.toThrow(/public host/);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(httpsRequestMock).not.toHaveBeenCalled();
  });

  it('rejects a literal private IPv6 host', async () => {
    const lookup = lookupOf(['93.184.216.34']);
    await expect(
      fetchCloneReferenceAudio('https://[::1]/ref.mp3', { remote: true, lookup }),
    ).rejects.toThrow(/public host/);
    expect(lookup).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(httpsRequestMock).not.toHaveBeenCalled();
  });

  it('fails closed when DNS resolution fails', async () => {
    const lookup = vi.fn<HostLookup>().mockRejectedValue(new Error('ENOTFOUND'));
    await expect(
      fetchCloneReferenceAudio('https://audio.example.com/ref.mp3', { remote: true, lookup }),
    ).rejects.toThrow(/public host/);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(httpsRequestMock).not.toHaveBeenCalled();
  });

  it('does not echo a resolved address in the error', async () => {
    const lookup = lookupOf(['10.0.0.5']);
    const error: unknown = await fetchCloneReferenceAudio('https://audio.example.com/ref.mp3', {
      remote: true,
      lookup,
    }).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(Error);
    expect(error instanceof Error ? error.message : '').not.toContain('10.0.0.5');
  });

  it('downloads from a public host over the pinned connection', async () => {
    armHttps(httpsAudioResponse([new Uint8Array([1, 2, 3])]));
    const lookup = lookupOf(['93.184.216.34']);
    const blob = await fetchCloneReferenceAudio('https://audio.example.com/ref.mp3', { remote: true, lookup });
    expect(blob.size).toBe(3);
    expect(blob.type).toBe('audio/mpeg');
    expect(lookup).toHaveBeenCalledWith('audio.example.com');
    expect(httpsRequestMock).toHaveBeenCalledTimes(1);
    expect(httpsRequestMock).toHaveBeenCalledWith(
      'https://audio.example.com/ref.mp3',
      expect.objectContaining({ lookup: expect.any(Function), signal: expect.anything() }),
      expect.any(Function),
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('pins DNS to the validated address even if the name re-resolves elsewhere', async () => {
    armHttps(httpsAudioResponse([new Uint8Array([1, 2, 3])]));
    const lookup = lookupOf(['93.184.216.34']);
    await fetchCloneReferenceAudio('https://audio.example.com/ref.mp3', { remote: true, lookup });
    // The pinned lookup ignores the hostname entirely: a second answer
    // (DNS rebinding) can never steer the socket to another address.
    const rebound = await pinnedLookupAnswer('attacker.example.com', { family: 0 });
    expect(rebound.error).toBeNull();
    expect(rebound.address).toBe('93.184.216.34');
    expect(rebound.family).toBe(4);
    const all = await pinnedLookupAnswer('audio.example.com', { family: 0, all: true });
    expect(all.error).toBeNull();
    expect(all.address).toEqual([{ address: '93.184.216.34', family: 4 }]);
  });

  it('fails the pinned lookup closed when the family has no validated address', async () => {
    armHttps(httpsAudioResponse([new Uint8Array([1, 2, 3])]));
    const lookup = lookupOf(['2606:4700:4700::1111']);
    await fetchCloneReferenceAudio('https://audio.example.com/ref.mp3', { remote: true, lookup });
    const ipv4 = await pinnedLookupAnswer('audio.example.com', { family: 4 });
    expect(ipv4.error).toBeInstanceOf(Error);
    expect((ipv4.error as Error).message).toMatch(/ENOTFOUND/);
    const ipv6 = await pinnedLookupAnswer('audio.example.com', { family: 6 });
    expect(ipv6.error).toBeNull();
    expect(ipv6.address).toBe('2606:4700:4700::1111');
    expect(ipv6.family).toBe(6);
  });

  it('rejects a redirect on the remote download', async () => {
    armHttps(httpsAudioResponse([], 302, 'text/html'));
    const lookup = lookupOf(['93.184.216.34']);
    await expect(
      fetchCloneReferenceAudio('https://audio.example.com/ref.mp3', { remote: true, lookup }),
    ).rejects.toThrow(/redirect not allowed/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports the upstream HTTP status on a failed remote download', async () => {
    armHttps(httpsAudioResponse([], 500, 'text/html'));
    const lookup = lookupOf(['93.184.216.34']);
    await expect(
      fetchCloneReferenceAudio('https://audio.example.com/ref.mp3', { remote: true, lookup }),
    ).rejects.toThrow(/HTTP 500/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects an oversized remote download without buffering it', async () => {
    armHttps(httpsAudioResponse([Buffer.alloc(21 * 1024 * 1024, 1)]));
    const lookup = lookupOf(['93.184.216.34']);
    await expect(
      fetchCloneReferenceAudio('https://audio.example.com/ref.mp3', { remote: true, lookup }),
    ).rejects.toThrow(/exceeds 20 MB/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects an empty remote download', async () => {
    armHttps(httpsAudioResponse([]));
    const lookup = lookupOf(['93.184.216.34']);
    await expect(
      fetchCloneReferenceAudio('https://audio.example.com/ref.mp3', { remote: true, lookup }),
    ).rejects.toThrow(/Downloaded audio is empty/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fails the remote download when the socket errors', async () => {
    armHttps(null, new Error('socket boom'));
    const lookup = lookupOf(['93.184.216.34']);
    await expect(
      fetchCloneReferenceAudio('https://audio.example.com/ref.mp3', { remote: true, lookup }),
    ).rejects.toThrow(/socket boom/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('stdio keeps the loopback allowance', async () => {
    fetchMock.mockResolvedValue(okAudio());
    const blob = await fetchCloneReferenceAudio('http://127.0.0.1:8080/ref.wav');
    expect(blob.size).toBe(3);
  });
});

describe('registerVoiceTools passes remote to the download', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    global.fetch = realFetch;
  });

  it('remote create_clone rejects an http loopback audioUrl before any fetch', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const host = {
      baseUrl: 'https://api.test',
      getHeaders: vi.fn(() => ({ Authorization: 'Bearer test-token' })),
      request: vi.fn(),
    };
    const server = createPostEngineerMcpServer(host as unknown as PostEngineerClient, 'http');
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'test-client', version: '0.0.0' });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    try {
      const result = await client.callTool({
        name: 'voices',
        arguments: { action: 'create_clone', audioUrl: 'http://127.0.0.1:8080/ref.wav', language: 'en', consent: true, denoise: true },
      });
      expect(result.isError).toBe(true);
      expect(JSON.stringify(result.content)).toMatch(/https/);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(host.request).not.toHaveBeenCalled();
    } finally {
      await client.close();
    }
  });
});
