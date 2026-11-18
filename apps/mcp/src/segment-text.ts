// Segment text rules: single source of truth for the web app and the MCP
// server, for what spoken segment text may and may not contain.
// DO NOT EDIT this copy directly in apps/web or apps/mcp: the files at
// apps/web/lib/generation/segment-text.ts and
// apps/mcp/src/segment-text.ts are generated copies of this file.
// Edit here, then run `node scripts/sync-script-segments.mjs` from the
// repo root (both apps also run it from their prebuild/pretest scripts).
// Mirrors the engine's _check_text_content and _normalized in
// apps/engine/app/services/script_segments.py: same placeholder, link,
// markdown, emoji and bracket rules, same punctuation stripping.

export function hasForbiddenContent(text: string): boolean {
  const lower = text.toLowerCase();
  if (
    lower.includes('[insira') ||
    lower.includes('[insert') ||
    lower.includes('todo') ||
    lower.includes('lorem')
  ) {
    return true;
  }
  if (lower.includes('http://') || lower.includes('https://') || lower.includes('www.')) {
    return true;
  }
  if (
    text.includes('**') ||
    text.includes('__') ||
    text.includes('`') ||
    text.split('\n').some((line) => line.trim().startsWith('#'))
  ) {
    return true;
  }
  if (/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F000}-\u{1F2FF}\u{FE0F}]/u.test(text)) {
    return true;
  }
  // Any bracketed span is a placeholder or a stage direction.
  return text.includes('[') || text.includes(']');
}

export function normalize(text: string): string {
  // Mirrors the engine _normalized: strip punctuation, keep letters,
  // numbers, underscores and whitespace runs exactly as written (no
  // collapsing), then trim. JS \w is ASCII-only, so the class spells out
  // Unicode letters/numbers plus '_' to match Python's Unicode \w.
  // One remaining difference: Python casefold vs JS toLowerCase differ
  // on a few characters (for example ß), so this is a near mirror, not
  // byte-identical, for those edge cases.
  return text.toLowerCase().replace(/[^\p{L}\p{N}_\s]/gu, '').trim();
}
