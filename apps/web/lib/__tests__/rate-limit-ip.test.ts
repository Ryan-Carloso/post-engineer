import { describe, it, expect } from 'vitest';
import { clientBucket } from '@/lib/rate-limit-ip';

describe('clientBucket', () => {
  it('keeps IPv4 addresses unchanged', () => {
    expect(clientBucket('10.20.30.40')).toBe('10.20.30.40');
  });

  it('keeps non-address identifiers unchanged', () => {
    expect(clientBucket('unknown')).toBe('unknown');
    expect(clientBucket('spoofed-1')).toBe('spoofed-1');
  });

  it('buckets a full IPv6 address by its /64 prefix', () => {
    expect(clientBucket('2001:0db8:0001:0002:0003:0004:0005:0006')).toBe('2001:db8:1:2::/64');
  });

  it('puts two addresses of one /64 in the same bucket', () => {
    expect(clientBucket('2001:db8:1:2::1')).toBe(clientBucket('2001:db8:1:2:ffff:eeee:dddd:cccc'));
  });

  it('keeps addresses of different /64 prefixes in different buckets', () => {
    expect(clientBucket('2001:db8:1:2::1')).not.toBe(clientBucket('2001:db8:1:3::1'));
  });

  it('expands compressed forms before taking the prefix', () => {
    expect(clientBucket('2001:db8::1')).toBe('2001:db8:0:0::/64');
    expect(clientBucket('::1')).toBe('0:0:0:0::/64');
    expect(clientBucket('::')).toBe('0:0:0:0::/64');
    expect(clientBucket('fe80::')).toBe('fe80:0:0:0::/64');
  });

  it('is case-insensitive', () => {
    expect(clientBucket('2001:DB8:A:B::1')).toBe('2001:db8:a:b::/64');
  });

  it('strips brackets and a zone id', () => {
    expect(clientBucket('[2001:db8:1:2::1]')).toBe('2001:db8:1:2::/64');
    expect(clientBucket('fe80::1%eth0')).toBe('fe80:0:0:0::/64');
  });

  it('maps IPv4-mapped IPv6 to the IPv4 address in dotted form', () => {
    expect(clientBucket('::ffff:1.2.3.4')).toBe('1.2.3.4');
    expect(clientBucket('::FFFF:1.2.3.4')).toBe('1.2.3.4');
    expect(clientBucket('0:0:0:0:0:ffff:1.2.3.4')).toBe('1.2.3.4');
  });

  it('maps IPv4-mapped IPv6 in hex form to the IPv4 address', () => {
    expect(clientBucket('::ffff:102:304')).toBe('1.2.3.4');
    expect(clientBucket('::ffff:c0a8:0101')).toBe('192.168.1.1');
  });

  it('does not treat a non-mapped embedded IPv4 as IPv4', () => {
    expect(clientBucket('64:ff9b::1.2.3.4')).toBe('64:ff9b:0:0::/64');
  });

  it('leaves malformed IPv6-looking values unchanged', () => {
    for (const value of ['1::2::3', '1:2:3:4:5:6:7:8:9', '12345::1', 'g::1', '1:2:3:4:5:6:7', '::ffff:1.2.3.999', ':1:2:3:4:5:6:7']) {
      expect(clientBucket(value)).toBe(value);
    }
  });
});
