import { logger } from '@/lib/logger';
import { scrubSecretValues } from '@/lib/publisher/scrub-error';

export const DISCORD_WEBHOOK_ENV = 'DISCORD_WEBHOOK_URL';
export const DISCORD_MAX_CONTENT = 2000;
const DISCORD_TIMEOUT_MS = 5_000;
const MIN_REDACTED_VARIANT_LENGTH = 8;
const REDACTED = '[redacted]';

let warnedMissingUrl = false;

export interface DiscordDeps {
  fetch?: typeof fetch;
  webhookUrl?: string;
}

function requote(value: string): string {
  try {
    return encodeURI(decodeURI(value));
  } catch {
    return value;
  }
}

export function redactKnownUrl(message: string, url: string): string {
  if (url === '') return message;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return message.split(url).join(REDACTED);
  }
  const requestTarget = parsed.pathname + parsed.search;
  const variants = new Set([
    url,
    requote(url),
    parsed.pathname,
    requote(parsed.pathname),
    requestTarget,
    requote(requestTarget),
  ]);
  let result = message;
  for (const variant of [...variants].sort((a, b) => b.length - a.length)) {
    if (variant.length >= MIN_REDACTED_VARIANT_LENGTH) result = result.split(variant).join(REDACTED);
  }
  return result;
}

export function safeDiscordReason(error: unknown, webhookUrl: string): string {
  const name = error instanceof Error && error.name !== '' ? error.name : 'Error';
  const message = error instanceof Error ? error.message : '';
  if (message === '') return name;
  if (redactKnownUrl(message, webhookUrl) !== message) return name;
  return scrubSecretValues(message).slice(0, 200);
}

export async function sendDiscord(message: string, deps: DiscordDeps = {}): Promise<boolean> {
  const url = deps.webhookUrl ?? process.env[DISCORD_WEBHOOK_ENV] ?? '';
  if (url === '') {
    if (!warnedMissingUrl) {
      warnedMissingUrl = true;
      console.warn(`[discord] ${DISCORD_WEBHOOK_ENV} not set — Discord notifications disabled`);
    }
    return false;
  }
  try {
    const response = await (deps.fetch ?? fetch)(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: message }),
      redirect: 'error',
      signal: AbortSignal.timeout(DISCORD_TIMEOUT_MS),
    });
    if (!response.ok) {
      logger.warn('[discord] notify failed', { status: response.status });
      return false;
    }
    return true;
  } catch (error) {
    logger.warn('[discord] notify failed', { reason: error instanceof Error ? error.name : 'Error' });
    return false;
  }
}

export function resetDiscordWarningForTests(): void {
  warnedMissingUrl = false;
}

function clip(text: string, maxChars: number): string {
  return text.length <= maxChars ? text : `${text.slice(0, maxChars - 1)}…`;
}

export function schedulerStartedMessage(): string {
  return '🗓️ Publish scheduler started';
}

export function slotPublishedMessage(persona: string, title: string, providers: string[]): string {
  return clip(
    `✅ Post published — persona: ${clip(persona, 100)} | title: ${clip(title, 150)} | providers: ${providers.join(', ')}`,
    DISCORD_MAX_CONTENT,
  );
}

export function slotFailedMessage(persona: string, title: string, reason: string): string {
  const titlePart = title === '' ? '' : `title: ${clip(title, 150)} | `;
  return clip(
    `❌ Slot failed — persona: ${clip(persona, 100)} | ${titlePart}reason: ${clip(reason, 300)}`,
    DISCORD_MAX_CONTENT,
  );
}

export function userActionMessage(notice: string): string {
  return clip(`⚠️ ${notice}`, DISCORD_MAX_CONTENT);
}

export function partialPublishMessage(slotId: string, failedProviders: string[]): string {
  const listing = failedProviders.length > 0 ? failedProviders.join(', ') : 'unknown';
  return clip(`⚠️ Partial publish — slot: ${slotId} | failed providers: ${listing}`, DISCORD_MAX_CONTENT);
}
