import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { mergeTimings } from './timings.mjs';

function arg(name) {
  const index = process.argv.indexOf(name);
  if (index === -1 || index + 1 >= process.argv.length) return null;
  return process.argv[index + 1];
}

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    process.stderr.write(
      `merge-timings: skipping ${file} (${error instanceof Error ? error.message : String(error)})\n`,
    );
    return null;
  }
}

function findTimingFiles(dir) {
  const found = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
      return found;
    }
    throw error;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...findTimingFiles(full));
    else if (entry.name.endsWith('.json')) found.push(full);
  }
  return found.sort();
}

function main() {
  const dir = arg('--dir');
  const out = arg('--out');
  const base = arg('--base');
  if (dir === null || out === null) {
    process.stderr.write('Usage: node merge-timings.mjs --dir <shards> --out <timings.json> [--base <previous.json>]\n');
    process.exit(1);
  }
  const parts = [];
  if (base !== null && existsSync(base)) {
    const previous = readJson(base);
    if (previous !== null) parts.push(previous);
  }
  for (const file of findTimingFiles(dir)) {
    const parsed = readJson(file);
    if (parsed !== null) parts.push(parsed);
  }
  const merged = mergeTimings(parts);
  writeFileSync(out, `${JSON.stringify(merged, null, 2)}\n`);
  process.stderr.write(`merged timings for ${Object.keys(merged.files).length} file(s) into ${out}\n`);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
