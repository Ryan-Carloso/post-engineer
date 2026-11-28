import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

function attr(tag, name) {
  const match = new RegExp(`\\b${name}="([^"]*)"`).exec(tag);
  return match === null ? null : match[1];
}

export function parseCoberturaFiles(xml) {
  const files = new Map();
  if (typeof xml !== 'string') return files;
  const classRe = /<class\b([^>]*\bfilename="[^"]+"[^>]*)>([\s\S]*?)<\/class>/g;
  let classMatch;
  while ((classMatch = classRe.exec(xml)) !== null) {
    const filename = attr(classMatch[1], 'filename');
    if (filename === null || filename.length === 0) continue;
    let lines = files.get(filename);
    if (lines === undefined) {
      lines = new Map();
      files.set(filename, lines);
    }
    const lineRe = /<line\b([^>]*)\/?>/g;
    let lineMatch;
    while ((lineMatch = lineRe.exec(classMatch[2])) !== null) {
      const number = attr(lineMatch[1], 'number');
      const hits = attr(lineMatch[1], 'hits');
      if (number === null || hits === null) continue;
      const lineNo = Number(number);
      const hitCount = Number(hits);
      if (!Number.isInteger(lineNo) || lineNo < 1) continue;
      if (!Number.isFinite(hitCount) || hitCount < 0) continue;
      const branch = attr(lineMatch[1], 'branch') === 'true';
      const condition = attr(lineMatch[1], 'condition-coverage');
      const prev = lines.get(lineNo);
      if (prev === undefined) {
        lines.set(lineNo, { hits: hitCount, branch, condition });
      } else if (hitCount > prev.hits) {
        prev.hits = hitCount;
        prev.branch = prev.branch || branch;
        prev.condition = condition ?? prev.condition;
      } else {
        prev.branch = prev.branch || branch;
        if (prev.condition === null || prev.condition === undefined) prev.condition = condition;
      }
    }
  }
  return files;
}

export function mergeCobertura(xmls) {
  const files = new Map();
  for (const xml of xmls) {
    for (const [filename, lines] of parseCoberturaFiles(xml)) {
      let dest = files.get(filename);
      if (dest === undefined) {
        dest = new Map();
        files.set(filename, dest);
      }
      for (const [lineNo, info] of lines) {
      const prev = dest.get(lineNo);
      if (prev === undefined) {
        dest.set(lineNo, { hits: info.hits, branch: info.branch, condition: info.condition });
      } else {
        prev.hits += info.hits;
        prev.branch = prev.branch || info.branch;
        prev.condition = mergeCondition(prev.condition, info.condition);
      }
      }
    }
  }
  return renderCobertura(files);
}

function renderCobertura(files) {
  let linesValid = 0;
  let linesCovered = 0;
  const classes = [];
  const names = [...files.keys()].sort();
  for (const filename of names) {
    const lines = files.get(filename);
    if (lines === undefined) continue;
    const numbers = [...lines.keys()].sort((a, b) => a - b);
    let covered = 0;
    const body = [];
    for (const number of numbers) {
      const info = lines.get(number);
      if (info === undefined) continue;
      linesValid += 1;
      if (info.hits > 0) {
        covered += 1;
        linesCovered += 1;
      }
      const branch = info.branch || (info.condition !== null && info.condition !== undefined);
      const condition = info.condition === null || info.condition === undefined
        ? ''
        : ` condition-coverage="${escapeXml(info.condition)}"`;
      body.push(
        `            <line number="${number}" hits="${info.hits}" branch="${branch ? 'true' : 'false'}"${condition}/>`,
      );
    }
    const rate = numbers.length === 0 ? 0 : covered / numbers.length;
    classes.push(
      `        <class name="${escapeXml(filename)}" filename="${escapeXml(filename)}" line-rate="${rate}">\n          <lines>\n${body.join('\n')}\n          </lines>\n        </class>`,
    );
  }
  const rate = linesValid === 0 ? 0 : linesCovered / linesValid;
  return `<?xml version="1.0" encoding="UTF-8"?>
<coverage lines-valid="${linesValid}" lines-covered="${linesCovered}" line-rate="${rate}" branches-valid="0" branches-covered="0" branch-rate="0" complexity="0" version="0">
  <packages>
    <package name="web" line-rate="${rate}">
      <classes>
${classes.join('\n')}
      </classes>
    </package>
  </packages>
</coverage>
`;
}

function mergeCondition(left, right) {
  if (left === null || left === undefined) return right ?? null;
  if (right === null || right === undefined) return left;
  const leftCount = /\((\d+)\/(\d+)\)/.exec(left);
  const rightCount = /\((\d+)\/(\d+)\)/.exec(right);
  if (leftCount === null || rightCount === null) return left;
  const total = Math.max(Number(leftCount[2]), Number(rightCount[2]));
  const covered = Math.min(total, Number(leftCount[1]) + Number(rightCount[1]));
  const percent = total === 0 ? 100 : Math.round((covered * 1000) / total) / 10;
  return `${percent}% (${covered}/${total})`;
}

function escapeXml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

async function findReports(dir) {
  const found = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
      return found;
    }
    throw error;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...await findReports(full));
    else if (entry.name === 'cobertura-coverage.xml') found.push(full);
  }
  return found;
}

async function main() {
  const outIndex = process.argv.indexOf('--out');
  const dirIndex = process.argv.indexOf('--dir');
  if (outIndex === -1 || dirIndex === -1 || outIndex + 1 >= process.argv.length || dirIndex + 1 >= process.argv.length) {
    process.stderr.write('Usage: node merge-cobertura.mjs --dir <shards> --out <cobertura.xml>\n');
    process.exit(1);
  }
  const dir = process.argv[dirIndex + 1];
  const out = process.argv[outIndex + 1];
  const reports = await findReports(dir);
  const xmls = await Promise.all(reports.map((file) => readFile(file, 'utf8')));
  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(out, mergeCobertura(xmls));
  process.stderr.write(`merged ${reports.length} cobertura report(s) into ${out}\n`);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}
