// api/stripe-webhook.js
// ──────────────────────
// Stripe sends POST here after every payment event.
// We listen for:
//   checkout.session.completed          → create + store license key
//   customer.subscription.deleted       → mark pro license expired
//
// Env vars required:
//   STRIPE_SECRET_KEY          sk_live_…
//   STRIPE_WEBHOOK_SECRET      whsec_…  (from Stripe Dashboard → Developers → Webhooks)
//   SUPABASE_URL               https://…supabase.co
//   SUPABASE_SERVICE_KEY       eyJ…
//   RESEND_API_KEY             re_…     (optional — for emailing the key)
//   APP_NAME                   Crapless Craps Analyzer

// ── disable Vercel's default body parser so we can read raw bytes
//    (Stripe signature verification needs the exact raw payload)
export const config = { api: { bodyParser: false } };

const stripe     = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// ── generate a human-friendly license key  e.g. CRPS-A3K7-X9M2-Q4NB
function generateKey() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I, O, 0, 1 to avoid confusion
  function seg() {
    let s = '';
    for (let i = 0; i < 4; i++) s += chars[Math.floor(Math.random() * chars.length)];
    return s;
  }
  return 'CRPS-' + seg() + '-' + seg() + '-' + seg();
}

// ── optional: send the key via email using Resend
async function sendKeyEmail(email, key, plan) {
  if (!process.env.RESEND_API_KEY || !email) return;

  const { Resend } = require('resend');
  const resend = new Resend(process.env.RESEND_API_KEY);

  const planLabel = plan === 'lifetime' ? 'Lifetime' : 'Pro';

  await resend.emails.send({
    from:    `noreply@${new URL(process.env.APP_URL).hostname}`,
    to:      [email],
    subject: `Your ${process.env.APP_NAME || 'Crapless Craps Analyzer'} License Key`,
    html: `
      <div style="font-family:sans-serif;max-width:500px;margin:0 auto;padding:32px 24px;background:#0a1f1a;border-radius:16px;color:#d1fae5;">
        <h2 style="color:#fbbf24;text-align:center;margin-top:0;">🎲 ${process.env.APP_NAME || 'Crapless Craps Analyzer'}</h2>
        <p style="text-align:center;font-size:15px;">Thanks for upgrading to <strong style="color:#86efac;">${planLabel}</strong>!</p>
        <div style="background:rgba(16,185,129,.15);border:2px solid #10b981;border-radius:12px;padding:20px;text-align:center;margin:24px 0;">
          <div style="font-size:11px;color:#86efac;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">Your License Key</div>
          <div style="font-size:24px;font-weight:800;color:#fff;letter-spacing:3px;font-family:monospace;">${key}</div>
        </div>
        <p style="font-size:13px;color:#d1fae5;text-align:center;">
          Open the app, tap <strong style="color:#fbbf24;">Upgrade</strong>, then scroll down to
          <em>"Already purchased? Enter your license key"</em> and paste it in.
        </p>
        <p style="font-size:12px;color:#6b7280;text-align:center;margin-top:32px;">
          If you have any issues, just reply to this email.
        </p>
      </div>
    `
  });
}

// ── read raw body from the request stream
function rawBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data',  chunk => body += chunk);
    req.on('end',   ()    => resolve(body));
    req.on('error', reject);
  });
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const raw = await rawBody(req);
  const sig = req.headers['stripe-signature'];

  // ── verify the signature so no one can fake a webhook call
  let event;
  try {
    event = stripe.webhooks.constructEvent(raw, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('[webhook] Signature verification failed:', err.message);
    return res.status(400).json({ error: 'Bad signature' });
  }

  // ── handle events ──────────────────────────────────────
  try {

    // 1. Payment completed → create license
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;

      if (session.payment_status === 'paid') {
        const plan  = session.metadata?.plan || (session.mode === 'subscription' ? 'pro' : 'lifetime');
        const email = session.customer_details?.email;
        const key   = generateKey();

        // persist to Supabase
        const { error } = await supabase.from('licenses').insert({
          key:                      key,
          plan:                     plan,
          email:                    email,
          stripe_customer_id:       session.customer,
          stripe_payment_intent:    session.payment_intent,
          stripe_subscription_id:   session.subscription || null,
          stripe_session_id:        session.id
        });

        if (error) {
          console.error('[webhook] Supabase insert error:', error);
          // still return 200 so Stripe doesn't retry — we can recover manually
        }

        // send the key via email
        await sendKeyEmail(email, key, plan);

        console.log(`[webhook] License created: ${key} | plan=${plan} | email=${email}`);
      }
    }

    // 2. Subscription cancelled → mark expired
    if (event.type === 'customer.subscription.deleted') {
      const sub = event.data.object;
      await supabase
        .from('licenses')
        .update({ expired: true })
        .eq('stripe_subscription_id', sub.id);

      console.log(`[webhook] Subscription ${sub.id} cancelled — license expired`);
    }

  } catch (err) {
    console.error('[webhook] Handler error:', err);
    // return 200 anyway — Stripe will log it but won't spam retries
  }

  return res.status(200).json({ received: true });
};
