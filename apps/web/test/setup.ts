process.env.MCP_RESOURCE = 'https://mcp.post-engineer.test';

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
