import type { ReactNode } from 'react';
import { ProviderIcon } from '@/components/provider-icon';
import type { TranslationKey } from '@/lib/i18n';
import type { SocialProvider } from '@/lib/providers/registry';
import { GoogleIcon, InstagramIcon } from '@/lib/ui';

interface ProviderBrand {
  tileClassName: string;
  Icon: () => ReactNode;
  labelKey: TranslationKey;
}

function LinkedinIcon(): ReactNode {
  return <svg viewBox="0 0 24 24" className="size-5" fill="currentColor" aria-hidden="true"><path d="M20.45 20.45h-3.55v-5.57c0-1.33-.03-3.04-1.85-3.04-1.86 0-2.14 1.45-2.14 2.94v5.67H9.35V9h3.41v1.56h.05c.47-.9 1.63-1.85 3.36-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28zM5.34 7.43a2.06 2.06 0 1 1 0-4.12 2.06 2.06 0 0 1 0 4.12zM7.12 20.45H3.56V9h3.56v11.45z" /></svg>;
}

function BlueskyIcon(): ReactNode {
  return <svg viewBox="0 0 24 24" className="size-5" fill="currentColor" aria-hidden="true"><path d="M12 10.8c-1.087-2.114-4.046-6.033-6.798-7.978C2.566 1.01.562 1.098.064 1.855c-.499.757.06 3.708 1.277 5.196.76.93 1.883 2.022 3.19 2.904-1.538-.24-3.02.052-3.585.754-.79.982.294 3.029 2.424 4.573 1.187.86 2.662 1.5 4.082 1.788-1.555.288-3.04 1.017-3.575 2.015-.72 1.343.682 2.72 3.125 3.076 2.1.307 4.653-.355 5.998-1.71 1.345 1.355 3.898 2.017 5.998 1.71 2.443-.356 3.845-1.733 3.125-3.076-.535-.998-2.02-1.727-3.575-2.015 1.42-.288 2.895-.928 4.082-1.788 2.13-1.544 3.214-3.591 2.424-4.573-.565-.702-2.047-.994-3.585-.754 1.307-.882 2.43-1.974 3.19-2.904 1.217-1.488 1.776-4.439 1.277-5.196-.498-.757-2.502-.845-5.138.967C16.046 4.767 13.087 8.686 12 10.8z" /></svg>;
}

export const PROVIDER_BRANDS = {
  youtube: { tileClassName: 'bg-destructive-soft text-destructive', Icon: GoogleIcon, labelKey: 'accounts.youtubeLabel' },
  instagram: { tileClassName: 'bg-brand-soft text-brand', Icon: InstagramIcon, labelKey: 'accounts.instagramLabel' },
  bluesky: { tileClassName: 'bg-info-soft text-info', Icon: BlueskyIcon, labelKey: 'accounts.blueskyLabel' },
  linkedin: { tileClassName: 'bg-info-soft text-info', Icon: LinkedinIcon, labelKey: 'accounts.linkedinLabel' },
  threads: { tileClassName: 'bg-muted text-foreground', Icon: () => <ProviderIcon provider="threads" />, labelKey: 'accounts.threadsLabel' },
  facebook: { tileClassName: 'bg-muted', Icon: () => <ProviderIcon provider="facebook" />, labelKey: 'accounts.facebookLabel' },
  pinterest: { tileClassName: 'bg-muted', Icon: () => <ProviderIcon provider="pinterest" />, labelKey: 'accounts.pinterestLabel' },
  '3speak': { tileClassName: 'bg-muted', Icon: () => <ProviderIcon provider="3speak" />, labelKey: 'accounts.threespeakLabel' },
  rumble: { tileClassName: 'bg-muted', Icon: () => <ProviderIcon provider="rumble" />, labelKey: 'accounts.rumbleLabel' },
  fanvue: { tileClassName: 'bg-muted', Icon: () => <ProviderIcon provider="fanvue" />, labelKey: 'accounts.fanvueLabel' },
  telegram: { tileClassName: 'bg-info-soft text-info', Icon: () => <ProviderIcon provider="telegram" />, labelKey: 'accounts.telegramLabel' },
} satisfies Record<SocialProvider, ProviderBrand>;

export function ProviderBrandIcon({ provider }: { provider: SocialProvider }): ReactNode {
  const { tileClassName, Icon } = PROVIDER_BRANDS[provider];
  return (
    <span data-testid={`provider-brand-${provider}`} className={`flex size-9 items-center justify-center rounded-lg ${tileClassName} [&>svg]:size-5`}>
      <Icon />
    </span>
  );
}
