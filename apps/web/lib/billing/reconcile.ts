//---------------
// billing/reconcile — daily billing reconciliation.
//
// Two jobs, one invariant: never take tokens for value the user did not
// get, and never refund value the user did get.
//
//   1. Zombie schedules: a schedule older than ZOMBIE_SCHEDULE_AGE_HOURS
//      with zero publish slots, zero generated videos, and a ledger spend
//      is provably worthless (slot dispatch happens within minutes of
//      creation). Refund automatically via the idempotent
//      refund_generation_tokens RPC and emit `refund_issued`.
//   2. Stuck video generations: rows in a non-terminal status older than
//      the stuck threshold are verified against the live engine task.
//      Provably dead (engine 404 + no published slot) -> auto-refund like
//      a zombie. Anything ambiguous (engine alive, unreachable, or no
//      task id to check) -> inserted into the refund_reviews queue for a
//      human decision. Ambiguity NEVER refunds.
//
// The Supabase access is hidden behind ReconcileStore so the orchestration
// below is unit-testable with a fake; createReconcileStore adapts a
// service-role client (cron/admin routes only).
//---------------

import type { SupabaseClient } from '@supabase/supabase-js';
import { getPostHogServer } from '@/lib/posthog-server';
import { logger } from '@/lib/logger';
import { SAFE_TASK_ID } from '@/lib/video-urls';
import { engineAuthHeaders } from '@/lib/request-auth';

//---------------
// Tunables
//---------------

// ZOMBIE_SCHEDULE_AGE_HOURS — slot dispatch runs within minutes of
// schedule creation; a schedule this old with zero slots will never
// produce anything.
export const ZOMBIE_SCHEDULE_AGE_HOURS = 24;

// STUCK_GENERATION_DEFAULT_HOURS — deliberate default (not a fallback):
// the daily job must keep running even when the operator never set the
// knob. RECONCILE_STUCK_HOURS overrides it when it parses to a positive
// number.
export const STUCK_GENERATION_DEFAULT_HOURS = 6;

export function stuckGenerationAgeHours(): number {
  const raw = process.env.RECONCILE_STUCK_HOURS;
  if (raw !== undefined) {
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return STUCK_GENERATION_DEFAULT_HOURS;
}

//---------------
// Ledger / analytics literals (kept as constants so the migration sync
// test and the queue UI can reference the same strings).
//---------------

export const ZOMBIE_REFUND_REASON = 'zombie_schedule_no_slots';
export const STUCK_REFUND_REASON = 'stuck_generation_task_gone';
export const REVIEW_APPROVE_REFUND_REASON = 'refund_review_approved';

//---------------
// Shapes
//---------------

export interface ZombieCandidate {
  id: string;
  userId: string;
  generationId: string;
  tokensSpent: number;
  createdAt: string;
}

export interface StuckGeneration {
  id: string;
  userId: string;
  generationId: string;
  engineTaskId: string | null;
  createdAt: string;
}

export interface ReviewInput {
  userId: string;
  refId: string;
  tokens: number;
  evidence: Record<string, unknown>;
}

export type EngineTaskOutcome = 'gone' | 'alive' | 'unknown';

export interface ZombieRefundRecord {
  scheduleId: string;
  userId: string;
  generationId: string;
  tokens: number;
}

export interface StuckRefundRecord {
  generationId: string;
  userId: string;
}

export interface QueuedRecord {
  generationId: string;
  userId: string;
}

export interface ReconcileReport {
  zombiesRefunded: ZombieRefundRecord[];
  zombiesAlreadySettled: ZombieRefundRecord[];
  stuckAutoRefunded: StuckRefundRecord[];
  stuckSkippedValueDelivered: StuckRefundRecord[];
  queuedForReview: QueuedRecord[];
  queuedAlready: QueuedRecord[];
  errors: Array<{ scope: string; ref: string; message: string }>;
}

//---------------
// ReconcileStore — the persistence boundary.
//---------------

export interface ReconcileStore {
  findZombieCandidates(cutoffIso: string): Promise<ZombieCandidate[]>;
  findStuckGenerations(cutoffIso: string): Promise<StuckGeneration[]>;
  /** Calls the idempotent refund_generation_tokens RPC. False = no-op (already settled). */
  refund(userId: string, generationId: string, reason: string): Promise<boolean>;
  hasPublishedSlotForTask(userId: string, taskId: string): Promise<boolean>;
  queueReview(input: ReviewInput): Promise<'queued' | 'already_queued'>;
  markGenerationSettled(generationId: string, refunded: boolean): Promise<void>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function toZombieCandidate(row: Record<string, unknown>): ZombieCandidate | null {
  if (
    typeof row.schedule_id !== 'string' ||
    typeof row.user_id !== 'string' ||
    typeof row.generation_id !== 'string'
  ) {
    return null;
  }
  const tokens = typeof row.tokens_spent === 'number' ? Math.abs(row.tokens_spent) : 0;
  return {
    id: row.schedule_id,
    userId: row.user_id,
    generationId: row.generation_id,
    tokensSpent: tokens,
    createdAt: typeof row.created_at === 'string' ? row.created_at : '',
  };
}

function toStuckGeneration(row: Record<string, unknown>): StuckGeneration | null {
  if (
    typeof row.generation_id !== 'string' ||
    typeof row.user_id !== 'string'
  ) {
    return null;
  }
  return {
    id: typeof row.generation_pk === 'string' ? row.generation_pk : '',
    userId: row.user_id,
    generationId: row.generation_id,
    engineTaskId: typeof row.engine_task_id === 'string' ? row.engine_task_id : null,
    createdAt: typeof row.created_at === 'string' ? row.created_at : '',
  };
}

//---------------
// createReconcileStore — Supabase adapter. The caller must hand over a
// service-role client: the detector functions bypass RLS (security
// definer) and every query below re-checks ownership explicitly.
//---------------

export function createReconcileStore(supabase: SupabaseClient): ReconcileStore {
  return {
    async findZombieCandidates(cutoffIso: string): Promise<ZombieCandidate[]> {
      const { data, error } = await supabase.rpc('find_zombie_schedule_candidates', {
        p_cutoff: cutoffIso,
      });
      if (error) throw new Error(`find_zombie_schedule_candidates failed: ${error.message}`);
      const rows = Array.isArray(data) ? data : [];
      const out: ZombieCandidate[] = [];
      for (const row of rows) {
        if (isRecord(row)) {
          const candidate = toZombieCandidate(row);
          if (candidate) out.push(candidate);
          else logger.error('[reconcile] malformed zombie candidate row', null, { row });
        }
      }
      return out;
    },

    async findStuckGenerations(cutoffIso: string): Promise<StuckGeneration[]> {
      const { data, error } = await supabase.rpc('find_stuck_generations', {
        p_cutoff: cutoffIso,
      });
      if (error) throw new Error(`find_stuck_generations failed: ${error.message}`);
      const rows = Array.isArray(data) ? data : [];
      const out: StuckGeneration[] = [];
      for (const row of rows) {
        if (isRecord(row)) {
          const stuck = toStuckGeneration(row);
          if (stuck) out.push(stuck);
          else logger.error('[reconcile] malformed stuck generation row', null, { row });
        }
      }
      return out;
    },

    async refund(userId: string, generationId: string, reason: string): Promise<boolean> {
      const { data, error } = await supabase.rpc('refund_generation_tokens', {
        p_user_id: userId,
        p_generation_id: generationId,
        p_reason: reason,
      });
      if (error) {
        logger.error('[reconcile] refund RPC failed', error, { userId, generationId });
        return false;
      }
      // The RPC is idempotent: refunded=false means "nothing to refund"
      // (already settled), not an error — the caller treats it as settled.
      return isRecord(data) && data.refunded === true;
    },

    async hasPublishedSlotForTask(userId: string, taskId: string): Promise<boolean> {
      const { data, error } = await supabase
        .from('scheduled_posts')
        .select('id')
        .eq('user_id', userId)
        .eq('task_id', taskId)
        .eq('status', 'published')
        .limit(1);
      if (error) {
        // Fail closed: a lookup error must never read as "no value
        // delivered" — the caller queues for review instead of refunding.
        throw new Error(`published-slot lookup failed: ${error.message}`);
      }
      return (data?.length ?? 0) > 0;
    },

    async queueReview(input: ReviewInput): Promise<'queued' | 'already_queued'> {
      const { error } = await supabase.from('refund_reviews').insert({
        user_id: input.userId,
        kind: 'stuck_generation',
        ref_id: input.refId,
        tokens: input.tokens,
        evidence: input.evidence,
        status: 'pending',
      });
      if (error) {
        // 23505 = the pending-uniqueness guard fired: another run already
        // queued this generation. Not an error.
        if (error.code === '23505') return 'already_queued';
        throw new Error(`refund_reviews insert failed: ${error.message}`);
      }
      return 'queued';
    },

    async markGenerationSettled(generationId: string, refunded: boolean): Promise<void> {
      const patch: Record<string, unknown> = {
        status: 'failed',
        error_code: 'reconcile_stuck',
        error_message: 'Video generation stuck past the reconcile threshold; settled by billing reconciliation.',
        updated_at: new Date().toISOString(),
      };
      // Never write tokens_refunded=true optimistically: only the RPC's
      // refunded=true proves the tokens moved.
      if (refunded) patch.tokens_refunded = true;
      const { error } = await supabase
        .from('video_generations')
        .update(patch)
        .eq('generation_id', generationId);
      if (error) throw new Error(`markGenerationSettled failed: ${error.message}`);
    },
  };
}

//---------------
// checkEngineTask — no-throw tri-state engine lookup.
//
// 'gone' (HTTP 404) is the ONLY outcome that can lead to an automatic
// refund. Every other outcome — including "the engine is down" — is
// 'unknown' and routes to the human review queue.
//---------------

const ENGINE_TASK_TIMEOUT_MS = 10_000;

export async function checkEngineTask(taskId: string, userId: string): Promise<EngineTaskOutcome> {
  if (!SAFE_TASK_ID.test(taskId)) return 'unknown';
  const baseUrl = process.env.MONEYPRINT_API_URL;
  if (!baseUrl) return 'unknown';
  let headers: Record<string, string>;
  try {
    headers = engineAuthHeaders(userId);
  } catch {
    return 'unknown';
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ENGINE_TASK_TIMEOUT_MS);
  try {
    const response = await fetch(
      `${baseUrl.replace(/\/+$/, '')}/api/v1/tasks/${encodeURIComponent(taskId)}`,
      { headers, cache: 'no-store', signal: controller.signal },
    );
    if (response.status === 404) return 'gone';
    if (response.ok) return 'alive';
    return 'unknown';
  } catch {
    return 'unknown';
  } finally {
    clearTimeout(timeout);
  }
}

//---------------
// Analytics — server-side, attributed to the affected user (never the
// shared service id), so refunds are per-person in PostHog.
//
// NOTE: these events intentionally bypass scrubSecrets. The scrubber
// redacts every key containing "token" — including a plain token COUNT —
// which would erase the audit value of refund_issued. That is safe here
// because every property below is constructed from typed store outputs
// (uuids, counts, fixed reason literals): no request input, no secrets,
// no credential-shaped values can reach these calls.
//---------------

function trackRefundIssued(
  userId: string,
  properties: Record<string, unknown>,
): void {
  try {
    getPostHogServer()?.captureAs(userId, 'refund_issued', properties);
  } catch {
    // Telemetry must never break the reconciliation run.
  }
}

function trackReviewQueued(userId: string, properties: Record<string, unknown>): void {
  try {
    getPostHogServer()?.captureAs(userId, 'refund_review_queued', properties);
  } catch {
    // Telemetry must never break the reconciliation run.
  }
}

//---------------
// runBillingReconciliation — the orchestrator.
//---------------

function emptyReport(): ReconcileReport {
  return {
    zombiesRefunded: [],
    zombiesAlreadySettled: [],
    stuckAutoRefunded: [],
    stuckSkippedValueDelivered: [],
    queuedForReview: [],
    queuedAlready: [],
    errors: [],
  };
}

export async function runBillingReconciliation(store: ReconcileStore): Promise<ReconcileReport> {
  const report = emptyReport();
  const now = Date.now();

  // --- Phase 1: zombie schedules -------------------------------------
  const zombieCutoff = new Date(now - ZOMBIE_SCHEDULE_AGE_HOURS * 3600 * 1000).toISOString();
  let zombies: ZombieCandidate[];
  try {
    zombies = await store.findZombieCandidates(zombieCutoff);
  } catch (error) {
    report.errors.push({ scope: 'zombie_detection', ref: '', message: messageOf(error) });
    zombies = [];
  }
  for (const z of zombies) {
    try {
      const refunded = await store.refund(z.userId, z.generationId, ZOMBIE_REFUND_REASON);
      const record: ZombieRefundRecord = {
        scheduleId: z.id,
        userId: z.userId,
        generationId: z.generationId,
        tokens: z.tokensSpent,
      };
      if (refunded) {
        report.zombiesRefunded.push(record);
        trackRefundIssued(z.userId, {
          kind: 'zombie_schedule',
          schedule_id: z.id,
          generation_id: z.generationId,
          tokens: z.tokensSpent,
          reason: ZOMBIE_REFUND_REASON,
        });
      } else {
        // Idempotent no-op: a previous run (or the request path) already
        // settled this generation. Nothing to do, nothing to report.
        report.zombiesAlreadySettled.push(record);
      }
    } catch (error) {
      report.errors.push({ scope: 'zombie_refund', ref: z.id, message: messageOf(error) });
      logger.error('[reconcile] zombie refund failed', error, { scheduleId: z.id, userId: z.userId });
    }
  }

  // --- Phase 2: stuck video generations ------------------------------
  const stuckCutoff = new Date(now - stuckGenerationAgeHours() * 3600 * 1000).toISOString();
  let stuck: StuckGeneration[];
  try {
    stuck = await store.findStuckGenerations(stuckCutoff);
  } catch (error) {
    report.errors.push({ scope: 'stuck_detection', ref: '', message: messageOf(error) });
    stuck = [];
  }
  for (const s of stuck) {
    try {
      await settleStuckGeneration(store, s, report);
    } catch (error) {
      report.errors.push({ scope: 'stuck_settle', ref: s.generationId, message: messageOf(error) });
      logger.error('[reconcile] stuck generation settle failed', error, {
        generationId: s.generationId,
        userId: s.userId,
      });
    }
  }

  return report;
}

async function settleStuckGeneration(
  store: ReconcileStore,
  s: StuckGeneration,
  report: ReconcileReport,
): Promise<void> {
  const evidence: Record<string, unknown> = {
    generation_id: s.generationId,
    engine_task_id: s.engineTaskId,
    stuck_since: s.createdAt,
  };

  // No task id to verify against the engine: genuinely ambiguous.
  if (!s.engineTaskId) {
    await queueForReview(store, s, { ...evidence, verification: 'no_engine_task_id' }, report);
    return;
  }

  const outcome = await checkEngineTask(s.engineTaskId, s.userId);
  evidence.engine_outcome = outcome;

  if (outcome === 'gone') {
    // Provably dead task — but only refund when no published slot proves
    // the user got value. The slot lookup throws on DB error (fail
    // closed); the catch in runBillingReconciliation then queues nothing
    // and records the error — the next run retries.
    const published = await store.hasPublishedSlotForTask(s.userId, s.engineTaskId);
    if (published) {
      report.stuckSkippedValueDelivered.push({ generationId: s.generationId, userId: s.userId });
      logger.error('[reconcile] stuck generation has a published slot; skipping refund', null, {
        generationId: s.generationId,
        userId: s.userId,
      });
      return;
    }
    const refunded = await store.refund(s.userId, s.generationId, STUCK_REFUND_REASON);
    await store.markGenerationSettled(s.generationId, refunded);
    if (refunded) {
      report.stuckAutoRefunded.push({ generationId: s.generationId, userId: s.userId });
      trackRefundIssued(s.userId, {
        kind: 'stuck_generation',
        generation_id: s.generationId,
        engine_task_id: s.engineTaskId,
        reason: STUCK_REFUND_REASON,
      });
    }
    return;
  }

  // 'alive' or 'unknown': ambiguous — human decides.
  await queueForReview(store, s, evidence, report);
}

async function queueForReview(
  store: ReconcileStore,
  s: StuckGeneration,
  evidence: Record<string, unknown>,
  report: ReconcileReport,
): Promise<void> {
  const queued = await store.queueReview({
    userId: s.userId,
    refId: s.generationId,
    tokens: 0,
    evidence,
  });
  const record: QueuedRecord = { generationId: s.generationId, userId: s.userId };
  if (queued === 'queued') {
    report.queuedForReview.push(record);
    trackReviewQueued(s.userId, {
      generation_id: s.generationId,
      engine_task_id: s.engineTaskId,
      evidence,
    });
  } else {
    report.queuedAlready.push(record);
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
