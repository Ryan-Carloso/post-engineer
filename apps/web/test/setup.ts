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
