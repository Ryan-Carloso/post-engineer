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

describe('isPublicIp — shared SSRF fixture', () => {
  it.each(cases.blocked)('blocks %s', (ip) => {
    expect(isPublicIp(ip)).toBe(false);
  });

  it.each(cases.allowed)('allows %s', (ip) => {
    expect(isPublicIp(ip)).toBe(true);
  });

  it.each(cases.blockedBeyondPython)('blocks %s (multicast, stricter than Python)', (ip) => {
    expect(isPublicIp(ip)).toBe(false);
  });

  it('rejects a value that is not an IP address', () => {
    expect(isPublicIp('not-an-ip')).toBe(false);
    expect(isPublicIp('')).toBe(false);
  });

  // Each pair is the last allowed address and the first rejected address of
  // one special range (and the reverse edge). Dropping a range check, or
  // treating NAT64 as public without looking at the embedded IPv4, fails
  // the matching row.
  it.each([
    ['100.63.255.255', true],
    ['100.64.0.0', false],
    ['100.127.255.255', false],
    ['100.128.0.0', true],
    ['198.17.255.255', true],
    ['198.18.0.0', false],
    ['198.19.255.255', false],
    ['198.20.0.0', true],
    ['192.0.0.0', false],
    ['192.0.0.8', false],
    ['192.0.0.9', true],
    ['192.0.0.10', true],
    ['192.0.0.11', false],
    ['192.0.1.0', true],
    ['192.88.98.255', true],
    ['192.88.99.0', false],
    ['192.88.99.255', false],
    ['192.88.100.0', true],
    ['::ffff:8.8.8.8', true],
    ['::ffff:10.0.0.1', false],
    ['::ffff:100.64.0.1', false],
    ['64:ff9b::8.8.8.8', true],
    ['64:ff9b::7f00:1', false],
    ['64:ff9b::a00:1', false],
    ['2002::1', false],
    ['2003::1', true],
    ['100::1', false],
    ['100:0:0:2::1', true],
  ])('range boundary %s is public=%s', (ip, allowed) => {
    expect(isPublicIp(ip)).toBe(allowed);
  });

  it('rejects a zone id even when the address without it is public', () => {
    expect(isPublicIp('2606:4700:4700::1111%eth0')).toBe(false);
    expect(isPublicIp('::ffff:8.8.8.8%eth0')).toBe(false);
    expect(isPublicIp('fe80::1%eth0')).toBe(false);
    expect(isPublicIp('64:ff9b::8.8.8.8%eth0')).toBe(false);
  });

  it('classifies an uncompressed IPv6 address', () => {
    expect(isPublicIp('2001:db8:0:0:0:0:0:1')).toBe(false);
    expect(isPublicIp('2606:4700:4700:0:0:0:0:1111')).toBe(true);
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
