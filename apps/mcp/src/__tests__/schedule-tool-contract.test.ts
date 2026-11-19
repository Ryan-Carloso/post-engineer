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

describe('list posts limit: tool schema vs the shared contract', () => {
  it.each([
    { limit: 1, toolAccepts: true, contractValue: 1 },
    { limit: 20, toolAccepts: true, contractValue: 20 },
    { limit: 500, toolAccepts: true, contractValue: 500 },
    { limit: 0, toolAccepts: false, contractValue: 10 },
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
    { from: '2026-11-01', to: '2026-12-01', toolAccepts: false, contractKind: 'error' },
    { from: '2026-11-01T00:00:00+0300', to: TO, toolAccepts: false, contractKind: 'error' },
    { from: '2026-11-01T00:00:00.123456Z', to: TO, toolAccepts: false, contractKind: 'error' },
    { from: FROM, to: FROM, toolAccepts: true, contractKind: 'error' },
    { from: TO, to: FROM, toolAccepts: true, contractKind: 'error' },
    { from: FROM, to: '2027-02-01T00:00:00-03:00', toolAccepts: true, contractKind: 'error' },
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
