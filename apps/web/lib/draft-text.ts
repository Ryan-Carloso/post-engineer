//---------------
// draft-text — text primitives shared by the draft scorer and the
// publish gate. Extracted from lib/draft-scoring.ts (file-size ratchet):
// both surfaces import them from here, so a character, hashtag or link
// counts exactly the same in the score and in the gate.
//---------------

export function countChars(text: string): number {
  // Code points, not UTF-16 units: an emoji counts as one character,
  // matching how the LinkedIn editor counts it closely enough for a
  // pre-publish gate (the platform is the final arbiter).
  return Array.from(text).length;
}

// A # glued to a preceding word or path is a URL fragment or "C#", never a
// hashtag ("example.com/guide#setup" must not count).
export function extractHashtags(text: string): string[] {
  return text.match(/(?<![\p{L}\p{N}_/])#[\p{L}\p{N}_]+/gu) ?? [];
}

// Any scheme casing, www., or a bare domain on a known TLD. The TLD list is
// closed so "Node.js" or "e.g." never count, and the lookbehind skips email
// addresses.
export function extractLinks(text: string): string[] {
  return text.match(
    /(?<![@\p{L}\p{N}.-])(?:https?:\/\/[^\s]+|www\.[^\s]+|(?:[a-z0-9-]+\.)+(?:com|org|net|io|co|ai|dev|app|br|pt)(?![\p{L}\p{N}-])(?:\/[^\s]*)?)/giu,
  ) ?? [];
}
