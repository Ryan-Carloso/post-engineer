/**
 * Deterministic lint layer: configurable denylist with an explicit,
 * documented match rule.
 *
 * Match rule: case-insensitive EXACT match on the full identifier.
 * `replay` fails; `replayed`, `replayCount`, `metadata` do not — those
 * go to the LLM layer, which judges semantic clarity from context.
 *
 * There is no exceptions mechanism: a denylisted name either gets renamed
 * or fails the lint.
 */

/**
 * @param {Array<{ file: string, line: number, name: string, context: string, renamedFrom: string | null }>} candidates
 * @param {{ denylist: Record<string, { severity: 'error' | 'warn', reason: string }>, allowlist: string[] }} config
 * @returns {Array<{ file: string, line: number, name: string, severity: 'error' | 'warn', reason: string, alternatives: string[], source: 'denylist', renamedFrom: string | null }>}
 */
export function checkDenylist(candidates, config) {
  const allowed = new Set(config.allowlist.map((n) => n.toLowerCase()));
  const findings = [];
  for (const c of candidates) {
    const lower = c.name.toLowerCase();
    if (allowed.has(lower)) continue;
    const entry = Object.entries(config.denylist).find(([k]) => k.toLowerCase() === lower);
    if (!entry) continue;
    const [, rule] = entry;
    findings.push({
      file: c.file,
      line: c.line,
      name: c.name,
      severity: rule.severity,
      reason: rule.reason,
      alternatives: [],
      source: 'denylist',
      renamedFrom: c.renamedFrom,
    });
  }
  return findings;
}
