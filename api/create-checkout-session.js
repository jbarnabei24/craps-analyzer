// api/create-checkout-session.js
// ──────────────────────────────
// POST { plan: "pro" | "lifetime" }
// → returns { url: "https://checkout.stripe.com/…" }
//
// Env vars required:
//   STRIPE_SECRET_KEY        sk_live_…
//   STRIPE_PRICE_PRO         price_…  (monthly recurring)
//   STRIPE_PRICE_LIFETIME    price_…  (one-time)
//   APP_URL                  https://yourdomain.com

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

module.exports = async function handler(req, res) {
  // ── CORS (allow your domain only) ──
  res.setHeader('Access-Control-Allow-Origin', process.env.APP_URL || '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { plan } = req.body;

  // map plan names → Stripe Price IDs (set in .env)
  const PRICES = {
    pro:      process.env.STRIPE_PRICE_PRO,
    lifetime: process.env.STRIPE_PRICE_LIFETIME
  };

  if (!PRICES[plan]) {
    return res.status(400).json({ error: 'Invalid plan.' });
  }

  try {
    const session = await stripe.checkout.sessions.create({
      mode: plan === 'lifetime' ? 'payment' : 'subscription',

      line_items: [{ price: PRICES[plan], quantity: 1 }],

      // collect email even for one-time payments so we can send the key
      customer_creation: plan === 'lifetime' ? 'always' : undefined,

      // where Stripe sends the user after checkout
      success_url: `${process.env.APP_URL}/?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:  `${process.env.APP_URL}/`,

      // store which plan was purchased — handy in the webhook
      metadata: { plan: plan }
    });

    return res.status(200).json({ url: session.url });

  } catch (err) {
    console.error('[create-checkout-session] Stripe error:', err.message);
    return res.status(500).json({ error: 'Failed to create checkout session.' });
  }
};
