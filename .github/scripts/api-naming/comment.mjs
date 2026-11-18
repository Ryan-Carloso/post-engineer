#!/usr/bin/env node

import fs from 'node:fs';
import { buildCommentBody } from './report.mjs';

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      args[key] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true';
    }
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
if (!args.findings || !args.headSha) {
  console.error('Usage: node comment.mjs --findings <findings.json> --head-sha <sha>');
  process.exit(2);
}
const payload = JSON.parse(fs.readFileSync(args.findings, 'utf8'));
console.log(buildCommentBody(payload.findings ?? [], payload.warnings ?? [], { headSha: args.headSha }));
