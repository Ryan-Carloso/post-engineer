import path from 'node:path';

export function durationsFromVitestJson(report, root) {
  const files = {};
  if (typeof report !== 'object' || report === null) return { version: 1, files };
  const results = (report).testResults;
  if (!Array.isArray(results)) return { version: 1, files };
  for (const result of results) {
    if (typeof result !== 'object' || result === null) continue;
    const row = (result);
    if (typeof row.name !== 'string' || row.name.length === 0) continue;
    if (typeof row.startTime !== 'number' || typeof row.endTime !== 'number') continue;
    const ms = row.endTime - row.startTime;
    if (!Number.isFinite(ms) || ms < 0) continue;
    const relative = path.isAbsolute(row.name)
      ? path.relative(root, row.name)
      : row.name;
    const key = relative.split(path.sep).join('/');
    if (key.startsWith('..')) continue;
    files[key] = ms;
  }
  return { version: 1, files };
}

export function mergeTimings(parts) {
  const files = {};
  for (const part of parts) {
    if (typeof part !== 'object' || part === null) continue;
    const entries = part.files;
    if (typeof entries !== 'object' || entries === null) continue;
    for (const [file, ms] of Object.entries(entries)) {
      if (typeof ms === 'number' && Number.isFinite(ms) && ms >= 0) files[file] = ms;
    }
  }
  return { version: 1, files };
}
