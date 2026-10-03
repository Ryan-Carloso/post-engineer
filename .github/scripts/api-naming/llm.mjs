/**
 * LLM review layer: second pass over new names that clear the denylist.
 *
 * Sends each name plus its code context to an OpenAI-compatible
 * chat-completions endpoint. The model judges whether the name is
 * self-explanatory to an API consumer with no access to code or comments.
 *
 * Never blocks on infrastructure: missing API key, HTTP errors, timeouts
 * and malformed model output all degrade to warnings, never findings.
 * The deterministic denylist layer always runs regardless.
 */

/**
 * @param {{ file: string, line: number, name: string, context: string }} c
 * @returns {string}
 */
function buildPrompt(c) {
  return [
    'You are an API naming reviewer for a JSON API consumed by AI agents.',
    `A developer added a new externally-exposed field/parameter named "${c.name}" in ${c.file}.`,
    '',
    'Code context (unified diff hunk around the addition):',
    '```',
    c.context.slice(0, 2000),
    '```',
    '',
    'Judge ONLY whether the name communicates its meaning clearly to an API',
    'consumer who sees just the JSON, with no access to code or comments.',
    '- A good name is self-explanatory: what it holds and its shape/unit are inferable',
    '  (e.g. retryCount, publishedAt, isActive, taskId).',
    '- Flag names that are ambiguous about WHAT they hold (data, info, result),',
    '  ambiguous about TYPE/UNIT (retry could be a boolean, a count, or an object),',
    '  or verbs/adjectives masquerading as data without a clear subject.',
    '- Do NOT flag names that are clear in this context, even if short (id, url, status).',
    '- Do not demand a specific rename; suggest 1-3 alternatives only for warn/fail.',
    '',
    'Respond with JSON only, exactly this shape:',
    '{"verdict": "pass" | "warn" | "fail", "reason": "<one or two sentences>", "alternatives": ["<name>", ...]}',
  ].join('\n');
}

/**
 * @param {unknown} parsed
 * @returns {{ verdict: 'pass' | 'warn' | 'fail', reason: string, alternatives: string[] } | null}
 */
function normalizeVerdict(parsed) {
  if (typeof parsed !== 'object' || parsed === null) return null;
  const p = /** @type {Record<string, unknown>} */ (parsed);
  if (p.verdict !== 'pass' && p.verdict !== 'warn' && p.verdict !== 'fail') return null;
  if (typeof p.reason !== 'string' || p.reason.trim() === '') return null;
  const alternatives = Array.isArray(p.alternatives)
    ? p.alternatives.filter((a) => typeof a === 'string')
    : [];
  return { verdict: p.verdict, reason: p.reason, alternatives };
}

function stripFences(text) {
  return text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
}

/**
 * @param {{ file: string, line: number, name: string, context: string, renamedFrom: string | null }} c
 * @param {{ llm: { baseUrl: string, model: string, timeoutMs: number } }} config
 * @param {typeof fetch} fetchImpl
 * @param {string} apiKey
 */
async function reviewOne(c, config, fetchImpl, apiKey) {
  const url = `${config.llm.baseUrl.replace(/\/+$/, '')}/chat/completions`;
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: config.llm.model,
      temperature: 0,
      messages: [
        { role: 'system', content: 'You review API field names. Respond with JSON only.' },
        { role: 'user', content: buildPrompt(c) },
      ],
    }),
    signal: AbortSignal.timeout(config.llm.timeoutMs),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`LLM endpoint returned HTTP ${res.status}${body ? `: ${body.slice(0, 200)}` : ''}`);
  }
  const data = await res.json().catch(() => null);
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || content.trim() === '') {
    throw new Error('LLM returned an empty completion');
  }
  let parsed;
  try {
    parsed = JSON.parse(stripFences(content));
  } catch {
    throw new Error(`LLM returned non-JSON: ${content.slice(0, 120)}`);
  }
  const verdict = normalizeVerdict(parsed);
  if (!verdict) throw new Error('LLM returned JSON in an unexpected shape');
  return verdict;
}

/**
 * @param {Array<{ file: string, line: number, name: string, context: string, renamedFrom: string | null }>} candidates
 * @param {{ llm: { enabled: boolean, baseUrl: string, model: string, maxNames: number, timeoutMs: number } }} config
 * @param {{ fetchImpl?: typeof fetch, apiKey?: string }} [options] fetch injected via options (test seam)
 * @returns {Promise<{ findings: Array<{ file: string, line: number, name: string, severity: 'error' | 'warn', reason: string, alternatives: string[], source: 'llm', renamedFrom: string | null }>, skipped: number, warnings: string[] }>}
 */
export async function reviewNames(candidates, config, options = {}) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const apiKey = options.apiKey ?? process.env.API_NAMING_LLM_API_KEY ?? '';

  if (!config.llm.enabled) {
    return { findings: [], skipped: candidates.length, warnings: ['LLM layer disabled in api-naming.yml.'] };
  }
  if (!apiKey) {
    return {
      findings: [],
      skipped: candidates.length,
      warnings: [
        'API_NAMING_LLM_API_KEY is not set — LLM naming review skipped. Deterministic denylist layer still ran.',
      ],
    };
  }

  const max = Math.max(1, config.llm.maxNames);
  const todo = candidates.slice(0, max);
  const skipped = candidates.length - todo.length;
  /** @type {string[]} */
  const warnings = skipped > 0 ? [`LLM cap reached (maxNames=${max}): ${skipped} name(s) skipped without review.`] : [];
  const findings = [];
  for (const c of todo) {
    try {
      const verdict = await reviewOne(c, config, fetchImpl, apiKey);
      if (verdict.verdict === 'fail' || verdict.verdict === 'warn') {
        findings.push({
          file: c.file,
          line: c.line,
          name: c.name,
          severity: verdict.verdict === 'fail' ? 'error' : 'warn',
          reason: verdict.reason,
          alternatives: verdict.alternatives,
          source: 'llm',
          renamedFrom: c.renamedFrom,
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      warnings.push(`LLM review of "${c.name}" (${c.file}:${c.line}) failed (${msg}) — skipped, not failed.`);
    }
  }
  return { findings, skipped, warnings };
}
