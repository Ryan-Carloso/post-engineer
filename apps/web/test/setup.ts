import { beforeEach } from 'vitest';
import { ONBOARDING_WIZARD_SEEN_KEY } from '@/lib/onboarding-wizard';

process.env.MCP_RESOURCE = 'https://mcp.post-engineer.test';

//---------------
// The first-visit onboarding wizard auto-opens on /posts. The default test
// user is a returning one, so the wizard starts seen; first-visit tests
// clear localStorage in their own beforeEach to get the fresh state. The
// window guard keeps node-environment suites (route tests) out of this,
// and the storage guard keeps suites that stub a bare `window` without
// `localStorage` (session-expiry stubs `{ location }`) out of it too.
//---------------
beforeEach(() => {
  if (typeof window !== 'undefined' && typeof window.localStorage !== 'undefined') {
    window.localStorage.setItem(ONBOARDING_WIZARD_SEEN_KEY, '1');
  }
});


//---------------
// jsdom ships no ResizeObserver, and the Radix primitives behind our shadcn
// components (RadioGroup, Select, Popover...) construct one on mount. Without
// this stub every screen that renders one dies with
// "ReferenceError: ResizeObserver is not defined" — a test-environment gap,
// not a bug in the component.
//---------------
if (typeof globalThis.ResizeObserver === 'undefined') {
  class ResizeObserverStub implements ResizeObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  globalThis.ResizeObserver = ResizeObserverStub;
}

//---------------
// jsdom ships no matchMedia; next-themes (mounted in app/providers.tsx) reads
// the OS color-scheme preference through it. Default to "no match" (light);
// theme tests stub their own.
//---------------
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
