#!/usr/bin/env bash
# Seeds the local Supabase stack the Cypress suite runs against: the E2E
# user (confirmed, onboarding wizard already seen, as the suite expects of a
# returning user) and its token balance. Run after the migration chain.
set -euo pipefail

: "${NEXT_PUBLIC_SUPABASE_URL:?NEXT_PUBLIC_SUPABASE_URL is not set}"
: "${SUPABASE_SERVICE_ROLE_KEY:?SUPABASE_SERVICE_ROLE_KEY is not set}"
: "${E2E_TEST_EMAIL:?E2E_TEST_EMAIL is not set}"
: "${E2E_TEST_PASSWORD:?E2E_TEST_PASSWORD is not set}"

case "$NEXT_PUBLIC_SUPABASE_URL" in
  http://127.0.0.1:*|http://localhost:*) ;;
  *)
    echo "seed-e2e.sh only seeds a local Supabase stack (got $NEXT_PUBLIC_SUPABASE_URL)" >&2
    exit 1
    ;;
esac

readonly E2E_TOKENS_BALANCE=100
auth_headers=(-H "apikey: $SUPABASE_SERVICE_ROLE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" -H "Content-Type: application/json")

user_body="$(jq -n --arg email "$E2E_TEST_EMAIL" --arg password "$E2E_TEST_PASSWORD" \
  '{email: $email, password: $password, email_confirm: true, user_metadata: {onboarding_wizard_seen: true}}')"
user_json="$(curl -fsS -X POST "$NEXT_PUBLIC_SUPABASE_URL/auth/v1/admin/users" "${auth_headers[@]}" -d "$user_body")"
user_id="$(jq -er '.id' <<<"$user_json")"

profile_body="$(jq -n --arg id "$user_id" --argjson tokens "$E2E_TOKENS_BALANCE" '{id: $id, tokens_balance: $tokens}')"
curl -fsS -X POST "$NEXT_PUBLIC_SUPABASE_URL/rest/v1/user_profiles" "${auth_headers[@]}" \
  -H "Prefer: resolution=merge-duplicates,return=minimal" -d "$profile_body"

echo "seeded E2E user $user_id with $E2E_TOKENS_BALANCE tokens"
