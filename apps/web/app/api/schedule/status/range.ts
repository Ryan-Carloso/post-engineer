// Range mode of GET /api/schedule/status (?from=&to=): every slot, any status,
// with slot_at in [from, to), instead of the upcoming/recent split.
//
// The parser and constants live in the shared schedule contract
// (@/lib/contracts/schedule); this module only re-exports them so the
// existing range tests keep their import path.
export {
  parseStatusRange as parseRange,
  RANGE_MAX_SPAN_DAYS,
  RANGE_MAX_SLOTS,
  RANGE_STATUSES,
} from '@/lib/contracts/schedule';
export type { RangeParseResult as RangeParse } from '@/lib/contracts/schedule';
