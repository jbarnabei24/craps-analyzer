// api/validate-license.js
// ─────────────────────────
// POST { key: "CRPS-XXXX-XXXX-XXXX" }
// → { valid: true,  plan: "pro"|"lifetime" }
// → { valid: false, error: "…" }
//
// Called by the app when a user types their key into the modal.
// Env vars: SUPABASE_URL, SUPABASE_SERVICE_KEY, APP_URL

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.APP_URL || '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { key } = req.body || {};
  if (!key) return res.status(400).json({ valid: false, error: 'No key provided.' });

  try {
    const { data, error } = await supabase
      .from('licenses')
      .select('plan, expired')
      .eq('key', key.trim().toUpperCase())
      .single();

    if (error || !data) {
      // key not found in database
      return res.status(200).json({ valid: false, error: 'Key not found. Double-check and try again.' });
    }

    if (data.expired) {
      return res.status(200).json({ valid: false, error: 'This Pro subscription has been cancelled.' });
    }

    // ✓ valid — return the plan so the client knows which tier to activate
    return res.status(200).json({ valid: true, plan: data.plan });

  } catch (err) {
    console.error('[validate-license] DB error:', err);
    return res.status(500).json({ valid: false, error: 'Server error — please try again.' });
  }
};
