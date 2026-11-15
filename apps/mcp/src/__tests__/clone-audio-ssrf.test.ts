import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchCloneReferenceAudio, type HostLookup } from '../cloned-voice-client.js';
import { createPostEngineerMcpServer } from '../index.js';
import type { PostEngineerClient } from '../client.js';
import { isPublicIp } from '../public-ip.js';

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

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
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
  });

  it('rejects a host that resolves to a private address', async () => {
    const lookup = lookupOf(['10.0.0.5']);
    await expect(
      fetchCloneReferenceAudio('https://audio.example.com/ref.mp3', { remote: true, lookup }),
    ).rejects.toThrow(/public host/);
    expect(lookup).toHaveBeenCalledWith('audio.example.com');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects when any resolved address is private', async () => {
    const lookup = lookupOf(['93.184.216.34', '169.254.169.254']);
    await expect(
      fetchCloneReferenceAudio('https://audio.example.com/ref.mp3', { remote: true, lookup }),
    ).rejects.toThrow(/public host/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a literal private IPv6 host', async () => {
    const lookup = lookupOf(['93.184.216.34']);
    await expect(
      fetchCloneReferenceAudio('https://[::1]/ref.mp3', { remote: true, lookup }),
    ).rejects.toThrow(/public host/);
    expect(lookup).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fails closed when DNS resolution fails', async () => {
    const lookup = vi.fn<HostLookup>().mockRejectedValue(new Error('ENOTFOUND'));
    await expect(
      fetchCloneReferenceAudio('https://audio.example.com/ref.mp3', { remote: true, lookup }),
    ).rejects.toThrow(/public host/);
    expect(fetchMock).not.toHaveBeenCalled();
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

  it('downloads from a public host', async () => {
    fetchMock.mockResolvedValue(okAudio());
    const lookup = lookupOf(['93.184.216.34']);
    const blob = await fetchCloneReferenceAudio('https://audio.example.com/ref.mp3', { remote: true, lookup });
    expect(blob.size).toBe(3);
    expect(lookup).toHaveBeenCalledWith('audio.example.com');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://audio.example.com/ref.mp3',
      expect.objectContaining({ redirect: 'error' }),
    );
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
