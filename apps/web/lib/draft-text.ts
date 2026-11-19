export function countChars(text: string): number {
  return Array.from(text).length;
}

export function extractHashtags(text: string): string[] {
  return text.match(/(?<![\p{L}\p{N}_/])#[\p{L}\p{N}_]+/gu) ?? [];
}

export function extractLinks(text: string): string[] {
  return text.match(
    /(?<![@\p{L}\p{N}.-])(?:https?:\/\/[^\s]+|www\.[^\s]+|(?:[a-z0-9-]+\.)+(?:com|org|net|io|co|ai|dev|app|br|pt)(?![\p{L}\p{N}-])(?:\/[^\s]*)?)/giu,
  ) ?? [];
}
