alter table public.user_profiles
  alter column access_until set default now();

update public.user_profiles
set access_until = least(access_until, now())
where subscription_status is null;

do $$
begin
  if exists (select 1 from pg_constraint where conname = 'user_profiles_subscription_status_check') then
    alter table public.user_profiles drop constraint user_profiles_subscription_status_check;
  end if;
  alter table public.user_profiles
    add constraint user_profiles_subscription_status_check
    check (
      subscription_status is null
      or subscription_status in (
        'trialing', 'active', 'past_due', 'canceled',
        'unpaid', 'incomplete', 'incomplete_expired', 'paused', 'beta'
      )
    );
end $$;

alter table public.user_profiles
  drop column if exists trial_ends_at;
