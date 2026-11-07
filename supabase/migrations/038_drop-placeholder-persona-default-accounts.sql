-- 038: remove persona default accounts that point at the 'unknown'
-- placeholder account id. Migration 036 deleted the social_accounts rows
-- stored under that placeholder, but persona_default_accounts keys accounts by
-- (provider, provider_account_id) with no foreign key, so a default saved
-- while the placeholder row still counted as connected is left dangling: the
-- persona editor renders no checkbox for it (it cannot be unchecked) and
-- every save sends it back and is rejected as not a connected account.
-- Idempotent: re-running matches nothing.

delete from public.persona_default_accounts
where lower(btrim(provider_account_id)) in ('unknown', '');
