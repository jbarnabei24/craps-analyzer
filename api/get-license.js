// api/get-license.js
// ────────────────────
// GET ?session_id=cs_…
// → { status: "success", key: "CRPS-…", plan: "pro"|"lifetime" }
// → { status: "pending" }   (webhook hasn't fired yet — client will retry)
// → { status: "error" }
//
// Called by the app after Stripe redirects back with a session_id.
// We verify the session with Stripe (so nobody can fish for keys
// with a fake session_id), then look up the license we created in
// the webhook.
//
// Env vars: STRIPE_SECRET_KEY, SUPABASE_URL, SUPABASE_SERVICE_KEY, APP_URL

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.APP_URL || '*');

  const { session_id } = req.query;
  if (!session_id) return res.status(400).json({ status: 'error', error: 'No session_id' });

  try {
    // 1. ask Stripe to confirm this session is real & paid
    const session = await stripe.checkout.sessions.retrieve(session_id);

    if (session.payment_status !== 'paid') {
      return res.status(200).json({ status: 'pending' });   // not paid yet
    }

    // 2. look up the license by the Stripe session ID we stored in the webhook
    const { data } = await supabase
      .from('licenses')
      .select('key, plan')
      .eq('stripe_session_id', session.id)
      .single();

    if (data) {
      return res.status(200).json({ status: 'success', key: data.key, plan: data.plan });
    }

    // webhook hasn't written the row yet — tell client to poll again
    return res.status(200).json({ status: 'pending' });

  } catch (err) {
    console.error('[get-license] Error:', err.message);
    return res.status(500).json({ status: 'error' });
  }
};
