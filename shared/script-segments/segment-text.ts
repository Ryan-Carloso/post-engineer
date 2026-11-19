export function hasForbiddenContent(text: string): boolean {
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
  return text.includes('[') || text.includes(']');
}

export function normalize(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}_\s]/gu, '').trim();
}
