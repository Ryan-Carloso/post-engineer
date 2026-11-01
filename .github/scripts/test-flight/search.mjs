#!/usr/bin/env node
//---------------
// Web search grounding for the test-flight script writer.
//
// Tavily is the primary provider, Exa is the reserve — never both at
// once, and never as a cross-check: two providers returning the same
// snippet would not prove it true, it would only double the cost.
// Order: try Tavily when its key is set, otherwise Exa; if the primary
// fails (HTTP error, timeout, or zero usable results), try the reserve
// when its key is set. If both fail, or no key is set at all, throw:
// the job fails loudly instead of publishing an ungrounded script.
// Keys are never logged and never appear in the returned facts.
//---------------

export class SearchError extends Error {}

const SEARCH_TIMEOUT_MS = 30000;
const MAX_RESULTS = 5;
const MAX_SNIPPET_CHARS = 400;

function cleanSnippet(text) {
  return String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_SNIPPET_CHARS);
}

function usableResults(results) {
  return (Array.isArray(results) ? results : [])
    .filter((r) => r && typeof r.url === 'string' && r.url !== '' && cleanSnippet(r.snippet) !== '')
    .slice(0, MAX_RESULTS);
}

export async function searchTavily({ query, apiKey, fetchFn = fetch }) {
  const res = await fetchFn('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ query, search_depth: 'basic', max_results: MAX_RESULTS }),
    signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new SearchError(`Tavily search returned HTTP ${res.status}`);
  const data = await res.json().catch(() => null);
  const results = usableResults((data?.results ?? []).map((r) => ({ title: r.title ?? '', url: r.url, snippet: r.content ?? '' })));
  if (results.length === 0) throw new SearchError('Tavily search returned no usable results');
  return results;
}

export async function searchExa({ query, apiKey, fetchFn = fetch }) {
  const res = await fetchFn('https://api.exa.ai/search', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ query, numResults: MAX_RESULTS, contents: { highlights: true } }),
    signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new SearchError(`Exa search returned HTTP ${res.status}`);
  const data = await res.json().catch(() => null);
  const results = usableResults((data?.results ?? []).map((r) => ({
    title: r.title ?? '',
    url: r.url,
    snippet: Array.isArray(r.highlights) && r.highlights.length > 0 ? r.highlights.join(' ') : (r.text ?? ''),
  })));
  if (results.length === 0) throw new SearchError('Exa search returned no usable results');
  return results;
}

export function formatFacts(results) {
  return results.map((r) => `- ${r.title} (${r.url}): ${cleanSnippet(r.snippet)}`).join('\n');
}

export async function searchFacts({ topic, tavilyKey = '', exaKey = '', fetchFn = fetch }) {
  const attempts = [];
  if (tavilyKey) {
    try {
      const results = await searchTavily({ query: topic, apiKey: tavilyKey, fetchFn });
      return { provider: 'tavily', facts: formatFacts(results), sources: results.map((r) => r.url) };
    } catch (error) {
      attempts.push(error.message);
    }
  }
  if (exaKey) {
    try {
      const results = await searchExa({ query: topic, apiKey: exaKey, fetchFn });
      return { provider: 'exa', facts: formatFacts(results), sources: results.map((r) => r.url) };
    } catch (error) {
      attempts.push(error.message);
    }
  }
  if (attempts.length === 0) {
    throw new SearchError('search: no TEST_FLIGHT_TAVILY_API_KEY or TEST_FLIGHT_EXA_API_KEY set — failing the job instead of publishing an ungrounded script');
  }
  throw new SearchError(`search: all providers failed (${attempts.join('; ')}) — failing the job instead of publishing an ungrounded script`);
}
