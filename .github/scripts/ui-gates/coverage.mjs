//---------------
// Coverage parsing and aggregation.
//
// normalizeWebPath: coverage reports use paths relative to apps/web
// (vitest cobertura, lcov SF, Stryker filenames); the gate works with
// repo-relative paths, so 'apps/web/' is prepended when missing.
//
// aggregateCoverage: sums covered/total executable lines across the
// target files only. Files with zero coverable lines are skipped;
// files absent from the report are listed as missing (the caller
// decides how to treat them).
//---------------

const WEB_PREFIX = 'apps/web/';

export function normalizeWebPath(path) {
  if (typeof path !== 'string') return path;
  const trimmed = path.startsWith('./') ? path.slice(2) : path;
  return trimmed.startsWith(WEB_PREFIX) ? trimmed : WEB_PREFIX + trimmed;
}

//---------------
// parseCobertura — per-file {covered, total} from a Cobertura XML
// string (vitest --coverage.reporter=cobertura). Dependency-free:
// only <class filename="..."> and <line number hits> are read.
//---------------
export function parseCobertura(xml) {
  const perFile = new Map();
  if (typeof xml !== 'string') return perFile;
  const classRe = /<class\b[^>]*\bfilename="([^"]+)"[^>]*>([\s\S]*?)<\/class>/g;
  let classMatch;
  while ((classMatch = classRe.exec(xml)) !== null) {
    const filename = classMatch[1];
    const body = classMatch[2];
    const lineRe = /<line\b[^>]*\bnumber="(\d+)"[^>]*\bhits="(\d+)"[^>]*>/g;
    let lineMatch;
    let covered = 0;
    let total = 0;
    while ((lineMatch = lineRe.exec(body)) !== null) {
      total += 1;
      if (Number(lineMatch[2]) > 0) covered += 1;
    }
    const prev = perFile.get(filename) || { covered: 0, total: 0 };
    perFile.set(filename, { covered: prev.covered + covered, total: prev.total + total });
  }
  return perFile;
}

//---------------
// parseLcov — per-file {covered, total} from an lcov.info string
// (@cypress/code-coverage output). Counts DA records with hits > 0.
//---------------
export function parseLcov(text) {
  const perFile = new Map();
  if (typeof text !== 'string') return perFile;
  let current = null;
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (line.startsWith('SF:')) {
      current = line.slice(3).trim();
      if (!perFile.has(current)) perFile.set(current, { covered: 0, total: 0 });
    } else if (line.startsWith('DA:') && current !== null) {
      const hits = Number(line.slice(3).split(',')[1]);
      const entry = perFile.get(current);
      entry.total += 1;
      if (hits > 0) entry.covered += 1;
    } else if (line === 'end_of_record') {
      current = null;
    }
  }
  return perFile;
}

//---------------
// aggregateCoverage — sums over targetFiles (repo-relative).
//---------------
export function aggregateCoverage(perFile, targetFiles) {
  let covered = 0;
  let total = 0;
  const missing = [];
  const details = [];
  for (const file of targetFiles) {
    const entry = perFile.get(file) || perFile.get(stripWebPrefix(file));
    if (!entry) {
      missing.push(file);
      continue;
    }
    if (entry.total === 0) continue;
    covered += entry.covered;
    total += entry.total;
    details.push({ file, covered: entry.covered, total: entry.total });
  }
  return { covered, total, missing, details };
}

function stripWebPrefix(path) {
  return path.startsWith(WEB_PREFIX) ? path.slice(WEB_PREFIX.length) : path;
}
