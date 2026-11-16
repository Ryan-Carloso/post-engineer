// Request shape of `segments` for generate-and-schedule (MCP first,
// Phase 1): one call = one video. The schemas live in the shared videos
// contract now; this module only re-exports them so existing import
// sites keep working.
export { segmentOverlaySchema, segmentsRequestSchema } from '@/lib/contracts/videos';
