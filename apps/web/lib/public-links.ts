export const SITE_URL = 'https://post-engineer.com';

export const GITHUB_URL = 'https://github.com/Ryan-Carloso/post-engineer';

export const DISCORD_INVITE_URL = 'https://discord.gg/ukmCXMCDJ';

export const WHATSAPP_NUMBER = '351962248268';

export function whatsappUrl(message?: string): string {
  const base = `https://wa.me/${WHATSAPP_NUMBER}`;
  return message === undefined ? base : `${base}?text=${encodeURIComponent(message)}`;
}
