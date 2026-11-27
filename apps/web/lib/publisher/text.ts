export function truncateChars(text: string, max: number): string {
  const chars = Array.from(text);
  return chars.length <= max ? text : chars.slice(0, max).join('');
}

const TAG_LIMIT = 8;
const TAG_TOTAL_CHARS = 400;
const TAG_MIN_LENGTH = 3;
const TOKEN_CHAR = /[\p{L}\p{M}\p{N}]/u;
const DIGITS_ONLY = /^\p{Nd}+$/u;

function tokenize(text: string): string[] {
  const tokens: string[] = [];
  let current = '';
  for (const char of text) {
    if (TOKEN_CHAR.test(char)) {
      current += char;
    } else if (current !== '') {
      tokens.push(current);
      current = '';
    }
  }
  if (current !== '') tokens.push(current);
  return tokens;
}

function deriveTags(title: string, minLength: number, dropDigits: boolean): string[] {
  const seen = new Set<string>();
  const tags: string[] = [];
  let total = 0;
  for (const token of tokenize(title.toLowerCase())) {
    const length = Array.from(token).length;
    if (length < minLength) continue;
    if (dropDigits && DIGITS_ONLY.test(token)) continue;
    if (seen.has(token)) continue;
    if (tags.length >= TAG_LIMIT) break;
    if (total + length > TAG_TOTAL_CHARS) break;
    seen.add(token);
    tags.push(token);
    total += length;
  }
  return tags;
}

export function deriveTagsFromTitle(title: string): string[] {
  const tags = deriveTags(title, TAG_MIN_LENGTH, true);
  return tags.length > 0 ? tags : deriveTags(title, 1, false);
}
