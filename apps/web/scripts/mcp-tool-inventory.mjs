import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

export const NO_ACTION_TOOLS = ['generate_video', 'cancel_video'];

export const SPECS_TO_TOOL = {
  'intent-accounts.ts:ACCOUNTS_SPECS': 'accounts',
  'intent-content.ts:EXPERIMENTS_SPECS': 'experiments',
  'intent-content.ts:MEDIA_SPECS': 'media',
  'intent-content.ts:CHECK_SCRIPT_SPECS': 'check_script',
  'intent-content.ts:PUBLISH_SPECS': 'publish_video',
  'intent-library.ts:SCHEDULES_SPECS': 'schedules',
  'intent-library.ts:POSTS_SPECS': 'posts',
  'intent-library.ts:INSIGHTS_SPECS': 'insights',
  'intent-library.ts:BILLING_SPECS': 'billing',
  'intent-personas.ts:PERSONAS_SPECS': 'personas',
  'intent-personas.ts:MEDIA_SPECS': 'persona_media',
  'intent-tool-config.ts:TOOL_CONFIG_SPECS': 'tool_config',
  'intent-video.ts:VIDEO_TASKS_SPECS': 'video_tasks',
  'intent-voices.ts:VOICES_SPECS': 'voices',
  'tools-prompts.ts:PROMPTS_SPECS': 'prompts',
};

const TOOL_REGISTRATION = /server\.tool\(\s*(['"])([a-z_]+)\1/g;
const ASSIGNMENT_OPEN_BRACE = /\s*=\s*\{/y;
const SPECS_SPREAD = /\.\.\.([A-Z_]+_SPECS)\b/g;
const SPEC_KEY = /(?:^|[{,])\s*([a-z][a-z_]*)\s*:/gm;

function sourceFiles(dir, prefix = '') {
  const files = [];
  for (const entry of readdirSync(join(dir, prefix))) {
    const relative = prefix === '' ? entry : join(prefix, entry);
    if (statSync(join(dir, relative)).isDirectory()) {
      if (entry === '__tests__') continue;
      files.push(...sourceFiles(dir, relative));
    } else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts')) {
      files.push(relative);
    }
  }
  return files.sort();
}

function mcpSrcDir(repoRoot) {
  return join(repoRoot, 'apps', 'mcp', 'src');
}

function readSource(repoRoot, file) {
  return readFileSync(join(mcpSrcDir(repoRoot), file), 'utf8');
}

function findSpecsObjectBrace(source, constName) {
  const marker = `const ${constName}`;
  let from = 0;
  for (;;) {
    const at = source.indexOf(marker, from);
    if (at === -1) return -1;
    let cursor = at + marker.length;
    from = cursor;
    if (source[cursor] === ':') {
      cursor = source.indexOf('=', cursor);
      if (cursor === -1) return -1;
    } else if (source[cursor] !== ' ' && source[cursor] !== '=') {
      continue;
    }
    ASSIGNMENT_OPEN_BRACE.lastIndex = cursor;
    const assignment = ASSIGNMENT_OPEN_BRACE.exec(source);
    if (assignment !== null) return cursor + assignment[0].length - 1;
  }
}

function topLevelObjectBody(source, openBrace) {
  let depth = 0;
  let body = '';
  for (let i = openBrace; i < source.length; i += 1) {
    const char = source[i];
    if (char === '{' || char === '(' || char === '[') depth += 1;
    if (depth === 1) body += char;
    if (char === '}' || char === ')' || char === ']') {
      depth -= 1;
      if (depth === 0) return body;
    }
  }
  throw new Error('unterminated SPECS object');
}

export function specKeys(repoRoot, file, constName) {
  const source = readSource(repoRoot, file);
  const openBrace = findSpecsObjectBrace(source, constName);
  if (openBrace === -1) throw new Error(`${constName} not found in ${file}`);
  const body = topLevelObjectBody(source, openBrace);
  const keys = [...body.matchAll(SPEC_KEY)].map((match) => match[1]);
  for (const spread of body.matchAll(SPECS_SPREAD)) {
    const owner = sourceFiles(mcpSrcDir(repoRoot)).find(
      (candidate) => findSpecsObjectBrace(readSource(repoRoot, candidate), spread[1]) !== -1,
    );
    if (owner === undefined) throw new Error(`${spread[1]} spread in ${constName} not found`);
    keys.push(...specKeys(repoRoot, owner, spread[1]));
  }
  return keys;
}

export function registeredToolNames(repoRoot) {
  const names = new Set();
  for (const file of sourceFiles(mcpSrcDir(repoRoot))) {
    for (const match of readSource(repoRoot, file).matchAll(TOOL_REGISTRATION)) {
      names.add(match[2]);
    }
  }
  return [...names].sort();
}

export function registeredToolActions(repoRoot) {
  const actions = {};
  for (const [key, tool] of Object.entries(SPECS_TO_TOOL)) {
    const [file, constName] = key.split(':');
    actions[tool] = specKeys(repoRoot, file, constName);
  }
  for (const tool of NO_ACTION_TOOLS) actions[tool] = [];
  return actions;
}
