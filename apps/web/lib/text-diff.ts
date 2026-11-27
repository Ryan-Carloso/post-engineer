export type DiffKind = 'same' | 'added' | 'removed';

export interface DiffSegment {
  kind: DiffKind;
  text: string;
}

export interface TextDiff {
  segments: DiffSegment[];
  addedWords: number;
  removedWords: number;
  granularity: 'word' | 'line' | 'block';
}

const MAX_DIFF_CELLS = 4_000_000;

const WORD_TOKENS = /\s+|[^\s]+/g;
const LINE_TOKENS = /[^\n]*\n|[^\n]+/g;
const WORD = /\S+/g;

function tokens(text: string, pattern: RegExp): string[] {
  return text.match(pattern) ?? [];
}

function countWords(text: string): number {
  return (text.match(WORD) ?? []).length;
}

function push(segments: DiffSegment[], kind: DiffKind, text: string): void {
  if (text === '') return;
  const last = segments.at(-1);
  if (last !== undefined && last.kind === kind) {
    last.text += text;
    return;
  }
  segments.push({ kind, text });
}

function lcsSegments(before: readonly string[], after: readonly string[]): DiffSegment[] {
  const rows = before.length + 1;
  const columns = after.length + 1;
  const table = new Uint16Array(rows * columns);
  for (let i = before.length - 1; i >= 0; i -= 1) {
    for (let j = after.length - 1; j >= 0; j -= 1) {
      table[i * columns + j] =
        before[i] === after[j]
          ? table[(i + 1) * columns + j + 1] + 1
          : Math.max(table[(i + 1) * columns + j], table[i * columns + j + 1]);
    }
  }
  const segments: DiffSegment[] = [];
  let i = 0;
  let j = 0;
  while (i < before.length && j < after.length) {
    if (before[i] === after[j]) {
      push(segments, 'same', before[i]);
      i += 1;
      j += 1;
    } else if (table[(i + 1) * columns + j] >= table[i * columns + j + 1]) {
      push(segments, 'removed', before[i]);
      i += 1;
    } else {
      push(segments, 'added', after[j]);
      j += 1;
    }
  }
  for (; i < before.length; i += 1) push(segments, 'removed', before[i]);
  for (; j < after.length; j += 1) push(segments, 'added', after[j]);
  return segments;
}

function trimmedDiff(before: readonly string[], after: readonly string[], maxCells: number): DiffSegment[] | null {
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start += 1;
  let endBefore = before.length;
  let endAfter = after.length;
  while (endBefore > start && endAfter > start && before[endBefore - 1] === after[endAfter - 1]) {
    endBefore -= 1;
    endAfter -= 1;
  }
  const middleBefore = before.slice(start, endBefore);
  const middleAfter = after.slice(start, endAfter);
  if ((middleBefore.length + 1) * (middleAfter.length + 1) > maxCells) return null;
  const segments: DiffSegment[] = [];
  push(segments, 'same', before.slice(0, start).join(''));
  for (const segment of lcsSegments(middleBefore, middleAfter)) push(segments, segment.kind, segment.text);
  push(segments, 'same', before.slice(endBefore).join(''));
  return segments;
}

function blockDiff(before: string, after: string): DiffSegment[] {
  const segments: DiffSegment[] = [];
  push(segments, 'removed', before);
  push(segments, 'added', after);
  return segments;
}

export function diffText(before: string, after: string, maxCells: number = MAX_DIFF_CELLS): TextDiff {
  let granularity: TextDiff['granularity'] = 'word';
  let segments = trimmedDiff(tokens(before, WORD_TOKENS), tokens(after, WORD_TOKENS), maxCells);
  if (segments === null) {
    granularity = 'line';
    segments = trimmedDiff(tokens(before, LINE_TOKENS), tokens(after, LINE_TOKENS), maxCells);
  }
  if (segments === null) {
    granularity = 'block';
    segments = blockDiff(before, after);
  }
  let addedWords = 0;
  let removedWords = 0;
  for (const segment of segments) {
    if (segment.kind === 'added') addedWords += countWords(segment.text);
    if (segment.kind === 'removed') removedWords += countWords(segment.text);
  }
  return { segments, addedWords, removedWords, granularity };
}
