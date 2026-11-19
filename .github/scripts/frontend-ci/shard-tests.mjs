export const WEB_SHARD_TOTAL = 4;

/**
 * @param {unknown} timings
 * @returns {Record<string, number>}
 */
export function readTimings(timings) {
  if (typeof timings !== 'object' || timings === null) return {};
  const files = /** @type {{ files?: unknown }} */ (timings).files;
  if (typeof files !== 'object' || files === null) return {};
  /** @type {Record<string, number>} */
  const out = {};
  for (const [file, ms] of Object.entries(files)) {
    if (typeof ms === 'number' && Number.isFinite(ms) && ms >= 0) out[file] = ms;
  }
  return out;
}

/**
 * Lower median, so an even count does not invent a value between two files.
 * @param {number[]} values
 */
function lowerMedian(values) {
  if (values.length === 0) return 1;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)];
}

/**
 * @param {string[]} files
 * @param {unknown} timings
 * @param {number} total
 * @returns {string[][]} one array per shard, index 0 is shard 1
 */
export function assignShards(files, timings, total) {
  if (!Number.isInteger(total) || total < 1) {
    throw new Error(`shard total must be a positive integer, got ${total}`);
  }
  const known = readTimings(timings);
  const median = lowerMedian(Object.values(known));
  const items = files.map((file) => ({
    file,
    ms: Object.prototype.hasOwnProperty.call(known, file) ? known[file] : median,
  }));
  items.sort((a, b) => b.ms - a.ms || (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
  const bins = Array.from({ length: total }, () => ({ ms: 0, files: /** @type {string[]} */ ([]) }));
  for (const item of items) {
    let best = 0;
    for (let i = 1; i < bins.length; i += 1) {
      if (bins[i].ms < bins[best].ms) best = i;
    }
    bins[best].files.push(item.file);
    bins[best].ms += item.ms;
  }
  return bins.map((bin) => bin.files.sort());
}
