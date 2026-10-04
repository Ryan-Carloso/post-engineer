import { NextResponse } from 'next/server';

//---------------
// Cypress backend coverage endpoint.
//
// After each spec, the @cypress/code-coverage plugin requests the URL
// configured in cypress.config.ts (`codeCoverage.url`) and merges
// `body.coverage` into the final report. This exposes the Node server's
// accumulated istanbul counters — route handlers, server components and
// other server files exercised by the E2E specs — collected during the
// instrumented production build that CI runs (temporary .babelrc with
// the istanbul plugin, see the cypress-coverage job).
//
// A non-instrumented build never sets `globalThis.__coverage__`; the
// endpoint then answers 204, so it is a harmless no-op in production.
//---------------

// Never statically prerender: the counters accumulate while Cypress
// exercises the app, so every request must read the live global.
export const dynamic = 'force-dynamic';

// One istanbul file-coverage entry map, keyed by absolute file path.
// Kept structural (not the istanbul types) so this route does not
// depend on the instrumentation libraries at runtime.
type ServerCoverageMap = Record<string, unknown>;

declare global {
  // Set by babel-plugin-istanbul in instrumented builds only.
  var __coverage__: ServerCoverageMap | undefined;
}

export async function GET() {
  const coverage = globalThis.__coverage__;
  if (!coverage) {
    return new NextResponse(null, { status: 204 });
  }
  return NextResponse.json({ coverage });
}
