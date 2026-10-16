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
//---------------

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Group 1 is the schedule id (unused here); group 2 is the slot row id.
const BATCH_SLOT_PATTERN =
  /^batch:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):slot:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

export function resolveSlotUuid(rawSlotId: string): string | null {
  if (UUID_PATTERN.test(rawSlotId)) {
    return rawSlotId;
  }
  const batchMatch = BATCH_SLOT_PATTERN.exec(rawSlotId);
  if (batchMatch) {
    return batchMatch[2];
  }
  return null;
}
