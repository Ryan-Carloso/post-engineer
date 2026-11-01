# Shared TypeScript sources

Single sources of truth used by more than one app. Each file has no imports,
so it compiles under the web's bundler resolution and the MCP's NodeNext
resolution. There are no generated copies: edit the file here and both apps
get it.

- `script-segments/script-segments.ts`: the mechanical segments-script
  validation (`validateSegments`, `joinSegments`), used by the web route and
  the MCP tool.
- `prompt-base/prompt-base.ts`: the text of every prompt in the prompts hub,
  `SHARED_PROMPT_BASE` (rules for all prompts) plus each composed prompt
  (`[...SHARED_PROMPT_BASE, '', ...specificLines].join('\n')`). A new prompt
  gets every shared rule by spreading the base. Docs link to the hub.

The apps import through one-line files, `apps/web/lib/generation/<name>.ts` and
`apps/mcp/src/<name>.ts`. The published MCP package stays self-contained: `tsc`
compiles these sources into `dist/shared`, so the entry point is
`dist/apps/mcp/src/index.js`.
