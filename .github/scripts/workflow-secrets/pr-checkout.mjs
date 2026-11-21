const PR_REF = /^\s+ref:.*(?:pull_request\.head|refs\/pull\/)/m;
const CHECKOUT_PATH = /^\s+path:\s*["']?([^\s"']+)/m;
const INTERPRETER = /^\s*(?:timeout\s+\S+\s+)?(python3?|node|bash|sh|source|\.|pnpm|npm|npx|yarn|pip3?|make|uv)\s+(.*)$/;
const INSTALL = /^\s*(?:pnpm|npm|yarn|pip3?|uv)\s+(?:install|ci|add|sync|i)\b/;
const TRUSTED_START = /^["']?\$\{?(?:GITHUB_WORKSPACE|RUNNER_TEMP)\b|^["']?\//;

const stepsOf = (lines) => {
  const steps = [];
  for (const [offset, line] of lines.entries()) {
    if (/^ {6}- /.test(line)) steps.push({ first: offset, text: [] });
    if (steps.length > 0) steps[steps.length - 1].text.push(line);
  }
  return steps.map((step) => ({ first: step.first, text: step.text.join('\n') }));
};

export function prCheckoutDirs(job) {
  const dirs = [];
  const violations = [];
  for (const step of stepsOf(job.lines)) {
    if (!/uses:\s*actions\/checkout@/.test(step.text) || !PR_REF.test(step.text)) continue;
    const path = CHECKOUT_PATH.exec(step.text);
    if (path === null) violations.push({ line: job.firstLine + step.first, message: `pull_request_target job ${job.id} checks out the PR at the workspace root; check it out into its own path: directory` });
    else dirs.push(path[1].replace(/\/$/, ''));
  }
  return { dirs, violations };
}

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function runLineViolations(job, dirs) {
  const violations = [];
  const dirPattern = dirs.map(escapeRegExp).join('|');
  const isPrDir = new RegExp(`^["']?(?:\\./)?(?:${dirPattern})/?["']?$`);
  const isPrPath = new RegExp(`^["']?(?:\\./)?(?:${dirPattern})/`);
  let inPr = false;
  for (const run of job.runs) {
    for (const part of run.text.split(/(&&|;|\|\||\(|\))/)) {
      if (part === ')') inPr = false;
      const cd = /^\s*cd\s+(\S+)/.exec(part);
      if (cd !== null) inPr = isPrDir.test(cd[1]);
      if (INSTALL.test(part)) {
        violations.push({ line: run.line, message: `pull_request_target job ${job.id} installs dependencies next to a checked-out PR; never install PR code` });
        continue;
      }
      const command = INTERPRETER.exec(part);
      if (command === null) continue;
      const rest = command[2].trim();
      const firstPath = rest.split(/\s+/).find((token) => !token.startsWith('-')) ?? '';
      if (isPrPath.test(firstPath) || (inPr && !TRUSTED_START.test(rest))) {
        violations.push({ line: run.line, message: `pull_request_target job ${job.id} runs ${command[1]} on a path from the checked-out PR; run only base files, by absolute path` });
      }
    }
  }
  return violations;
}

export function pullRequestTargetViolations(file, job) {
  const { dirs, violations } = prCheckoutDirs(job);
  const all = [...violations, ...(dirs.length > 0 ? runLineViolations(job, dirs) : [])];
  return all.map((violation) => ({ file, ...violation }));
}
