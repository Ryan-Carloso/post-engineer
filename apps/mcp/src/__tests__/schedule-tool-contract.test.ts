import { describe, expect, it } from 'vitest';
import {
  parseCancelScheduleQuery,
  parseStatusLimit,
  parseStatusRange,
  UpdateSlotBodySchema,
} from '../contracts/schedule.js';
import { requireTitle } from '../require-title.js';
import {
  CancelScheduleSchema,
  DeleteSlotSchema,
  GetSlotSchema,
  ListPostsSchema,
  UpdateSlotTitleSchema,
} from '../tools.js';

//---------------
// Schedule tool schemas vs the shared contract — the MCP tools validate
// their arguments locally with the same rules the routes enforce
// (parseStatusLimit / parseStatusRange / parseCancelScheduleQuery /
// UpdateSlotBodySchema in the contract). A one-sided edit would make the
// MCP reject what the route accepts (or forward what it rejects), so the
// two must agree on every case.
//
// Deliberate differences:
// - Limit: the tool REJECTS an out-of-range limit (400 at the tool) while
//   the route parser is lenient — invalid falls back to 10, over-max
//   clamps to 500. The client never sends an invalid limit because the
//   tool schema stops it first.
// - Range ordering and span: the tool schema checks the ISO shape and the
//   from/to pairing but not from < to or the 62-day span; the route 400s
//   those. The tool also never sends ?limit= in range mode
//   (handleListPosts drops it), while the route rejects a literal
//   ?limit= combined with from/to.
// - Title: the tool schema accepts a blank title (min(1) only); the
//   blank is rejected by requireTitle in the client before any fetch,
//   and by the contract's trim refine. The tool schema alone is not the
//   whole check.
// - slotAt: the PATCH route accepts a slotAt reschedule, but the MCP
//   update_slot_title action only ever sends a title — the slotAt rule
//   is route-only.
// - slotId: the tool schemas reject an empty slotId; the contract has
//   no slotId rule (it is a path param, not a body field).
//---------------

describe('list posts limit: tool schema vs the shared contract', () => {
  it.each([
    { limit: 1, toolAccepts: true, contractValue: 1 },
    { limit: 20, toolAccepts: true, contractValue: 20 },
    { limit: 500, toolAccepts: true, contractValue: 500 },
    // Tool rejects; the route falls back to the default instead.
    { limit: 0, toolAccepts: false, contractValue: 10 },
    // Tool rejects; the route clamps to the max instead.
    { limit: 501, toolAccepts: false, contractValue: 500 },
    { limit: 1.5, toolAccepts: false, contractValue: 10 },
  ])('limit $limit: tool accepts $toolAccepts, contract parses to $contractValue', ({ limit, toolAccepts, contractValue }) => {
    expect(ListPostsSchema.safeParse({ limit }).success).toBe(toolAccepts);
    expect(parseStatusLimit(String(limit))).toBe(contractValue);
  });

  it('the route parser is lenient on non-numeric input the tool never sends', () => {
    expect(parseStatusLimit(null)).toBe(10);
    expect(parseStatusLimit('12abc')).toBe(10);
    expect(parseStatusLimit('999')).toBe(500);
  });
});

describe('list posts range: tool schema vs the shared contract', () => {
  const FROM = '2026-11-01T00:00:00-03:00';
  const TO = '2026-12-01T00:00:00-03:00';

  it.each([
    { from: FROM, to: TO, toolAccepts: true, contractKind: 'range' },
    { from: FROM, to: undefined, toolAccepts: false, contractKind: 'error' },
    { from: undefined, to: TO, toolAccepts: false, contractKind: 'error' },
    // Date without a time: neither side accepts it.
    { from: '2026-11-01', to: '2026-12-01', toolAccepts: false, contractKind: 'error' },
    // Offset without the colon: both regexes require ±hh:mm.
    { from: '2026-11-01T00:00:00+0300', to: TO, toolAccepts: false, contractKind: 'error' },
    // Six fractional digits: both regexes allow at most three.
    { from: '2026-11-01T00:00:00.123456Z', to: TO, toolAccepts: false, contractKind: 'error' },
    // Ordering and span are route-only checks: the tool accepts, the contract 400s.
    { from: FROM, to: FROM, toolAccepts: true, contractKind: 'error' },
    { from: TO, to: FROM, toolAccepts: true, contractKind: 'error' },
    { from: FROM, to: '2027-02-01T00:00:00-03:00', toolAccepts: true, contractKind: 'error' },
    // The 62-day span boundary: exactly 62 days passes, 63 days 400s.
    { from: FROM, to: '2027-01-02T00:00:00-03:00', toolAccepts: true, contractKind: 'range' },
    { from: FROM, to: '2027-01-03T00:00:00-03:00', toolAccepts: true, contractKind: 'error' },
  ])('from $from to $to: tool accepts $toolAccepts, contract kind $contractKind', ({ from, to, toolAccepts, contractKind }) => {
    const args: Record<string, string> = {};
    if (from !== undefined) args.from = from;
    if (to !== undefined) args.to = to;
    expect(ListPostsSchema.safeParse(args).success).toBe(toolAccepts);
    const params = new URLSearchParams(args);
    expect(parseStatusRange(params).kind).toBe(contractKind);
  });

  it('the together-refine message matches the contract message', () => {
    const toolIssue = ListPostsSchema.safeParse({ from: FROM });
    expect(toolIssue.success).toBe(false);
    if (!toolIssue.success) {
      expect(toolIssue.error.issues[0]?.message).toBe('from and to must be provided together.');
    }
    expect(parseStatusRange(new URLSearchParams({ from: FROM }))).toEqual({
      kind: 'error',
      message: 'from and to must be provided together.',
    });
  });

  it('the contract normalizes the range bounds to ISO strings', () => {
    expect(parseStatusRange(new URLSearchParams({ from: FROM, to: TO }))).toEqual({
      kind: 'range',
      from: '2026-11-01T03:00:00.000Z',
      to: '2026-12-01T03:00:00.000Z',
    });
  });

  it('the contract rejects ?limit= combined with a range', () => {
    expect(parseStatusRange(new URLSearchParams({ from: FROM, to: TO, limit: '5' }))).toEqual({
      kind: 'error',
      message: 'limit cannot be combined with from/to.',
    });
  });
});

describe('cancel schedule: tool schema vs the shared contract', () => {
  it('accepts a non-empty schedule id on both sides', () => {
    expect(CancelScheduleSchema.safeParse({ scheduleId: 'sched-1' }).success).toBe(true);
    expect(parseCancelScheduleQuery(new URLSearchParams({ id: 'sched-1' }))).toEqual({
      ok: true,
      query: { id: 'sched-1' },
    });
  });

  it('rejects a missing id on both sides', () => {
    expect(CancelScheduleSchema.safeParse({ scheduleId: '' }).success).toBe(false);
    expect(parseCancelScheduleQuery(new URLSearchParams())).toEqual({
      ok: false,
      error: 'id query param is required.',
    });
  });
});

describe('update slot title: tool schema vs the shared contract', () => {
  it.each([
    { title: 'New title', toolAccepts: true, contractAccepts: true, requireTitleThrows: false },
    { title: '', toolAccepts: false, contractAccepts: false, requireTitleThrows: true },
    // Blank passes the tool schema (min(1) only); requireTitle and the
    // contract's trim refine both reject it before any fetch.
    { title: '   ', toolAccepts: true, contractAccepts: false, requireTitleThrows: true },
  ])('title "$title": tool accepts $toolAccepts, contract accepts $contractAccepts', ({ title, toolAccepts, contractAccepts, requireTitleThrows }) => {
    expect(UpdateSlotTitleSchema.safeParse({ slotId: 'slot-1', title }).success).toBe(toolAccepts);
    expect(UpdateSlotBodySchema.safeParse({ title }).success).toBe(contractAccepts);
    if (requireTitleThrows) {
      expect(() => requireTitle(title)).toThrow('title must be a non-empty string.');
    } else {
      expect(requireTitle(title)).toBe(title);
    }
  });

  it('the contract requires at least one of title/slotAt', () => {
    expect(UpdateSlotBodySchema.safeParse({}).success).toBe(false);
    expect(UpdateSlotBodySchema.safeParse({ slotAt: '2026-11-01T00:00:00Z' }).success).toBe(true);
    expect(UpdateSlotBodySchema.safeParse({ slotAt: '2026-11-01' }).success).toBe(false);
  });
});

describe('get/delete slot: tool schema rejects an empty slotId', () => {
  it.each([GetSlotSchema, DeleteSlotSchema])('schema rejects an empty slotId and accepts a real one', (schema) => {
    expect(schema.safeParse({ slotId: '' }).success).toBe(false);
    expect(schema.safeParse({ slotId: 'slot-1' }).success).toBe(true);
  });
});
