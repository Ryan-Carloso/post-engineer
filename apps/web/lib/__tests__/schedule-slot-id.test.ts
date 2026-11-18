import { describe, it, expect } from 'vitest';
import { isUuid, resolveSlotUuid } from '../schedule-slot-id';

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
    expect(resolveSlotUuid(`batch:${SCHEDULE_ID}:slot:${SLOT_ID}`)).toBe(SLOT_ID);
  });

  it('decodes a percent-encoded batch key before extracting the slot uuid', () => {
    expect(resolveSlotUuid(`batch%3A${SCHEDULE_ID}%3Aslot%3A${SLOT_ID}`)).toBe(SLOT_ID);
    expect(resolveSlotUuid(`batch%253A${SCHEDULE_ID}%253Aslot%253A${SLOT_ID}`)).toBe(SLOT_ID);
  });

  it('never throws on a stray percent sign', () => {
    expect(resolveSlotUuid('100%')).toBeNull();
    expect(resolveSlotUuid(`batch%${SCHEDULE_ID}:slot:${SLOT_ID}`)).toBeNull();
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

  it('does not match a uuid with trailing junk', () => {
    expect(resolveSlotUuid(`${SLOT_ID}-extra`)).toBeNull();
    expect(resolveSlotUuid(`${SLOT_ID}x`)).toBeNull();
  });
});

describe('isUuid', () => {
  it('accepts a plain uuid, either case', () => {
    expect(isUuid(SLOT_ID)).toBe(true);
    expect(isUuid(SLOT_ID.toUpperCase())).toBe(true);
  });

  it('rejects a truncated uuid prefix', () => {
    expect(isUuid('ca192c1b')).toBe(false);
  });

  it('rejects batch keys and garbage', () => {
    expect(isUuid(`batch:${SCHEDULE_ID}:slot:${SLOT_ID}`)).toBe(false);
    expect(isUuid('not-a-uuid')).toBe(false);
    expect(isUuid('')).toBe(false);
  });
});
