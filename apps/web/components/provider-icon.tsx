import type { SocialProvider } from '@/lib/providers/registry';

//---------------
// ProviderIcon — the network glyph used on post cards. The icon map is
// exhaustive by construction (`satisfies Record<SocialProvider, ...>`,
// same pattern as PROVIDER_REGISTRY): adding a network to
// SOCIAL_PROVIDERS without adding its glyph here is a typecheck error,
// never a silent missing icon. Lucide dropped brand marks, so each
// network carries its official compact SVG path. The wrapping span is the
// accessible name (role img); the svg is aria-hidden.
//---------------

interface ProviderGlyph {
  label: string;
  className: string;
  path: string;
}

const PROVIDER_GLYPHS = {
  youtube: {
    label: 'youtube',
    className: 'text-[#ff2d20]',
    path:
      'M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.5 12 3.5 12 3.5s-7.5 0-9.4.6A3 3 0 0 0 .5 6.2 31.3 31.3 0 0 0 0 12a31.3 31.3 0 0 0 .5 5.8 3 3 0 0 0 2.1 2.1c1.9.6 9.4.6 9.4.6s7.5 0 9.4-.6a3 3 0 0 0 2.1-2.1A31.3 31.3 0 0 0 24 12a31.3 31.3 0 0 0-.5-5.8ZM9.6 15.6V8.4L15.8 12l-6.2 3.6Z',
  },
  instagram: {
    label: 'instagram',
    className: 'text-[#e1306c]',
    path:
      'M12 2.2c3.2 0 3.6 0 4.9.1 1.2.1 1.8.2 2.2.4.6.2 1 .5 1.4.9.4.4.7.8.9 1.4.2.4.4 1 .4 2.2.1 1.3.1 1.7.1 4.9s0 3.6-.1 4.9c-.1 1.2-.2 1.8-.4 2.2a3.8 3.8 0 0 1-.9 1.4c-.4.4-.8.7-1.4.9-.4.2-1 .4-2.2.4-1.3.1-1.7.1-4.9.1s-3.6 0-4.9-.1c-1.2-.1-1.8-.2-2.2-.4a3.8 3.8 0 0 1-1.4-.9 3.8 3.8 0 0 1-.9-1.4c-.2-.4-.4-1-.4-2.2-.1-1.3-.1-1.7-.1-4.9s0-3.6.1-4.9c.1-1.2.2-1.8.4-2.2.2-.6.5-1 .9-1.4.4-.4.8-.7 1.4-.9.4-.2 1-.4 2.2-.4 1.3-.1 1.7-.1 4.9-.1Zm0 4.3a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11Zm0 2a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7Zm5.8-3.5a1.3 1.3 0 1 1 0 2.6 1.3 1.3 0 0 1 0-2.6Z',
  },
  bluesky: {
    label: 'bluesky',
    className: 'text-[#1185fe]',
    path:
      'M12 10.8c-1.1-2.1-4-6-6.7-7.9C2.7 1.1 1.7 1.4 1 1.7c-.8.4-1 1.6-1 2.3 0 .7.4 5.5.6 6.3.8 2.6 3.5 3.5 6 3.2-3.7.6-7 1.9-2.7 6.7 4.8 5 6.6-1.1 7.9-4.1 1.3 3 2.6 8.9 7.8 4.1 4.5-4.8 1-6.1-2.7-6.7 2.5.3 5.2-.6 6-3.2.2-.8.7-5.6.7-6.3 0-.7-.2-1.9-1-2.3-.7-.3-1.7-.6-4.3 1.2C16 4.8 13.1 8.7 12 10.8Z',
  },
  linkedin: {
    label: 'linkedin',
    className: 'text-[#0a66c2]',
    path:
      'M20.4 20.4h-3.5v-5.5c0-1.3 0-3-1.9-3s-2.1 1.4-2.1 2.9v5.6H9.4V9h3.4v1.6h.1a3.7 3.7 0 0 1 3.4-1.9c3.6 0 4.2 2.4 4.2 5.4v6.3ZM5.3 7.4a2 2 0 1 1 0-4.1 2 2 0 0 1 0 4.1ZM7.1 20.4H3.6V9h3.5v11.4Z',
  },
} satisfies Record<SocialProvider, ProviderGlyph>;

export function ProviderIcon({ provider }: { provider: SocialProvider }) {
  const glyph = PROVIDER_GLYPHS[provider];
  return (
    <span role="img" aria-label={glyph.label} className={`inline-flex ${glyph.className}`}>
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor" aria-hidden="true">
        <path d={glyph.path} />
      </svg>
    </span>
  );
}
