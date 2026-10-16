import { describe, it, expect } from 'vitest';
import { resolveSlotUuid } from '../schedule-slot-id';

const SLOT_ID = '872827cb-6345-45b8-8153-60924092a648';
const SCHEDULE_ID = 'aad196b2-380d-560d-a506-d6ee93c980ae';

describe('resolveSlotUuid', () => {
  it('passes a plain slot uuid through untouched', () => {
    expect(resolveSlotUuid(SLOT_ID)).toBe(SLOT_ID);
  });

  it('accepts uppercase uuids', () => {
    const upper = SLOT_ID.toUpperCase();
    expect(resolveSlotUuid(upper)).toBe(upper);
  });

  it('extracts the slot uuid from the engine batch generation key', () => {
    // Callers (MCP agents, UI) sometimes hand over the engine-side
    // generation key instead of the slot row id.
    expect(resolveSlotUuid(`batch:${SCHEDULE_ID}:slot:${SLOT_ID}`)).toBe(SLOT_ID);
  });

  it('returns null for garbage that is not a uuid', () => {
    expect(resolveSlotUuid('not-a-uuid')).toBeNull();
    expect(resolveSlotUuid('')).toBeNull();
    expect(resolveSlotUuid('slot-1')).toBeNull();
  });

  it('returns null for a malformed batch key', () => {
    expect(resolveSlotUuid(`batch:${SCHEDULE_ID}:slot:nope`)).toBeNull();
    expect(resolveSlotUuid(`batch:nope:slot:${SLOT_ID}`)).toBeNull();
    expect(resolveSlotUuid(`batch:${SLOT_ID}`)).toBeNull();
    expect(resolveSlotUuid(`slot:${SLOT_ID}`)).toBeNull();
  });

  it('does not match when the pattern is embedded in a longer string', () => {
    expect(resolveSlotUuid(`x-batch:${SCHEDULE_ID}:slot:${SLOT_ID}`)).toBeNull();
    expect(resolveSlotUuid(`batch:${SCHEDULE_ID}:slot:${SLOT_ID}-extra`)).toBeNull();
  });
});
