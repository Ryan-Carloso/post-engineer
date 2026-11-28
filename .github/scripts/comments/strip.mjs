const isBlank = (s) => /^[ \t\r]*$/.test(s);
const isWord = (c) => c !== undefined && /[\w$]/.test(c);

function removalSpans(comments) {
  const spans = new Map();
  for (const c of comments) {
    const [start, end] = c.jsxWrapper ?? [c.start, c.end];
    spans.set(start, { start, end });
  }
  return [...spans.values()].sort((a, b) => a.start - b.start);
}

function groupSpans(text, spans) {
  const groups = [];
  for (const span of spans) {
    const last = groups[groups.length - 1];
    if (last !== undefined && span.start <= last.end) {
      last.end = Math.max(last.end, span.end);
    } else if (last !== undefined && /^\s*$/.test(text.slice(last.end, span.start))) {
      last.end = span.end;
    } else {
      groups.push({ ...span });
    }
  }
  return groups;
}

function lineBounds(text, pos) {
  const start = text.lastIndexOf('\n', pos - 1) + 1;
  const nl = text.indexOf('\n', pos);
  return { start, end: nl === -1 ? text.length : nl };
}

function removeWholeLines(text, start, end) {
  const nl = text.indexOf('\n', end);
  const cutEnd = nl === -1 ? text.length : nl + 1;
  let out = text.slice(0, start) + text.slice(cutEnd);
  const next = lineBounds(out, start);
  const nextLine = out.slice(next.start, next.end);
  const nextBlank = start < out.length && isBlank(nextLine);
  const prevBlank = start > 0 && isBlank(out.slice(lineBounds(out, start - 1).start, start - 1));
  if (nextBlank && (start === 0 || prevBlank)) {
    out = out.slice(0, start) + out.slice(Math.min(out.length, next.end + 1));
  } else if (prevBlank && (start >= out.length || /^\s*[}\])]/.test(nextLine))) {
    const prev = lineBounds(out, start - 1);
    out = out.slice(0, prev.start) + out.slice(start);
  }
  return out;
}

export function stripComments(text, comments) {
  const groups = groupSpans(text, removalSpans(comments)).reverse();
  let out = text;
  for (const { start, end } of groups) {
    const first = lineBounds(out, start);
    const last = lineBounds(out, end);
    const before = out.slice(first.start, start);
    const after = out.slice(end, last.end);
    if (isBlank(before) && isBlank(after)) {
      out = removeWholeLines(out, first.start, end);
    } else if (isBlank(after)) {
      let s = start;
      while (s > first.start && (out[s - 1] === ' ' || out[s - 1] === '\t')) s--;
      out = out.slice(0, s) + out.slice(end);
    } else {
      const body = out.slice(start, end);
      let e = end;
      let replacement = '';
      if (body.includes('\n')) replacement = '\n';
      else if (/[ \t]$/.test(before) && /^[ \t]/.test(after)) e++;
      else if (isWord(out[start - 1]) && isWord(out[end])) replacement = ' ';
      out = out.slice(0, start) + replacement + out.slice(e);
    }
  }
  return out;
}
