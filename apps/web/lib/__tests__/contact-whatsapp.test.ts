import { afterEach, describe, expect, it, vi } from 'vitest';
import { contactWhatsappUrl } from '../contact-whatsapp';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('contactWhatsappUrl', () => {
  it('returns the configured contact link', () => {
    vi.stubEnv('NEXT_PUBLIC_CONTACT_WHATSAPP_URL', 'https://wa.me/000000000');
    expect(contactWhatsappUrl()).toBe('https://wa.me/000000000');
  });

  it('throws when the variable is missing', () => {
    vi.stubEnv('NEXT_PUBLIC_CONTACT_WHATSAPP_URL', undefined);
    expect(() => contactWhatsappUrl()).toThrow('NEXT_PUBLIC_CONTACT_WHATSAPP_URL is not defined');
  });

  it('throws when the variable is empty', () => {
    vi.stubEnv('NEXT_PUBLIC_CONTACT_WHATSAPP_URL', '');
    expect(() => contactWhatsappUrl()).toThrow('NEXT_PUBLIC_CONTACT_WHATSAPP_URL is not defined');
  });
});
