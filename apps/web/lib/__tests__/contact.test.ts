import { describe, expect, it } from 'vitest';
import { CONTACT_WHATSAPP_URL } from '../contact';

describe('CONTACT_WHATSAPP_URL', () => {
  it('is the owner WhatsApp link over https', () => {
    expect(CONTACT_WHATSAPP_URL).toBe('https://wa.me/351962248268');
    expect(new URL(CONTACT_WHATSAPP_URL).protocol).toBe('https:');
  });
});
