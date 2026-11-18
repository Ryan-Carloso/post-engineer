import { isIP } from 'node:net';

export function unbracketIpLiteral(host: string): string {
  if (host.startsWith('[') && host.endsWith(']') && host.length > 2) {
    return host.slice(1, -1);
  }
  return host;
}

export function isPublicIp(ip: string): boolean {
  const bare = unbracketIpLiteral(ip);
  const family = isIP(bare);
  if (family === 4) return isPublicIpv4(bare);
  if (family === 6) return isPublicIpv6(bare);
  return false;
}

function isPublicIpv4(ip: string): boolean {
  const [a, b, c, d] = ip.split('.').map(Number);
  if (a === 0 || a === 127) return false;
  if (a === 10) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 0 && c === 0) {
    return d === 9 || d === 10;
  }
  if (a === 192 && b === 0 && c === 2) return false;
  if (a === 192 && b === 88 && c === 99) return false;
  if (a === 192 && b === 168) return false;
  if (a === 198 && (b === 18 || b === 19)) return false;
  if (a === 198 && b === 51 && c === 100) return false;
  if (a === 203 && b === 0 && c === 113) return false;
  if (a >= 224) return false;
  return true;
}

function ipv6ToBigInt(ip: string): bigint | null {
  let addr = ip.toLowerCase();
  if (addr.includes('.')) {
    const lastColon = addr.lastIndexOf(':');
    const octets = addr.slice(lastColon + 1).split('.').map(Number);
    if (octets.some((octet) => Number.isNaN(octet))) return null;
    const hi = ((octets[0] << 8) | octets[1]).toString(16);
    const lo = ((octets[2] << 8) | octets[3]).toString(16);
    addr = `${addr.slice(0, lastColon)}:${hi}:${lo}`;
  }
  const halves = addr.split('::');
  const head = halves[0] === '' ? [] : halves[0].split(':');
  const tail = halves.length === 2 ? (halves[1] === '' ? [] : halves[1].split(':')) : [];
  const groups = [...head, ...Array<string>(8 - head.length - tail.length).fill('0'), ...tail];
  let value = 0n;
  for (const group of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(group)) return null;
    value = (value << 16n) | BigInt(parseInt(group, 16));
  }
  return value;
}

function inIpv6Network(addr: bigint, network: string, prefixLen: number): boolean {
  const net = ipv6ToBigInt(network) as bigint;
  const shift = BigInt(128 - prefixLen);
  return (addr >> shift) === (net >> shift);
}

const IPV6_NON_GLOBAL: ReadonlyArray<readonly [string, number]> = [
  ['::', 128],
  ['::1', 128],
  ['64:ff9b:1::', 48],
  ['100::', 64],
  ['100:0:0:1::', 64],
  ['2001::', 23],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['3fff::', 20],
  ['5f00::', 16],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
];

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
    return isPublicIpv4(embeddedIpv4(addr));
  }
  if (inIpv6Network(addr, '64:ff9b::', 96)) {
    return isPublicIpv4(embeddedIpv4(addr & 0xffffffffn));
  }
  if (IPV6_GLOBAL_EXCEPTIONS.some(([net, len]) => inIpv6Network(addr, net, len))) return true;
  if (IPV6_NON_GLOBAL.some(([net, len]) => inIpv6Network(addr, net, len))) return false;
  return true;
}
