import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { getStripePriceId, isTokenPackId, TOKEN_PACKS, type TokenPackId } from '@/lib/billing';
import { applyRateLimit, RATE_LIMITS } from '@/lib/rate-limit';

//---------------
// POST /api/billing/checkout — creates a one-time Checkout Session for a pack.
// Body: { packId: 'pack_50' }. The server controls the token amount.
// Returns: { url } — redirects the user to the Stripe checkout.
//---------------

function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('STRIPE_SECRET_KEY is not defined');
  // Dynamic import so environments without Stripe do not break
  return import('stripe').then((mod) => new mod.default(key));
}

export async function POST(request: Request): Promise<NextResponse> {
  const limited = await applyRateLimit(request, RATE_LIMITS.billingCheckout);
  if (limited) return limited;

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error: sessionError,
  } = await supabase.auth.getUser();
  if (sessionError || !user) {
    return NextResponse.json(
      { success: false, error: 'Authentication required.' },
      { status: 401 },
    );
  }

  let body: { packId?: unknown };
  try {
    body = (await request.json()) as { packId?: unknown };
  } catch {
    return NextResponse.json(
      { success: false, error: 'Invalid JSON payload.' },
      { status: 400 },
    );
  }

  if (!isTokenPackId(body.packId)) {
    return NextResponse.json(
      { success: false, error: 'packId must be a valid token pack.' },
      { status: 400 },
    );
  }

  const packId: TokenPackId = body.packId;
  let stripePriceId: string;
  try {
    stripePriceId = getStripePriceId(packId);
  } catch (error) {
    console.error('[api/billing/checkout] price configuration failed', { error });
    return NextResponse.json(
      { success: false, error: 'Payment system unavailable.' },
      { status: 500 },
    );
  }

  let stripe;
  try {
    stripe = await getStripe();
  } catch (error) {
    console.error('[api/billing/checkout] stripe init failed', { error });
    return NextResponse.json(
      { success: false, error: 'Payment system unavailable.' },
      { status: 500 },
    );
  }

  // Busca ou cria o customer no Stripe
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('stripe_customer_id')
    .eq('id', user.id)
    .single();

  let customerId = profile?.stripe_customer_id ?? null;

  if (!customerId) {
    try {
      const customer = await stripe.customers.create({
        email: user.email ?? undefined,
        metadata: { userId: user.id },
      });
      customerId = customer.id;

      // Billing metadata is written server-side because the user-facing client
      // intentionally has no INSERT policy for this protected column set.
      const { error: upsertError } = await createSupabaseServiceClient()
        .from('user_profiles')
        .upsert(
          { id: user.id, stripe_customer_id: customerId },
          { onConflict: 'id' },
        );
      if (upsertError) {
        console.error('[api/billing/checkout] profile upsert failed', { error: upsertError });
        return NextResponse.json(
          { success: false, error: 'Unable to save billing profile.' },
          { status: 502 },
        );
      }
    } catch (error) {
      console.error('[api/billing/checkout] customer creation failed', { error, userId: user.id });
      return NextResponse.json(
        { success: false, error: 'Unable to start checkout.' },
        { status: 502 },
      );
    }
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!appUrl) {
    console.error('[api/billing/checkout] NEXT_PUBLIC_APP_URL is not defined');
    return NextResponse.json(
      { success: false, error: 'Payment system unavailable.' },
      { status: 500 },
    );
  }

  try {
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'payment',
      line_items: [{ price: stripePriceId, quantity: 1 }],
      automatic_tax: { enabled: true },
      billing_address_collection: 'required',
      customer_update: { address: 'auto', name: 'auto' },
      success_url: `${appUrl}/billing?checkout=success`,
      cancel_url: `${appUrl}/billing?checkout=canceled`,
      client_reference_id: user.id,
      metadata: {
        userId: user.id,
        tokenPackId: packId,
        stripePriceId,
        tokenAmount: String(TOKEN_PACKS[packId].tokens),
      },
    });

    return NextResponse.json({ success: true, url: session.url });
  } catch (error) {
    console.error('[api/billing/checkout] checkout session creation failed', { error, userId: user.id });
    return NextResponse.json(
      { success: false, error: 'Unable to start checkout.' },
      { status: 502 },
    );
  }
}
