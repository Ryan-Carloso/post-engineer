import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { findRepoRoot } from './repo-root';

const NO_ACTION_TOOLS: readonly string[] = ['generate_video', 'cancel_video'];

const SPECS_TO_TOOL: Readonly<Record<string, string>> = {
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

function mcpSrcDir(fromUrl: string): string {
  return join(findRepoRoot(fromUrl), 'apps', 'mcp', 'src');
}

function sourceFiles(fromUrl: string): string[] {
  const dir = mcpSrcDir(fromUrl);
  return readdirSync(dir).filter((name) => name.endsWith('.ts') && !name.endsWith('.d.ts'));
}

function readSource(fromUrl: string, file: string): string {
  return readFileSync(join(mcpSrcDir(fromUrl), file), 'utf8');
}

function topLevelObjectBody(source: string, openBrace: number): string {
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

function specKeys(fromUrl: string, file: string, constName: string): string[] {
  const source = readSource(fromUrl, file);
  const declaration = new RegExp(`const ${constName}(?::[^=]+)? = \\{`).exec(source);
  if (declaration === null) throw new Error(`${constName} not found in ${file}`);
  const body = topLevelObjectBody(source, declaration.index + declaration[0].length - 1);
  const keys = [...body.matchAll(/(?:^|[{,\s])([a-z][a-z_]*)\s*:/g)].map((match) => match[1]);
  for (const spread of body.matchAll(/\.\.\.([A-Z_]+_SPECS)\b/g)) {
    const owner = sourceFiles(fromUrl).find((candidate) =>
      new RegExp(`const ${spread[1]}(?::[^=]+)? = \\{`).test(readSource(fromUrl, candidate)),
    );
    if (owner === undefined) throw new Error(`${spread[1]} spread in ${constName} not found`);
    keys.push(...specKeys(fromUrl, owner, spread[1]));
  }
  return keys;
}

export function registeredToolNames(fromUrl: string): string[] {
  const names = new Set<string>();
  for (const file of sourceFiles(fromUrl)) {
    for (const match of readSource(fromUrl, file).matchAll(/server\.tool\(\s*'([a-z_]+)'/g)) {
      names.add(match[1]);
    }
  }
  return [...names].sort();
}

export function registeredToolActions(fromUrl: string): Record<string, string[]> {
  const actions: Record<string, string[]> = {};
  for (const [key, tool] of Object.entries(SPECS_TO_TOOL)) {
    const [file, constName] = key.split(':');
    actions[tool] = specKeys(fromUrl, file, constName);
  }
  for (const tool of NO_ACTION_TOOLS) actions[tool] = [];
  return actions;
}
