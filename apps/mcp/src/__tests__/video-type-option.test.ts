import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, vi } from 'vitest';

vi.mock('../analytics.js', () => ({
  mcpTelemetryHeaders: () => ({}),
  withTelemetryHeaders: (_headers: unknown, run: () => Promise<unknown>) => run(),
  withTracking: (_toolName: string, handler: (args: unknown) => Promise<unknown>) => async (args: unknown) => {
    return handler(args);
  },
}));

import { VIDEO_TYPE_ERROR_SUFFIX, VIDEO_TYPE_REQUIRED_MESSAGE, isVideoType, unknownVideoTypeMessage } from '../video-type.js';
import { GeneratePersonaVideoSchema, ValidateScriptSchema } from '../single-video-shape.js';
import { handleGeneratePersonaVideo, handleValidateScript } from '../tools-single-video.js';
import type { PostEngineerClient } from '../client.js';
import type { McpToolResponse } from '../tools.js';

//---------------
// video_type (issue #542 follow-up): the one video mode, with the
// invalid-value message listing every mode WITH its token cost, so the
// agent can choose knowing the price. The message is short on purpose:
// the MCP relays upstream errors through errors.ts, which truncates
// error detail at 200 chars — the message must arrive whole.
//---------------
// Walk up to the pnpm-workspace.yaml marker instead of climbing a fixed
// number of `..` segments: Stryker runs tests from a sandbox nested deeper
// than the repo layout (`.stryker-tmp/sandbox-<n>/`), where a fixed climb
// lands in apps/mcp instead of the repo root.
function findRepoRoot(fromUrl: string): string {
  let dir = dirname(fileURLToPath(fromUrl));
  for (;;) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) throw new Error(`findRepoRoot: pnpm-workspace.yaml not found above ${fromUrl}`);
    dir = parent;
  }
}
const repoRoot = findRepoRoot(import.meta.url);

function readSuffix(file: string, pattern: RegExp): string {
  const text = readFileSync(join(repoRoot, file), 'utf8');
  const match = text.match(pattern);
  if (match === null) throw new Error(`VIDEO_TYPE_ERROR_SUFFIX not found in ${file}`);
  return match[1];
}

const hook =
  'Stop wasting your trip stuck in a ninety minute line for the original dish when a better table is waiting nearby for you today.';
const body =
  'Locals skip the famous house and walk two minutes to a smaller kitchen where the sauce recipe has not changed since nineteen fifty three and the cook still greets every table by name before the first plate arrives at your table tonight.';
const cta = 'Save this video before your next trip to Porto.';
function photos(count: number, prefix: string): Array<{ url: string }> {
  return Array.from({ length: count }, (_, i) => ({ url: `https://example.com/${prefix}-${i + 1}.jpg` }));
}

const segments = [
  { kind: 'hook' as const, text: hook, media: photos(3, 'hook') },
  { kind: 'body' as const, text: body, media: photos(6, 'body') },
  { kind: 'cta' as const, text: cta, media: photos(2, 'cta') },
];
// Guard tests need segments that pass mechanical validation first (the
// handler validates the script before the persona guard): the 3/6/2-photo
// segments already satisfy the images-mode density rule, so only
// full_lipsync needs bare segments (11 photos exceed its 6-photo cap).
const bareSegments = segments.map((segment) => ({ kind: segment.kind, text: segment.text }));
const baseArgs = {
  personaId: 'persona-123',
  segments,
  title: 'Launch a SaaS in days',
  description: 'Agent description.',
  providers: ['youtube'] as 'youtube'[],
  youtubeAccountIds: ['chan-1'],
  mode: 'scheduled' as const,
  startAt: '2026-10-05T20:00:00',
  times: ['20:00'],
  timezone: 'Europe/Lisbon',
  options: { videoType: 'hook_lipsync' as const },
};

function textOf(response: McpToolResponse): string {
  const block = response.content[0];
  if (!block || block.type !== 'text') throw new Error('expected a text content block');
  return block.text;
}

function mockClient() {
  return {
    listVoices: vi.fn().mockResolvedValue({ voices: [] }),
    validateScript: vi.fn().mockResolvedValue({ success: true, valid: true, segmentCount: 3, totalWords: 60, hookWords: 20, bodyWords: 30, ctaWords: 10, mediaCount: 11, hookWindowSeconds: { min: 8, max: 12 }, measuredDurationSeconds: null, measured: 'pending', measuredReason: 'pending' }),
    generatePersonaVideo: vi.fn().mockResolvedValue({
      schedule: { id: 'sch-1', mode: 'scheduled' },
      slots: [{ slotId: 's1', slotAt: '2026-10-30T18:00:00Z', title: 'Porto trip', taskId: 'task-1', status: 'scheduled' }],
      replayed: false,
    }),
  } as unknown as PostEngineerClient;
}

describe('video_type error messages', () => {
  it('lists every mode with its cost', () => {
    expect(VIDEO_TYPE_ERROR_SUFFIX).toBe('use full_lipsync (8/15), hook_lipsync (2/3) or faceless (1)');
    expect(VIDEO_TYPE_REQUIRED_MESSAGE).toBe(`videoType is required; ${VIDEO_TYPE_ERROR_SUFFIX}`);
  });

  it('names the offending value and stays under the 200-char relay cap', () => {
    const message = unknownVideoTypeMessage('sideways');
    expect(message).toBe("unknown video_type 'sideways'; use full_lipsync (8/15), hook_lipsync (2/3) or faceless (1)");
    expect(message.length).toBeLessThan(200);
    // A 100-char value is clipped to 32, so the whole message still fits.
    expect(unknownVideoTypeMessage('x'.repeat(100)).length).toBeLessThan(200);
    expect(unknownVideoTypeMessage('x'.repeat(100))).toContain(`'${'x'.repeat(32)}'`);
    expect(unknownVideoTypeMessage(null)).toBe("unknown video_type ''; use full_lipsync (8/15), hook_lipsync (2/3) or faceless (1)");
    expect(unknownVideoTypeMessage(undefined)).toBe("unknown video_type ''; use full_lipsync (8/15), hook_lipsync (2/3) or faceless (1)");
  });

  it('narrows only the three modes', () => {
    expect(isVideoType('full_lipsync')).toBe(true);
    expect(isVideoType('hook_lipsync')).toBe(true);
    expect(isVideoType('faceless')).toBe(true);
    expect(isVideoType('sideways')).toBe(false);
    expect(isVideoType(undefined)).toBe(false);
    expect(isVideoType(null)).toBe(false);
  });

  it('matches the engine and web suffix literals exactly', () => {
    const engineSuffix = readSuffix(join('apps', 'engine', 'app', 'models', 'schema.py'), /VIDEO_TYPE_ERROR_SUFFIX = "([^"]+)"/);
    expect(engineSuffix).toBe(VIDEO_TYPE_ERROR_SUFFIX);
    const webSuffix = readSuffix(join('apps', 'web', 'lib', 'tokens.ts'), /VIDEO_TYPE_ERROR_SUFFIX =\s*'([^']+)'/);
    expect(webSuffix).toBe(VIDEO_TYPE_ERROR_SUFFIX);
  });
});

describe('generate_persona_video videoType shape', () => {
  it('accepts each of the three modes', () => {
    for (const videoType of ['full_lipsync', 'hook_lipsync', 'faceless'] as const) {
      expect(GeneratePersonaVideoSchema.safeParse({ ...baseArgs, options: { videoType } }).success).toBe(true);
    }
  });

  it('rejects a missing videoType (options absent) with the required message', () => {
    const { options: _options, ...rest } = baseArgs;
    const result = GeneratePersonaVideoSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path.join('.') === 'options.videoType');
      expect(issue).toBeDefined();
      expect(issue?.message).toBe(`options.videoType is required; ${VIDEO_TYPE_ERROR_SUFFIX}`);
    }
  });

  it('rejects a missing videoType (options present, mode absent) with the required message', () => {
    const result = GeneratePersonaVideoSchema.safeParse({ ...baseArgs, options: {} });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path.join('.') === 'options.videoType');
      expect(issue).toBeDefined();
      expect(issue?.message).toBe(`options.videoType is required; ${VIDEO_TYPE_ERROR_SUFFIX}`);
    }
  });

  it('rejects an unknown videoType with the costs message', () => {
    const result = GeneratePersonaVideoSchema.safeParse({ ...baseArgs, options: { videoType: 'sideways' } });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path.join('.') === 'options.videoType');
      expect(issue).toBeDefined();
      expect(issue?.message).toBe("unknown video_type 'sideways'; use full_lipsync (8/15), hook_lipsync (2/3) or faceless (1)");
    }
  });
});

describe('validate_script videoType shape', () => {
  it('accepts an absent videoType (hook_lipsync default)', () => {
    expect(ValidateScriptSchema.safeParse({ segments }).success).toBe(true);
  });

  it('rejects an unknown videoType with the costs message', () => {
    const result = ValidateScriptSchema.safeParse({ segments, videoType: 'sideways' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe("unknown video_type 'sideways'; use full_lipsync (8/15), hook_lipsync (2/3) or faceless (1)");
    }
  });
});

describe('generate_persona_video videoType guards (no charge)', () => {
  it('rejects full_lipsync without a persona before any client call', async () => {
    const client = mockClient();
    const { personaId: _personaId, ...rest } = baseArgs;
    const response = await handleGeneratePersonaVideo(client, {
      ...rest,
      segments: bareSegments,
      options: { videoType: 'full_lipsync' },
    });
    expect(response.isError).toBe(true);
    expect(textOf(response)).toContain('must be faceless');
    expect(client.generatePersonaVideo).not.toHaveBeenCalled();
  });

  it('rejects hook_lipsync without a persona before any client call', async () => {
    const client = mockClient();
    const { personaId: _personaId, ...rest } = baseArgs;
    const response = await handleGeneratePersonaVideo(client, { ...rest, options: { videoType: 'hook_lipsync' } });
    expect(response.isError).toBe(true);
    expect(textOf(response)).toContain('must be faceless');
    expect(client.generatePersonaVideo).not.toHaveBeenCalled();
  });

  it('rejects a faceless post without a persona and without a voice before any client call', async () => {
    const client = mockClient();
    const { personaId: _personaId, ...rest } = baseArgs;
    const response = await handleGeneratePersonaVideo(client, { ...rest, options: { videoType: 'faceless' } });
    expect(response.isError).toBe(true);
    expect(textOf(response)).toContain('must have a voice');
    expect(client.generatePersonaVideo).not.toHaveBeenCalled();
  });

  it('accepts a faceless post without a persona when a voice is given', async () => {
    const client = mockClient();
    const { personaId: _personaId, ...rest } = baseArgs;
    const response = await handleGeneratePersonaVideo(client, {
      ...rest,
      options: { videoType: 'faceless', voiceId: 'chatterbox:kokoro_af_heart' },
    });
    expect(response.isError).toBeUndefined();
    expect(client.generatePersonaVideo).toHaveBeenCalledTimes(1);
  });
});

describe('validate_script videoType (no charge)', () => {
  it('keeps media optional for full_lipsync and required for faceless', async () => {
    const client = mockClient();
    const bare = segments.map((segment) => ({ kind: segment.kind, text: segment.text }));
    const full = await handleValidateScript(client, { segments: bare, videoType: 'full_lipsync' });
    expect(full.isError).toBeUndefined();
    const faceless = await handleValidateScript(client, { segments: bare, videoType: 'faceless' });
    expect(faceless.isError).toBe(true);
    expect(textOf(faceless)).toContain('segments.0.media');
  });
});
