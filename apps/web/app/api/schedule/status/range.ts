// Range mode of GET /api/schedule/status (?from=&to=): every slot, any status,
// with slot_at in [from, to), instead of the upcoming/recent split.

export const RANGE_MAX_SPAN_DAYS = 62;
// Hard cap on slots per range request; one extra row is fetched to detect
// truncation, which the response exposes as `truncated` (never a silent cut).
export const RANGE_MAX_SLOTS = 1000;
// DB statuses ('pending' is presented to clients as 'awaiting').
export const RANGE_STATUSES = ['pending', 'generating', 'ready', 'publishing', 'published', 'failed'] as const;

const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;

export type RangeParse =
  | { kind: 'none' }
  | { kind: 'range'; from: string; to: string }
  | { kind: 'error'; message: string };

function parseInstant(value: string): Date | null {
  if (!ISO_INSTANT.test(value)) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

// Strict: from and to come together, both must be ISO-8601 instants with an
// offset, from < to, the span is bounded, and ?limit= must not be combined
// (it belongs to the upcoming/recent mode). Anything else is a 400.
export function parseRange(params: URLSearchParams): RangeParse {
  const from = params.get('from');
  const to = params.get('to');
  if (from === null && to === null) return { kind: 'none' };
  if (from === null || to === null) return { kind: 'error', message: 'from and to must be provided together.' };
  if (params.has('limit')) return { kind: 'error', message: 'limit cannot be combined with from/to.' };
  const fromDate = parseInstant(from);
  const toDate = parseInstant(to);
  if (fromDate === null || toDate === null) {
    return { kind: 'error', message: 'from and to must be ISO-8601 timestamps with a UTC offset.' };
  }
  if (fromDate.getTime() >= toDate.getTime()) return { kind: 'error', message: 'from must be before to.' };
  if (toDate.getTime() - fromDate.getTime() > RANGE_MAX_SPAN_DAYS * 86_400_000) {
    return { kind: 'error', message: `The range cannot exceed ${RANGE_MAX_SPAN_DAYS} days.` };
  }
  return { kind: 'range', from: fromDate.toISOString(), to: toDate.toISOString() };
}
