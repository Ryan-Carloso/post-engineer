//---------------
// Prompt-data files — the prompt text the product serves, kept in
// shared/prompt-base/ (single source; the web reads it through the symlink
// apps/web/lib/generation/prompt-base.ts, the MCP fetches it from the web
// API). The files are long arrays of prompt wording — data, not logic —
// and they grow with every prompt lesson the 10/10 loop lands, so the
// 500-line cap would block all future prompt work once the store hits it.
// Splitting prompt-base.ts into one file per prompt + a barrel was tried
// and reverted: the joined strings were byte-identical and the tests green,
// but the real path (shared/prompt-base/) is outside the web rootDir, so
// tsc fails with TS6059; the split also breaks Stryker/vite (its sandbox
// copies only the app root). See prompt-base.ts. So the file-size ratchet
// exempts every file under shared/prompt-base/; keep only prompt wording
// there, never logic or helpers. A file merely named prompt-base elsewhere
// is still checked.
//---------------

/** True for a repo-relative path holding prompt data (under shared/prompt-base/). */
export function isPromptDataFile(repoPath) {
  const segments = repoPath.split('/');
  return segments[0] === 'shared' && segments[1] === 'prompt-base';
}
