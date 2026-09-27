//---------------
// sanitizeClientName — hardens a third-party OAuth client name before it is
// shown on the consent screen. React interpolation already escapes HTML, so
// this is about visual phishing: bidi overrides, zero-width and control
// characters, and absurd lengths can make one application look like another.
// Implemented with code-point checks (no regex escapes) so the unsafe
// ranges stay explicit and reviewable.
//---------------

const MAX_VISIBLE_LENGTH = 80;

// C0/C1 control characters, zero-width and format characters, and the
// bidirectional isolate/override ranges plus the byte-order mark — none of
// these may appear in a display name.
function isUnsafeChar(code: number): boolean {
  return (
    code <= 0x1f ||
    (code >= 0x7f && code <= 0x9f) ||
    (code >= 0x200b && code <= 0x200f) ||
    (code >= 0x202a && code <= 0x202e) ||
    (code >= 0x2066 && code <= 0x2069) ||
    code === 0xfeff
  );
}

function isWhitespace(code: number): boolean {
  return (
    code === 0x20 ||
    code === 0x09 ||
    code === 0x0a ||
    code === 0x0b ||
    code === 0x0c ||
    code === 0x0d
  );
}

export function sanitizeClientName(value: string | null | undefined, fallback = 'this application'): string {
  if (value == null) return fallback;
  // Iterating with for..of walks whole code points, not UTF-16 halves.
  let out = '';
  let pendingSpace = false;
  for (const ch of value.normalize('NFC')) {
    const code = ch.codePointAt(0);
    if (code === undefined || isUnsafeChar(code)) continue;
    if (isWhitespace(code)) {
      pendingSpace = true;
      continue;
    }
    if (pendingSpace && out.length > 0) out += ' ';
    pendingSpace = false;
    out += ch;
  }
  if (!out) return fallback;
  const codePoints = Array.from(out);
  if (codePoints.length > MAX_VISIBLE_LENGTH) {
    return `${codePoints.slice(0, MAX_VISIBLE_LENGTH - 1).join('')}…`;
  }
  return out;
}
