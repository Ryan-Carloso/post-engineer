export const ERROR_CODES = {
  PERSONA_NOT_FOUND: 'PERSONA_NOT_FOUND',
  PERSONA_ACCESS_DENIED: 'PERSONA_ACCESS_DENIED',
  PERSONA_SCOPE_DENIED: 'PERSONA_SCOPE_DENIED',
  SOCIAL_ACCOUNT_NOT_OWNED: 'SOCIAL_ACCOUNT_NOT_OWNED',
  INVALID_PROVIDER_ACCOUNT: 'INVALID_PROVIDER_ACCOUNT',
  NO_CONNECTED_ACCOUNTS: 'NO_CONNECTED_ACCOUNTS',
  ACCOUNT_NOT_BOUND_TO_PERSONA: 'ACCOUNT_NOT_BOUND_TO_PERSONA',
  PERSONA_NO_BOUND_ACCOUNTS: 'PERSONA_NO_BOUND_ACCOUNTS',
  SCHEDULE_OUT_OF_RANGE: 'SCHEDULE_OUT_OF_RANGE',
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  TRIAL_EXPIRED: 'TRIAL_EXPIRED',
  SUBSCRIPTION_INACTIVE: 'SUBSCRIPTION_INACTIVE',
  BLUESKY_CREDENTIAL_REJECTED: 'BLUESKY_CREDENTIAL_REJECTED',
  THREESPEAK_CREDENTIAL_REJECTED: 'THREESPEAK_CREDENTIAL_REJECTED',
  TELEGRAM_TOKEN_REJECTED: 'TELEGRAM_TOKEN_REJECTED',
  TELEGRAM_CHAT_NOT_FOUND: 'TELEGRAM_CHAT_NOT_FOUND',
  TELEGRAM_CHAT_KIND_MISMATCH: 'TELEGRAM_CHAT_KIND_MISMATCH',
  TELEGRAM_BOT_NOT_MEMBER: 'TELEGRAM_BOT_NOT_MEMBER',
  TELEGRAM_BOT_CANNOT_POST: 'TELEGRAM_BOT_CANNOT_POST',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  IMAGE_PROVIDER_UNSUPPORTED: 'IMAGE_PROVIDER_UNSUPPORTED',
  VIDEO_UPLOAD_CONSUMED: 'VIDEO_UPLOAD_CONSUMED',
  IDEMPOTENCY_KEY_CONSUMED: 'IDEMPOTENCY_KEY_CONSUMED',
  VIDEO_UPLOAD_SCHEDULED: 'VIDEO_UPLOAD_SCHEDULED',
  MCP_VERSION_MISMATCH: 'MCP_VERSION_MISMATCH',
  PROMPT_NOT_FOUND: 'PROMPT_NOT_FOUND',
  PROMPT_SLUG_TAKEN: 'PROMPT_SLUG_TAKEN',
  PROMPT_VERSION_NOT_FOUND: 'PROMPT_VERSION_NOT_FOUND',
  PROMPT_VERSION_CONFLICT: 'PROMPT_VERSION_CONFLICT',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

const DEFAULT_MESSAGES: Record<ErrorCode, string> = {
  PERSONA_NOT_FOUND: 'Persona does not exist or is not accessible.',
  PERSONA_ACCESS_DENIED: 'You do not have access to this persona.',
  PERSONA_SCOPE_DENIED: 'This API key cannot access the selected persona.',
  SOCIAL_ACCOUNT_NOT_OWNED: 'Selected {provider} account does not belong to this user.',
  INVALID_PROVIDER_ACCOUNT: 'Selected account cannot be used with this provider.',
  NO_CONNECTED_ACCOUNTS: 'No connected {provider} account found.',
  ACCOUNT_NOT_BOUND_TO_PERSONA: 'Selected {provider} account is not bound to this persona.',
  PERSONA_NO_BOUND_ACCOUNTS: 'This persona has no accounts bound. Bind at least one account before scheduling.',
  SCHEDULE_OUT_OF_RANGE: 'Publishing must be scheduled between {minHours} hours and {maxDays} days from now.',
  VALIDATION_FAILED: 'Request validation failed.',
  TRIAL_EXPIRED: 'Your free trial has ended. Contact us to keep scheduling and publishing.',
  SUBSCRIPTION_INACTIVE: 'Your subscription is not active. Contact us to keep scheduling and publishing.',
  BLUESKY_CREDENTIAL_REJECTED: 'Invalid Bluesky handle or app password.',
  THREESPEAK_CREDENTIAL_REJECTED: 'Invalid Hive username or posting key.',
  TELEGRAM_TOKEN_REJECTED: 'Telegram rejected the bot token. Copy a fresh token from @BotFather and try again.',
  TELEGRAM_CHAT_NOT_FOUND: 'Telegram could not find that chat. Check the chat ID or @username and that the bot was added to it.',
  TELEGRAM_CHAT_KIND_MISMATCH: 'That chat is a {actual}, not a {expected}. Pick {actual} in the setup and try again.',
  TELEGRAM_BOT_NOT_MEMBER: 'The bot is not a member of that chat. Add it in Telegram first, then try again.',
  TELEGRAM_BOT_CANNOT_POST:
    'The bot cannot post there yet. Make it an administrator who can post (channel) or allow it to send messages (group), then try again.',
  INTERNAL_ERROR: 'Something went wrong. Please try again later.',
  IMAGE_PROVIDER_UNSUPPORTED: 'Images can only be published to Instagram, Bluesky, LinkedIn, Threads, Facebook, Pinterest and Telegram.',
  VIDEO_UPLOAD_CONSUMED: 'This video upload was already used. Upload it again to publish.',
  IDEMPOTENCY_KEY_CONSUMED:
    'This idempotency key belongs to a schedule that was deleted. Send the request again with a new idempotency key.',
  VIDEO_UPLOAD_SCHEDULED:
    'This video upload is already scheduled. An upload publishes once: schedule it to every network in one call, or upload it again.',
  MCP_VERSION_MISMATCH: 'This post-engineer-mcp version does not match the server. Restart the MCP with the version the server requires.',
  PROMPT_NOT_FOUND: 'Unknown prompt slug.',
  PROMPT_SLUG_TAKEN: 'You already have a prompt with this slug, or another public prompt uses it.',
  PROMPT_VERSION_NOT_FOUND: 'Unknown prompt version.',
  PROMPT_VERSION_CONFLICT: 'The prompt changed since you loaded it. Reload and try again.',
};

export function errorMessage(code: ErrorCode): string {
  return DEFAULT_MESSAGES[code];
}

export function formatErrorMessage(
  code: ErrorCode,
  params?: Record<string, string | number>,
): string {
  let message = DEFAULT_MESSAGES[code];
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      message = message.split(`{${key}}`).join(String(value));
    }
  }
  return message;
}

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === 'string' && (Object.values(ERROR_CODES) as string[]).includes(value);
}
