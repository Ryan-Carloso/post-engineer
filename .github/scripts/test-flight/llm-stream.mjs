// Streaming reader for an OpenAI-compatible chat completions SSE stream.
// A thinking model sends nothing until it finishes thinking, so a single
// total timeout cannot tell thinking from dead: it kills a live model
// mid-thought. This reader therefore aborts only on silence (no chunk
// for silenceMs) and keeps a total cap so a job can never hang forever.
// Reasoning is accumulated as a LENGTH only: it is internal thinking,
// never logged as text and never used as the script.

export class StreamError extends Error {}

// One OpenAI-compatible chat completions call over SSE, shared by the
// script writer and the topic proposer so there is exactly one LLM
// client. The caller supplies the messages; this function sends
// stream:true, accumulates delta.content, counts reasoning length only,
// and returns the parsed JSON. Reasoning text is never logged, never
// parsed, and never returned. A non-2xx response, an empty completion,
// or non-JSON content throws, so the caller can move to the next model
// in the chain instead of publishing anything the LLM did not write.
export async function streamLlmJson({
  baseUrl,
  apiKey,
  model,
  messages,
  fetchFn = fetch,
  streamTimeouts = {},
}) {
  const silenceMs = streamTimeouts.silenceMs ?? 60000;
  const totalMs = streamTimeouts.totalMs ?? 300000;
  const startedAt = Date.now();
  const controller = new AbortController();
  const fetchTimer = setTimeout(() => controller.abort(), totalMs);
  let res;
  try {
    res = await fetchFn(`${String(baseUrl).replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, temperature: 0.7, stream: true, messages }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(fetchTimer);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new StreamError(`write-script: LLM endpoint returned HTTP ${res.status}${body ? `: ${body.slice(0, 200)}` : ''}`);
  }
  const remainingMs = totalMs - (Date.now() - startedAt);
  if (remainingMs <= 0) {
    throw new StreamError(`write-script: LLM stream total timeout (${totalMs}ms)`);
  }
  const streamed = await accumulateLlmStream(res.body, { silenceMs, totalMs: remainingMs, startedAt });
  const content = streamed.content;
  const reasoningChars = streamed.reasoningChars;
  const responseModel = streamed.model !== '' ? streamed.model : model;
  console.log(`write-script: LLM response model=${responseModel} reasoning=${reasoningChars === 0 ? 'none' : `${reasoningChars} chars`} content=${content.length} chars timeout=streaming-silence-${silenceMs}ms-total-${totalMs}ms`);
  if (content.trim() === '') {
    throw new StreamError(`write-script: LLM returned an empty completion (${reasoningChars > 0 ? `reasoning present, ${reasoningChars} chars` : 'no reasoning'})`);
  }
  let parsed;
  try {
    parsed = JSON.parse(content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim());
  } catch {
    throw new StreamError(`write-script: LLM returned non-JSON: ${content.slice(0, 120)}`);
  }
  return { parsed, model: responseModel, reasoningChars };
}

function reasoningLength(delta) {
  const values = [
    delta?.reasoning,
    delta?.reasoning_content,
    ...(Array.isArray(delta?.reasoning_details)
      ? delta.reasoning_details.map((detail) => detail?.text)
      : []),
  ];
  return values.reduce((total, value) => total + (typeof value === 'string' ? value.length : 0), 0);
}

async function readWithTimeout(reader, timeoutMs, isTotal) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new StreamError(
      isTotal
        ? `write-script: LLM stream total timeout (${timeoutMs}ms)`
        : `write-script: LLM stream silence timeout (no chunk for ${timeoutMs}ms)`,
    )), timeoutMs);
  });
  try {
    return await Promise.race([reader.read(), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export async function accumulateLlmStream(body, { silenceMs, totalMs, startedAt = Date.now() } = {}) {
  if (!body || typeof body.getReader !== 'function') {
    throw new StreamError('write-script: LLM stream has no readable body');
  }
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';
  let reasoningChars = 0;
  let responseModel = '';
  let sawData = false;
  try {
    for (;;) {
      const elapsed = Date.now() - startedAt;
      const remaining = totalMs - elapsed;
      if (remaining <= 0) {
        throw new StreamError(`write-script: LLM stream total timeout (${totalMs}ms)`);
      }
      const timeoutMs = Math.min(silenceMs, remaining);
      const isTotal = timeoutMs === remaining;
      let result;
      try {
        result = await readWithTimeout(reader, timeoutMs, isTotal);
      } catch (error) {
        await reader.cancel().catch(() => {});
        throw error;
      }
      if (result.done) break;
      buffer += decoder.decode(result.value, { stream: true });
      let newline = buffer.indexOf('\n');
      while (newline !== -1) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line.startsWith('data:')) {
          const payload = line.slice('data:'.length).trim();
          if (payload === '[DONE]') {
            newline = buffer.indexOf('\n');
            continue;
          }
          let chunk;
          try {
            chunk = JSON.parse(payload);
          } catch {
            await reader.cancel().catch(() => {});
            throw new StreamError('write-script: LLM stream returned an unparseable chunk');
          }
          sawData = true;
          if (typeof chunk?.model === 'string' && chunk.model !== '') responseModel = chunk.model;
          const delta = chunk?.choices?.[0]?.delta;
          if (typeof delta?.content === 'string') content += delta.content;
          reasoningChars += reasoningLength(delta);
        }
        newline = buffer.indexOf('\n');
      }
    }
    buffer += decoder.decode();
    if (buffer.trim().startsWith('data:')) {
      const payload = buffer.trim().slice('data:'.length).trim();
      if (payload !== '[DONE]') {
        let chunk;
        try {
          chunk = JSON.parse(payload);
        } catch {
          throw new StreamError('write-script: LLM stream returned an unparseable chunk');
        }
        sawData = true;
        if (typeof chunk?.model === 'string' && chunk.model !== '') responseModel = chunk.model;
        const delta = chunk?.choices?.[0]?.delta;
        if (typeof delta?.content === 'string') content += delta.content;
        reasoningChars += reasoningLength(delta);
      }
    }
  } finally {
    reader.releaseLock();
  }
  if (!sawData) {
    throw new StreamError('write-script: LLM stream ended without SSE data');
  }
  return { model: responseModel, content, reasoningChars };
}
