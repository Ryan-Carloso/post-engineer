#!/usr/bin/env node

import fs from 'node:fs';
import { buildCommentBody } from './report.mjs';
import { parseArgs } from '../cli/args.mjs';

const args = parseArgs(process.argv.slice(2));
if (!args.findings || !args.headSha) {
  console.error('Usage: node comment.mjs --findings <findings.json> --head-sha <sha>');
  process.exit(2);
}
const payload = JSON.parse(fs.readFileSync(args.findings, 'utf8'));
console.log(buildCommentBody(payload.findings ?? [], payload.warnings ?? [], { headSha: args.headSha }));
