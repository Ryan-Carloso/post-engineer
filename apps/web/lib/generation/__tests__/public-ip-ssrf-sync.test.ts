// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { findRepoRoot } from '@/test/repo-root';
import { isPublicIp } from '../custom-audio';

interface PublicIpCases {
  blocked: string[];
  allowed: string[];
  blockedBeyondPython: string[];
}

function loadCases(): PublicIpCases {
  const root = findRepoRoot(import.meta.url);
  const raw: unknown = JSON.parse(readFileSync(join(root, 'shared', 'ssrf', 'public-ip-cases.json'), 'utf8'));
  if (
    typeof raw !== 'object' ||
    raw === null ||
    !('blocked' in raw) ||
    !('allowed' in raw) ||
    !('blockedBeyondPython' in raw) ||
    !Array.isArray(raw.blocked) ||
    !Array.isArray(raw.allowed) ||
    !Array.isArray(raw.blockedBeyondPython) ||
    !raw.blocked.every((ip) => typeof ip === 'string') ||
    !raw.allowed.every((ip) => typeof ip === 'string') ||
    !raw.blockedBeyondPython.every((ip) => typeof ip === 'string')
  ) {
    throw new Error('shared/ssrf/public-ip-cases.json has an unexpected shape');
  }
  return raw as PublicIpCases;
}

const cases = loadCases();

// Literal representatives asserted by the engine suite
// (apps/engine/test/utils/test_ssrf.py): the private literals it rejects
// and the public literals / resolved address it accepts.
const ENGINE_BLOCKED = ['127.0.0.1', '169.254.169.254', '::1', '10.0.0.5'];
const ENGINE_ALLOWED = ['1.1.1.1', '2606:4700:4700::1111', '93.184.215.14'];

describe('isPublicIp — shared SSRF fixture (Python is_global parity)', () => {
  it.each(cases.blocked)('blocks %s (engine is_global is false)', (ip) => {
    expect(isPublicIp(ip)).toBe(false);
  });

  it.each(cases.allowed)('allows %s (engine is_global is true)', (ip) => {
    expect(isPublicIp(ip)).toBe(true);
  });

  it.each(cases.blockedBeyondPython)('blocks %s (multicast, stricter than Python)', (ip) => {
    expect(isPublicIp(ip)).toBe(false);
  });

  it('pins every literal representative the engine SSRF test covers', () => {
    const root = findRepoRoot(import.meta.url);
    const engineTest = readFileSync(join(root, 'apps', 'engine', 'test', 'utils', 'test_ssrf.py'), 'utf8');
    for (const ip of ENGINE_BLOCKED) {
      expect(engineTest).toContain(ip);
      expect(cases.blocked).toContain(ip);
    }
    for (const ip of ENGINE_ALLOWED) {
      expect(engineTest).toContain(ip);
      expect(cases.allowed).toContain(ip);
    }
  });
});
