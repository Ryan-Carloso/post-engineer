import { normalizeWebPath } from './coverage.mjs';

export function mutationScore(report, targetFiles) {
  if (!report || typeof report !== 'object' || !report.files) return null;
  const targets = new Set(targetFiles.map(normalizeWebPath));
  let killed = 0;
  let survived = 0;
  let timeout = 0;
  let total = 0;
  const files = report.files;
  const entries = Array.isArray(files)
    ? files.map((f) => [f.filename || f.name, f.mutants])
    : Object.entries(files).map(([name, f]) => [name, f && f.mutants]);
  for (const [name, mutants] of entries) {
    if (!targets.has(normalizeWebPath(name))) continue;
    if (!Array.isArray(mutants)) continue;
    for (const mutant of mutants) {
      total += 1;
      if (mutant.status === 'Killed') killed += 1;
      else if (mutant.status === 'Timeout') timeout += 1;
      else if (mutant.status === 'Survived') survived += 1;
    }
  }
  if (total === 0) return null;
  return { killed, survived, timeout, total, score: Math.floor(((killed + timeout) * 100) / total) };
}
