import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { z } from 'zod';
import { PostEngineerClient } from '../client.js';
import { createPostEngineerMcpServer } from '../index.js';
import type { McpTransportKind } from '../tools-prompts.js';

const { fileReads, httpsRequests, lookups } = vi.hoisted(() => ({
  fileReads: [] as string[],
  httpsRequests: [] as string[],
  lookups: [] as string[],
}));

vi.mock('../bounded-file-read.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../bounded-file-read.js')>();
  return {
    ...actual,
    readBoundedRegularFile: async (path: string, maxBytes: number) => {
      fileReads.push(path);
      return actual.readBoundedRegularFile(path, maxBytes);
    },
  };
});

vi.mock('node:https', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:https')>();
  return {
    ...actual,
    request: (url: unknown) => {
      httpsRequests.push(String(url));
      throw new Error('outbound https is blocked in this test');
    },
  };
});

vi.mock('node:dns/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:dns/promises')>();
  return {
    ...actual,
    lookup: async (hostname: string) => {
      lookups.push(hostname);
      return [{ address: '10.0.0.1', family: 4 }];
    },
  };
});

vi.mock('../analytics.js', () => ({
  mcpTelemetryHeaders: () => ({}),
  withTelemetryHeaders: (_headers: unknown, run: () => Promise<unknown>) => run(),
  withToolCall: (_tool: string, _action: string, run: () => Promise<unknown>) => run(),
  withTracking: (_toolName: string, handler: (args: unknown) => Promise<unknown>) => async (args: unknown) => handler(args),
}));

const API_ORIGIN = 'https://api.remote-io.test';
const here = dirname(fileURLToPath(import.meta.url));
const SampleSchema = z.object({ args: z.record(z.string(), z.unknown()), responses: z.record(z.string(), z.unknown()).optional() }).strict();
type Sample = z.infer<typeof SampleSchema>;
const ACTION_SAMPLES: Record<string, Sample[]> = z
  .record(z.string(), z.array(SampleSchema).min(1))
  .parse(JSON.parse(readFileSync(join(here, 'parity-action-samples.json'), 'utf8')));

const TEMP_DIR = mkdtempSync(join(tmpdir(), 'remote-host-io-'));
afterAll(() => rmSync(TEMP_DIR, { recursive: true, force: true }));

const PNG_BYTES = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');

function tempFile(name: string): string {
  const file = join(TEMP_DIR, name);
  writeFileSync(file, name.endsWith('.png') ? PNG_BYTES : 'sample');
  return file;
}

function withTempFiles(value: unknown): unknown {
  if (typeof value === 'string') {
    return value.replace(/\{\{tmp:([\w.-]+)\}\}/g, (_match, name: string) => tempFile(name));
  }
  if (Array.isArray(value)) return value.map(withTempFiles);
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, withTempFiles(entry)]));
  }
  return value;
}

function smuggledLocalPaths(): Record<string, unknown> {
  const image = tempFile('smuggled.png');
  return {
    path: image,
    avatarPath: image,
    imagePath: image,
    images: [{ path: image }],
    videoPath: tempFile('smuggled.mp4'),
    audioPath: tempFile('smuggled.mp3'),
  };
}

const INTERNAL_IMAGE_URLS = ['http://127.0.0.1:9/a.png', 'https://169.254.169.254/a.png', 'https://10.0.0.1/a.png', 'https://internal.example/a.png'];
const IMAGE_URL_ACTIONS = new Set(['media.upload', 'persona_media.add_image']);

const INTERNAL_AUDIO_URLS = ['http://127.0.0.1:9/a.mp3', 'https://169.254.169.254/a.mp3', 'https://10.0.0.1/a.mp3', 'https://internal.example/a.mp3'];

interface ToolCall {
  readonly name: string;
  readonly args: Record<string, unknown>;
  readonly responses: Readonly<Record<string, unknown>>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function connectedClient(transport: McpTransportKind): Promise<Client> {
  const server = createPostEngineerMcpServer(new PostEngineerClient({ apiKey: 'remote-io-proof', baseUrl: API_ORIGIN }), transport);
  const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'remote-io-sweep', version: '0.0.0' });
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  return client;
}

interface OfferedAction {
  readonly tool: string;
  readonly action: string | null;
}

async function offeredActions(transport: McpTransportKind): Promise<OfferedAction[]> {
  const client = await connectedClient(transport);
  try {
    const { tools } = await client.listTools();
    return tools.flatMap((tool): OfferedAction[] => {
      const action = tool.inputSchema.properties?.action;
      const names = isRecord(action) && Array.isArray(action.enum) ? action.enum.filter((entry): entry is string => typeof entry === 'string') : [];
      return names.length === 0 ? [{ tool: tool.name, action: null }] : names.map((name) => ({ tool: tool.name, action: name }));
    });
  } finally {
    await client.close();
  }
}

function sampleCalls(tool: string, action: string | null): ToolCall[] {
  const samples = action === null ? undefined : ACTION_SAMPLES[`${tool}.${action}`];
  const base: Sample[] = samples ?? [{ args: action === null ? {} : { action } }];
  return base.map((sample) => {
    const args = withTempFiles(sample.args);
    return { name: tool, args: isRecord(args) ? args : {}, responses: sample.responses ?? {} };
  });
}

const LOCAL_PATH_TWINS: Readonly<Record<string, { readonly drop: readonly string[]; readonly set: Readonly<Record<string, unknown>> }>> = {
  path: { drop: [], set: {} },
  avatarPath: { drop: ['avatarUrl'], set: {} },
  imagePath: { drop: ['taskId', 'uploadId'], set: { mediaKind: 'image' } },
  images: { drop: [], set: {} },
  videoPath: { drop: [], set: {} },
  audioPath: { drop: ['audioUrl'], set: {} },
};

function withOnlyLocalField(args: Record<string, unknown>, field: string, value: unknown): Record<string, unknown> {
  const twin = LOCAL_PATH_TWINS[field];
  const kept = Object.fromEntries(Object.entries(args).filter(([key]) => !twin.drop.includes(key)));
  return { ...kept, ...twin.set, [field]: value };
}

function localFieldVariants(call: ToolCall): ToolCall[] {
  return Object.entries(smuggledLocalPaths()).map(([field, value]) => ({ ...call, args: withOnlyLocalField(call.args, field, value) }));
}

const INSTAGRAM_ACCOUNTS = {
  'GET /api/account': {
    authenticated: true,
    accounts: [{ provider: 'instagram', recordId: 'rec-ig', igUserId: 'ig-1', username: 'maria', connectedAt: 1700000000000, lastUsed: 1700000000000 }],
    message: 'Accounts retrieved from Supabase',
  },
};

function imageAccountVariants(tool: string, action: string | null, calls: readonly ToolCall[]): ToolCall[] {
  if (tool !== 'publish_video' || action !== 'publish_existing') return [];
  return calls.map((call) => ({
    ...call,
    args: { ...withOnlyLocalField(call.args, 'imagePath', tempFile('smuggled.png')), accounts: ['ig-1'], caption: 'hi' },
    responses: { ...call.responses, ...INSTAGRAM_ACCOUNTS },
  }));
}

function hostileCalls(tool: string, action: string | null): ToolCall[] {
  const samples = sampleCalls(tool, action);
  return [
    ...samples.flatMap((call) => {
      const smuggled = { ...call, args: { ...call.args, ...smuggledLocalPaths() } };
      const internalUrls = typeof call.args.audioUrl === 'string' ? INTERNAL_AUDIO_URLS.map((audioUrl) => ({ ...call, args: { ...call.args, audioUrl } })) : [];
      const internalImages = IMAGE_URL_ACTIONS.has(`${tool}.${action}`) ? INTERNAL_IMAGE_URLS.map((imageUrl) => ({ ...call, args: { ...call.args, imageUrl } })) : [];
      return [call, smuggled, ...localFieldVariants(call), ...internalUrls, ...internalImages];
    }),
    ...imageAccountVariants(tool, action, samples),
  ];
}

const LOCAL_READ_ACTIONS = [
  'media.upload',
  'persona_media.add_image',
  'personas.create',
  'personas.update',
  'publish_video.from_file',
  'publish_video.publish_existing',
  'voices.create_clone',
];

const FILE_ONLY_SAMPLES: ReadonlyArray<readonly [string, string]> = [
  ['media', 'upload'],
  ['persona_media', 'add_image'],
  ['publish_video', 'from_file'],
];

interface HostIo {
  readonly fileReads: string[];
  readonly foreignFetches: string[];
  readonly httpsRequests: string[];
}

const foreignFetches: string[] = [];
const realFetch = globalThis.fetch;

beforeEach(() => {
  fileReads.length = 0;
  httpsRequests.length = 0;
  lookups.length = 0;
  foreignFetches.length = 0;
  globalThis.fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (new URL(url).origin !== API_ORIGIN) {
      foreignFetches.push(url);
      throw new Error('outbound fetch is blocked in this test');
    }
    const method = (init?.method ?? 'GET').toUpperCase();
    return Response.json(currentResponses[`${method} ${new URL(url).pathname}`] ?? { success: true, body: {}, data: {} });
  };
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

let currentResponses: Readonly<Record<string, unknown>> = {};

async function hostIoOf(transport: McpTransportKind, call: ToolCall): Promise<HostIo> {
  fileReads.length = 0;
  httpsRequests.length = 0;
  foreignFetches.length = 0;
  currentResponses = call.responses;
  const client = await connectedClient(transport);
  try {
    await client.callTool({ name: call.name, arguments: call.args });
  } finally {
    await client.close();
  }
  return { fileReads: [...fileReads], foreignFetches: [...foreignFetches], httpsRequests: [...httpsRequests] };
}

describe('remote (http) host I/O sweep', () => {
  it('no offered action reads a host file or fetches a non-public caller URL on http, even with smuggled paths', async () => {
    const actions = await offeredActions('http');
    expect(actions.length).toBeGreaterThan(40);
    const violations: string[] = [];
    let calls = 0;
    for (const { tool, action } of actions) {
      for (const call of hostileCalls(tool, action)) {
        calls += 1;
        const io = await hostIoOf('http', call);
        const label = `${tool}.${action ?? '-'} ${JSON.stringify(call.args)}`;
        if (io.fileReads.length > 0) violations.push(`${label} read ${io.fileReads.join(', ')}`);
        if (io.foreignFetches.length > 0) violations.push(`${label} fetched ${io.foreignFetches.join(', ')}`);
        if (io.httpsRequests.length > 0) violations.push(`${label} connected to ${io.httpsRequests.join(', ')}`);
      }
    }
    expect(calls).toBeGreaterThan(actions.length);
    expect(violations).toEqual([]);
  }, 120_000);

  it('calls a file-only action by name on http without touching the file', async () => {
    for (const [tool, action] of FILE_ONLY_SAMPLES) {
      for (const call of sampleCalls(tool, action)) {
        const io = await hostIoOf('http', call);
        expect(io.fileReads, `${tool}.${action}`).toEqual([]);
      }
    }
  });

  it('resolves the clone audio host and refuses a private answer on http', async () => {
    const call = sampleCalls('voices', 'create_clone').find((entry) => typeof entry.args.audioUrl === 'string');
    if (call === undefined) throw new Error('create_clone samples must cover audioUrl');
    lookups.length = 0;
    const io = await hostIoOf('http', call);
    expect(lookups).toEqual(['example.com']);
    expect(io.httpsRequests).toEqual([]);
    expect(io.foreignFetches).toEqual([]);
  });
});

describe('remote image URL actions', () => {
  it.each([...IMAGE_URL_ACTIONS])('resolves the image host and refuses a private answer on http for %s', async (key) => {
    const [tool, action] = key.split('.');
    const call = sampleCalls(tool, action)[0];
    const withUrl: ToolCall = { ...call, args: { ...call.args, imageUrl: 'https://example.com/a.png' } };
    lookups.length = 0;
    const io = await hostIoOf('http', withUrl);
    expect(lookups).toEqual(['example.com']);
    expect(io.httpsRequests).toEqual([]);
    expect(io.foreignFetches).toEqual([]);
    expect(io.fileReads).toEqual([]);
  });
});

describe('stdio host I/O control', () => {
  it('the same hostile sweep reaches a local read on stdio in every action that takes a path', async () => {
    const reading = new Set<string>();
    for (const { tool, action } of await offeredActions('stdio')) {
      for (const call of hostileCalls(tool, action)) {
        if ((await hostIoOf('stdio', call)).fileReads.length > 0) reading.add(`${tool}.${action ?? '-'}`);
      }
    }
    expect([...reading].sort()).toEqual(LOCAL_READ_ACTIONS);
  }, 120_000);

  it('the file-only actions read their local file on stdio', async () => {
    for (const [tool, action] of FILE_ONLY_SAMPLES) {
      const reads = [];
      for (const call of sampleCalls(tool, action)) {
        reads.push(...(await hostIoOf('stdio', call)).fileReads);
      }
      expect(reads.length, `${tool}.${action}`).toBeGreaterThan(0);
    }
  });

  it('create_clone reads a local audioPath and fetches an audioUrl on stdio', async () => {
    const calls = sampleCalls('voices', 'create_clone');
    const fromFile = calls.find((call) => typeof call.args.audioPath === 'string');
    const fromUrl = calls.find((call) => typeof call.args.audioUrl === 'string');
    if (fromFile === undefined || fromUrl === undefined) throw new Error('create_clone samples must cover audioPath and audioUrl');
    expect((await hostIoOf('stdio', fromFile)).fileReads).toEqual([fromFile.args.audioPath]);
    expect((await hostIoOf('stdio', fromUrl)).foreignFetches).toEqual(['https://example.com/a.mp3']);
  });
});
