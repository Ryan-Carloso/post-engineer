import 'server-only';

import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { redactCredentialFragments } from '@/lib/scrub';

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
    throw new Error(
      `[scheduler-lease] ${job}: acquire rpc failed: ${redactCredentialFragments(error.message)}`,
    );
  }
  return data === true;
}

export async function getSchedulerLastSuccess(job: string): Promise<Date | null> {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase.rpc('get_scheduler_last_success', {
    p_job: job,
  });
  if (error) {
    throw new Error(
      `[scheduler-lease] ${job}: last-success rpc failed: ${redactCredentialFragments(error.message)}`,
    );
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
    throw new Error(
      `[scheduler-lease] ${job}: record-success rpc failed: ${redactCredentialFragments(error.message)}`,
    );
  }
}

export async function releaseSchedulerLease(job: string, holder: string): Promise<void> {
  const supabase = createSupabaseServiceClient();
  const { error } = await supabase.rpc('release_scheduler_lease', {
    p_job: job,
    p_holder: holder,
  });
  if (error) {
    throw new Error(
      `[scheduler-lease] ${job}: release rpc failed: ${redactCredentialFragments(error.message)}`,
    );
  }
}
