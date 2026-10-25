import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { AvatarDisabledBanner } from '../avatar-disabled-banner';

vi.mock('@/lib/i18n/provider', () => {
  function I18nProvider({ children }: { children: ReactNode }) {
    return <>{children}</>;
  }
  I18nProvider.displayName = 'I18nProvider';
  return {
    I18nProvider,
    useI18n: () => ({ t: (key: string) => key, locale: 'en', setLocale: vi.fn() }),
  };
});

describe('AvatarDisabledBanner', () => {
  it('renders when warnings include avatar_disabled', () => {
    render(<AvatarDisabledBanner warnings={['avatar_disabled']} />);
    expect(screen.getByTestId('avatar-disabled-warning')).toBeInTheDocument();
  });

  it('renders nothing without that code', () => {
    const { container } = render(<AvatarDisabledBanner warnings={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
