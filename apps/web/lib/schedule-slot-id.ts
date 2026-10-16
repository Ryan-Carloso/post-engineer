//---------------
// resolveSlotUuid — normalize the :slotId route param into a real
// scheduled_posts row id.
//
// The slot routes take a uuid, but callers sometimes hand over the
// engine-side generation key `batch:<scheduleId>:slot:<slotId>` instead
// (the MCP agent passes task ids back as slot ids). Feeding either form
// raw into the uuid-typed PostgREST filter raises Postgres 22P02
// ("invalid input syntax for type uuid") and turns into a 500. Resolve
// the real slot uuid up front; anything else 404s without touching the
// database, so a non-uuid value can never reach a uuid-typed column.
//
// The key can arrive percent-encoded: the web UI builds the request path
// with encodeURIComponent, and production showed the value reaching the
// handler still-encoded (`batch%3A…%3Aslot%3A…`, double-encoded upstream).
// Decode until stable before matching so every encoding layer resolves to
// the same slot; a decode failure falls back to the raw value.
//---------------

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Group 1 is the schedule id (unused here); group 2 is the slot row id.
const BATCH_SLOT_PATTERN =
  /^batch:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):slot:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

// Max decode rounds: one per plausible encoding layer, then stop so a
// pathological input cannot loop.
const MAX_DECODE_ROUNDS = 3;

function decodeSlotId(rawSlotId: string): string {
  let decoded = rawSlotId;
  for (let i = 0; i < MAX_DECODE_ROUNDS; i++) {
    let next: string;
    try {
      next = decodeURIComponent(decoded);
    } catch {
      // Stray '%' — not decodable; match against the raw value instead.
      return rawSlotId;
    }
    if (next === decoded) {
      return decoded;
    }
    decoded = next;
  }
  return decoded;
}

export function resolveSlotUuid(rawSlotId: string): string | null {
  const slotId = decodeSlotId(rawSlotId);
  if (UUID_PATTERN.test(slotId)) {
    return slotId;
  }
  const batchMatch = BATCH_SLOT_PATTERN.exec(slotId);
  if (batchMatch) {
    return batchMatch[2];
  }
  return null;
}
