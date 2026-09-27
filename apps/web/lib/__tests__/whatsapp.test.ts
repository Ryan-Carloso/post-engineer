import { describe, it, expect, afterEach } from 'vitest';

import { getWhatsAppNumber, whatsappUrl } from '@/lib/whatsapp';

const ENV_KEY = 'NEXT_PUBLIC_WHATSAPP_NUMBER';
const ORIGINAL = process.env[ENV_KEY];

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env[ENV_KEY];
  else process.env[ENV_KEY] = ORIGINAL;
});

describe('getWhatsAppNumber', () => {
  it('returns null when the env var is unset', () => {
    delete process.env[ENV_KEY];
    expect(getWhatsAppNumber()).toBeNull();
  });

  it('returns null when the env var is blank', () => {
    process.env[ENV_KEY] = '   ';
    expect(getWhatsAppNumber()).toBeNull();
  });

  it('returns the configured number', () => {
    process.env[ENV_KEY] = '15551234567';
    expect(getWhatsAppNumber()).toBe('15551234567');
  });

  it('strips non-digit characters from the configured value', () => {
    process.env[ENV_KEY] = '+1 (555) 123-4567';
    expect(getWhatsAppNumber()).toBe('15551234567');
  });
});

describe('whatsappUrl', () => {
  it('returns null when the env var is unset (no hardcoded fallback)', () => {
    delete process.env[ENV_KEY];
    expect(whatsappUrl('hello')).toBeNull();
  });

  it('builds the wa.me URL with the configured number', () => {
    process.env[ENV_KEY] = '15551234567';
    expect(whatsappUrl('hello')).toBe('https://wa.me/15551234567?text=hello');
  });

  it('encodes the message', () => {
    process.env[ENV_KEY] = '15551234567';
    expect(whatsappUrl('olá mundo!')).toBe(
      `https://wa.me/15551234567?text=${encodeURIComponent('olá mundo!')}`,
    );
  });

  it('never embeds the previous hardcoded number', () => {
    process.env[ENV_KEY] = '15551234567';
    expect(whatsappUrl('hello')).not.toContain('351962248268');
  });
});
