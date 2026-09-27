#!/usr/bin/env node
//---------------
// generate-voice-samples.mjs — generates the house voice samples on the
// engine and saves them to public/voice-samples/{voiceId}-{language}.mp3.
// Run whenever the voice or language catalog changes:
//
//   node scripts/generate-voice-samples.mjs
//
// Requires: the engine running (MONEYPRINT_API_URL, defaults to local) and
// MONEYPRINT_API_SECRET for authentication. The generated mp3 files must be
// committed.
//---------------

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

function readEnv(file) {
  try {
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch {
    // missing file is optional
  }
}

readEnv('.env');

const baseUrl = (process.env.MONEYPRINT_API_URL || 'http://127.0.0.1:8000').replace(/\/+$/, '');
const outDir = path.resolve('public/voice-samples');

//---------------
// Auth: shared secret + x-user-id — same contract the Next proxy uses in
// production.
//---------------
const API_SECRET = process.env.MONEYPRINT_API_SECRET;
if (!API_SECRET) {
  console.error('MONEYPRINT_API_SECRET é obrigatória para autenticar no engine.');
  process.exit(1);
}
const engineHeaders = { Authorization: `Bearer ${API_SECRET}`, 'x-user-id': 'voice-samples-script' };

async function moneyPrintData(pathname) {
  const res = await fetch(`${baseUrl}${pathname}`, {
    headers: engineHeaders,
  });
  if (!res.ok) throw new Error(`${pathname} -> HTTP ${res.status}`);
  const body = await res.json();
  return body.data;
}

async function main() {
  const voices = await moneyPrintData('/api/v1/personas/voices');
  const languages = await moneyPrintData('/api/v1/personas/voices/sample-languages');
  console.log('vozes:', voices.map((v) => v.id).join(', '));
  console.log('idiomas:', languages.map((l) => l.code).join(', '));

  mkdirSync(outDir, { recursive: true });

  let ok = 0;
  let skipped = 0;
  for (const voice of voices) {
    for (const lang of languages) {
      const file = path.join(outDir, `${voice.id}-${lang.code}.mp3`);
      try {
        writeFileSync(file, ''); // valida que podemos escrever antes de sintetizar
      } catch (error) {
        console.error(`sem permissão de escrita em ${file}:`, error.message);
        process.exit(1);
      }

      const res = await fetch(
        `${baseUrl}/api/v1/personas/voices/${encodeURIComponent(voice.id)}/sample?language=${encodeURIComponent(lang.code)}`,
        { headers: engineHeaders },
      );
      if (!res.ok) {
        console.error(`ERRO ${voice.id}-${lang.code}: HTTP ${res.status}`);
        process.exit(1);
      }
      const bytes = Buffer.from(await res.arrayBuffer());
      writeFileSync(file, bytes);
      ok++;
      console.log('gerado:', path.relative(process.cwd(), file), `(${bytes.length} bytes)`);
    }
  }
  console.log(`\nconcluído: ${ok} samples em ${outDir} — comite os arquivos.`);
}

main().catch((error) => {
  console.error('falhou:', error.message);
  process.exit(1);
});
