// Side-effect CSS imports (`import "./globals.css"`).
//
// TypeScript 5.9 does not check them. `bun check` matches TypeScript 7 and
// reports TS2882 unless a declaration exists. The file lives outside apps/web
// so the web mutation job, which selects apps/web/**/*.ts, does not try to
// mutate a declaration that has no mutants and no tests.
declare module '*.css' {}
