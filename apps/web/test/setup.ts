import { beforeEach } from 'vitest';
import { ONBOARDING_WIZARD_SEEN_KEY } from '@/lib/onboarding-wizard-keys';

process.env.MCP_RESOURCE = 'https://mcp.post-engineer.test';

beforeEach(() => {
  if (typeof window !== 'undefined' && typeof window.localStorage !== 'undefined') {
    window.localStorage.setItem(ONBOARDING_WIZARD_SEEN_KEY, '1');
  }
});


if (typeof globalThis.ResizeObserver === 'undefined') {
  class ResizeObserverStub implements ResizeObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  globalThis.ResizeObserver = ResizeObserverStub;
}

if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  window.matchMedia = (query: string): MediaQueryList => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  });
}
