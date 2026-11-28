import { describe, expect, it } from 'vitest';
import { DISCORD_INVITE_URL, WHATSAPP_NUMBER, whatsappUrl } from '@/lib/public-links';

describe('public links', () => {
  it('points WhatsApp at the built-in number without a message', () => {
    expect(WHATSAPP_NUMBER).toBe('351962248268');
    expect(whatsappUrl()).toBe('https://wa.me/351962248268');
  });

  it('percent-encodes the message', () => {
    expect(whatsappUrl('olá mundo!')).toBe('https://wa.me/351962248268?text=ol%C3%A1%20mundo!');
  });

  it('keeps an empty message as an explicit text parameter', () => {
    expect(whatsappUrl('')).toBe('https://wa.me/351962248268?text=');
  });

  it('serves the Discord invite over https', () => {
    expect(DISCORD_INVITE_URL).toBe('https://discord.gg/ukmCXMCDJ');
    expect(new URL(DISCORD_INVITE_URL).protocol).toBe('https:');
  });
});
