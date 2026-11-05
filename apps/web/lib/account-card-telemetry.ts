//---------------
// Sends account-card display diagnostics to PostHog. Measures the live
// label (scrollWidth > clientWidth) so a session shows whether the name
// was stored and then clipped, or was never there.
//---------------

import { useEffect } from 'react';
import { trackClientEvent } from './client-analytics';
import {
  ACCOUNT_CARD_DISPLAY_EVENT,
  ACCOUNT_DISCONNECT_FAILED_EVENT,
  ACCOUNT_LIST_FAILED_EVENT,
  buildAccountCardDisplayReport,
  type AccountCardDisplayInput,
  type AccountCardDisplayReport,
  type AccountProvider,
} from './account-display-diagnostics';

const sent = new Set<string>();

function signature(report: AccountCardDisplayReport): string {
  return [
    report.provider,
    report.shown_label,
    report.secondary_label ?? '',
    report.stored_display_name ?? '',
    String(report.label_truncated),
    String(report.secondary_truncated),
    String(report.name_is_fallback),
    String(report.thumbnail_failed),
    String(report.thumbnail_present),
    report.thumbnail_host ?? '',
    String(report.thumbnail_url_expired),
    String(report.display_name_not_rendered),
    String(report.label_is_provider_id),
    report.card_width === null ? '' : String(Math.round(report.card_width / 16)),
    report.reasons.join(','),
  ].join('|');
}

export function reportAccountCardDisplay(input: AccountCardDisplayInput): void {
  if (input.compact) return;
  const viewport = input.viewport
    ?? (typeof window === 'undefined' ? null : { width: window.innerWidth, height: window.innerHeight });
  const report = buildAccountCardDisplayReport({ ...input, viewport });
  const key = signature(report);
  if (sent.has(key)) return;
  sent.add(key);
  trackClientEvent(ACCOUNT_CARD_DISPLAY_EVENT, { ...report });
}

export function reportAccountDisconnectFailed(
  provider: AccountProvider,
  outcome: 'threw' | 'rejected',
): void {
  const key = `disconnect|${provider}|${outcome}`;
  if (sent.has(key)) return;
  sent.add(key);
  trackClientEvent(ACCOUNT_DISCONNECT_FAILED_EVENT, { provider, outcome });
}

export function reportAccountListFailed(provider: AccountProvider, message: string): void {
  const key = `list|${provider}|${message}`;
  if (sent.has(key)) return;
  sent.add(key);
  trackClientEvent(ACCOUNT_LIST_FAILED_EVENT, { provider, message });
}

// One call per provider section. React Query keeps the error object around,
// so the effect re-fires on render; reportAccountListFailed dedupes.
export function useAccountListErrorTelemetry(provider: AccountProvider, message: string | null): void {
  useEffect(() => {
    if (message === null || message.length === 0) return;
    reportAccountListFailed(provider, message);
  }, [provider, message]);
}
