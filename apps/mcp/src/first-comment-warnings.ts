import type { DirectPublishAccountResult } from './client-types.js';
import type { FirstCommentWarningCode } from './contracts/first-comment.js';

const WARNING_TEXT: Record<FirstCommentWarningCode, string> = {
  FIRST_COMMENT_FAILED: 'the first comment did not post; the post is still live',
  FIRST_COMMENT_RECONNECT_REQUIRED:
    'the first comment needs a permission this account was connected without; reconnect the account (accounts, action: connect) and comment again by hand. The post is still live',
  FIRST_COMMENT_UNSUPPORTED_CHAT: 'the first comment was skipped: a bot cannot comment on a Telegram channel post, only reply in a group',
  FIRST_COMMENT_TOO_LONG: 'the first comment was skipped: it is over the network character limit',
};

export function firstCommentWarningSuffix(account: DirectPublishAccountResult): string {
  const warnings = account.warnings ?? [];
  if (warnings.length === 0) return '';
  return warnings.map((code) => ` — ${code}: ${WARNING_TEXT[code]}`).join('');
}
