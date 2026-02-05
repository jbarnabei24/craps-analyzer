// ============================================================
//  PAYWALL ENGINE  —  Crapless Craps Analyzer
//  Version 2.0  —  Full-access free tier, sim-count gate only
// ============================================================
//
//  FREE TIER
//    • Every feature works: all strategies, Roll Analyzer,
//      Reverse Calculator, guides — everything.
//    • 3 simulation runs total.  After that the modal fires.
//
//  PRO  ($9.99 / month)
//    • Unlimited simulation runs.
//
//  LIFETIME  ($49 one-time)
//    • Same as Pro, forever, no recurring charge.
//
//  Payment flow:
//    1. User clicks "Go Pro" or "Get Lifetime"
//    2. We POST to /api/create-checkout-session  →  get a Stripe URL
//    3. User completes Stripe Checkout
//    4. Stripe webhook fires  →  license key created & emailed
//    5. Success URL brings user back with ?session_id=…
//    6. We poll /api/get-license until the key appears
//    7. Key is stored in localStorage; tier is activated
//    8. User can also manually enter their key at any time
// ============================================================

(function CrapsPaywall() {
  'use strict';

  /* ── tunables ──────────────────────────────────────────── */
  var FREE_SIM_LIMIT = 3;

  /* ── localStorage keys ────────────────────────────────── */
  var K_TIER = 'craps_tier';            // "free" | "pro" | "lifetime"
  var K_RUNS = 'craps_free_runs';       // number
  var K_KEY  = 'craps_license_key';     // the activated key string

  /* ── helpers ───────────────────────────────────────────── */
  function getTier()     { return localStorage.getItem(K_TIER) || 'free'; }
  function getRuns()     { return parseInt(localStorage.getItem(K_RUNS), 10) || 0; }
  function setRuns(n)    { localStorage.setItem(K_RUNS, String(n)); }
  function isPaid()      { return getTier() === 'pro' || getTier() === 'lifetime'; }

  /* ── public API (attached to window) ───────────────────── */
  window.CrapsPaywall = {

    // ── called once per "Run Simulations" tap ──────────────
    attemptSimulation: function () {
      if (isPaid()) return true;                      // paid → always go

      var used = getRuns();
      if (used < FREE_SIM_LIMIT) {
        setRuns(used + 1);
        refreshBadge();
        return true;                                 // still within quota
      }

      showModal();                                   // quota hit → show paywall
      return false;
    },

    // ── activate a tier in the browser (called after key
    //    validation or success-page confirmation) ──────────
    activateTier: function (tier) {
      localStorage.setItem(K_TIER, tier);
      hideModal();
      hideSuccess();
      refreshBadge();
      toast('🎉 ' + (tier === 'lifetime' ? 'Lifetime' : 'Pro') +
            ' activated — unlimited simulations unlocked.');
    },

    // ── validate a license key the user typed in ──────────
    activateByKey: async function (raw) {
      var key = (raw || '').trim().toUpperCase();
      if (!key) return;

      btnState('pw-key-submit', true, 'Validating…');
      keyError('');                                  // clear previous error

      try {
        var res  = await fetch('/api/validate-license', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ key: key })
        });
        var data = await res.json();

        if (data.valid) {
          localStorage.setItem(K_KEY,  key);
          localStorage.setItem(K_TIER, data.plan);
          btnState('pw-key-submit', false, 'Activate');
          CrapsPaywall.activateTier(data.plan);
        } else {
          btnState('pw-key-submit', false, 'Activate');
          keyError(data.error || 'Invalid or already-used key.');
        }
      } catch (e) {
        btnState('pw-key-submit', false, 'Activate');
        keyError('Network error — please check your connection and retry.');
      }
    },

    // ── kick off Stripe Checkout ───────────────────────────
    initiatePayment: async function (plan) {
      var btnId  = 'pw-' + plan + '-btn';
      var orig   = document.getElementById(btnId).textContent;
      btnState(btnId, true, 'Loading…');

      try {
        var res  = await fetch('/api/create-checkout-session', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ plan: plan })
        });
        var data = await res.json();

        if (data.url) {
          window.location.href = data.url;           // leave the page
        } else {
          throw new Error(data.error || 'no url');
        }
      } catch (e) {
        btnState(btnId, false, orig);
        toast('⚠️ Checkout failed to load — please try again.');
      }
    },

    // ── called on page-load; detects ?session_id= and polls
    //    until the webhook-created license key is ready ─────
    checkSuccessRedirect: async function () {
      var params    = new URLSearchParams(window.location.search);
      var sessionId = params.get('session_id');
      if (!sessionId) return;

      // scrub the URL immediately so a refresh doesn't re-trigger
      history.replaceState({}, '', window.location.pathname);

      showSuccess('loading');                        // spinner state

      var attempts = 0, max = 12;                    // poll up to ~24 s
      var poller   = setInterval(async function () {
        attempts++;
        try {
          var res  = await fetch('/api/get-license?session_id=' + sessionId);
          var data = await res.json();

          if (data.status === 'success') {
            clearInterval(poller);
            localStorage.setItem(K_KEY,  data.key);
            localStorage.setItem(K_TIER, data.plan);
            showSuccess('done', data.key, data.plan);
            return;
          }
        } catch (e) { /* keep polling */ }

        if (attempts >= max) {
          clearInterval(poller);
          showSuccess('error');
        }
      }, 2000);
    }
  };

  /* ── badge: "X free sims left" above the Run button ─── */
  function refreshBadge() {
    var el = document.getElementById('free-runs-badge');
    if (!el) return;
    if (isPaid()) { el.style.display = 'none'; return; }

    var left = Math.max(0, FREE_SIM_LIMIT - getRuns());
    el.style.display = 'block';
    el.innerHTML =
      '<span style="color:#fbbf24;font-weight:700;">' + left +
      ' free simulation' + (left !== 1 ? 's' : '') + ' remaining</span>' +
      ' &nbsp;·&nbsp; ' +
      '<a href="#" id="upgrade-badge-link" style="color:#86efac;text-decoration:underline;' +
      'cursor:pointer;font-weight:600;">Upgrade for unlimited</a>';

    // re-bind click (innerHTML wipes old listener)
    requestAnimationFrame(function () {
      var a = document.getElementById('upgrade-badge-link');
      if (a) a.addEventListener('click', function (e) { e.preventDefault(); showModal(); });
    });
  }

  /* ── modal: the two-plan paywall ──────────────────────── */
  function showModal()  { document.getElementById('paywall-modal-overlay').style.display = 'flex'; hideSuccess(); }
  function hideModal()  { document.getElementById('paywall-modal-overlay').style.display = 'none'; }

  /* ── success screen (replaces modal content after pay) ── */
  function showSuccess(state, key, plan) {
    var overlay = document.getElementById('paywall-modal-overlay');
    var plans   = document.getElementById('pw-plans-section');
    var keyIn   = document.getElementById('pw-key-input-section');
    var success = document.getElementById('pw-success-section');

    overlay.style.display = 'flex';
    plans.style.display   = 'none';
    keyIn.style.display   = 'none';
    success.style.display = 'block';

    if (state === 'loading') {
      success.innerHTML =
        '<div class="pw-icon">⏳</div>' +
        '<div class="pw-headline">Completing your purchase…</div>' +
        '<div class="pw-sub">Hang tight while we set everything up.</div>' +
        '<div class="pw-spinner"></div>';

    } else if (state === 'done') {
      success.innerHTML =
        '<div class="pw-icon">🎉</div>' +
        '<div class="pw-headline">You\'re all set!</div>' +
        '<div class="pw-sub">' + (plan === 'lifetime' ? 'Lifetime' : 'Pro') + ' access is active.</div>' +
        '<div class="pw-key-box">' +
          '<div class="pw-key-label">YOUR LICENSE KEY</div>' +
          '<div class="pw-key-value">' + key + '</div>' +
          '<div class="pw-key-note">Save this — you can activate it on any device at any time.</div>' +
        '</div>' +
        '<button id="pw-done-btn" class="pw-btn-green">Start Using ' + (plan === 'lifetime' ? 'Lifetime' : 'Pro') + ' →</button>';

      requestAnimationFrame(function () {
        document.getElementById('pw-done-btn').addEventListener('click', function () {
          CrapsPaywall.activateTier(plan);
        });
      });

    } else if (state === 'error') {
      success.innerHTML =
        '<div class="pw-icon">⚠️</div>' +
        '<div class="pw-headline" style="color:#fca5a5;">Oops — key not ready yet</div>' +
        '<div class="pw-sub">Your payment went through but the key is delayed. ' +
          'Email us and we\'ll sort it out in minutes.</div>' +
        '<button id="pw-email-btn" class="pw-btn-blue">Email Support</button>';

      requestAnimationFrame(function () {
        document.getElementById('pw-email-btn').addEventListener('click', function () {
          window.open('mailto:support@crapsanalyzer.com?subject=License+key+not+received', '_blank');
        });
      });
    }
  }

  function hideSuccess() {
    var s = document.getElementById('pw-success-section');
    var p = document.getElementById('pw-plans-section');
    var k = document.getElementById('pw-key-input-section');
    if (s) s.style.display = 'none';
    if (p) p.style.display = 'block';
    if (k) k.style.display = 'block';
  }

  /* ── small helpers ─────────────────────────────────────── */
  function btnState(id, disabled, label) {
    var b = document.getElementById(id);
    if (!b) return;
    b.disabled     = disabled;
    b.textContent  = label;
  }

  function keyError(msg) {
    var el = document.getElementById('pw-key-error');
    if (!el) return;
    el.style.display = msg ? 'block' : 'none';
    el.textContent   = msg;
  }

  function toast(msg) {
    var t = document.getElementById('paywall-toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'paywall-toast';
      document.body.appendChild(t);
    }
    t.textContent  = msg;
    t.style.display = 'block';
    setTimeout(function () { t.style.display = 'none'; }, 4200);
  }

  /* ── bootstrap: inject CSS + modal HTML on DOM ready ──── */
  document.addEventListener('DOMContentLoaded', function () {

    /* styles */
    var css = document.createElement('style');
    css.textContent = [
      /* overlay */
      '#paywall-modal-overlay{display:none;position:fixed;inset:0;z-index:99998;',
        'background:rgba(0,0,0,.76);justify-content:center;align-items:center;padding:16px;}',

      /* card */
      '#paywall-modal{background:linear-gradient(135deg,#0f2a1e,#0a1f1a);border:3px solid #fbbf24;',
        'border-radius:20px;max-width:460px;width:100%;padding:32px 24px 28px;',
        'box-shadow:0 24px 64px rgba(0,0,0,.6),0 0 40px rgba(251,191,36,.25);',
        'text-align:center;position:relative;max-height:90vh;overflow-y:auto;}',

      /* close btn */
      '.pw-close{position:absolute;top:12px;right:16px;background:none;border:none;',
        'color:#86efac;font-size:22px;cursor:pointer;width:auto;padding:4px 8px;box-shadow:none;}',
      '.pw-close:active,.pw-close:hover{transform:none;background:none;box-shadow:none;}',

      /* text */
      '.pw-icon{font-size:44px;margin-bottom:10px;}',
      '.pw-headline{font-size:20px;font-weight:800;color:#fde68a;margin-bottom:8px;}',
      '.pw-sub{font-size:14px;color:#d1fae5;line-height:1.6;margin-bottom:20px;}',

      /* plan grid */
      '.pw-plans{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px;}',
      '.pw-plan{background:rgba(6,78,59,.45);border:2px solid #10b981;border-radius:14px;padding:18px 12px;}',
      '.pw-plan.featured{border-color:#fbbf24;background:rgba(217,119,6,.2);}',
      '.pw-badge{display:inline-block;background:#fbbf24;color:#000;font-size:10px;font-weight:800;',
        'padding:3px 10px;border-radius:20px;letter-spacing:.5px;margin-bottom:8px;text-transform:uppercase;}',
      '.pw-plan-name{font-size:15px;font-weight:700;color:#86efac;margin-bottom:4px;}',
      '.pw-plan-price{font-size:28px;font-weight:900;color:#fde68a;}',
      '.pw-plan-price span{font-size:13px;color:#d1fae5;font-weight:400;}',
      '.pw-plan-desc{font-size:12px;color:#d1fae5;margin:8px 0 14px;line-height:1.5;}',

      /* plan buttons */
      '.pw-plan button{width:100%;padding:10px;font-size:14px;border-radius:8px;',
        'background:linear-gradient(135deg,#10b981,#059669);color:#fff;font-weight:700;',
        'border:none;cursor:pointer;box-shadow:none;letter-spacing:.3px;}',
      '.pw-plan button:disabled{opacity:.55;cursor:not-allowed;}',
      '.pw-plan button:active{transform:scale(.96);}',
      '.pw-plan.featured button{background:linear-gradient(135deg,#fbbf24,#f59e0b);color:#000;}',

      /* divider */
      '.pw-divider{color:#4ade80;font-size:12px;margin:14px 0;opacity:.7;}',

      /* key input row */
      '.pw-key-row{display:flex;gap:8px;margin-top:8px;}',
      '.pw-key-row input{flex:1;padding:10px 12px;background:rgba(6,78,59,.6);border:2px solid #10b981;',
        'border-radius:8px;color:#fff;font-size:15px;font-family:monospace;letter-spacing:2px;',
        'text-transform:uppercase;}',
      '.pw-key-row input:focus{outline:none;border-color:#34d399;}',
      '.pw-key-row input::placeholder{color:#5a6a60;letter-spacing:0;text-transform:none;font-family:inherit;}',
      '.pw-key-row button{padding:10px 18px;background:linear-gradient(135deg,#10b981,#059669);color:#fff;',
        'border:none;border-radius:8px;font-weight:700;font-size:13px;cursor:pointer;box-shadow:none;width:auto;}',
      '.pw-key-row button:disabled{opacity:.55;}',
      '#pw-key-error{color:#fca5a5;font-size:12px;margin-top:6px;display:none;text-align:left;}',

      /* success key display */
      '.pw-key-box{background:rgba(16,185,129,.12);border:2px solid #10b981;border-radius:12px;',
        'padding:18px;margin:16px 0;}',
      '.pw-key-label{font-size:10px;color:#86efac;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;}',
      '.pw-key-value{font-size:22px;font-weight:800;color:#fff;letter-spacing:3px;font-family:monospace;}',
      '.pw-key-note{font-size:11px;color:#d1fae5;margin-top:8px;}',

      /* generic buttons in success screen */
      '.pw-btn-green{width:100%;padding:12px;background:linear-gradient(135deg,#10b981,#059669);color:#fff;',
        'font-weight:700;font-size:15px;border:none;border-radius:8px;cursor:pointer;box-shadow:none;}',
      '.pw-btn-green:active{transform:scale(.96);}',
      '.pw-btn-blue{width:100%;padding:10px;background:linear-gradient(135deg,#3b82f6,#2563eb);color:#fff;',
        'font-weight:700;font-size:14px;border:none;border-radius:8px;cursor:pointer;box-shadow:none;}',

      /* spinner inside success screen */
      '.pw-spinner{width:40px;height:40px;border:4px solid rgba(251,191,36,.3);border-top-color:#fbbf24;',
        'border-radius:50%;animation:pw-spin 1s linear infinite;margin:20px auto 0;}',
      '@keyframes pw-spin{to{transform:rotate(360deg);}}',

      /* free-runs badge */
      '#free-runs-badge{text-align:center;font-size:13px;color:#d1fae5;margin-bottom:10px;padding:8px 14px;',
        'background:rgba(251,191,36,.1);border:1px solid rgba(251,191,36,.35);border-radius:8px;}',

      /* toast */
      '#paywall-toast{display:none;position:fixed;top:20px;left:50%;transform:translateX(-50%);z-index:99999;',
        'background:linear-gradient(135deg,#065f46,#047857);border:2px solid #10b981;border-radius:12px;',
        'padding:14px 28px;color:#d1fae5;font-size:15px;font-weight:600;',
        'box-shadow:0 8px 32px rgba(0,0,0,.5);max-width:90vw;text-align:center;}'
    ].join('');
    document.head.appendChild(css);

    /* modal HTML */
    document.body.insertAdjacentHTML('beforeend', [
      '<div id="paywall-modal-overlay">',
        '<div id="paywall-modal">',
          '<button class="pw-close" id="pw-close-btn">✕</button>',

          '<!-- plans + key input (default view) -->',
          '<div id="pw-plans-section">',
            '<div class="pw-icon">🎲</div>',
            '<div class="pw-headline">You\'ve used your 3 free simulations</div>',
            '<div class="pw-sub">Pick a plan to unlock unlimited runs — every strategy and tool stays active.</div>',
            '<div class="pw-plans">',
              '<div class="pw-plan">',
                '<div class="pw-plan-name">Pro</div>',
                '<div class="pw-plan-price">$9.99<span>/mo</span></div>',
                '<div class="pw-plan-desc">Unlimited sims · All strategies · Roll Analyzer · Reverse Calc · Cancel anytime</div>',
                '<button id="pw-pro-btn">Go Pro</button>',
              '</div>',
              '<div class="pw-plan featured">',
                '<div class="pw-badge">Best Value</div>',
                '<div class="pw-plan-name">Lifetime</div>',
                '<div class="pw-plan-price">$49<span> once</span></div>',
                '<div class="pw-plan-desc">Everything in Pro · Pay once · All future updates forever</div>',
                '<button id="pw-lifetime-btn">Get Lifetime</button>',
              '</div>',
            '</div>',
            '<div style="font-size:11px;color:#86efac;opacity:.6;">Secure checkout via Stripe · Cancel Pro anytime</div>',
          '</div>',

          '<!-- license key entry -->',
          '<div id="pw-key-input-section">',
            '<div class="pw-divider">— or enter a license key —</div>',
            '<div style="font-size:13px;color:#d1fae5;margin-bottom:6px;">Already purchased?</div>',
            '<div class="pw-key-row">',
              '<input type="text" id="pw-key-input" placeholder="XXXX-XXXX-XXXX-XXXX" autocomplete="off">',
              '<button id="pw-key-submit">Activate</button>',
            '</div>',
            '<div id="pw-key-error"></div>',
          '</div>',

          '<!-- success / loading / error screen (hidden until payment completes) -->',
          '<div id="pw-success-section" style="display:none;"></div>',
        '</div>',
      '</div>'
    ].join(''));

    /* badge: inject right before the Run button */
    var runBtn = document.getElementById('runSimBtn');
    if (runBtn && runBtn.parentNode) {
      var badge = document.createElement('div');
      badge.id = 'free-runs-badge';
      runBtn.parentNode.insertBefore(badge, runBtn);
    }

    /* button listeners */
    document.getElementById('pw-close-btn').addEventListener('click', function () { hideModal(); hideSuccess(); });
    document.getElementById('paywall-modal-overlay').addEventListener('click', function (e) {
      if (e.target === e.currentTarget) { hideModal(); hideSuccess(); }
    });
    document.getElementById('pw-pro-btn').addEventListener('click', function () { window.CrapsPaywall.initiatePayment('pro'); });
    document.getElementById('pw-lifetime-btn').addEventListener('click', function () { window.CrapsPaywall.initiatePayment('lifetime'); });
    document.getElementById('pw-key-submit').addEventListener('click', function () {
      window.CrapsPaywall.activateByKey(document.getElementById('pw-key-input').value);
    });
    document.getElementById('pw-key-input').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') window.CrapsPaywall.activateByKey(this.value);
    });

    /* initial render */
    refreshBadge();

    /* detect Stripe success redirect */
    CrapsPaywall.checkSuccessRedirect();
  });

})(); // end CrapsPaywall
