// Prints the size of the `tools/list` payload of the built MCP server (issue
// #566): tool count, total bytes, estimated tokens and the largest tools. Run
// it before and after a tool change and paste both outputs in the PR.
//
//   pnpm build && node scripts/measure-tools-list.mjs [--transport stdio|http] [--top 10] [--json]
//
// Needs no API key and makes no network call: the server is created with a
// placeholder key and listed over an in-memory transport.
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const distDir = fileURLToPath(new URL('../dist/', import.meta.url));
if (!existsSync(`${distDir}tools-list-stats.js`)) {
  console.error('dist/ is missing or stale: run `pnpm build` in apps/mcp first.');
  process.exit(1);
}

function parseArgs(argv) {
  const options = { transport: 'stdio', top: 10, json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--json') {
      options.json = true;
    } else if (arg === '--transport' || arg === '--top') {
      const value = argv[i + 1];
      if (value === undefined) throw new Error(`${arg} needs a value`);
      i += 1;
      if (arg === '--transport') {
        if (value !== 'stdio' && value !== 'http') throw new Error(`--transport must be stdio or http, got ${value}`);
        options.transport = value;
      } else {
        const top = Number(value);
        if (!Number.isInteger(top) || top < 1) throw new Error(`--top must be a positive integer, got ${value}`);
        options.top = top;
      }
    } else {
      throw new Error(`unknown argument ${arg}`);
    }
  }
  return options;
}

let options;
try {
  options = parseArgs(process.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

const { createPostEngineerMcpServer } = await import(pathToFileURL(`${distDir}index.js`).href);
const { PostEngineerClient } = await import(pathToFileURL(`${distDir}client.js`).href);
const { formatToolsListReport, listServerTools, summarizeTools } = await import(pathToFileURL(`${distDir}tools-list-stats.js`).href);

const server = createPostEngineerMcpServer(new PostEngineerClient({ apiKey: 'measure-only' }), options.transport);
const summary = summarizeTools(await listServerTools(server), options.top);
console.log(options.json ? JSON.stringify(summary, null, 2) : `transport: ${options.transport}\n${formatToolsListReport(summary)}`);
