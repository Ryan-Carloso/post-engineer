import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { findRepoRoot } from '@/test/repo-root';
import { PROVIDER_LABELS } from '@/lib/account-options';
import { USER_ACCOUNT_ERROR_CODES } from '@/lib/upload/account-error-codes';
import { TRANSIENT_HTTP_STATUSES } from '@/lib/upload/account-error';

//---------------
// Issue #500 literals live in both apps: the web handler emits the codes,
// the engine classifies and writes the notice with the provider label, and
// both agree on which HTTP statuses are transient. Parse the engine sources
// so a code, label, or status added on one side fails here.
//---------------

const root = findRepoRoot(import.meta.url);
const read = (path: string): string => readFileSync(join(root, path), 'utf8');

function block(source: string, start: string, end: string): string {
  const from = source.indexOf(start);
  expect(from).toBeGreaterThanOrEqual(0);
  const to = source.indexOf(end, from + start.length);
  expect(to).toBeGreaterThan(from);
  return source.slice(from + start.length, to);
}

describe('publish code sync (web ↔ engine)', () => {
  const outcomes = read('apps/engine/app/services/fill_schedule/account_outcomes.py');

  it('engine USER_CODES match the web user-account codes', () => {
    const body = block(outcomes, 'USER_CODES = frozenset({', '})');
    const codes = [...body.matchAll(/"([a-z_]+)"/g)].map((match) => match[1]);
    expect(codes.sort()).toEqual([...USER_ACCOUNT_ERROR_CODES].sort());
  });

  it('engine provider labels match PROVIDER_LABELS', () => {
    const body = block(outcomes, '_LABELS = {', '}');
    const labels = Object.fromEntries(
      // Provider keys are lowercase letters, except '3speak' which starts
      // with a digit — the class must allow it or the entry is invisible.
      [...body.matchAll(/"([a-z0-9]+)":\s*"([^"]+)"/g)].map((match) => [match[1], match[2]]),
    );
    expect(labels).toEqual(PROVIDER_LABELS);
  });

  it('engine RETRYABLE_STATUS_CODES match the web transient statuses', () => {
    const publisher = read('apps/engine/app/services/upload_publisher.py');
    const body = block(publisher, 'RETRYABLE_STATUS_CODES: frozenset[int] = frozenset({', '})');
    const statuses = [...body.matchAll(/\d+/g)].map((match) => Number(match[0]));
    expect(statuses.sort()).toEqual([...TRANSIENT_HTTP_STATUSES].sort());
    expect(statuses.length).toBeGreaterThan(0);
  });
});
