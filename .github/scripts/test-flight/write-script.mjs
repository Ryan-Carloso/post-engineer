import { writeFile } from 'node:fs/promises';
import { searchFacts } from './search.mjs';
import { pathToFileURL } from 'node:url';
import { streamLlmJson } from './llm-stream.mjs';
import { fetchRecentTitles, generateTopic, resolveHistoryConfig } from './topic-llm.mjs';

export class ScriptError extends Error {}

export const MIN_TOTAL_WORDS = 60;
export const MAX_TOTAL_WORDS = 200;
export const MIN_CONTENT_WORDS = 30;
export const MIN_HOOK_WORDS = 25;
export const MAX_HOOK_WORDS = 40;
export const MAX_SEGMENTS = 12;
export const LLM_SILENCE_TIMEOUT_MS = 60000;
export const LLM_TOTAL_TIMEOUT_MS = 300000;
export const DEFAULT_LLM_BASE_URL = 'https://openrouter.ai/api/v1';
export const DEFAULT_LLM_MODELS = ['nvidia/nemotron-3.5-lightning:free', 'z-ai/glm-5.3-flash'];

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
    return { ok: false, error: { field: 'segments', rule: `segments must be 1-${MAX_SEGMENTS} items`, fix: 'Send hook and content segments in one array.' } };
  }
  for (let i = 0; i < segments.length; i += 1) {
    const segment = segments[i];
    if (typeof segment !== 'object' || segment === null) {
      return { ok: false, error: { field: `segments.${i}`, rule: 'Segment must be an object.', fix: 'Send each segment as { kind, text }.' } };
    }
    if (segment.kind !== 'hook' && segment.kind !== 'content') {
      return { ok: false, error: { field: `segments.${i}.kind`, rule: 'Segment kind must be hook or content.', fix: 'Set kind to hook for the first segment, content for the rest.' } };
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
  const contents = segments.filter((segment) => segment.kind === 'content');
  if (segments[0].kind !== 'hook') {
    return { ok: false, error: { field: 'segments.0.kind', rule: 'the first segment must be the hook', fix: 'Move the hook segment first.' } };
  }
  if (hooks.length !== 1 || contents.length < 1) {
    return { ok: false, error: { field: 'segments', rule: 'segments need exactly one hook and at least one content segment', fix: 'Send exactly one hook and one or more content segments.' } };
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
  const contentWords = contents.reduce((sum, segment) => sum + countWords(segment.text), 0);
  if (contentWords < MIN_CONTENT_WORDS) {
    return { ok: false, error: { field: 'segments.text', rule: `Content must have at least ${MIN_CONTENT_WORDS} words.`, fix: `Add content words until the content reaches ${MIN_CONTENT_WORDS} words.` } };
  }
  const hookWords = countWords(hookText);
  if (hookWords < MIN_HOOK_WORDS || hookWords > MAX_HOOK_WORDS) {
    return { ok: false, error: { field: 'segments.text', rule: `the hook must be ${MIN_HOOK_WORDS}-${MAX_HOOK_WORDS} words`, fix: 'Rewrite the hook to fit the word range.' } };
  }
  const totalWords = hookWords + contentWords;
  if (totalWords < MIN_TOTAL_WORDS || totalWords > MAX_TOTAL_WORDS) {
    return { ok: false, error: { field: 'segments', rule: `the script must be ${MIN_TOTAL_WORDS}-${MAX_TOTAL_WORDS} words in total`, fix: 'Add or remove content to fit the total word range.' } };
  }
  return { ok: true, value: { title, segments, totalWords, contentWords, hookWords } };
}

export function pickAngle(seed) {
  const text = String(seed ?? '');
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 31 + text.charCodeAt(i)) % 1000003;
  }
  return SCRIPT_ANGLES[hash % SCRIPT_ANGLES.length];
}

export function buildPrompt({ topic, angle, facts = '' }) {
  return [
    'You are a Porto travel guide writing a short spoken video script in English.',
    'This video will publish for real on YouTube and Instagram, as a faceless video: a voiceover over stock footage of places, not a presenter on camera.',
    `Topic: ${topic}`,
    `Angle for this run: ${angle}. Build the whole script around this angle, not around a generic Porto introduction.`,
    '',
    ...(facts === '' ? [] : [
      'Web search results for this topic. Use ONLY facts from these results. If a fact is not in them, leave it out instead of guessing it. Never invent a restaurant name, a price, an opening hour, or a claim you cannot support with these results.',
      facts,
      '',
    ]),
    'Write like a human, never like generic AI:',
    'Use concrete detail: named places, streets, and things you can see. Only use facts from the search results above. Never invent a restaurant name, a price, an opening hour, or a claim you cannot support. If a detail is missing, leave it out instead of guessing it.',
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
    `Segments: first hook, then content takes in order, exactly one hook, at least one content take, at most ${MAX_SEGMENTS} segments.`,
    `Length: ${MIN_TOTAL_WORDS}-${MAX_TOTAL_WORDS} words in total. Hook ${MIN_HOOK_WORDS}-${MAX_HOOK_WORDS} words, aim for 25-35, ending with a period, exclamation mark, or question mark. Content at least ${MIN_CONTENT_WORDS} words. A CTA is a content take and may appear anywhere after the hook.`,
    'Title: short, specific, and true to this script. Never clickbait that promises more than the video delivers.',
    '',
    'Respond with JSON only, exactly this shape, no other text:',
    '{"title": "<video title>", "segments": [{"kind": "hook", "text": "..."}, {"kind": "content", "text": "..."}, {"kind": "content", "text": "..."}]}',
  ].join('\n');
}

async function callLlm({ topic, angle, llm, model, fetchFn, attemptError, facts = '', streamTimeouts = {} }) {
  const prompt = buildPrompt({ topic, angle, facts });
  const userContent = attemptError
    ? `${prompt}\n\nPrevious output failed validation: ${attemptError.rule} Fix: ${attemptError.fix} Return JSON only, with the fix applied.`
    : prompt;
  const { parsed } = await streamLlmJson({
    baseUrl: llm.baseUrl,
    apiKey: llm.apiKey,
    model,
    messages: [
      { role: 'system', content: 'You write short spoken video scripts. Respond with JSON only.' },
      { role: 'user', content: userContent },
    ],
    fetchFn,
    streamTimeouts: {
      silenceMs: streamTimeouts.silenceMs ?? LLM_SILENCE_TIMEOUT_MS,
      totalMs: streamTimeouts.totalMs ?? LLM_TOTAL_TIMEOUT_MS,
    },
  });
  return parsed;
}

export function resolveLlmModels(env) {
  const fromList = optionalEnv(env, 'TEST_FLIGHT_LLM_MODELS');
  if (fromList !== '') return fromList.split(',').map((m) => m.trim()).filter(Boolean);
  const single = optionalEnv(env, 'TEST_FLIGHT_LLM_MODEL');
  if (single !== '') return [...DEFAULT_LLM_MODELS.filter((m) => m !== single), single];
  return [...DEFAULT_LLM_MODELS];
}

export async function generateScript({ topic, angle, llm, fetchFn = fetch, facts = '', streamTimeouts = {} }) {
  if (!llm || !llm.apiKey) {
    throw new ScriptError('write-script: missing TEST_FLIGHT_LLM_API_KEY — refusing to publish a fallback script');
  }
  const models = Array.isArray(llm.models) && llm.models.length > 0
    ? llm.models
    : (llm.model ? [llm.model] : DEFAULT_LLM_MODELS);
  const failures = [];
  for (const model of models) {
    let lastError = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const parsed = await callLlm({ topic, angle, llm, model, fetchFn, attemptError: lastError, facts, streamTimeouts });
        const checked = validateScript(parsed);
        if (!checked.ok) {
          lastError = checked.error;
          continue;
        }
        return { title: checked.value.title, segments: checked.value.segments, source: 'llm', model };
      } catch (error) {
        failures.push(`${model}: ${error instanceof Error ? error.message : String(error)}`);
        break;
      }
    }
    if (lastError) failures.push(`${model}: validation failed twice (${lastError.rule})`);
    console.log(`write-script: LLM model ${model} failed, trying next model in the chain`);
  }
  throw new ScriptError(`write-script: all LLM models failed (${failures.join('; ')}) — failing the job instead of publishing a repeat script`);
}

export function resolveLlm(env) {
  const apiKey = optionalEnv(env, 'TEST_FLIGHT_LLM_API_KEY');
  if (apiKey === '') return null;
  return {
    apiKey,
    baseUrl: optionalEnv(env, 'TEST_FLIGHT_LLM_BASE_URL') || DEFAULT_LLM_BASE_URL,
    models: resolveLlmModels(env),
  };
}

export function resolveSearch(env) {
  return {
    tavilyKey: optionalEnv(env, 'TEST_FLIGHT_TAVILY_API_KEY'),
    exaKey: optionalEnv(env, 'TEST_FLIGHT_EXA_API_KEY'),
  };
}

export async function writeScriptFile(env = process.env, options = {}) {
  const now = options.now ?? new Date();
  const runId = optionalEnv(env, 'TEST_FLIGHT_RUN_ID') || `manual-${Date.now()}`;
  const angle = pickAngle(`${runId}-${now.toISOString().slice(0, 10)}`);
  const explicitTopic = optionalEnv(env, 'TEST_FLIGHT_TOPIC');
  let topic;
  let topicSource;
  let topicModel = '';
  if (explicitTopic !== '') {
    topic = explicitTopic;
    topicSource = 'explicit';
  } else {
    const historyConfig = resolveHistoryConfig(env);
    const recentTitles = options.history ?? await fetchRecentTitles({ ...historyConfig, fetchFn: options.fetchFn ?? fetch, now });
    const generated = await generateTopic({ llm: resolveLlm(env), recentTitles, fetchFn: options.fetchFn, streamTimeouts: options.streamTimeouts ?? {} });
    topic = generated.topic;
    topicModel = generated.model;
    topicSource = 'llm';
    console.log(`write-script: topic source=llm model=${topicModel} recentTitles=${recentTitles.length} topic="${topic}"`);
  }
  const search = options.search ?? await searchFacts({ topic, ...resolveSearch(env), fetchFn: options.fetchFn ?? fetch });
  console.log(`write-script: search provider=${search.provider} sources=${search.sources.length}`);
  const script = await generateScript({ topic, angle, llm: resolveLlm(env), fetchFn: options.fetchFn, facts: search.facts });
  const outPath = optionalEnv(env, 'TEST_FLIGHT_SCRIPT_PATH');
  if (outPath === '') throw new ScriptError('write-script: missing required TEST_FLIGHT_SCRIPT_PATH');
  const out = {
    topic,
    topicSource,
    angle,
    title: script.title,
    segments: script.segments,
    source: script.source,
    searchProvider: search.provider,
    llmModel: script.model,
    runId,
  };
  const write = options.writeFile ?? writeFile;
  await write(outPath, `${JSON.stringify(out, null, 2)}\n`, 'utf8');
  console.log(`write-script: topic="${topic}" topicSource=${topicSource} angle="${angle}" source=${script.source} model=${script.model} search=${search.provider} title="${script.title}"`);
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
