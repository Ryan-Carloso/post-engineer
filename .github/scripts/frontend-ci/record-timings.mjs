//---------------
// record-timings — write one shard's file durations from a vitest JSON report.
//---------------

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { durationsFromVitestJson } from './timings.mjs';

function arg(name) {
  const index = process.argv.indexOf(name);
  if (index === -1 || index + 1 >= process.argv.length) return null;
  return process.argv[index + 1];
}

function main() {
  const reportPath = arg('--report');
  const root = arg('--root');
  const out = arg('--out');
  if (reportPath === null || root === null || out === null) {
    process.stderr.write('Usage: node record-timings.mjs --report <vitest.json> --root <apps/web> --out <timings.json>\n');
    process.exit(1);
  }
  const report = JSON.parse(readFileSync(reportPath, 'utf8'));
  const timings = durationsFromVitestJson(report, path.resolve(root));
  writeFileSync(out, `${JSON.stringify(timings, null, 2)}\n`);
  process.stderr.write(`recorded ${Object.keys(timings.files).length} file timing(s)\n`);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
