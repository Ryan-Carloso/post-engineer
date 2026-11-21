const RISKY_TRIGGERS = ['pull_request', 'pull_request_target', 'workflow_dispatch'];
const UNTRUSTED_CONTEXT = /\$\{\{[^}]*\b(?:inputs|github\.event)\./;
const SECRET_REFERENCE = /\bsecrets\.([A-Za-z0-9_]+)/g;
const BLOCK_SCALAR = /^[|>][+-]?\d*$/;

const indentOf = (line) => line.length - line.trimStart().length;
const isComment = (line) => line.trimStart().startsWith('#');

function parseTriggers(lines) {
  const start = lines.findIndex((line) => /^on:/.test(line));
  if (start < 0) return new Set();
  const inline = lines[start].slice(3).replace(/#.*$/, '').trim();
  if (inline !== '') {
    return new Set(inline.replace(/[[\]]/g, '').split(',').map((name) => name.trim()).filter(Boolean));
  }
  const triggers = new Set();
  for (const line of lines.slice(start + 1)) {
    if (line.trim() === '' || isComment(line)) continue;
    if (indentOf(line) === 0) break;
    const key = /^ {2}([A-Za-z_]+):/.exec(line) ?? /^ {2}- ([A-Za-z_]+)/.exec(line);
    if (key !== null) triggers.add(key[1]);
  }
  return triggers;
}

function runBlocks(lines, from, to) {
  const blocks = [];
  for (let index = from; index < to; index += 1) {
    const match = /^(\s*)(- )?run:\s*(.*)$/.exec(lines[index]);
    if (match === null) continue;
    const keyIndent = match[1].length + (match[2] === undefined ? 0 : 2);
    const value = match[3].trim();
    if (!BLOCK_SCALAR.test(value)) {
      blocks.push({ line: index + 1, text: value });
      continue;
    }
    for (let next = index + 1; next < to; next += 1) {
      if (lines[next].trim() !== '' && indentOf(lines[next]) <= keyIndent) break;
      blocks.push({ line: next + 1, text: lines[next] });
    }
  }
  return blocks;
}

function secretsIn(lines, from, to) {
  const found = [];
  for (let index = from; index < to; index += 1) {
    if (isComment(lines[index])) continue;
    for (const match of lines[index].matchAll(SECRET_REFERENCE)) {
      if (match[1] !== 'GITHUB_TOKEN') found.push({ line: index + 1, name: match[1] });
    }
  }
  return found;
}

export function parseWorkflow(text) {
  const lines = text.split('\n');
  const jobsAt = lines.findIndex((line) => /^jobs:/.test(line));
  const headerEnd = jobsAt < 0 ? lines.length : jobsAt;
  const starts = [];
  for (let index = jobsAt + 1; jobsAt >= 0 && index < lines.length; index += 1) {
    if (lines[index].trim() !== '' && !isComment(lines[index]) && indentOf(lines[index]) === 0) break;
    const id = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(lines[index]);
    if (id !== null) starts.push({ id: id[1], index });
  }
  const jobs = starts.map((start, position) => {
    const end = position + 1 < starts.length ? starts[position + 1].index : lines.length;
    const environment = lines.slice(start.index + 1, end).some((line) => /^ {4}environment:/.test(line));
    return { id: start.id, environment, secrets: secretsIn(lines, start.index, end), runs: runBlocks(lines, start.index, end) };
  });
  return { triggers: parseTriggers(lines), workflowSecrets: secretsIn(lines, 0, headerEnd), jobs };
}

const riskyTriggersOf = (triggers) => [...triggers].filter((name) => RISKY_TRIGGERS.includes(name));

export function violationsOf(file, text, allowlist) {
  const { triggers, workflowSecrets, jobs } = parseWorkflow(text);
  const violations = [];
  const risky = riskyTriggersOf(triggers);
  const allowed = (job) => allowlist.some((entry) => entry.workflow === file && entry.job === job);
  if (risky.length > 0 && workflowSecrets.length > 0) {
    violations.push({ file, line: workflowSecrets[0].line, message: `workflow-level env reads secrets.${workflowSecrets[0].name} under ${risky.join('/')}` });
  }
  for (const job of jobs) {
    if (risky.length > 0 && job.secrets.length > 0 && !job.environment && !allowed(job.id)) {
      violations.push({ file, line: job.secrets[0].line, message: `job ${job.id} reads secrets.${job.secrets[0].name} under ${risky.join('/')} with no environment: and no allowlist entry` });
    }
    for (const run of job.runs) {
      if (UNTRUSTED_CONTEXT.test(run.text)) {
        violations.push({ file, line: run.line, message: `job ${job.id} interpolates an inputs.* or github.event.* expression inside run:; pass it through env: instead` });
      }
    }
  }
  return violations;
}

export function staleEntries(files, allowlist) {
  return allowlist.filter((entry) => {
    const text = files.get(entry.workflow);
    if (text === undefined) return true;
    const { triggers, jobs } = parseWorkflow(text);
    const job = jobs.find((candidate) => candidate.id === entry.job);
    return job === undefined || job.environment || job.secrets.length === 0 || riskyTriggersOf(triggers).length === 0;
  });
}
