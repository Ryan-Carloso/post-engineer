-- ============================================================================
-- 086 — Scheduling-only Post Engineer (issue #788).
-- Video generation and the token economy are gone: video is made outside and
-- uploaded, and a 7-day free trial replaces the free-token grant.
--
--   1. Generated slots that cannot publish any more are cancelled: pending,
--      generating and ready slots without uploaded media are deleted, a
--      generated slot still publishing is marked failed. Schedules left
--      without any slot are deleted.
--   2. user_profiles.trial_ends_at: existing users get created_at + 7 days,
--      new users now() + 7 days. Only the service role writes it.
--   3. find_post_metrics_due / find_post_metrics_daily_due read the slot's
--      publish_outcomes instead of an engine task id.
--   4. Billing, generation and voice tables, functions and columns are
--      dropped. Idempotent: every statement is guarded.
--   5. share_week_posts lists only the statuses a slot can still have
--      (ready, publishing, published, failed).
--
-- Storage objects of the dropped features are not touched here.
-- ============================================================================

delete from public.scheduled_posts
where media_kind is null
  and status in ('pending', 'generating', 'ready');

update public.scheduled_posts
set status = 'failed',
    error = 'Video generation was removed from Post Engineer.',
    updated_at = now()
where media_kind is null
  and status = 'publishing';

delete from public.schedules s
where not exists (
  select 1 from public.scheduled_posts p where p.schedule_id = s.id
);

alter table public.user_profiles add column if not exists trial_ends_at timestamptz;
update public.user_profiles
set trial_ends_at = created_at + interval '7 days'
where trial_ends_at is null;
alter table public.user_profiles alter column trial_ends_at set default (now() + interval '7 days');
alter table public.user_profiles alter column trial_ends_at set not null;

drop function if exists public.find_post_metrics_due(timestamptz, integer);
create function public.find_post_metrics_due(p_now timestamptz, p_limit integer)
returns table (
  post_id uuid,
  user_id uuid,
  published_at timestamptz,
  publish_outcomes jsonb,
  metrics_window text,
  collected_keys text[]
)
language sql
stable
security definer
set search_path = public
as $$
  with windows(metrics_window, start_hours) as (
    values ('24h', 24), ('7d', 168), ('28d', 672)
  ),
  due as (
    select sp.id, sp.user_id, sp.published_at, sp.publish_outcomes, w.metrics_window
    from public.scheduled_posts sp
    join windows w
      on sp.published_at <= p_now - make_interval(hours => w.start_hours)
     and sp.published_at > p_now - make_interval(hours => w.start_hours + 24)
    where sp.status = 'published'
      and not exists (
        select 1 from public.post_metrics_done pmd
        where pmd.post_id = sp.id and pmd.metrics_window = w.metrics_window
      )
  )
  select
    d.id,
    d.user_id,
    d.published_at,
    d.publish_outcomes,
    d.metrics_window,
    coalesce(
      (
        select array_agg(pm.provider || ':' || pm.external_id)
        from public.post_metrics pm
        where pm.post_id = d.id
          and pm.metrics_window = d.metrics_window
          and not (
            pm.provider = 'youtube'
            and (pm.analytics_status is null or pm.analytics_status = 'scope_missing')
          )
      ),
      '{}'
    )
  from due d
  order by
    exists (
      select 1 from public.post_metrics pm
      where pm.post_id = d.id and pm.metrics_window = d.metrics_window
    ),
    d.published_at
  limit p_limit;
$$;

drop function if exists public.find_post_metrics_daily_due(timestamptz, integer);
create function public.find_post_metrics_daily_due(p_now timestamptz, p_limit integer)
returns table (
  post_id uuid,
  user_id uuid,
  published_at timestamptz,
  publish_outcomes jsonb,
  collected_keys text[]
)
language sql
stable
security definer
set search_path = public
as $$
  select
    sp.id,
    sp.user_id,
    sp.published_at,
    sp.publish_outcomes,
    coalesce(
      (
        select array_agg(pmd.provider || ':' || pmd.external_id)
        from public.post_metrics_daily pmd
        where pmd.post_id = sp.id
          and pmd.snapshot_date = (p_now at time zone 'UTC')::date
      ),
      '{}'
    )
  from public.scheduled_posts sp
  where sp.status = 'published'
    and sp.published_at > p_now - interval '28 days'
    and sp.published_at <= p_now
    and not exists (
      select 1 from public.post_metrics_daily_attempts pda
      where pda.post_id = sp.id
        and pda.snapshot_date = (p_now at time zone 'UTC')::date
    )
  order by
    (select max(pmd.collected_at) from public.post_metrics_daily pmd where pmd.post_id = sp.id) asc nulls first,
    sp.published_at asc,
    sp.id asc
  limit p_limit;
$$;

do $$
begin
  revoke execute on function public.find_post_metrics_due(timestamptz, integer) from public;
  revoke execute on function public.find_post_metrics_daily_due(timestamptz, integer) from public;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke execute on function public.find_post_metrics_due(timestamptz, integer) from anon;
    revoke execute on function public.find_post_metrics_daily_due(timestamptz, integer) from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke execute on function public.find_post_metrics_due(timestamptz, integer) from authenticated;
    revoke execute on function public.find_post_metrics_daily_due(timestamptz, integer) from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.find_post_metrics_due(timestamptz, integer) to service_role;
    grant execute on function public.find_post_metrics_daily_due(timestamptz, integer) to service_role;
  end if;
end $$;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    execute 'select cron.unschedule(jobid) from cron.job where jobname = ''billing-reconcile''';
  end if;
end $$;

drop function if exists public.schedule_billing_reconcile();
drop function if exists public.refund_batch_tokens(uuid, text, text, numeric, text, text);
drop function if exists public.settle_batch_clawback(uuid, jsonb, jsonb);
drop function if exists public.restore_batch_discount_credit(uuid, text, text, numeric);
drop function if exists public.find_stuck_generations(timestamptz);
drop function if exists public.find_zombie_schedule_candidates(timestamptz);
drop function if exists public.set_primary_persona_image(uuid, uuid, uuid);
drop function if exists public.record_persona_image_use(uuid, uuid, uuid);
drop function if exists public.grant_signup_bonus(uuid);
drop function if exists public.credit_tokens_for_payment(uuid, numeric, text, text, text);

drop table if exists public.persona_images cascade;
drop function if exists public.enforce_persona_image_limit();
drop table if exists public.token_transactions cascade;
drop table if exists public.stripe_webhook_events cascade;
drop table if exists public.video_generations cascade;
drop table if exists public.engine_task_state cascade;
drop table if exists public.cloned_voices cascade;
drop table if exists public.scheduled_post_progress_history cascade;

alter table public.user_profiles drop column if exists tokens_balance;
alter table public.user_profiles drop column if exists free_tokens_balance;
alter table public.user_profiles drop column if exists stripe_customer_id;

alter table public.scheduled_posts drop column if exists charged_tokens;
alter table public.scheduled_posts drop column if exists discount_tokens;
alter table public.scheduled_posts drop column if exists batch_id;
alter table public.scheduled_posts drop column if exists task_id;
alter table public.scheduled_posts drop column if exists voiceover;
alter table public.scheduled_posts drop column if exists voiceover_material;
alter table public.scheduled_posts drop column if exists full_lipsync;
alter table public.scheduled_posts drop column if exists lipsync_photos;
alter table public.scheduled_posts drop column if exists hook_title;
alter table public.scheduled_posts drop column if exists music_mood;
alter table public.scheduled_posts drop column if exists segments;
alter table public.scheduled_posts drop column if exists video_type;

alter table public.post_metrics drop column if exists script_angle;

alter table public.schedules drop column if exists post_voice_id;
alter table public.schedules drop column if exists post_voice_audio_url;
alter table public.schedules drop column if exists post_niche;
alter table public.schedules drop column if exists post_language;
alter table public.schedules drop column if exists post_video_aspect;
alter table public.schedules drop column if exists post_paragraph_number;
alter table public.schedules drop column if exists post_face_quality;
alter table public.schedules drop column if exists post_video_layout;
alter table public.schedules drop column if exists post_cta_type;
alter table public.schedules drop column if exists post_cta_url;
alter table public.schedules drop column if exists post_cta_instruction;
alter table public.schedules drop column if exists post_hook_panel;

alter table public.personas drop column if exists voice_id;
alter table public.personas drop column if exists voice_audio_path;
alter table public.personas drop column if exists language;
alter table public.personas drop column if exists video_aspect;
alter table public.personas drop column if exists script_prompt;
alter table public.personas drop column if exists paragraph_number;
alter table public.personas drop column if exists niche;
alter table public.personas drop column if exists face_quality;
alter table public.personas drop column if exists recent_image_ids;
alter table public.personas drop column if exists video_layout;
alter table public.personas drop column if exists cta_type;
alter table public.personas drop column if exists cta_url;
alter table public.personas drop column if exists cta_instruction;
alter table public.personas drop column if exists hook_panel;

drop type if exists public.face_quality;

drop function if exists public.share_week_posts(uuid, uuid[], timestamptz, timestamptz, integer);

create or replace function public.share_week_posts(
  p_user_id uuid,
  p_persona_ids uuid[],
  p_from timestamptz,
  p_to timestamptz,
  p_limit integer
)
returns table (
  title text,
  slot_at timestamptz,
  status text,
  providers text[]
)
language sql
stable
security definer
set search_path = public
as $$
  select sp.title, sp.slot_at, sp.status, coalesce(s.providers, '{}')
  from public.scheduled_posts sp
  left join public.schedules s on s.id = sp.schedule_id and s.user_id = p_user_id
  where sp.user_id = p_user_id
    and sp.slot_at >= p_from
    and sp.slot_at < p_to
    and sp.status in ('ready', 'publishing', 'published', 'failed')
    and (p_persona_ids is null or s.persona_id = any(p_persona_ids))
  order by sp.slot_at asc, sp.id asc
  limit p_limit;
$$;

do $$
begin
  revoke execute on function public.share_week_posts(uuid, uuid[], timestamptz, timestamptz, integer) from public;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke execute on function public.share_week_posts(uuid, uuid[], timestamptz, timestamptz, integer) from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke execute on function public.share_week_posts(uuid, uuid[], timestamptz, timestamptz, integer) from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.share_week_posts(uuid, uuid[], timestamptz, timestamptz, integer) to service_role;
  end if;
end $$;
