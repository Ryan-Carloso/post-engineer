import 'server-only';

import { createSupabaseServiceClient } from '@/lib/supabase/service';

//---------------
// scheduler-lease — DB lease acquisition for the in-app scheduler
// (supabase/migrations/027_internal-scheduler.sql). One lease per job:
// with multiple app replicas, only the replica whose
// try_acquire_scheduler_lease RPC returns true runs the job in that
// tick; the others skip. The lease expires after the TTL, so a replica
// that crashes mid-run cannot block future ticks forever.
//
// Service-role client: the lease table is internal infrastructure, not
// user data (RLS on, no policies — service role is the only accessor).
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
    throw new Error(`[scheduler-lease] ${job}: rpc failed: ${error.message}`);
  }
  return data === true;
}
