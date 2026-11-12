import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';

vi.mock('@/lib/account-card-telemetry', () => ({
  reportAccountCardDisplay: vi.fn(),
}));

import AccountCard, { ACCOUNT_LABEL_MIN_WIDTH_PX } from '@/components/account-card';
import { reportAccountCardDisplay } from '@/lib/account-card-telemetry';

//---------------
// AccountCard — unit tests
//---------------

// Mock next/image (não renderiza em testes unitários)
vi.mock('next/image', () => ({
  default: (props: Record<string, unknown>) =>
    React.createElement('img', { alt: props.alt, src: props.src, ...props }),
}));

// Mock lib/ui icons
vi.mock('@/lib/ui', () => ({
  GoogleIcon: () => React.createElement('span', { 'data-testid': 'google-icon' }, 'YT'),
  InstagramIcon: () => React.createElement('span', { 'data-testid': 'instagram-icon' }, 'IG'),
  TrashIcon: () => React.createElement('span', { 'data-testid': 'trash-icon' }, '🗑'),
}));

vi.mock('@/lib/i18n/provider', () => {
  const t = (key: string) => key;
  return {
    useI18n: () => ({ t, locale: 'pt', setLocale: vi.fn() }),
  };
});

describe('AccountCard', () => {
  const baseProps = {
    type: 'youtube' as const,
    name: 'Meu Canal',
  };

  it('keeps ~8 letters of label space with the inline trash button', () => {
    render(<AccountCard type="youtube" name="Ch" showDisconnect onDisconnect={() => {}} />);
    const label = document.querySelector('h3') as HTMLElement;
    expect(label.style.minWidth).toBe(`${ACCOUNT_LABEL_MIN_WIDTH_PX}px`);
    const button = screen.getByTestId('youtube-disconnect-button');
    expect(button.getAttribute('aria-label')).toBe('accounts.disconnect');
    expect(within(button).getByTestId('trash-icon')).toBeTruthy();
  });

  it('renders the account name', () => {
    render(<AccountCard {...baseProps} />);
    expect(screen.getByText('Meu Canal')).toBeTruthy();
  });

  it('renders the email when provided', () => {
    render(<AccountCard {...baseProps} email="canal@example.com" />);
    expect(screen.getByText('canal@example.com')).toBeTruthy();
  });

  it('uses initials when there is no thumbnail (YouTube)', () => {
    render(<AccountCard {...baseProps} />);
    expect(screen.getByRole('img', { name: 'Meu Canal' }).textContent).toBe('ME');
  });

  it('uses initials when there is no thumbnail (Instagram)', () => {
    render(<AccountCard type="instagram" name="@perfil" />);
    expect(screen.getByRole('img', { name: '@perfil' }).textContent).toBe('PE');
  });

  it('uses initials when the thumbnail fails to load', () => {
    render(<AccountCard {...baseProps} thumbnail="https://img.example/avatar.jpg" />);
    fireEvent.error(screen.getByRole('img', { name: 'Meu Canal' }));
    expect(screen.getByRole('img', { name: 'Meu Canal' }).textContent).toBe('ME');
  });

  describe('selection mode (onSelect)', () => {
    it('renders a checkbox when onSelect is provided', () => {
      render(<AccountCard {...baseProps} onSelect={() => {}} />);
      expect(screen.getByTestId('account-card-select')).toBeTruthy();
    });

    it('renders a label when onSelect is provided', () => {
      const { container } = render(<AccountCard {...baseProps} onSelect={() => {}} />);
      const label = container.querySelector('label');
      expect(label).toBeTruthy();
    });

    it('calls onSelect when the checkbox is clicked', () => {
      const onSelect = vi.fn();
      render(<AccountCard {...baseProps} onSelect={onSelect} />);
      fireEvent.click(screen.getByTestId('account-card-select'));
      expect(onSelect).toHaveBeenCalledTimes(1);
    });

    it('reflects selected={true} on the checkbox', () => {
      render(<AccountCard {...baseProps} onSelect={() => {}} selected />);
      expect((screen.getByTestId('account-card-select') as HTMLInputElement).checked).toBe(true);
    });

    it('reflects selected={false} on the checkbox by default', () => {
      render(<AccountCard {...baseProps} onSelect={() => {}} />);
      expect((screen.getByTestId('account-card-select') as HTMLInputElement).checked).toBe(false);
    });
  });

  describe('compact mode', () => {
    it('renders only the avatar, with no visible name', () => {
      render(<AccountCard {...baseProps} compact onSelect={() => {}} />);
      expect(screen.queryByText('Meu canal')).toBeNull();
      expect(screen.getByRole('img', { name: 'Meu Canal' })).toBeTruthy();
    });

    it('shows initials when there is no image', () => {
      render(<AccountCard {...baseProps} compact />);
      const fallback = screen.getByRole('img', { name: 'Meu Canal' });
      expect(fallback.textContent).toBe('ME');
    });

    it('switches to initials when the image fails to load', () => {
      render(<AccountCard {...baseProps} compact thumbnail="https://img/x.jpg" />);
      const image = screen.getByRole('img', { name: 'Meu Canal' });
      fireEvent.error(image);
      expect(screen.getByRole('img', { name: 'Meu Canal' }).textContent).toBe('ME');
    });

    it('hides the checkbox and uses color only when selected', () => {
      const onSelect = vi.fn();
      const { rerender } = render(<AccountCard {...baseProps} compact onSelect={onSelect} />);
      expect(screen.queryByTestId('account-card-select')).toBeNull();
      expect(screen.getByTestId('account-card').className).toContain('border-line');
      expect(screen.getByRole('img', { name: 'Meu Canal' }).className).toContain('grayscale');

      rerender(<AccountCard {...baseProps} compact onSelect={onSelect} selected />);
      expect(screen.getByTestId('account-card').className).toContain('border-accent');
      expect(screen.getByRole('img', { name: 'Meu Canal' }).className).not.toContain('grayscale');
      fireEvent.click(screen.getByTestId('account-card'));
      expect(onSelect).toHaveBeenCalledTimes(1);
    });
  });

  describe('error state', () => {
    it('shows only the reconnect action on a broken card', () => {
      render(<AccountCard {...baseProps} error onReconnect={() => {}} showDisconnect onDisconnect={() => {}} />);
      expect(screen.getByTestId('youtube-reconnect-button')).toBeTruthy();
      expect(screen.queryByTestId('youtube-disconnect-button')).toBeNull();
    });

    it('replaces the secondary line with the invalid-token message', () => {
      render(<AccountCard {...baseProps} email="canal@example.com" error onReconnect={() => {}} />);
      expect(screen.getByText('accounts.tokenInvalid')).toBeTruthy();
      expect(screen.queryByText('canal@example.com')).toBeNull();
    });

    it('calls onReconnect when the reconnect button is clicked', () => {
      const onReconnect = vi.fn();
      render(<AccountCard {...baseProps} error onReconnect={onReconnect} showDisconnect onDisconnect={() => {}} />);
      fireEvent.click(screen.getByTestId('youtube-reconnect-button'));
      expect(onReconnect).toHaveBeenCalledTimes(1);
    });

    it('uses a red border and a red status dot on a broken card', () => {
      const { container } = render(<AccountCard {...baseProps} error onReconnect={() => {}} />);
      expect(container.querySelector('[data-testid="account-card"]')?.className).toContain('border-destructive');
      expect(screen.getByRole('img', { name: 'accounts.tokenInvalid' }).className).toContain('bg-destructive');
    });

    it('keeps the trash button and no reconnect action on a healthy card', () => {
      render(<AccountCard {...baseProps} showDisconnect onDisconnect={() => {}} />);
      expect(screen.getByTestId('youtube-disconnect-button')).toBeTruthy();
      expect(screen.queryByTestId('youtube-reconnect-button')).toBeNull();
    });
  });

  describe('accessibility', () => {
    it('a selectable card has cursor-pointer on the label', () => {
      const { container } = render(<AccountCard {...baseProps} onSelect={() => {}} />);
      const label = container.querySelector('label');
      expect(label?.className).toContain('cursor-pointer');
    });

    it('a selected card has a highlighted border', () => {
      const { container } = render(<AccountCard {...baseProps} onSelect={() => {}} selected />);
      const label = container.querySelector('label');
      expect(label?.className).toContain('border-ink');
    });

    it('an unselected card has a neutral border', () => {
      const { container } = render(<AccountCard {...baseProps} onSelect={() => {}} />);
      const label = container.querySelector('label');
      expect(label?.className).toContain('border-line');
    });
  });

  describe('display telemetry', () => {
    beforeEach(() => {
      vi.mocked(reportAccountCardDisplay).mockClear();
    });

    it('reports the painted label', () => {
      render(<AccountCard {...baseProps} email="canal@example.com" />);
      expect(reportAccountCardDisplay).toHaveBeenCalledWith(expect.objectContaining({
        provider: 'youtube',
        shownLabel: 'Meu Canal',
        secondaryLabel: 'canal@example.com',
        compact: false,
        thumbnailFailed: false,
      }));
    });

    it('does not report compact cards', () => {
      render(<AccountCard {...baseProps} compact />);
      expect(reportAccountCardDisplay).not.toHaveBeenCalled();
    });

    it('reports a thumbnail load failure', () => {
      render(<AccountCard {...baseProps} thumbnail="https://cdn.example/a.jpg" />);
      fireEvent.error(screen.getByRole('img', { name: 'Meu Canal' }));
      expect(reportAccountCardDisplay).toHaveBeenCalledWith(expect.objectContaining({
        thumbnailFailed: true,
        thumbnailUrl: 'https://cdn.example/a.jpg',
      }));
    });

    it('measures the disconnect card through its ref', () => {
      render(<AccountCard {...baseProps} />);
      const input = vi.mocked(reportAccountCardDisplay).mock.calls.at(-1)?.[0];
      expect(input?.cardEl).toBeInstanceOf(HTMLElement);
      expect(input?.labelEl).toBeInstanceOf(HTMLHeadingElement);
    });

    it('measures the selectable card through its ref', () => {
      render(<AccountCard {...baseProps} onSelect={() => {}} />);
      const input = vi.mocked(reportAccountCardDisplay).mock.calls.at(-1)?.[0];
      expect(input?.cardEl).toBeInstanceOf(HTMLElement);
    });
  });

  describe('resize observation', () => {
    function installObserver() {
      const observe = vi.fn();
      const disconnect = vi.fn();
      let notify = (): void => {};
      class ResizeObserverStub {
        constructor(callback: () => void) {
          notify = callback;
        }
        observe = observe;
        unobserve = vi.fn();
        disconnect = disconnect;
      }
      vi.stubGlobal('ResizeObserver', ResizeObserverStub);
      return { observe, disconnect, fire: () => notify() };
    }

    beforeEach(() => {
      vi.mocked(reportAccountCardDisplay).mockClear();
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('publishes again when the card resizes', () => {
      const observer = installObserver();
      render(<AccountCard {...baseProps} />);
      expect(observer.observe).toHaveBeenCalled();
      const before = vi.mocked(reportAccountCardDisplay).mock.calls.length;
      observer.fire();
      expect(vi.mocked(reportAccountCardDisplay).mock.calls.length).toBe(before + 1);
    });

    it('disconnects the observer when the card unmounts', () => {
      const observer = installObserver();
      const view = render(<AccountCard {...baseProps} />);
      view.unmount();
      expect(observer.disconnect).toHaveBeenCalled();
    });

    it('skips observation when ResizeObserver is missing', () => {
      vi.stubGlobal('ResizeObserver', undefined);
      expect(() => render(<AccountCard {...baseProps} />)).not.toThrow();
      expect(reportAccountCardDisplay).toHaveBeenCalledTimes(1);
    });
  });
});
