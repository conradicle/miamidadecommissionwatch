// Bot protection for public forms: the browser half of api/_bot-check.js.
//
//   var guard = MDCW.botGuard.attach(form, { action: 'claim' });
//   ...on submit:
//   guard.getToken().then(function (token) {
//     fetch(..., body: JSON.stringify(Object.assign(payload, guard.fields(token))));
//     ...and after any response, success or not: guard.reset();
//   });
//
// It does three things:
//   1. Renders a Cloudflare Turnstile widget in Managed mode with
//      appearance "interaction-only", so most visitors never see anything.
//      Only a visitor Cloudflare is unsure about gets a checkbox.
//   2. Makes sure the form has the honeypot field (`website`). Pages can put
//      it in their HTML; forms in the shared footer get it injected here.
//   3. Reports how long the page has been open (performance.now(), which a
//      wrong computer clock can't skew).
//
// The site key is public. scripts/build.mjs swaps it in for the placeholder
// below from the TURNSTILE_SITE_KEY env var, the same var /attend uses.
(function () {
  var SITE_KEY = '__TURNSTILE_SITE_KEY__';
  var SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
  var HP_STYLE = 'position:absolute; left:-10000px; top:auto; width:1px; height:1px; overflow:hidden;';

  var waiting = [];
  var loading = false;

  // /attend loads the Turnstile script itself, so reuse it if it's already
  // on the page rather than loading it twice.
  function whenTurnstile(cb) {
    if (window.turnstile) { cb(); return; }
    waiting.push(cb);
    if (loading) return;
    loading = true;

    var existing = document.querySelector('script[src^="https://challenges.cloudflare.com/turnstile/"]');
    if (existing) {
      var tries = 0;
      var poll = setInterval(function () {
        if (window.turnstile || ++tries > 100) { clearInterval(poll); flush(); }
      }, 100);
      return;
    }
    var s = document.createElement('script');
    s.src = SCRIPT_SRC;
    s.async = true;
    s.onload = flush;
    s.onerror = flush;
    document.head.appendChild(s);
  }

  function flush() {
    var cbs = waiting;
    waiting = [];
    cbs.forEach(function (cb) { cb(); });
  }

  function ensureHoneypot(form) {
    if (form.querySelector('input[name="website"]')) return;
    var id = (form.id || 'form') + '-website';
    var wrap = document.createElement('div');
    wrap.className = 'hp-field';
    wrap.setAttribute('aria-hidden', 'true');
    // Off screen, not display:none: some bots skip fields that are hidden
    // outright. Inline so style.css doesn't need a version bump on every page.
    wrap.style.cssText = HP_STYLE;
    wrap.innerHTML = '<label for="' + id + '">Website</label>' +
      '<input type="text" id="' + id + '" name="website" tabindex="-1" autocomplete="off">';
    form.appendChild(wrap);
  }

  function attach(form, opts) {
    opts = opts || {};
    // Sign-in forms pass honeypot: false; Supabase only reads the token.
    if (opts.honeypot !== false) ensureHoneypot(form);

    var container = opts.container;
    if (!container) {
      container = document.createElement('div');
      container.className = 'bot-guard-widget';
      form.parentNode.insertBefore(container, form.nextSibling);
    }

    var widgetId = null;
    var token = '';
    var pending = [];
    var started = false;

    function settle(value) {
      var list = pending;
      pending = [];
      list.forEach(function (resolve) { resolve(value); });
    }

    function start() {
      if (started) return;
      started = true;
      if (!SITE_KEY || SITE_KEY.indexOf('__') === 0) { settle(''); return; }
      whenTurnstile(function () {
        if (!window.turnstile) { settle(''); return; }
        widgetId = window.turnstile.render(container, {
          sitekey: SITE_KEY,
          action: opts.action || undefined,
          appearance: 'interaction-only',
          callback: function (t) { token = t; settle(t); },
          'expired-callback': function () { token = ''; },
          'error-callback': function () { token = ''; settle(''); }
        });
      });
    }

    // Forms in the footer of every page start the widget on first touch
    // rather than loading Cloudflare's script for every visitor.
    if (opts.lazy) {
      form.addEventListener('focusin', start, { once: true });
      form.addEventListener('pointerdown', start, { once: true });
    } else {
      start();
    }

    return {
      // Resolves with a token, or '' if none arrived in 20 seconds. The
      // server turns '' away; the form shows its usual "try again".
      getToken: function () {
        start();
        if (token) return Promise.resolve(token);
        return new Promise(function (resolve) {
          pending.push(resolve);
          setTimeout(function () { resolve(token); }, 20000);
        });
      },
      fields: function (t) {
        var hp = form.querySelector('input[name="website"]');
        return {
          website: hp ? hp.value : '',
          form_elapsed_ms: Math.round(window.performance ? performance.now() : 0),
          turnstile_token: t || token
        };
      },
      // Tokens are single use. Call after every submit, whatever happened.
      reset: function () {
        token = '';
        if (widgetId !== null && window.turnstile) window.turnstile.reset(widgetId);
      }
    };
  }

  window.MDCW = window.MDCW || {};
  window.MDCW.botGuard = { attach: attach };
})();
