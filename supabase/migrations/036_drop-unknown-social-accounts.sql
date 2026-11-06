-- 036: remove social accounts saved with the placeholder provider_account_id
-- 'unknown'. A failed YouTube channel lookup used to store the account under
-- that sentinel; the real channel id is unrecoverable, every publish to the
-- row failed with a bare Unauthorized, and the user cannot tell which account
-- is broken. Dropping the rows makes the account disappear so the user
-- reconnects it; the app now refuses to save such ids (upsertSocialAccount).
-- Idempotent: re-running matches nothing.

delete from public.social_accounts
where lower(btrim(provider_account_id)) in ('unknown', '');
