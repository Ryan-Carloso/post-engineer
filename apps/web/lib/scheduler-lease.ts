import 'server-only';

import { createSupabaseServiceClient } from '@/lib/supabase/service';

//---------------
// scheduler-lease — DB lease + last-success persistence for the in-app
// scheduler (supabase/migrations/027_internal-scheduler.sql). One lease
// row per job: with multiple app replicas, only the replica whose
// try_acquire_scheduler_lease RPC returns true runs the job in that
// tick; the others skip. recordSchedulerSuccess moves last_success_at
// (the restart-safe due-check input), and getSchedulerLastSuccess reads
// it. The lease expires after the TTL, so a replica that crashes mid-run
// cannot block future ticks forever.
//
// Service-role client: the lease table is internal infrastructure, not
// user data (RLS on, no policies; functions revoked from
// public/anon/authenticated, granted to service_role only).
//---------------

export async function tryAcquireSchedulerLease(
  job: string,
  ttlSeconds: number,
  holder: string,
): Promise<boolean> {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase.rpc('try_acquire_scheduler_lease', {
    p_job: job,
    p_ttl_seconds: ttlSeconds,
    p_holder: holder,
  });
  if (error) {
    throw new Error(`[scheduler-lease] ${job}: acquire rpc failed: ${error.message}`);
  }
  return data === true;
}

export async function getSchedulerLastSuccess(job: string): Promise<Date | null> {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase.rpc('get_scheduler_last_success', {
    p_job: job,
  });
  if (error) {
    throw new Error(`[scheduler-lease] ${job}: last-success rpc failed: ${error.message}`);
  }
  if (data === null || data === undefined) return null;
  return new Date(data as string);
}

export async function recordSchedulerSuccess(job: string): Promise<void> {
  const supabase = createSupabaseServiceClient();
  const { error } = await supabase.rpc('record_scheduler_success', {
    p_job: job,
  });
  if (error) {
    throw new Error(`[scheduler-lease] ${job}: record-success rpc failed: ${error.message}`);
  }
}
