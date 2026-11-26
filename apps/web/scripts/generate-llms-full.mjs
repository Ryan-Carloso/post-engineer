import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MORE_SECTION, TOOL_DESCRIPTIONS } from './llms-full-content.mjs';
import { registeredToolActions, registeredToolNames } from './mcp-tool-inventory.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const publicDir = join(root, 'apps/web/public');

const TOOLS_HEADING = '## MCP tools';
const PROMPTS_BULLET = '- Prompts:';
const API_DOCS_FILE = 'api-documentation.txt';

function llmsHead(llms) {
  const end = llms.indexOf(`\n${TOOLS_HEADING}`);
  if (end === -1) throw new Error(`llms.txt has no "${TOOLS_HEADING}" section`);
  return llms.slice(0, end);
}

function llmsPromptsBullet(llms) {
  const toolsAt = llms.indexOf(TOOLS_HEADING);
  const start = llms.indexOf(`\n${PROMPTS_BULLET}`, toolsAt);
  if (toolsAt === -1 || start === -1) {
    throw new Error(`llms.txt has no "${PROMPTS_BULLET}" bullet in its tool section`);
  }
  const [bullet, ...rest] = llms.slice(start + 1).split('\n');
  const continuation = [];
  for (const line of rest) {
    if (!line.startsWith('  ')) break;
    continuation.push(line.trim());
  }
  return [bullet, ...continuation].join(' ');
}

function assertSameTools(described, registered) {
  const missing = registered.filter((name) => !described.includes(name));
  const extra = described.filter((name) => !registered.includes(name));
  if (missing.length > 0 || extra.length > 0) {
    throw new Error(
      `llms-full-content.mjs and the MCP server disagree: missing description for [${missing.join(', ')}], description without a registered tool [${extra.join(', ')}]`,
    );
  }
}

function toolBullet(tool, description, actions) {
  const list = actions.map((action) => `\`${action}\``).join(', ');
  return actions.length === 0 ? `- \`${tool}\` — ${description}` : `- \`${tool}\` — ${description} Actions: ${list}.`;
}

export function buildLlmsFull({ llms, apiDocs, toolNames, toolActions }) {
  const described = TOOL_DESCRIPTIONS.map(([tool]) => tool);
  assertSameTools(described, toolNames);
  const bullets = TOOL_DESCRIPTIONS.map(([tool, description]) =>
    toolBullet(tool, description, toolActions[tool]),
  );
  const intro = `${toolNames.length} intent tools; each takes an \`action\`. Personas and accounts are given by name or id. Every tool and every action is listed below.`;
  return [
    llmsHead(llms),
    '',
    `=== BEGIN ${API_DOCS_FILE} ===`,
    apiDocs.trimEnd(),
    `=== END ${API_DOCS_FILE} ===`,
    '',
    TOOLS_HEADING,
    '',
    intro,
    '',
    ...bullets,
    llmsPromptsBullet(llms),
    '',
    MORE_SECTION,
    '',
  ].join('\n');
}

export function generateLlmsFull(repoRoot = root) {
  return buildLlmsFull({
    llms: readFileSync(join(repoRoot, 'apps/web/public/llms.txt'), 'utf8'),
    apiDocs: readFileSync(join(repoRoot, `apps/web/public/${API_DOCS_FILE}`), 'utf8'),
    toolNames: registeredToolNames(repoRoot),
    toolActions: registeredToolActions(repoRoot),
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writeFileSync(join(publicDir, 'llms-full.txt'), generateLlmsFull());
}
