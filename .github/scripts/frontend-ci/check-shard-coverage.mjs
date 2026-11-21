import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { WEB_SHARD_TOTAL } from './shard-tests.mjs';

/**
 * @param {object} input
 * @param {{ shard: number, selected: number }[]} input.markers
 * @param {number[]} input.coverageShards
 * @param {number} input.total
 * @returns {{ ok: boolean, reason: string }}
 */
export function assessShardCoverage({ markers, coverageShards, total }) {
  if (!Array.isArray(markers) || markers.length !== total) {
    return { ok: false, reason: `expected ${total} shard markers, found ${markers.length}` };
  }
  const seen = new Set();
  for (const marker of markers) {
    if (!Number.isInteger(marker.shard) || marker.shard < 1 || marker.shard > total) {
      return { ok: false, reason: `shard marker ${marker.shard} is outside 1..${total}` };
    }
    if (!Number.isInteger(marker.selected) || marker.selected < 0) {
      return { ok: false, reason: `shard ${marker.shard} has a bad selected count` };
    }
    if (seen.has(marker.shard)) return { ok: false, reason: `duplicate marker for shard ${marker.shard}` };
    seen.add(marker.shard);
  }
  for (const marker of markers) {
    if (marker.selected > 0 && !coverageShards.includes(marker.shard)) {
      return {
        ok: false,
        reason: `shard ${marker.shard} selected ${marker.selected} test files but uploaded no coverage`,
      };
    }
  }
  const ran = markers.filter((marker) => marker.selected > 0).length;
  return {
    ok: true,
    reason: ran === 0 ? 'no shard selected tests' : `${ran} shard(s) uploaded coverage`,
  };
}

/**
 * @param {string} dir
 * @param {(name: string) => number | null} shardOf
 * @returns {Promise<string[]>}
 */
async function filesUnder(dir, shardOf) {
  /** @type {string[]} */
  const found = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') return found;
    throw error;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const nested = await filesUnder(full, shardOf);
      found.push(...nested);
    } else if (shardOf(entry.name) !== null || entry.name === '.shard-marker.json' || entry.name === 'cobertura-coverage.xml') {
      found.push(full);
    }
  }
  return found;
}

function shardFromDir(filePath, pattern) {
  const match = pattern.exec(filePath.split(path.sep).join('/'));
  return match === null ? null : Number(match[1]);
}

async function main() {
  const markersDir = arg('--markers');
  const coverageDir = arg('--coverage');
  if (markersDir === null || coverageDir === null) {
    process.stderr.write('Usage: node check-shard-coverage.mjs --markers <dir> --coverage <dir>\n');
    process.exit(1);
  }
  const markerFiles = (await filesUnder(markersDir, () => null)).filter((file) => file.endsWith('.shard-marker.json'));
  /** @type {{ shard: number, selected: number }[]} */
  const markers = [];
  for (const file of markerFiles) {
    const parsed = JSON.parse(await readFile(file, 'utf8'));
    if (typeof parsed !== 'object' || parsed === null) {
      throw new Error(`marker ${file} is not an object`);
    }
    const row = /** @type {{ shard?: unknown, selected?: unknown }} */ (parsed);
    if (typeof row.shard !== 'number' || typeof row.selected !== 'number') {
      throw new Error(`marker ${file} is missing shard or selected`);
    }
    markers.push({ shard: row.shard, selected: row.selected });
  }
  const coverageFiles = (await filesUnder(coverageDir, () => null)).filter((file) => file.endsWith('cobertura-coverage.xml'));
  const coverageShards = [...new Set(coverageFiles.map((file) => shardFromDir(file, /coverage-vitest-shard-(\d+)/)).filter((id) => id !== null))];
  const result = assessShardCoverage({ markers, coverageShards, total: WEB_SHARD_TOTAL });
  process.stderr.write(`${result.reason}\n`);
  if (!result.ok) process.exit(1);
}

function arg(name) {
  const index = process.argv.indexOf(name);
  if (index === -1 || index + 1 >= process.argv.length) return null;
  return process.argv[index + 1];
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}
