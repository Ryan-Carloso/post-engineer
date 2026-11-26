-- ============================================================================
-- 088 — API-key approval mode (issue #806).
-- user_api_keys.approval_mode ('yolo' | 'approval', NOT NULL DEFAULT 'yolo'):
-- a yolo key schedules ready slots that publish at slot time, as today; an
-- approval key schedules awaiting_approval slots that publish only after the
-- owner approves them in the Posts page. Existing keys become yolo. The mode
-- is set at key creation and immutable afterwards: no key-PATCH endpoint
-- exists, so changing it means revoking and re-creating the key. Idempotent.
-- ============================================================================

alter table public.user_api_keys
  add column if not exists approval_mode text not null default 'yolo';

alter table public.user_api_keys
  drop constraint if exists user_api_keys_approval_mode_check;

alter table public.user_api_keys
  add constraint user_api_keys_approval_mode_check
  check (approval_mode in ('yolo', 'approval'));
