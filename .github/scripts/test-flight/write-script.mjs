//---------------
// write-script — test-flight script writer.
//
// One flight needs one publishable script, and since MCP-first the server
// no longer writes it: POST /api/videos/generate-and-schedule rejects
// `topics` and requires `title` plus the full script in
// `options.segments`. This step writes that script to a JSON file that
// flight.mjs then sends unchanged.
//
// Quality matters because the ASAP leg publishes for real, on YouTube and
// Instagram. The primary path is an LLM call with a complete, standalone
// prompt: human voice, concrete Porto facts, anti-slop rules, and the
// exact server segment contract. The prompt is standalone on purpose: it
// must work from this file alone, never as a bare reference to another
// prompt. The LLM output is validated with the same rules the server
// enforces, retried once with the named error, and only then replaced.
//
// The fallback is a hand-written script, never a generated placeholder.
// A smoke test must not die because the script writer died, but it must
// also never publish a script that fails validation or reads like filler.
// Every fallback script below passes validateScript, and the flight log
// records which source was used, so a fallback publish is visible.
//
// LLM configuration (all optional; missing key means fallback, not failure):
//   TEST_FLIGHT_LLM_API_KEY   OpenAI-compatible API key. The workflow
//                             passes TEST_FLIGHT_LLM_API_KEY, falling back
//                             to the repo API_NAMING_LLM_API_KEY.
//   TEST_FLIGHT_LLM_BASE_URL  default https://api.openai.com/v1. Point it
//                             at https://opencode.ai/zen/v1 with an
//                             OpenCode Zen key to use OpenCode tokens.
//   TEST_FLIGHT_LLM_MODEL     default gpt-4o-mini.
//   TEST_FLIGHT_TOPIC         optional fixed topic; empty rotates topics.
//   TEST_FLIGHT_RUN_ID        seed for the angle, so reruns differ.
//   TEST_FLIGHT_SCRIPT_PATH   required output path for the script JSON.
// The key never appears in logs or in the output file.
//---------------

import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export class ScriptError extends Error {}

// Server segment contract, mirrored from
// apps/web/lib/generation/script-segments.ts. Keep these in lockstep:
// a script that passes here must pass the server, and a script that
// fails here must never be sent.
export const MIN_TOTAL_WORDS = 60;
export const MAX_TOTAL_WORDS = 200;
export const MIN_BODY_WORDS = 30;
export const MIN_HOOK_WORDS = 15;
export const MAX_HOOK_WORDS = 40;
export const MIN_CTA_WORDS = 5;
export const MAX_CTA_WORDS = 20;
export const MAX_SEGMENTS = 12;
export const LLM_TIMEOUT_MS = 60000;
export const DEFAULT_LLM_BASE_URL = 'https://api.openai.com/v1';
export const DEFAULT_LLM_MODEL = 'gpt-4o-mini';

// Evergreen topics for the scheduled monitor (manual flights pass their own).
export const MONITOR_TOPICS = [
  'Where to eat francesinha in Porto like a local',
  'The best viewpoints in Porto you can visit for free',
  'Porto in one day: what to visit first',
  'Where locals actually eat in Porto (not tourist traps)',
  'The hidden streets of Porto worth getting lost in',
  'Port wine cellars in Vila Nova de Gaia: what to know before you go',
  'Morning in Porto: the perfect riverside walk',
];

// One angle per run, picked from the run seed. The same topic on two runs
// still gets a different script, because the angle changes what the
// script argues, not just which words it swaps.
export const SCRIPT_ANGLES = [
  'first-timer: what to do on a first visit, in order',
  'budget: the best version that costs little or nothing',
  'hidden-gems: the version locals know and tourists miss',
  'food-first: eat your way through it, one stop at a time',
  'walking-route: a route on foot, in order, with no transport',
  'local-habits: how people in Porto actually do this',
  'one-day-plan: fit it into a single day without rushing',
];

function optionalEnv(env, name) {
  return (env[name] ?? '').trim();
}

export function countWords(text) {
  return text.trim().split(/\s+/).filter((word) => word.length > 0).length;
}

// Phrases the shared prompt base bans. An LLM script containing one is
// rejected and retried, not cleaned up silently: cleaning would hide a
// bad script behind a patched one.
export const BANNED_PHRASES = [
  'unlock',
  'elevate',
  'seamless',
  'game-changer',
  'next-level',
  'delve',
  'the future of',
  'a new era',
  'it is not just',
  'let us dive in',
  'here is the thing',
  'honestly',
  'have you ever wondered',
  'did you know',
  'follow for more',
];

function hasForbiddenContent(text) {
  const lower = text.toLowerCase();
  if (
    lower.includes('[insira') ||
    lower.includes('[insert') ||
    lower.includes('todo') ||
    lower.includes('lorem')
  ) {
    return true;
  }
  if (lower.includes('http://') || lower.includes('https://') || lower.includes('www.')) {
    return true;
  }
  if (
    text.includes('**') ||
    text.includes('__') ||
    text.includes('`') ||
    text.split('\n').some((line) => line.trim().startsWith('#'))
  ) {
    return true;
  }
  if (/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F000}-\u{1F2FF}\u{FE0F}]/u.test(text)) {
    return true;
  }
  if (text.includes('[') || text.includes(']')) return true;
  return BANNED_PHRASES.some((phrase) => lower.includes(phrase));
}

export function validateScript(script) {
  if (typeof script !== 'object' || script === null) {
    return { ok: false, error: { field: 'script', rule: 'script must be an object', fix: 'Send { title, segments }.' } };
  }
  const title = typeof script.title === 'string' ? script.title.trim() : '';
  if (title === '') {
    return { ok: false, error: { field: 'title', rule: 'title must be a non-empty string', fix: 'Write a short, specific title for this video.' } };
  }
  const segments = script.segments;
  if (!Array.isArray(segments) || segments.length === 0 || segments.length > MAX_SEGMENTS) {
    return { ok: false, error: { field: 'segments', rule: `segments must be 1-${MAX_SEGMENTS} items`, fix: 'Send hook, body and CTA segments in one array.' } };
  }
  for (let i = 0; i < segments.length; i += 1) {
    const segment = segments[i];
    if (typeof segment !== 'object' || segment === null) {
      return { ok: false, error: { field: `segments.${i}`, rule: 'Segment must be an object.', fix: 'Send each segment as { kind, text }.' } };
    }
    if (segment.kind !== 'hook' && segment.kind !== 'body' && segment.kind !== 'cta') {
      return { ok: false, error: { field: `segments.${i}.kind`, rule: 'Segment kind must be hook, body, or cta.', fix: 'Set kind to hook for the first segment, body for the middle, cta for the last.' } };
    }
    if (typeof segment.text !== 'string' || segment.text.trim() === '') {
      return { ok: false, error: { field: `segments.${i}.text`, rule: 'Segment text must be a non-empty string.', fix: 'Write the spoken text for this segment.' } };
    }
    const unknown = Object.keys(segment).filter((key) => key !== 'kind' && key !== 'text' && key !== 'media' && key !== 'terms').sort();
    if (unknown.length > 0) {
      return { ok: false, error: { field: `segments.${i}`, rule: `segment has unknown field ${unknown[0]}`, fix: 'Remove unknown fields from the segment.' } };
    }
  }
  const hooks = segments.filter((segment) => segment.kind === 'hook');
  const ctas = segments.filter((segment) => segment.kind === 'cta');
  const bodies = segments.filter((segment) => segment.kind === 'body');
  if (segments[0].kind !== 'hook') {
    return { ok: false, error: { field: 'segments.0.kind', rule: 'the first segment must be the hook', fix: 'Move the hook segment first.' } };
  }
  if (segments[segments.length - 1].kind !== 'cta') {
    return { ok: false, error: { field: `segments.${segments.length - 1}.kind`, rule: 'the last segment must be the CTA', fix: 'Move the CTA segment last.' } };
  }
  if (hooks.length !== 1 || ctas.length !== 1 || bodies.length < 1) {
    return { ok: false, error: { field: 'segments', rule: 'segments need exactly one hook, at least one body segment and exactly one CTA', fix: 'Send exactly one hook, one or more body segments and exactly one CTA.' } };
  }
  for (let i = 0; i < segments.length; i += 1) {
    if (hasForbiddenContent(segments[i].text)) {
      return { ok: false, error: { field: `segments.${i}.text`, rule: 'segment text must not contain placeholders, links, markdown, emoji, stage directions or banned AI phrases', fix: 'Remove the placeholder, link, markdown, emoji, bracketed direction or banned phrase and resend the spoken text only.' } };
    }
  }
  const hookText = hooks[0].text;
  if (!/[.!?]$/.test(hookText.trim())) {
    return { ok: false, error: { field: 'segments.0.text', rule: 'the hook must end with terminal punctuation', fix: 'End the hook with a period, exclamation mark or question mark.' } };
  }
  const seen = new Set();
  for (const segment of segments) {
    const normalized = segment.text.toLowerCase().replace(/[^\p{L}\p{N}_\s]/gu, '').trim();
    if (seen.has(normalized)) {
      return { ok: false, error: { field: 'segments.text', rule: 'the same segment text must not repeat', fix: 'Rewrite the repeated segment with different words.' } };
    }
    seen.add(normalized);
  }
  const bodyWords = bodies.reduce((sum, segment) => sum + countWords(segment.text), 0);
  if (bodyWords < MIN_BODY_WORDS) {
    return { ok: false, error: { field: 'segments.text', rule: `Body must have at least ${MIN_BODY_WORDS} words.`, fix: `Add body words until the body reaches ${MIN_BODY_WORDS} words.` } };
  }
  const ctaWords = countWords(ctas[0].text);
  if (ctaWords < MIN_CTA_WORDS || ctaWords > MAX_CTA_WORDS) {
    return { ok: false, error: { field: 'segments.text', rule: `the CTA must be ${MIN_CTA_WORDS}-${MAX_CTA_WORDS} words`, fix: 'Shorten or lengthen the CTA to fit the word range.' } };
  }
  const hookWords = countWords(hookText);
  if (hookWords < MIN_HOOK_WORDS || hookWords > MAX_HOOK_WORDS) {
    return { ok: false, error: { field: 'segments.text', rule: `the hook must be ${MIN_HOOK_WORDS}-${MAX_HOOK_WORDS} words`, fix: 'Rewrite the hook to fit the word range.' } };
  }
  const totalWords = hookWords + bodyWords + ctaWords;
  if (totalWords < MIN_TOTAL_WORDS || totalWords > MAX_TOTAL_WORDS) {
    return { ok: false, error: { field: 'segments', rule: `the script must be ${MIN_TOTAL_WORDS}-${MAX_TOTAL_WORDS} words in total`, fix: 'Add or remove body content to fit the total word range.' } };
  }
  return { ok: true, value: { title, segments, totalWords, bodyWords, hookWords, ctaWords } };
}

export function rotateTopic(topics, now = new Date()) {
  if (!Array.isArray(topics) || topics.length === 0) {
    throw new ScriptError('write-script: topic rotation needs a non-empty list');
  }
  const startOfYear = Date.UTC(now.getUTCFullYear(), 0, 1);
  const dayIndex = Math.floor((now.getTime() - startOfYear) / (24 * 3600 * 1000));
  return topics[((dayIndex % topics.length) + topics.length) % topics.length];
}

export function resolveTopic(env, now = new Date()) {
  const topic = optionalEnv(env, 'TEST_FLIGHT_TOPIC');
  if (topic !== '') return topic;
  return rotateTopic(MONITOR_TOPICS, now);
}

// Deterministic angle from the run seed, so the same topic still gets a
// different script on different runs. The seed is the workflow run id
// plus the date, never a random value the tests cannot reproduce.
export function pickAngle(seed) {
  const text = String(seed ?? '');
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 31 + text.charCodeAt(i)) % 1000003;
  }
  return SCRIPT_ANGLES[hash % SCRIPT_ANGLES.length];
}

//---------------
// The prompt: complete and standalone.
//---------------

export function buildPrompt({ topic, angle }) {
  return [
    'You are a Porto travel guide writing a short spoken video script in English.',
    'This video will publish for real on YouTube and Instagram, as a faceless video: a voiceover over stock footage of places, not a presenter on camera.',
    `Topic: ${topic}`,
    `Angle for this run: ${angle}. Build the whole script around this angle, not around a generic Porto introduction.`,
    '',
    'Write like a human, never like generic AI:',
    'Use concrete detail: named places, streets, and things you can see. Only use facts you are sure are true about Porto. Never invent a restaurant name, a price, an opening hour, or a claim you cannot support. If a detail is missing, leave it out instead of guessing it.',
    'Voice: plain spoken sentences of mixed length, in the first person plural or second person, as a local guide talking to a traveller. Say who did what. Most lines stay plain, with one or two punchy moments at most.',
    'Hook: its only job is to make the viewer want the next sentence. Open with a specific moment, a surprising true fact, or a choice the viewer has to make. Draft three hooks on different angles in your head and keep the strongest. Never promise more than the video delivers.',
    'Body: one idea, developed in order. Give a route, a comparison, or a rule the viewer can actually follow in Porto. Do not list five unrelated tips.',
    'CTA: one specific action tied to this video, for example saving it for a Porto trip or answering which stop the viewer would try first. Never a generic ask to follow.',
    'Faceless visuals: describe places, streets, food, and views that stock footage can show. Never write about the presenter, a face, a camera, looking at the viewer, or pointing.',
    'Cut these phrases and habits completely: unlock, elevate, seamless, game-changer, next-level, delve, the future of, a new era, it is not just X, it is Y, let us dive in, here is the thing, honestly, have you ever wondered, did you know, follow for more, forced groups of three, runs of fragments, upbeat closers, all-caps emphasis, stacked hedges, filler.',
    'No em dashes. No markdown, no emoji, no links, no hashtags, no brackets, no stage directions in any segment. Spoken text only.',
    'Test each line before you send it: could the viewer picture it, could it be proven true or false, and could another creator say it about another city? If yes to the last question, rewrite it.',
    '',
    'Script contract, every line of it is required:',
    `Segments: first hook, last CTA, exactly one of each, at least one body segment, at most ${MAX_SEGMENTS} segments.`,
    `Length: ${MIN_TOTAL_WORDS}-${MAX_TOTAL_WORDS} words in total. Hook ${MIN_HOOK_WORDS}-${MAX_HOOK_WORDS} words, aim for 20-30, ending with a period, exclamation mark, or question mark. Body at least ${MIN_BODY_WORDS} words. CTA ${MIN_CTA_WORDS}-${MAX_CTA_WORDS} words.`,
    'Title: short, specific, and true to this script. Never clickbait that promises more than the video delivers.',
    '',
    'Respond with JSON only, exactly this shape, no other text:',
    '{"title": "<video title>", "segments": [{"kind": "hook", "text": "..."}, {"kind": "body", "text": "..."}, {"kind": "cta", "text": "..."}]}',
  ].join('\n');
}

//---------------
// Fallback scripts: hand-written, one per monitor topic.
// Each one passes validateScript. They are the safety net, not filler:
// if the LLM fails, the flight still publishes a script a human wrote.
//---------------

function fallbackEntry(title, hook, bodies, cta) {
  return {
    title,
    segments: [
      { kind: 'hook', text: hook },
      ...bodies.map((text) => ({ kind: 'body', text })),
      { kind: 'cta', text: cta },
    ],
  };
}

export const FALLBACK_SCRIPTS = {
  'Where to eat francesinha in Porto like a local': fallbackEntry(
    'Where to eat francesinha in Porto like a local',
    'If you eat francesinha on the Ribeira tourist strip, you will pay more for a worse sandwich and miss the whole point of Porto.',
    [
      'Locals eat it in small taverns a few streets back from the river, where the bread is toasted, the cheese melts over the edges, and the sauce is made in the kitchen that morning, not poured from a bottle.',
      'Order it the way it comes, with a fried egg on top if you want the full version, and take your time, because this is a heavy lunch and nobody in Porto rushes it.',
    ],
    'Save this for Porto and tell me where you had your best francesinha.',
  ),
  'The best viewpoints in Porto you can visit for free': fallbackEntry(
    'The best viewpoints in Porto you can visit for free',
    'Porto charges nothing for its best views, and the free viewpoints are often better than the ones with a ticket and a queue.',
    [
      'Start at the Jardim do Morro in Vila Nova de Gaia, across the Dom Luis bridge from the old town, where the whole riverfront and the tiled roofs of Ribeira open in front of you.',
      'Then walk up to the Miradouro da Vitoria, a small terrace above the rooftops where you can watch the river bend and the sun drop behind the bridge in the evening.',
    ],
    'Save these two viewpoints for your Porto trip and go at sunset if you can.',
  ),
  'Porto in one day: what to visit first': fallbackEntry(
    'Porto in one day: what to visit first',
    'You have one day in Porto, so do not try to see everything, see the river, the old town, and one port cellar properly.',
    [
      'Start in Ribeira in the morning, walk along the water, cross the Dom Luis I bridge on the lower deck, and look back at the coloured houses from the Gaia side.',
      'Spend the afternoon in one cellar in Vila Nova de Gaia, taste a ruby and a tawny port, and finish back in Ribeira for dinner when the lights come on over the river.',
    ],
    'Save this one day plan and tell me which stop you would skip first.',
  ),
  'Where locals actually eat in Porto (not tourist traps)': fallbackEntry(
    'Where locals actually eat in Porto (not tourist traps)',
    'The restaurants with photos on the menu and a waiter calling you in from the street are not where Porto eats dinner.',
    [
      'Walk two streets back from Ribeira and look for small tascas with a handwritten daily dish, a short menu, and tables full of people speaking Portuguese at lunch.',
      'Order the dish of the day, ask what is fresh, and eat at Portuguese lunch time, because the best food in Porto is simple, seasonal, and served without a show for tourists.',
    ],
    'Save this rule for Porto and walk past any menu with photos on it.',
  ),
  'The hidden streets of Porto worth getting lost in': fallbackEntry(
    'The hidden streets of Porto worth getting lost in',
    'The best part of Porto is not on the main postcard street, it is in the narrow lanes where the laundry hangs and the stairs never go straight.',
    [
      'Get lost in Miragaia, west of Ribeira, where steep lanes drop toward the river, old houses lean over the street, and every turn opens onto a small square or a view you did not expect.',
      'Walk slowly, look up at the tiles and the balconies, and stop when a lane ends at the water, because in Porto a dead end is often the best viewpoint in the neighbourhood.',
    ],
    'Save Miragaia for your next Porto walk and get lost there on purpose.',
  ),
  'Port wine cellars in Vila Nova de Gaia: what to know before you go': fallbackEntry(
    'Port wine cellars in Vila Nova de Gaia: what to know before you go',
    'Every port cellar in Gaia will sell you a tour, so go in knowing the difference between ruby and tawny before you taste anything.',
    [
      'Ruby port is young, fruity, and aged in bottles or tanks, while tawny port ages in wooden barrels, turns brown with time, and tastes of nuts and dried fruit.',
      'Visit one or two cellars on the Gaia riverfront, not five in one afternoon, taste slowly, and buy only the bottle you actually enjoyed, not the biggest gift box in the shop.',
    ],
    'Save this before your Gaia visit and tell me if you prefer ruby or tawny.',
  ),
  'Morning in Porto: the perfect riverside walk': fallbackEntry(
    'Morning in Porto: the perfect riverside walk',
    'Porto is quietest and prettiest in the morning, before the day trippers arrive and the riverside fills with queues and cameras.',
    [
      'Start in Ribeira just after sunrise, walk west along the Douro past the old warehouses and fishing boats, and watch the city wake up as shops open their shutters.',
      'Keep walking toward Foz where the river meets the sea, stop for coffee on the way, and turn back when the light gets hard, because the walk back along the water is just as good.',
    ],
    'Save this morning walk for Porto and start it before nine if you can.',
  ),
};

export function fallbackScript(topic) {
  const known = FALLBACK_SCRIPTS[topic];
  if (known) return known;
  return fallbackEntry(
    topic,
    `If you only remember one thing about ${topic}, remember this: the best version is the local one, not the one sold to tourists.`,
    [
      'Plan around one clear idea, start early, walk instead of rushing between sights, and leave time to stop, look, and eat where the locals eat.',
      'Use the morning for the busiest places, the afternoon for one place done properly, and the evening for the river, because Porto rewards a slow day more than a checklist.',
    ],
    'Save this plan and tell me which part you would try first.',
  );
}

//---------------
// LLM call
//---------------

function stripFences(text) {
  return text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
}

async function callLlm({ topic, angle, llm, fetchFn, attemptError }) {
  const prompt = buildPrompt({ topic, angle });
  const userContent = attemptError
    ? `${prompt}\n\nPrevious output failed validation: ${attemptError.rule} Fix: ${attemptError.fix} Return JSON only, with the fix applied.`
    : prompt;
  const res = await fetchFn(`${llm.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${llm.apiKey}` },
    body: JSON.stringify({
      model: llm.model,
      temperature: 0.7,
      messages: [
        { role: 'system', content: 'You write short spoken video scripts. Respond with JSON only.' },
        { role: 'user', content: userContent },
      ],
    }),
    signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new ScriptError(`write-script: LLM endpoint returned HTTP ${res.status}${body ? `: ${body.slice(0, 200)}` : ''}`);
  }
  const data = await res.json().catch(() => null);
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || content.trim() === '') {
    throw new ScriptError('write-script: LLM returned an empty completion');
  }
  let parsed;
  try {
    parsed = JSON.parse(stripFences(content));
  } catch {
    throw new ScriptError(`write-script: LLM returned non-JSON: ${content.slice(0, 120)}`);
  }
  return parsed;
}

export async function generateScript({ topic, angle, llm, fetchFn = fetch }) {
  if (!llm || !llm.apiKey) {
    return { ...fallbackScript(topic), source: 'fallback', reason: 'no LLM key configured' };
  }
  let lastError = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const parsed = await callLlm({ topic, angle, llm, fetchFn, attemptError: lastError });
      const checked = validateScript(parsed);
      if (!checked.ok) {
        lastError = checked.error;
        continue;
      }
      return { title: checked.value.title, segments: checked.value.segments, source: 'llm' };
    } catch (error) {
      lastError = null;
      const message = error instanceof Error ? error.message : String(error);
      if (attempt === 1) {
        console.log(`write-script: LLM attempt 2 failed (${message}), using fallback`);
        return { ...fallbackScript(topic), source: 'fallback', reason: message };
      }
      console.log(`write-script: LLM attempt 1 failed (${message}), retrying once`);
    }
  }
  return { ...fallbackScript(topic), source: 'fallback', reason: lastError ? lastError.rule : 'LLM validation failed' };
}

export function resolveLlm(env) {
  const apiKey = optionalEnv(env, 'TEST_FLIGHT_LLM_API_KEY');
  if (apiKey === '') return null;
  return {
    apiKey,
    baseUrl: optionalEnv(env, 'TEST_FLIGHT_LLM_BASE_URL') || DEFAULT_LLM_BASE_URL,
    model: optionalEnv(env, 'TEST_FLIGHT_LLM_MODEL') || DEFAULT_LLM_MODEL,
  };
}

export async function writeScriptFile(env = process.env, options = {}) {
  const now = options.now ?? new Date();
  const topic = resolveTopic(env, now);
  const runId = optionalEnv(env, 'TEST_FLIGHT_RUN_ID') || `manual-${Date.now()}`;
  const angle = pickAngle(`${runId}-${now.toISOString().slice(0, 10)}`);
  const script = await generateScript({ topic, angle, llm: resolveLlm(env), fetchFn: options.fetchFn });
  const outPath = optionalEnv(env, 'TEST_FLIGHT_SCRIPT_PATH');
  if (outPath === '') throw new ScriptError('write-script: missing required TEST_FLIGHT_SCRIPT_PATH');
  const out = {
    topic,
    angle,
    title: script.title,
    segments: script.segments,
    source: script.source,
    runId,
  };
  const write = options.writeFile ?? writeFile;
  await write(outPath, `${JSON.stringify(out, null, 2)}\n`, 'utf8');
  console.log(`write-script: topic="${topic}" angle="${angle}" source=${script.source} title="${script.title}"`);
  if (script.source === 'fallback' && script.reason) {
    console.log(`write-script: fallback used because: ${script.reason}`);
  }
  return out;
}

async function main(env = process.env) {
  await writeScriptFile(env);
}

const invokedAsMain =
  typeof process.argv[1] === 'string' && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedAsMain) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
