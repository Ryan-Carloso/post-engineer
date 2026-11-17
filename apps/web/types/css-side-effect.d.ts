// Side-effect CSS imports (`import "./globals.css"` in app/layout.tsx).
//
// TypeScript 5.9, which `tsc` still runs for local typecheck and `next build`,
// does not check side-effect imports. Next's own types therefore only declare
// `*.module.css`. `bun check` matches TypeScript 7, which reports TS2882 on a
// side-effect import with no declaration. This file keeps that checker aligned
// with the build. It is a `.d.ts` on purpose: the mutation scope skips
// declaration files (nothing to mutate).
declare module '*.css' {}
