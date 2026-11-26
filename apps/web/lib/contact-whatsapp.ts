export function contactWhatsappUrl(): string {
  const url = process.env.NEXT_PUBLIC_CONTACT_WHATSAPP_URL;
  if (url === undefined || url === '') {
    throw new Error('NEXT_PUBLIC_CONTACT_WHATSAPP_URL is not defined');
  }
  return url;
}
