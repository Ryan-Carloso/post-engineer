//---------------
// WhatsApp support — the number comes from NEXT_PUBLIC_WHATSAPP_NUMBER.
// There is no hardcoded fallback: when the env var is unset, support
// links/buttons do not render at all (callers check for null).
//---------------

function readWhatsAppNumber(): string | null {
  const raw = process.env.NEXT_PUBLIC_WHATSAPP_NUMBER;
  if (!raw) return null;
  const digits = raw.replace(/\D/g, '');
  return digits.length > 0 ? digits : null;
}

export function getWhatsAppNumber(): string | null {
  return readWhatsAppNumber();
}

export function whatsappUrl(message: string): string | null {
  const number = readWhatsAppNumber();
  if (!number) return null;
  return `https://wa.me/${number}?text=${encodeURIComponent(message)}`;
}
