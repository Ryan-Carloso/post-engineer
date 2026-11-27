#!/usr/bin/env bash
set -euo pipefail

db_url="${1:?usage: check-publish-claim-concurrency.sh <db-url>}"
slot_id="77777777-7777-7777-7777-777777777777"
user_id="77777777-7777-7777-7777-777777777771"
schedule_id="77777777-7777-7777-7777-777777777772"
workdir="$(mktemp -d)"
trap 'psql "$db_url" -q -v ON_ERROR_STOP=1 -c "delete from public.scheduled_posts where id = '"'"'$slot_id'"'"'; delete from public.schedules where id = '"'"'$schedule_id'"'"'; delete from public.user_profiles where id = '"'"'$user_id'"'"';" >/dev/null; rm -rf "$workdir"' EXIT

psql "$db_url" -q -v ON_ERROR_STOP=1 <<SQL
insert into public.user_profiles (id, access_until) values ('$user_id', now() + interval '30 days');
insert into public.schedules (id, user_id, providers, youtube_account_ids, instagram_account_ids, linkedin_account_ids, bluesky_account_ids, times)
values ('$schedule_id', '$user_id', array['youtube'], array['yt-1'], '{}', '{}', '{}', '{}');
insert into public.scheduled_posts (id, schedule_id, user_id, slot_at, status, title, media_kind, media_ref)
values ('$slot_id', '$schedule_id', '$user_id', now() - interval '1 minute', 'ready', 'title', 'upload', '$slot_id');
SQL

claim_sql="select coalesce(public.claim_next_publish_slot(now(), interval '30 minutes')->>'id', 'none')"

(psql "$db_url" -q -At -v ON_ERROR_STOP=1 <<SQL > "$workdir/first.out"
begin;
$claim_sql;
select pg_sleep(3);
commit;
SQL
) &
first_pid=$!

sleep 1
second="$(psql "$db_url" -q -At -v ON_ERROR_STOP=1 -c "$claim_sql")"
wait "$first_pid"
first="$(head -n 1 "$workdir/first.out")"

claimed=0
[ "$first" = "$slot_id" ] && claimed=$((claimed + 1))
[ "$second" = "$slot_id" ] && claimed=$((claimed + 1))
if [ "$claimed" -ne 1 ] || [ "$first" != "$slot_id" ] || [ "$second" != "none" ]; then
  echo "expected exactly one session to claim the slot: first=$first second=$second" >&2
  exit 1
fi
echo "exactly one of two concurrent sessions claimed the slot"
