//---------------
// topic-llm — the test-flight topic comes from the LLM, not from a list.
//
// The old MONITOR_TOPICS list (7 hard-coded Porto topics, rotated by
// day-of-year) guaranteed a repeat: every dispatch on the same day
// picked the same topic, and two near-identical videos were published
// to the real test channels on 2026-11-01. There is no list here on
// purpose. Instead, before the script step, this module:
//   1. fetches the real history: GET /api/schedule/status on the test
//      API base URL with the test API key, which returns recent
//      published/failed slots and upcoming slots, each with a title;
//   2. asks the LLM (same chain and streaming client as the script
//      writer) to propose ONE new topic about food or travel in places
//      in Portugal, in English, different from every title in the
//      last 30 days;
//   3. validates that proposal mechanically (never by asking the LLM
//      whether it is a duplicate): exact match and token-overlap
//      near-duplicates are rejected, as are topics with no Portugal
//      place signal or no food/travel signal.
// A history fetch failure fails the job before any script call: going
// ahead blind is how duplicates get published. An empty history is
// fine and is stated to the LLM as such. If every model fails, the job
// throws: there is never a hard-coded fallback topic, and a proposed
// topic is never published just because it was the only one available.
// An explicit TEST_FLIGHT_TOPIC still wins over all of this and skips
// both the history fetch and the LLM topic step.
//---------------

import { streamLlmJson } from './llm-stream.mjs';

export class TopicError extends Error {}

export const HISTORY_WINDOW_DAYS = 30;
export const DUPLICATE_JACCARD_THRESHOLD = 0.7;
const HISTORY_TIMEOUT_MS = 30000;
const DEFAULT_API_BASE_URL = 'https://post-engineer.com';

// Stopwords removed before the overlap check so that "the best X in
// Porto" and "best X in Porto" count as the same topic, not as two.
const STOPWORDS = new Set([
  'a', 'an', 'the', 'in', 'on', 'of', 'to', 'and', 'or', 'for', 'with',
  'from', 'by', 'at', 'into', 'is', 'are', 'you', 'your', 'this', 'that',
]);

// Portugal place/culture signals. This is a validation safety net, not
// a topic list: any topic naming a place in Portugal passes the place
// half, whatever the place is. The LLM prompt carries the niche; this
// list only catches the obvious misses (a topic about another country,
// or about nothing placeable at all).
const PORTUGAL_SIGNALS = [
  'portugal', 'portuguese', 'porto', 'lisbon', 'lisboa', 'algarve',
  'douro', 'madeira', 'azores', 'acores', 'coimbra', 'braga', 'sintra',
  'evora', 'aveiro', 'faro', 'guimaraes', 'viseu', 'setubal', 'leiria',
  'viana', 'chaves', 'tavira', 'lagos', 'obidos', 'nazare', 'peniche',
  'gaia', 'ribeira', 'minho', 'alentejo', 'tras-os-montes', 'beira',
];

const FOOD_SIGNALS = [
  'food', 'eat', 'eating', 'restaurant', 'restaurants', 'dish', 'dishes',
  'taste', 'tasting', 'dinner', 'lunch', 'breakfast', 'cafe', 'market',
  'markets', 'wine', 'seafood', 'fish', 'francesinha', 'bacalhau',
  'pastel', 'custard', 'pastry', 'cheese', 'bread', 'soup', 'grill',
  'petiscos', 'tapas', 'brunch', 'dessert', 'coffee',
];

const TRAVEL_SIGNALS = [
  'travel', 'trip', 'visit', 'visiting', 'guide', 'walk', 'walking',
  'route', 'viewpoint', 'viewpoints', 'beach', 'beaches', 'river',
  'old town', 'street', 'streets', 'neighbourhood', 'neighborhood',
  'day trip', 'itinerary', 'hike', 'hiking', 'island', 'village',
  'town', 'city', 'coast', 'sunset', 'hidden', 'walkable',
];

export function normalizeTopic(text) {
  return String(text ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function topicTokens(text) {
  const words = normalizeTopic(text).split(' ').filter(Boolean);
  // Keep multi-word signals ("old town", "day trip") as single tokens.
  const tokens = new Set(words.filter((word) => !STOPWORDS.has(word)));
  for (const phrase of ['old town', 'day trip']) {
    if (normalizeTopic(text).includes(phrase)) tokens.add(phrase.replace(' ', '_'));
  }
  return tokens;
}

export function jaccardSimilarity(a, b) {
  const setA = topicTokens(a);
  const setB = topicTokens(b);
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const token of setA) if (setB.has(token)) intersection += 1;
  return intersection / (setA.size + setB.size - intersection);
}

function hasSignal(text, signals) {
  const normalized = ` ${normalizeTopic(text)} `;
  return signals.some((signal) => normalized.includes(` ${signal} `) || normalized.includes(` ${signal.replace(' ', '_')} `));
}

function inNiche(topic) {
  const normalized = normalizeTopic(topic);
  const hasPortugal = PORTUGAL_SIGNALS.some((signal) => normalized.includes(signal));
  const hasFood = hasSignal(topic, FOOD_SIGNALS);
  const hasTravel = hasSignal(topic, TRAVEL_SIGNALS);
  return hasPortugal && (hasFood || hasTravel);
}

// Mechanical validation only. It cannot prove a topic is in-niche in
// the way a human could: it catches exact repeats, near-duplicates
// (Jaccard >= 0.7 on content-word tokens), and topics with no Portugal
// place signal or no food/travel signal. The LLM prompt carries the
// niche; this check is the backstop, not the judge.
export function validateTopic(topic, recentTitles = []) {
  if (typeof topic !== 'string' || topic.trim() === '') {
    return { ok: false, error: { field: 'topic', rule: 'topic must be a non-empty string', fix: 'Propose one specific topic.' } };
  }
  const trimmed = topic.trim();
  const normalized = normalizeTopic(trimmed);
  for (const recent of recentTitles) {
    if (typeof recent !== 'string' || recent === '') continue;
    if (normalizeTopic(recent) === normalized) {
      return { ok: false, error: { field: 'topic', rule: 'topic repeats a title from the last 30 days', fix: 'Propose a different topic, not a rewording of a recent one.' } };
    }
    if (jaccardSimilarity(trimmed, recent) >= DUPLICATE_JACCARD_THRESHOLD) {
      return { ok: false, error: { field: 'topic', rule: 'topic is a near-duplicate of a title from the last 30 days', fix: 'Propose a topic about a different place, dish, or route.' } };
    }
  }
  if (!inNiche(trimmed)) {
    return { ok: false, error: { field: 'topic', rule: 'topic must be about food or travel in a place in Portugal', fix: 'Propose a food or travel topic about a place in Portugal, in English.' } };
  }
  return { ok: true, value: trimmed };
}

export function buildTopicPrompt({ recentTitles = [] }) {
  const lines = [
    'You propose the topic for a short travel video in English.',
    'Niche, mandatory: food or travel in a place in Portugal. The topic must name a place in Portugal and be about food or travel there. Never propose a topic about another country, and never propose a generic topic with no place in Portugal.',
    'Propose ONE new topic. It must be different from every title below: not the same topic, not a rewording of one, not the same place with a swapped adjective.',
  ];
  if (recentTitles.length === 0) {
    lines.push('Recent titles from the last 30 days: none. There is no recent history to avoid, so propose any topic inside the niche above.');
  } else {
    lines.push('Recent titles from the last 30 days, all of which are off-limits:');
    for (const title of recentTitles) lines.push(`- ${title}`);
  }
  lines.push(
    '',
    'Respond with JSON only, exactly this shape, no other text:',
    '{"topic": "<one specific topic>", "whyDifferent": "<one sentence saying why it differs from the recent titles>"}',
  );
  return lines.join('\n');
}

// Real history from GET /api/schedule/status: recent slots carry title,
// slot_at, published_at and status; upcoming slots carry title and
// slot_at. Only published titles inside the 30-day window count as
// "already went out"; upcoming titles count too, because they are
// queued to publish and picking the same topic would collide with
// them. Failed slots never published, so they do not block a topic.
// Any fetch or shape failure throws: the caller must fail the job
// rather than propose a topic blind.
export async function fetchRecentTitles({ apiBaseUrl, apiKey, fetchFn = fetch, now = new Date() }) {
  if (!apiKey) {
    throw new TopicError('topic history: missing TEST_FLIGHT_POST_ENGINEER_API_KEY — refusing to propose a topic blind');
  }
  const base = (apiBaseUrl ?? '').trim() || DEFAULT_API_BASE_URL;
  let res;
  try {
    res = await fetchFn(`${base.replace(/\/+$/, '')}/api/schedule/status?limit=500`, {
      headers: { authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(HISTORY_TIMEOUT_MS),
    });
  } catch (error) {
    throw new TopicError(`topic history: GET /api/schedule/status failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new TopicError(`topic history: GET /api/schedule/status returned HTTP ${res.status}${body ? `: ${body.slice(0, 200)}` : ''}`);
  }
  const data = await res.json().catch(() => null);
  if (data === null || data.success !== true || !Array.isArray(data.recent) || !Array.isArray(data.upcoming)) {
    throw new TopicError('topic history: GET /api/schedule/status returned an unexpected shape (expected { success: true, recent: [], upcoming: [] })');
  }
  const windowStart = now.getTime() - HISTORY_WINDOW_DAYS * 24 * 3600 * 1000;
  const titles = [];
  const push = (title) => {
    if (typeof title === 'string' && title.trim() !== '' && !titles.includes(title.trim())) titles.push(title.trim());
  };
  for (const slot of data.recent) {
    if (slot?.status !== 'published') continue;
    const when = Date.parse(slot.published_at ?? slot.slot_at ?? '');
    if (Number.isNaN(when) || when < windowStart || when > now.getTime()) continue;
    push(slot.title);
  }
  for (const slot of data.upcoming) push(slot.title);
  return titles;
}

export function resolveHistoryConfig(env) {
  return {
    apiBaseUrl: (env?.TEST_FLIGHT_API_BASE_URL ?? '').trim() || DEFAULT_API_BASE_URL,
    apiKey: (env?.TEST_FLIGHT_POST_ENGINEER_API_KEY ?? '').trim(),
  };
}

// One topic proposal per model, with one validation retry per model
// (the named failure fed back), then the next model. If every model
// fails, throw: the job fails instead of publishing a repeat or a
// hand-written topic.
export async function generateTopic({ llm, recentTitles = [], fetchFn = fetch, streamTimeouts = {} }) {
  if (!llm || !llm.apiKey) {
    throw new TopicError('topic: missing TEST_FLIGHT_LLM_API_KEY — refusing to propose a topic without the LLM');
  }
  const models = Array.isArray(llm.models) && llm.models.length > 0
    ? llm.models
    : (llm.model ? [llm.model] : []);
  if (models.length === 0) {
    throw new TopicError('topic: no LLM models configured — refusing to propose a topic without the LLM');
  }
  const failures = [];
  for (const model of models) {
    let lastError = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const prompt = buildTopicPrompt({ recentTitles });
        const userContent = lastError
          ? `${prompt}\n\nPrevious proposal failed validation: ${lastError.rule} Fix: ${lastError.fix} Return JSON only, with the fix applied.`
          : prompt;
        const { parsed, model: responseModel } = await streamLlmJson({
          baseUrl: llm.baseUrl,
          apiKey: llm.apiKey,
          model,
          messages: [
            { role: 'system', content: 'You propose video topics. Respond with JSON only.' },
            { role: 'user', content: userContent },
          ],
          fetchFn,
          streamTimeouts,
        });
        const topic = typeof parsed?.topic === 'string' ? parsed.topic.trim() : '';
        const checked = validateTopic(topic, recentTitles);
        if (!checked.ok) {
          lastError = checked.error;
          continue;
        }
        return { topic: checked.value, model: responseModel, recentTitles: [...recentTitles] };
      } catch (error) {
        failures.push(`${model}: ${error instanceof Error ? error.message : String(error)}`);
        break;
      }
    }
    if (lastError) failures.push(`${model}: validation failed twice (${lastError.rule})`);
    console.log(`topic-llm: LLM model ${model} failed, trying next model in the chain`);
  }
  throw new TopicError(`topic: all LLM models failed (${failures.join('; ')}) — failing the job instead of publishing a repeat script`);
}
