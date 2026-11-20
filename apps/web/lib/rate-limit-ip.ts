const HEXTET = /^[0-9a-f]{1,4}$/;
const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

function ipv4Octets(value: string): number[] | null {
  const match = IPV4.exec(value);
  if (match === null) return null;
  const octets = match.slice(1).map(Number);
  return octets.every((octet) => octet <= 255) ? octets : null;
}

function parseGroups(part: string, allowIpv4Tail: boolean): number[] | null {
  if (part === '') return [];
  const groups = part.split(':');
  const result: number[] = [];
  for (const [index, group] of groups.entries()) {
    if (allowIpv4Tail && index === groups.length - 1 && group.includes('.')) {
      const octets = ipv4Octets(group);
      if (octets === null) return null;
      result.push(octets[0] * 256 + octets[1], octets[2] * 256 + octets[3]);
    } else if (HEXTET.test(group)) {
      result.push(parseInt(group, 16));
    } else {
      return null;
    }
  }
  return result;
}

function parseIpv6(value: string): number[] | null {
  const halves = value.split('::');
  if (halves.length > 2) return null;
  if (halves.length === 1) {
    const groups = parseGroups(value, true);
    return groups !== null && groups.length === 8 ? groups : null;
  }
  const head = parseGroups(halves[0], false);
  const tail = parseGroups(halves[1], true);
  if (head === null || tail === null) return null;
  const missing = 8 - head.length - tail.length;
  if (missing < 1) return null;
  return [...head, ...Array.from({ length: missing }, () => 0), ...tail];
}

function stripDecorations(value: string): string {
  const unbracketed = value.startsWith('[') && value.endsWith(']') ? value.slice(1, -1) : value;
  const zone = unbracketed.indexOf('%');
  return (zone === -1 ? unbracketed : unbracketed.slice(0, zone)).toLowerCase();
}

function isIpv4Mapped(groups: number[]): boolean {
  return groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff;
}

export function clientBucket(address: string): string {
  if (!address.includes(':')) return address;
  const groups = parseIpv6(stripDecorations(address));
  if (groups === null) return address;
  if (isIpv4Mapped(groups)) {
    return [groups[6] >> 8, groups[6] & 0xff, groups[7] >> 8, groups[7] & 0xff].join('.');
  }
  return `${groups.slice(0, 4).map((group) => group.toString(16)).join(':')}::/64`;
}
