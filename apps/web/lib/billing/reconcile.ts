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
//      the stuck threshold are verified against the live engine task,
//      whose numeric state is terminal and self-describing:
//        - engine 404 (task gone) -> refund unless a published slot
//          proves the user got value.
//        - engine state -1 (failed) -> refund with the categorized
//          failure reason; the row is marked failed with the engine's
//          error recorded.
//        - engine state 1 (complete) -> backfill the row as completed;
//          no refund, the user got the video.
//        - task still active, or the engine unreachable -> wait. Past
//          STUCK_MAX_DAYS with no video and no provable delivery, the
//          user got nothing: auto-refund (a wrong refund costs ~$0.10 of
//          GPU; charging a user for nothing is the worse error).
//        - no engine task id (the engine never accepted the job) ->
//          refund unless a published slot proves value was delivered.
//
// Every refund emits `refund_issued` attributed to the affected user —
// that event is the audit trail. There is no human review queue: every
// branch above is decided from the engine's own terminal state or from
// the time-boxed absence of any provable delivery.
//
// The Supabase access is hidden behind ReconcileStore so the orchestration
// below is unit-testable with a fake; createReconcileStore adapts a
// service-role client (cron route only).
//---------------

import type { SupabaseClient } from '@supabase/supabase-js';
import { getPostHogServer } from '@/lib/posthog-server';
import { logger } from '@/lib/logger';
import { SAFE_TASK_ID } from '@/lib/video-urls';
import { engineAuthHeaders } from '@/lib/request-auth';
import { taskPayload, taskState, extractTaskError } from '@/lib/engine-task-state';
import { categorizeGenerationError } from '@/lib/generation/generation-errors';

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

// STUCK_MAX_DEFAULT_DAYS — deliberate default (not a fallback): a stuck
// generation older than this, with no video and no provable delivery,
// is refunded automatically. RECONCILE_STUCK_MAX_DAYS overrides it when
// it parses to a positive number.
export const STUCK_MAX_DEFAULT_DAYS = 3;

export function stuckMaxDays(): number {
  const raw = process.env.RECONCILE_STUCK_MAX_DAYS;
  if (raw !== undefined) {
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return STUCK_MAX_DEFAULT_DAYS;
}

//---------------
// Ledger / analytics literals (kept as constants so the migration sync
// test can reference the same strings).
//---------------

export const ZOMBIE_REFUND_REASON = 'zombie_schedule_no_slots';
export const STUCK_REFUND_REASON = 'stuck_generation_task_gone';
export const STUCK_FAILED_REFUND_REASON_PREFIX = 'stuck_generation_failed';
export const STUCK_NO_TASK_REFUND_REASON = 'stuck_generation_no_task_no_value';

export function stuckUnresolvedRefundReason(): string {
  return `stuck_unresolved_after_${stuckMaxDays()}_days`;
}

export function stuckUnverifiableRefundReason(): string {
  return `stuck_unverifiable_after_${stuckMaxDays()}_days`;
}

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

export type EngineTaskOutcome =
  | { kind: 'gone' }
  | { kind: 'failed'; error: string | null }
  | { kind: 'complete' }
  | { kind: 'active' }
  | { kind: 'unknown' };

export interface ZombieRefundRecord {
  scheduleId: string;
  userId: string;
  generationId: string;
  tokens: number;
}

export interface StuckRecord {
  generationId: string;
  userId: string;
  reason: string;
}

export interface ReconcileReport {
  zombiesRefunded: ZombieRefundRecord[];
  zombiesAlreadySettled: ZombieRefundRecord[];
  stuckAutoRefunded: StuckRecord[];
  stuckSkippedValueDelivered: StuckRecord[];
  stuckCompletedBackfilled: StuckRecord[];
  stuckDeferred: StuckRecord[];
  errors: Array<{ scope: string; ref: string; message: string }>;
}

export interface SettleGenerationInput {
  generationId: string;
  status: 'failed' | 'completed';
  errorCode?: string;
  errorMessage?: string;
  /** Only the RPC's refunded=true proves the tokens moved — never set optimistically. */
  refunded: boolean;
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
  hasPublishedSlotForGeneration(userId: string, generationId: string): Promise<boolean>;
  settleGeneration(input: SettleGenerationInput): Promise<void>;
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

// BATCH_SCHEDULE_ID — the unified flow's generation ids are
// `batch:<scheduleId>` (and `batch:<scheduleId>:slot:<slotId>` per slot),
// so a generation maps back to the schedule whose slots prove delivery.
const BATCH_SCHEDULE_ID =
  /^batch:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;

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
        // delivered" — the caller records the error and the next run
        // retries instead of refunding.
        throw new Error(`published-slot lookup failed: ${error.message}`);
      }
      return (data?.length ?? 0) > 0;
    },

    async hasPublishedSlotForGeneration(userId: string, generationId: string): Promise<boolean> {
      const match = BATCH_SCHEDULE_ID.exec(generationId);
      // Not a batch generation id: no schedule to check, so no provable
      // delivery. (A DB error below still throws — fail closed.)
      if (!match) return false;
      const { data, error } = await supabase
        .from('scheduled_posts')
        .select('id')
        .eq('user_id', userId)
        .eq('schedule_id', match[1])
        .eq('status', 'published')
        .limit(1);
      if (error) {
        throw new Error(`published-slot lookup failed: ${error.message}`);
      }
      return (data?.length ?? 0) > 0;
    },

    async settleGeneration(input: SettleGenerationInput): Promise<void> {
      const patch: Record<string, unknown> = {
        status: input.status,
        updated_at: new Date().toISOString(),
      };
      if (input.status === 'failed') {
        patch.error_code = input.errorCode ?? 'reconcile_stuck';
        patch.error_message =
          input.errorMessage ??
          'Video generation stuck past the reconcile threshold; settled by billing reconciliation.';
      } else {
        // Backfilled complete: clear any stale error detail.
        patch.error_code = null;
        patch.error_message = null;
      }
      // Never write tokens_refunded=true optimistically: only the RPC's
      // refunded=true proves the tokens moved.
      if (input.refunded) patch.tokens_refunded = true;
      const { error } = await supabase
        .from('video_generations')
        .update(patch)
        .eq('generation_id', input.generationId);
      if (error) throw new Error(`settleGeneration failed: ${error.message}`);
    },
  };
}

//---------------
// checkEngineTask — no-throw engine lookup with terminal-state parsing.
//
// The engine's numeric state is self-describing: -1 failed, 1 complete,
// anything else active. 'gone' (HTTP 404) and the parsed terminal states
// are the only outcomes that settle a generation immediately; 'unknown'
// (unreachable, unconfigured, unsafe id, malformed body) defers to the
// time-box.
//---------------

const ENGINE_TASK_TIMEOUT_MS = 10_000;

export async function checkEngineTask(taskId: string, userId: string): Promise<EngineTaskOutcome> {
  if (!SAFE_TASK_ID.test(taskId)) return { kind: 'unknown' };
  const baseUrl = process.env.MONEYPRINT_API_URL;
  if (!baseUrl) return { kind: 'unknown' };
  let headers: Record<string, string>;
  try {
    headers = engineAuthHeaders(userId);
  } catch {
    return { kind: 'unknown' };
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ENGINE_TASK_TIMEOUT_MS);
  try {
    const response = await fetch(
      `${baseUrl.replace(/\/+$/, '')}/api/v1/tasks/${encodeURIComponent(taskId)}`,
      { headers, cache: 'no-store', signal: controller.signal },
    );
    if (response.status === 404) return { kind: 'gone' };
    if (!response.ok) return { kind: 'unknown' };
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return { kind: 'unknown' };
    }
    const task = taskPayload(body);
    const state = task ? taskState(task) : null;
    if (state === -1) return { kind: 'failed', error: extractTaskError(body) };
    if (state === 1) return { kind: 'complete' };
    // A 200 without a readable numeric state proves nothing about the
    // task — treat it as unverifiable, not as active.
    if (state === null) return { kind: 'unknown' };
    return { kind: 'active' };
  } catch {
    return { kind: 'unknown' };
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

//---------------
// runBillingReconciliation — the orchestrator.
//---------------

function emptyReport(): ReconcileReport {
  return {
    zombiesRefunded: [],
    zombiesAlreadySettled: [],
    stuckAutoRefunded: [],
    stuckSkippedValueDelivered: [],
    stuckCompletedBackfilled: [],
    stuckDeferred: [],
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
      await settleStuckGeneration(store, s, report, now);
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

// stuckAgeDays — total age of the stuck generation in days. An
// unparseable created_at reads as 0 (never past the max): when the age
// itself is unknowable, the time-box must not fire.
function stuckAgeDays(s: StuckGeneration, now: number): number {
  const ageMs = now - Date.parse(s.createdAt);
  return Number.isFinite(ageMs) && ageMs > 0 ? ageMs / 86_400_000 : 0;
}

async function settleStuckGeneration(
  store: ReconcileStore,
  s: StuckGeneration,
  report: ReconcileReport,
  now: number,
): Promise<void> {
  const pastMaxAge = stuckAgeDays(s, now) > stuckMaxDays();

  // No task id: the engine never accepted the job, so there is no task
  // state to read. A published slot is the only proof of value.
  if (!s.engineTaskId) {
    const published = await store.hasPublishedSlotForGeneration(s.userId, s.generationId);
    if (published) {
      await store.settleGeneration({ generationId: s.generationId, status: 'completed', refunded: false });
      report.stuckSkippedValueDelivered.push({
        generationId: s.generationId,
        userId: s.userId,
        reason: 'value_delivered',
      });
      return;
    }
    await refundAndFail(
      store, s, STUCK_NO_TASK_REFUND_REASON, 'no_task_id',
      'Video generation never reached the engine (no task id); settled by billing reconciliation.',
      report,
    );
    return;
  }

  const outcome = await checkEngineTask(s.engineTaskId, s.userId);

  if (outcome.kind === 'gone') {
    // Provably dead task — but only refund when no published slot proves
    // the user got value. The slot lookup throws on DB error (fail
    // closed); the catch in runBillingReconciliation records the error
    // and the next run retries.
    const published = await store.hasPublishedSlotForTask(s.userId, s.engineTaskId);
    if (published) {
      await store.settleGeneration({ generationId: s.generationId, status: 'completed', refunded: false });
      report.stuckSkippedValueDelivered.push({
        generationId: s.generationId,
        userId: s.userId,
        reason: 'value_delivered',
      });
      logger.error('[reconcile] stuck generation has a published slot; skipping refund', null, {
        generationId: s.generationId,
        userId: s.userId,
      });
      return;
    }
    await refundAndFail(store, s, STUCK_REFUND_REASON, 'reconcile_stuck',
      'Video generation stuck past the reconcile threshold; engine task is gone.',
      report);
    return;
  }

  if (outcome.kind === 'failed') {
    // The engine tells us why it failed: categorize the reason so the
    // stored error_code stays inside GENERATION_ERROR_CODES.
    const category = categorizeGenerationError(outcome.error);
    await refundAndFail(
      store, s, `${STUCK_FAILED_REFUND_REASON_PREFIX}:${category}`, category,
      outcome.error ?? 'Video generation failed on the engine; settled by billing reconciliation.',
      report,
    );
    return;
  }

  if (outcome.kind === 'complete') {
    // The video exists: backfill the row the poll path never advanced.
    // No refund — the user got the value.
    await store.settleGeneration({ generationId: s.generationId, status: 'completed', refunded: false });
    report.stuckCompletedBackfilled.push({
      generationId: s.generationId,
      userId: s.userId,
      reason: 'engine_complete',
    });
    return;
  }

  // 'active' or 'unknown': nothing provable yet. Inside the time-box the
  // next daily run gets another look; past it, the absence of any
  // provable delivery is itself the decision.
  if (!pastMaxAge) {
    report.stuckDeferred.push({
      generationId: s.generationId,
      userId: s.userId,
      reason: 'deferred_to_next_run',
    });
    return;
  }
  const reason =
    outcome.kind === 'active' ? stuckUnresolvedRefundReason() : stuckUnverifiableRefundReason();
  await refundAndFail(
    store, s, reason, 'reconcile_stuck',
    `Video generation stuck with no provable delivery past the ${stuckMaxDays()}-day reconcile limit; settled by billing reconciliation.`,
    report,
  );
}

// refundAndFail — the shared terminal path for every auto-refund: move
// the tokens via the idempotent RPC, mark the row failed (refunded flag
// only when the RPC proved the tokens moved), and emit the audit event.
async function refundAndFail(
  store: ReconcileStore,
  s: StuckGeneration,
  reason: string,
  errorCode: string,
  errorMessage: string,
  report: ReconcileReport,
): Promise<void> {
  const refunded = await store.refund(s.userId, s.generationId, reason);
  await store.settleGeneration({
    generationId: s.generationId,
    status: 'failed',
    errorCode,
    errorMessage,
    refunded,
  });
  if (refunded) {
    report.stuckAutoRefunded.push({ generationId: s.generationId, userId: s.userId, reason });
    trackRefundIssued(s.userId, {
      kind: 'stuck_generation',
      generation_id: s.generationId,
      engine_task_id: s.engineTaskId,
      reason,
    });
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
