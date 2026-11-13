#!/usr/bin/env node
// Dependency-audit gate.
//
// `pnpm audit` is the source of truth; this script decides which advisories the
// workspace has knowingly accepted. The accepted list lives in
// .github/audit/accepted-advisories.json — one entry per GHSA, with the reason
// and the scope (runtime vs dev). The gate fails when:
//
//   - an advisory at or above the threshold is NOT in the list (new risk),
//   - an entry in the list is no longer reported (the list rots otherwise),
//   - an entry names a different package than the advisory does (copy-paste),
//   - an entry is missing a reason, a valid severity or a valid scope.
//
// An advisory is identified by GHSA id, so a NEW advisory on a package we
// already accept still fails: accepting one id never accepts its siblings.
//
// Usage: node .github/scripts/audit/verify-accepted.mjs [--level low|moderate|high|critical]
//        node .github/scripts/audit/verify-accepted.mjs --self-test
//
// `pnpm audit` needs the lockfile only (no node_modules), and pnpm exits
// non-zero when it finds anything — the report on stdout is what matters here.
// The workflow runs --self-test first, so the gate proves its own logic on
// every run.

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const LEVELS = ['info', 'low', 'moderate', 'high', 'critical'];
export const SCOPES = ['runtime', 'dev'];
const GHSA = /^GHSA(-[0-9a-z]{4}){3}$/;
const MIN_REASON_CHARS = 40;

/** A gate failure the caller should report as-is. */
export class GateError extends Error {}

/** Validate the accepted list and index it by GHSA. */
export function validateAccepted(accepted, source = 'accepted-advisories.json') {
  if (!Array.isArray(accepted)) throw new GateError(`${source} must hold an "advisories" array`);
  const byId = new Map();
  for (const entry of accepted) {
    const where = `${source}: ${entry?.ghsa ?? '(no ghsa)'}`;
    if (typeof entry?.ghsa !== 'string' || !GHSA.test(entry.ghsa)) {
      throw new GateError(`${where} is not a GHSA id`);
    }
    if (typeof entry.package !== 'string' || entry.package.length === 0) {
      throw new GateError(`${where} has no package`);
    }
    if (!LEVELS.includes(entry.severity)) throw new GateError(`${where} has severity "${entry.severity}"`);
    if (!SCOPES.includes(entry.scope)) throw new GateError(`${where} has scope "${entry.scope}"`);
    if (typeof entry.reason !== 'string' || entry.reason.trim().length < MIN_REASON_CHARS) {
      throw new GateError(`${where} needs a reason of at least ${MIN_REASON_CHARS} characters`);
    }
    if (byId.has(entry.ghsa)) throw new GateError(`${where} is listed twice`);
    byId.set(entry.ghsa, entry);
  }
  return byId;
}

/**
 * Split the report into accepted and rejected advisories.
 * Returns `blocking` (unaccepted at or above the level) and `stale` (accepted
 * ids the report no longer carries), the two failure conditions of the gate.
 */
export function evaluate(advisories, acceptedById, level) {
  const seen = new Set();
  const acceptedNow = [];
  const rejected = [];
  for (const advisory of advisories) {
    const entry = acceptedById.get(advisory.github_advisory_id);
    if (entry === undefined) {
      rejected.push(advisory);
      continue;
    }
    if (entry.package !== advisory.module_name) {
      throw new GateError(
        `${advisory.github_advisory_id} is accepted for "${entry.package}" but npm reports it for "${advisory.module_name}"`,
      );
    }
    seen.add(advisory.github_advisory_id);
    acceptedNow.push(advisory);
  }
  const blocking = rejected.filter(
    (advisory) => LEVELS.indexOf(advisory.severity) >= LEVELS.indexOf(level),
  );
  const stale = [...acceptedById.values()].filter((entry) => !seen.has(entry.ghsa));
  return { acceptedNow, rejected, blocking, stale };
}

function advisory(id, module_name, severity) {
  return { github_advisory_id: id, module_name, severity, title: `fixture ${id}` };
}

function entry(ghsa, pkg, severity = 'high', scope = 'dev') {
  return { ghsa, package: pkg, severity, scope, reason: 'x'.repeat(MIN_REASON_CHARS) };
}

/** Exercise the filtering rules. Returns the list of failed expectations. */
export function selfTest() {
  const failures = [];
  const expect = (label, actual, expected) => {
    if (actual !== expected) failures.push(`${label}: expected ${expected}, got ${actual}`);
  };
  const throws = (label, fn) => {
    try {
      fn();
      failures.push(`${label}: expected a GateError`);
    } catch (error) {
      if (!(error instanceof GateError)) failures.push(`${label}: wrong error ${String(error)}`);
    }
  };

  const accepted = validateAccepted([entry('GHSA-aaaa-bbbb-cccc', 'pkg-a', 'low', 'runtime')]);
  const report = [advisory('GHSA-aaaa-bbbb-cccc', 'pkg-a', 'low')];

  const allAccepted = evaluate(report, accepted, 'low');
  expect('accepted advisory is not blocking', allAccepted.blocking.length, 0);
  expect('accepted advisory is reported as accepted', allAccepted.acceptedNow.length, 1);
  expect('accepted advisory is not stale', allAccepted.stale.length, 0);

  const unknown = evaluate([...report, advisory('GHSA-dddd-eeee-ffff', 'pkg-b', 'high')], accepted, 'low');
  expect('unknown advisory blocks', unknown.blocking.length, 1);

  const atThreshold = evaluate([advisory('GHSA-dddd-eeee-ffff', 'pkg-b', 'high')], accepted, 'high');
  expect('unaccepted advisory at the level blocks', atThreshold.blocking.length, 1);

  const belowThreshold = evaluate([advisory('GHSA-dddd-eeee-ffff', 'pkg-b', 'low')], accepted, 'high');
  expect('unaccepted advisory below the level does not block', belowThreshold.blocking.length, 0);
  expect('unaccepted advisory below the level is still reported', belowThreshold.rejected.length, 1);

  const lowAcceptedHighThreshold = evaluate(
    [advisory('GHSA-aaaa-bbbb-cccc', 'pkg-a', 'low')],
    accepted,
    'high',
  );
  expect('accepted advisory stays accepted at a higher level', lowAcceptedHighThreshold.blocking.length, 0);

  const stale = evaluate([], accepted, 'low');
  expect('missing advisory is stale', stale.stale.length, 1);

  throws('package mismatch', () =>
    evaluate([advisory('GHSA-aaaa-bbbb-cccc', 'pkg-z', 'low')], accepted, 'low'),
  );
  throws('bad ghsa', () => validateAccepted([entry('CVE-2024-0001', 'pkg-a')]));
  throws('bad severity', () => validateAccepted([entry('GHSA-aaaa-bbbb-cccc', 'pkg-a', 'urgent')]));
  throws('bad scope', () => validateAccepted([entry('GHSA-aaaa-bbbb-cccc', 'pkg-a', 'high', 'prod')]));
  throws('short reason', () =>
    validateAccepted([{ ...entry('GHSA-aaaa-bbbb-cccc', 'pkg-a'), reason: 'because' }]),
  );
  throws('duplicate ghsa', () =>
    validateAccepted([entry('GHSA-aaaa-bbbb-cccc', 'pkg-a'), entry('GHSA-aaaa-bbbb-cccc', 'pkg-a')]),
  );
  return failures;
}

function argValue(flag, fallback) {
  const index = process.argv.indexOf(flag);
  return index === -1 ? fallback : process.argv[index + 1];
}

function abort(message) {
  console.error(`✖ could not run the audit: ${message}`);
  process.exit(2);
}

function main() {
  if (process.argv.includes('--self-test')) {
    const failures = selfTest();
    if (failures.length > 0) {
      for (const failure of failures) console.error(`✖ self-test ${failure}`);
      process.exit(1);
    }
    console.log('✔ self-test: every gate rule holds');
    return;
  }

  const level = argValue('--level', 'low');
  if (!LEVELS.includes(level)) abort(`--level must be one of ${LEVELS.join(', ')}`);

  const root = resolve(import.meta.dirname, '../../..');
  const acceptedPath = resolve(root, '.github/audit/accepted-advisories.json');

  let acceptedById;
  try {
    const parsed = JSON.parse(readFileSync(acceptedPath, 'utf8'));
    acceptedById = validateAccepted(parsed.advisories, acceptedPath);
  } catch (error) {
    if (error instanceof GateError) {
      console.error(`✖ ${error.message}`);
      process.exit(1);
    }
    abort(`cannot read ${acceptedPath}: ${error instanceof Error ? error.message : String(error)}`);
  }

  const run = spawnSync('pnpm', ['audit', '--json'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });

  // pnpm may prefix the JSON with warnings; keep the outermost object.
  const stdout = run.stdout ?? '';
  const start = stdout.indexOf('{');
  const end = stdout.lastIndexOf('}');
  if (start === -1 || end === -1) {
    abort(`pnpm audit printed no JSON (status ${run.status}): ${(run.stderr || stdout).slice(0, 500)}`);
  }

  let report;
  try {
    report = JSON.parse(stdout.slice(start, end + 1));
  } catch (error) {
    abort(`pnpm audit JSON is unparseable: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (report.error) {
    abort(`the registry rejected the audit: ${report.error.summary ?? JSON.stringify(report.error)}`);
  }

  const advisories = Object.values(report.advisories ?? {});
  let result;
  try {
    result = evaluate(advisories, acceptedById, level);
  } catch (error) {
    if (error instanceof GateError) {
      console.error(`✖ ${error.message}`);
      process.exit(1);
    }
    throw error;
  }

  for (const item of result.acceptedNow) {
    const accepted = acceptedById.get(item.github_advisory_id);
    console.log(
      `accepted  ${item.github_advisory_id}  ${item.module_name}  ${item.severity}  (${accepted.scope})`,
    );
  }
  for (const item of result.rejected) {
    const blocks = LEVELS.indexOf(item.severity) >= LEVELS.indexOf(level);
    console.log(
      `${blocks ? 'FAIL     ' : 'report   '}${item.github_advisory_id}  ${item.module_name}  ${item.severity}  ${item.title}`,
    );
  }
  for (const item of result.stale) {
    console.log(
      `stale     ${item.ghsa}  ${item.package}  — no longer reported, remove it from the accepted list`,
    );
  }

  if (result.blocking.length > 0) {
    console.error(
      `\n✖ ${result.blocking.length} advisory(ies) at or above "${level}" are not accepted: fix the dependency, or add a reasoned entry to .github/audit/accepted-advisories.json`,
    );
  }
  if (result.stale.length > 0) {
    console.error(
      `\n✖ ${result.stale.length} accepted advisor${result.stale.length === 1 ? 'y is' : 'ies are'} no longer reported: delete the ${result.stale.length === 1 ? 'entry' : 'entries'} from .github/audit/accepted-advisories.json`,
    );
  }
  if (result.blocking.length > 0 || result.stale.length > 0) process.exit(1);

  console.log(
    `\n✔ ${advisories.length} advisories: ${result.acceptedNow.length} accepted, 0 unaccepted at or above "${level}"`,
  );
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  main();
}