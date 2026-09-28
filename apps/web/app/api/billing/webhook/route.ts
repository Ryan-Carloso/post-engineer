import { NextResponse } from 'next/server';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { getStripePriceId, isTokenPackId, TOKEN_PACKS, type TokenPackId } from '@/lib/billing';
import { logger } from '@/lib/logger';

function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('STRIPE_SECRET_KEY is not defined');
  return import('stripe').then((mod) => new mod.default(key));
}

export async function POST(request: Request): Promise<NextResponse> {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    logger.error('[api/billing/webhook] STRIPE_WEBHOOK_SECRET is not defined');
    return NextResponse.json({ success: false, error: 'Webhook not configured.' }, { status: 500 });
  }

  const signature = request.headers.get('stripe-signature');
  if (!signature) {
    return NextResponse.json({ success: false, error: 'Missing stripe-signature header.' }, { status: 400 });
  }

  let stripe;
  try {
    stripe = await getStripe();
  } catch (error) {
    logger.error('[api/billing/webhook] stripe init failed', error);
    return NextResponse.json({ success: false, error: 'Payment system unavailable.' }, { status: 500 });
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(await request.text(), signature, webhookSecret);
  } catch (error) {
    logger.error('[api/billing/webhook] signature verification failed', error);
    return NextResponse.json({ success: false, error: 'Invalid signature.' }, { status: 400 });
  }

  const supabase = createSupabaseServiceClient();
  const { data: recordedEvent, error: eventError } = await supabase
    .from('stripe_webhook_events')
    .upsert(
      { event_id: event.id, event_type: event.type },
      { onConflict: 'event_id', ignoreDuplicates: true },
    )
    .select('event_id')
    .maybeSingle();

  if (eventError) {
    logger.error('[api/billing/webhook] event persistence failed', eventError, { eventId: event.id });
    return NextResponse.json({ success: false, error: 'Webhook persistence failed.' }, { status: 500 });
  }
  if (!recordedEvent) return NextResponse.json({ success: true, duplicate: true });

  try {
    if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
      await fulfillCheckout(supabase, event.data.object);
    }
  } catch (error) {
    if (isPermanentFulfillmentError(error)) {
      logger.error('[api/billing/webhook] permanent fulfillment rejection', error, { eventId: event.id });
      return NextResponse.json({ success: true, ignored: true });
    }
    const { error: deleteError } = await supabase.from('stripe_webhook_events').delete().eq('event_id', event.id);
    if (deleteError) {
      logger.error('[api/billing/webhook] failed to release event for retry', deleteError, { eventId: event.id });
    }
    logger.error('[api/billing/webhook] fulfillment failed', error, { eventId: event.id });
    return NextResponse.json({ success: false, error: 'Webhook handler failed.' }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}

function isPermanentFulfillmentError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.message === 'Paid Checkout Session is missing valid token pack metadata';
}

async function fulfillCheckout(
  supabase: ReturnType<typeof createSupabaseServiceClient>,
  session: {
    id: string;
    mode?: string | null;
    payment_status?: string | null;
    customer?: string | { id: string } | null;
    payment_intent?: string | { id: string } | null;
    client_reference_id?: string | null;
    metadata?: Record<string, string> | null;
  },
): Promise<void> {
  if (session.mode !== 'payment' || session.payment_status !== 'paid') return;

  const metadata = session.metadata;
  const userId = metadata?.userId ?? session.client_reference_id;
  const packValue = metadata?.tokenPackId;
  if (!userId || !isTokenPackId(packValue)) {
    throw new Error('Paid Checkout Session is missing valid token pack metadata');
  }

  const packId: TokenPackId = packValue;
  const configuredPriceId = getStripePriceId(packId);
  if (metadata?.stripePriceId !== configuredPriceId) {
    logger.warn('[api/billing/webhook] checkout price configuration changed; using validated pack ID', {
      sessionId: session.id,
      packId,
      configuredPriceId,
      sessionPriceId: metadata?.stripePriceId,
    });
  }

  const paymentIntentId = typeof session.payment_intent === 'string'
    ? session.payment_intent
    : session.payment_intent?.id ?? null;

  const { error } = await supabase.rpc('credit_tokens_for_payment', {
    p_user_id: userId,
    p_amount: TOKEN_PACKS[packId].tokens,
    p_pack_id: packId,
    p_checkout_session_id: session.id,
    p_payment_intent_id: paymentIntentId,
  });

  if (error) {
    logger.error('[api/billing/webhook] token credit failed', error, { userId, sessionId: session.id });
    throw error;
  }
}
