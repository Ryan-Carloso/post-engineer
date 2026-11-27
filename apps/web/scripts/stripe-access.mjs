import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const USAGE = `usage:
  node apps/web/scripts/stripe-access.mjs sync
  node apps/web/scripts/stripe-access.mjs grant --email <email> --until <ISO date>
  node apps/web/scripts/stripe-access.mjs revoke --email <email>`;

const SUBSCRIPTION_STATUSES = ['trialing', 'active', 'past_due', 'canceled', 'unpaid', 'incomplete', 'incomplete_expired', 'paused'];
const DUNNING_GRACE_MS = 3 * 24 * 60 * 60 * 1000;

export function effectiveAccessOf(args, now) {
  if (!SUBSCRIPTION_STATUSES.includes(args.status)) {
    throw new Error(`unknown subscription status ${args.status}`);
  }
  const nowMs = now.getTime();
  const endMs = args.periodEnd === null ? nowMs : Date.parse(args.periodEnd);
  if (args.status === 'active' || args.status === 'trialing') return new Date(Math.max(endMs, nowMs)).toISOString();
  if (args.status === 'past_due') return new Date(Math.max(endMs + DUNNING_GRACE_MS, nowMs)).toISOString();
  return new Date(nowMs).toISOString();
}

export function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = { command, email: null, until: null };
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (arg === '--email' || arg === '--until') {
      const value = rest[index + 1];
      if (value === undefined || value.startsWith('--')) {
        throw new Error(`${arg} needs a value`);
      }
      options[arg.slice(2)] = value;
      index += 1;
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }
  if (command === 'grant') {
    if (options.email === null) throw new Error('grant needs --email');
    const until = Date.parse(options.until ?? '');
    if (Number.isNaN(until)) throw new Error('grant needs --until as an ISO date');
  } else if (command === 'revoke') {
    if (options.email === null) throw new Error('revoke needs --email');
  } else if (command !== 'sync') {
    throw new Error(USAGE);
  }
  return options;
}

export function periodEndOf(subscription) {
  const ends = [];
  if (typeof subscription.current_period_end === 'number') ends.push(subscription.current_period_end);
  const items = subscription.items?.data;
  if (Array.isArray(items)) {
    for (const item of items) {
      if (typeof item?.current_period_end === 'number') ends.push(item.current_period_end);
    }
  }
  if (ends.length === 0) return null;
  return new Date(Math.max(...ends) * 1000).toISOString();
}

export function accessArgsOf(subscription) {
  const customer = typeof subscription.customer === 'string' ? subscription.customer : subscription.customer?.id;
  if (typeof customer !== 'string' || customer === '') {
    throw new Error(`subscription ${subscription.id} carries no customer id`);
  }
  if (typeof subscription.status !== 'string' || subscription.status === '') {
    throw new Error(`subscription ${subscription.id} carries no status`);
  }
  return {
    customer,
    subscriptionId: subscription.id,
    status: subscription.status,
    periodEnd: periodEndOf(subscription),
    userId: subscription.metadata?.userId ?? null,
  };
}

export function readEnv(env) {
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (url === undefined || url === '') throw new Error('NEXT_PUBLIC_SUPABASE_URL is not defined');
  if (serviceKey === undefined || serviceKey === '') throw new Error('SUPABASE_SERVICE_ROLE_KEY is not defined');
  return { url, serviceKey };
}

export async function loadEnvFile(root) {
  const path = join(root, 'apps/web/.env');
  const values = {};
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return values;
  }
  for (const line of text.split('\n')) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (match !== null) values[match[1]] = match[2].replace(/^["']|["']$/g, '');
  }
  return values;
}

async function resolveUserIdByEmail(supabase, email) {
  let page = 1;
  for (;;) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`user lookup failed: ${error.message}`);
    const match = data.users.find((user) => (user.email ?? '').toLowerCase() === email.toLowerCase());
    if (match !== undefined) return match.id;
    if (data.users.length < 200) return null;
    page += 1;
  }
}

export async function run(argv, deps) {
  const options = parseArgs(argv);
  const { supabase, stripe, log, now = () => new Date() } = deps;

  if (options.command === 'grant') {
    const userId = await resolveUserIdByEmail(supabase, options.email);
    if (userId === null) throw new Error(`no user with email ${options.email}`);
    const until = new Date(options.until);
    const { data, error } = await supabase
      .from('user_profiles')
      .upsert({ id: userId, access_until: until.toISOString() }, { onConflict: 'id' })
      .select('id');
    if (error) throw new Error(`grant failed: ${error.message}`);
    if (data === null || data.length === 0) throw new Error(`grant failed: no profile for ${options.email}`);
    log(`granted ${options.email} access until ${until.toISOString()}`);
    return { updated: 1 };
  }

  if (options.command === 'revoke') {
    const userId = await resolveUserIdByEmail(supabase, options.email);
    if (userId === null) throw new Error(`no user with email ${options.email}`);
    const { error } = await supabase.rpc('revoke_access', { p_user_id: userId });
    if (error) throw new Error(`revoke failed: ${error.message}`);
    log(`revoked ${options.email} at ${now().toISOString()}`);
    return { updated: 1 };
  }

  let updated = 0;
  let skipped = 0;
  const nowDate = now();
  const byCustomer = new Map();
  for await (const subscription of stripe.subscriptions.list({ status: 'all', limit: 100 })) {
    const args = accessArgsOf(subscription);
    const access = effectiveAccessOf(args, nowDate);
    const current = byCustomer.get(args.customer);
    if (current === undefined) {
      byCustomer.set(args.customer, { args, access });
      continue;
    }
    if (current.args.userId === null) current.args.userId = args.userId;
    if (access > current.access) {
      if (args.userId === null) args.userId = current.args.userId;
      byCustomer.set(args.customer, { args, access });
    }
  }
  for (const { args } of byCustomer.values()) {
    const { data: link, error: linkError } = await supabase
      .from('user_billing_links')
      .select('user_id')
      .eq('stripe_customer_id', args.customer)
      .maybeSingle();
    if (linkError) throw new Error(`billing link lookup failed: ${linkError.message}`);
    if (link === null) {
      if (args.userId === null) {
        skipped += 1;
        log(`skipped ${args.subscriptionId}: no billing link and no metadata.userId`);
        continue;
      }
      const { error: linkWriteError } = await supabase.rpc('link_stripe_customer', {
        p_user_id: args.userId,
        p_customer_id: args.customer,
      });
      if (linkWriteError) throw new Error(`billing link write failed: ${linkWriteError.message}`);
    }
    const { error } = await supabase.rpc('apply_subscription_access', {
      p_customer_id: args.customer,
      p_subscription_id: args.subscriptionId,
      p_status: args.status,
      p_current_period_end: args.periodEnd,
    });
    if (error) throw new Error(`access update failed for ${args.subscriptionId}: ${error.message}`);
    updated += 1;
    log(`${args.subscriptionId} ${args.status} -> access_until ${args.periodEnd ?? 'now()'}`);
  }
  return { updated, skipped };
}

async function main() {
  const root = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..');
  const env = { ...(await loadEnvFile(root)), ...process.env };
  const { url, serviceKey } = readEnv(env);
  const { createClient } = await import('@supabase/supabase-js');

  if (process.argv[2] === 'sync') {
    const key = env.STRIPE_SECRET_KEY;
    if (key === undefined || key === '') throw new Error('STRIPE_SECRET_KEY is not defined');
    const { default: Stripe } = await import('stripe');
    const stripe = new Stripe(key);
    const result = await run(process.argv.slice(2), {
      supabase: createClient(url, serviceKey, { auth: { persistSession: false } }),
      stripe,
      log: (line) => console.log(line),
    });
    console.log(`subscriptions applied: ${result.updated}, skipped: ${result.skipped}`);
    return;
  }

  const result = await run(process.argv.slice(2), {
    supabase: createClient(url, serviceKey, { auth: { persistSession: false } }),
    log: (line) => console.log(line),
  });
  console.log(`accounts updated: ${result.updated}`);
}

if (process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
