//---------------
// API polling-route silence — a polled route must not emit a 2xx success
// event per poll.
//
// withApiErrorReporting reports every 2xx under the route's semantic
// success name. On a route that a client polls (video status, slot
// detail) that turns one user action into hundreds of identical read
// events, burying real actions (post published, tokens spent). Those
// routes opt out with `reportSuccess: false`; failures (4xx warnings and
// 5xx $exceptions) stay reported either way.
//
// This test pins both directions: every route on the polling list opts
// out, and no other route does — silencing a real action's success event
// is a telemetry decision, not a drive-by. Adding a route to the list is
// deliberate.
//---------------

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const apiDir = join(here, '..', '..', 'app', 'api');

// Routes a client re-reads on an interval: one success event per poll is
// noise. Every other route keeps its semantic 2xx event.
const POLLING_ROUTE_LABELS = new Set([
  'GET /api/persona/video-status/[taskId]',
  'GET /api/schedule/slots/[slotId]',
]);

function collectRouteFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectRouteFiles(full));
    } else if (entry.isFile() && entry.name === 'route.ts') {
      out.push(full);
    }
  }
  return out.sort();
}

// Extract each withApiErrorReporting(...) call's full argument text
// (paren-balanced) so multi-line options objects are covered.
function extractWrapperCalls(content: string): string[] {
  const calls: string[] = [];
  const marker = 'withApiErrorReporting(';
  let from = 0;
  while (true) {
    const start = content.indexOf(marker, from);
    if (start === -1) break;
    let depth = 0;
    let i = start + marker.length - 1;
    for (; i < content.length; i++) {
      if (content[i] === '(') depth++;
      else if (content[i] === ')') {
        depth--;
        if (depth === 0) break;
      }
    }
    calls.push(content.slice(start, i + 1));
    from = i + 1;
  }
  return calls;
}

interface WrappedCall {
  file: string;
  label: string;
  text: string;
}

// Resolve the label of each call, honouring `const NAME = 'label'`
// indirection so an indirect label is never mistaken for an unnamed one.
function collectWrappedCalls(): WrappedCall[] {
  const calls: WrappedCall[] = [];
  for (const file of collectRouteFiles(apiDir)) {
    const content = readFileSync(file, 'utf8');
    const constStrings = new Map<string, string>();
    for (const m of content.matchAll(/const ([A-Za-z_$][\w$]*) = '([^']+)'/g)) {
      constStrings.set(m[1], m[2]);
    }
    for (const text of extractWrapperCalls(content)) {
      const m = /withApiErrorReporting\(\s*(?:'([^']+)'|([A-Za-z_$][\w$]*))/.exec(text);
      const label = m === null
        ? undefined
        : m[1] !== undefined
          ? m[1]
          : constStrings.get(m[2]);
      if (label === undefined) {
        throw new Error(`${relative(apiDir, file)}: unresolvable withApiErrorReporting label`);
      }
      calls.push({ file: relative(apiDir, file), label, text });
    }
  }
  return calls;
}

const wrappedCalls = collectWrappedCalls();
const silenced = wrappedCalls.filter((call) => /reportSuccess\s*:\s*false/.test(call.text));

describe('api polling-route silence', () => {
  it('every polling route opts out of the 2xx success event', () => {
    const missing: string[] = [];
    for (const label of POLLING_ROUTE_LABELS) {
      const calls = wrappedCalls.filter((call) => call.label === label);
      if (calls.length === 0) {
        missing.push(`${label}: no withApiErrorReporting call found`);
        continue;
      }
      for (const call of calls) {
        if (!/reportSuccess\s*:\s*false/.test(call.text)) {
          missing.push(`${call.file}: ${label} reports a success event per poll`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it('no other route silences its success event (real actions stay reported)', () => {
    const offending = silenced
      .filter((call) => !POLLING_ROUTE_LABELS.has(call.label))
      .map((call) => `${call.file}: ${call.label}`);
    expect(offending).toEqual([]);
  });

  it('the polling list names routes that exist (a renamed label must be noticed)', () => {
    const labels = new Set(wrappedCalls.map((call) => call.label));
    for (const label of POLLING_ROUTE_LABELS) {
      expect(labels.has(label), `${label} is on the polling list but no route declares it`).toBe(true);
    }
  });
});
