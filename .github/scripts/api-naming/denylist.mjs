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
