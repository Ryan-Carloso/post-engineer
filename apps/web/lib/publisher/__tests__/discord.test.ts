// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { logger } from '@/lib/logger';
import {
  DISCORD_MAX_CONTENT,
  partialPublishMessage,
  redactKnownUrl,
  resetDiscordWarningForTests,
  safeDiscordReason,
  schedulerStartedMessage,
  sendDiscord,
  slotFailedMessage,
  slotPublishedMessage,
  userActionMessage,
} from '@/lib/publisher/discord';

const URL_WITH_TOKEN = 'https://discord.com/api/webhooks/123456/SECRET-token_abc';

function okResponse(ok = true, status = 204): Response {
  return { ok, status } as Response;
}

describe('sendDiscord', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('DISCORD_WEBHOOK_URL', undefined);
    resetDiscordWarningForTests();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('is a no-op that warns once when the webhook url is not set', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const fetchMock = vi.fn();
    expect(await sendDiscord('hi', { fetch: fetchMock })).toBe(false);
    expect(await sendDiscord('hi again', { fetch: fetchMock })).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toContain('DISCORD_WEBHOOK_URL not set');
    warn.mockRestore();
  });

  it('posts the content as JSON to the env url, refusing redirects', async () => {
    vi.stubEnv('DISCORD_WEBHOOK_URL', URL_WITH_TOKEN);
    const fetchMock = vi.fn(async () => okResponse());
    expect(await sendDiscord('hello', { fetch: fetchMock })).toBe(true);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(URL_WITH_TOKEN);
    expect(init.method).toBe('POST');
    expect(init.redirect).toBe('error');
    expect(JSON.parse(init.body as string)).toEqual({ content: 'hello' });
  });

  it('never raises and never logs the url when the post fails', async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError(`fetch failed for ${URL_WITH_TOKEN}`);
    });
    expect(await sendDiscord('hello', { fetch: fetchMock, webhookUrl: URL_WITH_TOKEN })).toBe(false);
    expect(logger.warn).toHaveBeenCalledWith('[discord] notify failed', { reason: 'TypeError' });
    expect(JSON.stringify(vi.mocked(logger.warn).mock.calls)).not.toContain('SECRET');
  });

  it('counts a non-2xx response as a failure', async () => {
    const fetchMock = vi.fn(async () => okResponse(false, 429));
    expect(await sendDiscord('hello', { fetch: fetchMock, webhookUrl: URL_WITH_TOKEN })).toBe(false);
    expect(logger.warn).toHaveBeenCalledWith('[discord] notify failed', { status: 429 });
  });
});

describe('redactKnownUrl and safeDiscordReason', () => {
  it('replaces the url and its path variants', () => {
    expect(redactKnownUrl(`POST ${URL_WITH_TOKEN} failed`, URL_WITH_TOKEN)).toBe('POST [redacted] failed');
    expect(redactKnownUrl('connect /api/webhooks/123456/SECRET-token_abc refused', URL_WITH_TOKEN)).toBe('connect [redacted] refused');
    expect(redactKnownUrl('GET /api/webhooks/123456/SECRET-token_abc?wait=true x', `${URL_WITH_TOKEN}?wait=true`)).toBe('GET [redacted] x');
  });

  it('replaces the percent-encoded form of the url', () => {
    const url = 'https://discord.com/api/webhooks/123456/sec ret';
    expect(redactKnownUrl('bad https://discord.com/api/webhooks/123456/sec%20ret end', url)).toBe('bad [redacted] end');
  });

  it('skips a degenerate path that would rewrite every slash', () => {
    expect(redactKnownUrl('a/b/c', 'https://x.example/')).toBe('a/b/c');
  });

  it('leaves the message alone without a url and handles a url that does not parse', () => {
    expect(redactKnownUrl('a b', '')).toBe('a b');
    expect(redactKnownUrl('open not-a-valid-url now', 'not-a-valid-url')).toBe('open [redacted] now');
  });

  it('reports only the error type when the message carries the url, scrubs secrets and caps the rest', () => {
    expect(safeDiscordReason(new Error(`bad ${URL_WITH_TOKEN}`), URL_WITH_TOKEN)).toBe('Error');
    expect(safeDiscordReason(new Error('HTTP 500 password=abc'), URL_WITH_TOKEN)).toBe('HTTP 500 password=[redacted]');
    expect(safeDiscordReason(new Error('x'.repeat(500)), '')).toHaveLength(200);
    expect(safeDiscordReason(new TypeError(''), '')).toBe('TypeError');
    expect(safeDiscordReason('plain', '')).toBe('Error');
  });
});

describe('messages', () => {
  it('formats the scheduler start and the published, failed, user-action and partial alerts', () => {
    expect(schedulerStartedMessage()).toBe('🗓️ Publish scheduler started');
    expect(slotPublishedMessage('Maya', 'Porto', ['youtube', 'bluesky'])).toBe(
      '✅ Post published — persona: Maya | title: Porto | providers: youtube, bluesky',
    );
    expect(slotFailedMessage('Maya', 'Porto', 'boom')).toBe('❌ Slot failed — persona: Maya | title: Porto | reason: boom');
    expect(slotFailedMessage('Maya', '', 'boom')).toBe('❌ Slot failed — persona: Maya | reason: boom');
    expect(userActionMessage('Reconnect YouTube')).toBe('⚠️ Reconnect YouTube');
    expect(partialPublishMessage('s1', ['youtube', 'rumble'])).toBe('⚠️ Partial publish — slot: s1 | failed providers: youtube, rumble');
    expect(partialPublishMessage('s1', [])).toBe('⚠️ Partial publish — slot: s1 | failed providers: unknown');
  });

  it('clips long fields and the whole message to the Discord limit', () => {
    const message = slotFailedMessage('p'.repeat(500), 't'.repeat(500), 'r'.repeat(1000));
    expect(message.length).toBeLessThanOrEqual(DISCORD_MAX_CONTENT);
    expect(message).toContain(`${'r'.repeat(299)}…`);
    expect(slotPublishedMessage('m', 't', ['y'.repeat(3000)])).toHaveLength(DISCORD_MAX_CONTENT);
    expect(userActionMessage('n'.repeat(3000))).toHaveLength(DISCORD_MAX_CONTENT);
  });
});
