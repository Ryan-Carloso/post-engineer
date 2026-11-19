//---------------
// Prompt-data files — the prompt text the product serves, kept in
// shared/prompt-base/ (single source; the web reads it through the symlink
// apps/web/lib/generation/prompt-base.ts, the MCP fetches it from the web
// API). The files are long arrays of prompt wording — data, not logic —
// and they grow with every prompt lesson the 10/10 loop lands, so the
// 500-line cap would block all future prompt work once the store hits it.
// Splitting prompt-base.ts into one file per prompt + a barrel was tried
// in PR #668 and reverted: the joined strings were byte-identical and the
// tests green, but tsc resolves the barrel's relative imports from the
// symlink's directory (apps/web/lib/generation/) instead of the real path
// (shared/prompt-base/), and no variant (tsconfig paths, up-from-symlink
// imports) works without breaking Stryker/vite. So the file-size ratchet
// exempts this directory; the cap still applies to all logic, including
// any file merely named prompt-base elsewhere.
//---------------

/** True for a repo-relative path holding prompt data (under shared/prompt-base/). */
export function isPromptDataFile(repoPath) {
  const segments = repoPath.split('/');
  return segments[0] === 'shared' && segments[1] === 'prompt-base';
}
