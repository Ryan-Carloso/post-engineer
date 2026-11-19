const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const BATCH_SLOT_PATTERN =
  /^batch:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):slot:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

const MAX_DECODE_ROUNDS = 3;

function decodeSlotId(rawSlotId: string): string {
  let decoded = rawSlotId;
  for (let i = 0; i < MAX_DECODE_ROUNDS; i++) {
    let next: string;
    try {
      next = decodeURIComponent(decoded);
    } catch {
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

export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}
