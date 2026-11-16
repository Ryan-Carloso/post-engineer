// Verbatim copy of the isPublicIp classifier in
// apps/web/lib/ssrf/public-ip.ts (the MCP package cannot import web code).
// Pinned to shared/ssrf/public-ip-cases.json by
// __tests__/clone-audio-ssrf.test.ts. Both copies change together.

import { isIP } from 'node:net';

// URL.hostname keeps the brackets on an IPv6 literal (`[::1]`). isIP does
// not recognize that form, so classification strips them in this one place.
export function unbracketIpLiteral(host: string): string {
  if (host.startsWith('[') && host.endsWith(']') && host.length > 2) {
    return host.slice(1, -1);
  }
  return host;
}

// isPublicIp is the web/MCP SSRF address rule. It follows CPython
// ipaddress is_global (the engine checks ip.is_global) except where this
// CPython still reports an address global and IANA does not:
// multicast (224.0.0.0/4, ff00::/8), the deprecated 6to4 anycast
// 192.88.99.0/24 (RFC 7526), the dummy prefix 100:0:0:1::/64 (RFC 9780),
// SRv6 5f00::/16 (RFC 9602), and 64:ff9b::/96 when the embedded IPv4 is
// not public. 64:ff9b::8.8.8.8 stays public. 192.0.0.9 and 192.0.0.10
// stay public (IANA global anycast). Stricter than today's engine
// is_global, never looser; the engine mirror is a sibling change.
// Pinned by shared/ssrf/public-ip-cases.json.
export function isPublicIp(ip: string): boolean {
  const bare = unbracketIpLiteral(ip);
  const family = isIP(bare);
  if (family === 4) return isPublicIpv4(bare);
  if (family === 6) return isPublicIpv6(bare);
  return false;
}

function isPublicIpv4(ip: string): boolean {
  const [a, b, c, d] = ip.split('.').map(Number);
  if (a === 0 || a === 127) return false; // 0.0.0.0/8 "this network" + 127.0.0.0/8 loopback
  if (a === 10) return false; // 10.0.0.0/8
  if (a === 100 && b >= 64 && b <= 127) return false; // 100.64.0.0/10 shared address space
  if (a === 169 && b === 254) return false; // 169.254.0.0/16 link-local (cloud metadata)
  if (a === 172 && b >= 16 && b <= 31) return false; // 172.16.0.0/12
  if (a === 192 && b === 0 && c === 0) {
    // 192.0.0.0/24 IETF protocol assignments; Python exempts the two
    // anycast addresses below, and is_global follows it, so they stay public.
    return d === 9 || d === 10;
  }
  if (a === 192 && b === 0 && c === 2) return false; // 192.0.2.0/24 documentation
  if (a === 192 && b === 88 && c === 99) return false; // 192.88.99.0/24 deprecated 6to4 anycast
  if (a === 192 && b === 168) return false; // 192.168.0.0/16
  if (a === 198 && (b === 18 || b === 19)) return false; // 198.18.0.0/15 benchmarking
  if (a === 198 && b === 51 && c === 100) return false; // 198.51.100.0/24 documentation
  if (a === 203 && b === 0 && c === 113) return false; // 203.0.113.0/24 documentation
  if (a >= 224) return false; // 224.0.0.0/4 multicast + 240.0.0.0/4 reserved (incl. broadcast)
  return true;
}

function ipv6ToBigInt(ip: string): bigint | null {
  let addr = ip.toLowerCase();
  if (addr.includes('.')) {
    // Embedded IPv4 tail (e.g. ::ffff:8.8.8.8) becomes two hex groups.
    const lastColon = addr.lastIndexOf(':');
    if (lastColon === -1) return null;
    const octets = addr.slice(lastColon + 1).split('.').map(Number);
    if (octets.length !== 4 || octets.some((o) => Number.isNaN(o))) return null;
    const hi = ((octets[0] << 8) | octets[1]).toString(16);
    const lo = ((octets[2] << 8) | octets[3]).toString(16);
    addr = `${addr.slice(0, lastColon)}:${hi}:${lo}`;
  }
  const halves = addr.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] === '' ? [] : halves[0].split(':');
  const tail = halves.length === 2 ? (halves[1] === '' ? [] : halves[1].split(':')) : [];
  if (halves.length === 1 && head.length !== 8) return null;
  if (head.length + tail.length > 8) return null;
  const groups = [...head, ...Array<string>(8 - head.length - tail.length).fill('0'), ...tail];
  let value = 0n;
  for (const group of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(group)) return null;
    value = (value << 16n) | BigInt(parseInt(group, 16));
  }
  return value;
}

function inIpv6Network(addr: bigint, network: string, prefixLen: number): boolean {
  const net = ipv6ToBigInt(network);
  if (net === null) return false;
  const shift = BigInt(128 - prefixLen);
  return (addr >> shift) === (net >> shift);
}

const IPV6_NON_GLOBAL: ReadonlyArray<readonly [string, number]> = [
  ['::', 128], // unspecified
  ['::1', 128], // loopback
  ['64:ff9b:1::', 48], // local-use NAT64
  ['100::', 64], // discard-only
  ['100:0:0:1::', 64], // dummy prefix (RFC 9780), not globally reachable
  ['2001::', 23], // Teredo / benchmarking / orchestid and peers (see exceptions)
  ['2001:db8::', 32], // documentation
  ['2002::', 16], // 6to4
  ['3fff::', 20], // documentation
  ['5f00::', 16], // SRv6 SIDs (RFC 9602), not globally reachable
  ['fc00::', 7], // unique-local
  ['fe80::', 10], // link-local
  ['ff00::', 8], // multicast (blocked beyond Python, see header note)
];

// Subnets of 2001::/23 that Python still reports global.
const IPV6_GLOBAL_EXCEPTIONS: ReadonlyArray<readonly [string, number]> = [
  ['2001:1::1', 128],
  ['2001:1::2', 128],
  ['2001:3::', 32],
  ['2001:4:112::', 48],
  ['2001:20::', 28],
  ['2001:30::', 28],
];

function embeddedIpv4(addr: bigint): string {
  return [24, 16, 8, 0].map((shift) => Number((addr >> BigInt(shift)) & 0xffn)).join('.');
}

function isPublicIpv6(ip: string): boolean {
  const addr = ipv6ToBigInt(ip);
  if (addr === null) return false;
  if ((addr >> 32n) === 0xffffn) {
    // IPv4-mapped address: Python derives globality from the embedded IPv4.
    return isPublicIpv4(embeddedIpv4(addr));
  }
  // Well-known NAT64 (64:ff9b::/96). A blanket block of the prefix would
  // reject 64:ff9b::8.8.8.8; globality follows the embedded IPv4 instead.
  if (inIpv6Network(addr, '64:ff9b::', 96)) {
    return isPublicIpv4(embeddedIpv4(addr & 0xffffffffn));
  }
  if (IPV6_GLOBAL_EXCEPTIONS.some(([net, len]) => inIpv6Network(addr, net, len))) return true;
  if (IPV6_NON_GLOBAL.some(([net, len]) => inIpv6Network(addr, net, len))) return false;
  return true;
}
