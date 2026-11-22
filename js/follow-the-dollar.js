// Follow the Dollar: route one dollar from a revenue source, through a fund,
// to the department that delivers what Sunny asks for.
//
// All game data lives in /games/follow-the-dollar/data.json. A route is legal
// when the data has a source -> fund edge, a fund -> department edge, and the
// department is the one that runs the destination. Nothing here talks to
// Supabase or any other network service.
(function () {
  'use strict';

  var DATA_URL = '/games/follow-the-dollar/data.json?v=20261122b';
  var GAME_URL = 'https://www.miamidadecommissionwatch.com/games/follow-the-dollar';
  var ROUNDS = 5;
  var MAX_BONUS = 30;
  var REVEAL_AFTER = 3;
  var STEP_MS = 480;

  var root = document.getElementById('ftd');
  if (!root) return;

  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var data, byId = {}, edgeSet = {};
  var state = null;

  // ---------- small helpers ----------
  function $(sel, el) { return (el || root).querySelector(sel); }
  function h(tag, attrs, kids) {
    var el = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'text') el.textContent = attrs[k];
      else if (k === 'class') el.className = attrs[k];
      else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), attrs[k]);
      else el.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (c) { if (c) el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return el;
  }
  function wait(ms) { return new Promise(function (r) { setTimeout(r, reduceMotion ? 0 : ms); }); }
  function store(key, value) {
    try {
      if (value === undefined) return JSON.parse(localStorage.getItem(key) || 'null');
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) { return null; }
  }
  function todayKey() {
    try { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date()); }
    catch (e) { return new Date().toISOString().slice(0, 10); }
  }
  function prettyDate(key) {
    var p = key.split('-');
    return new Date(+p[0], +p[1] - 1, +p[2]).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }
  function money(millions) {
    if (millions < 1) return '$' + (millions * 1000).toFixed(0) + ' thousand';
    if (millions >= 1000) return '$' + (millions / 1000).toFixed(millions % 1000 === 0 ? 0 : 2).replace(/0$/, '') + ' billion';
    return '$' + Math.round(millions).toLocaleString('en-US') + ' million';
  }

  // Seeded random so everyone gets the same daily five.
  function hash(str) {
    var x = 2166136261;
    for (var i = 0; i < str.length; i++) { x ^= str.charCodeAt(i); x = Math.imul(x, 16777619); }
    return x >>> 0;
  }
  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function pickRounds(rand) {
    var list = data.destinations.slice();
    for (var i = list.length - 1; i > 0; i--) {
      var j = Math.floor(rand() * (i + 1));
      var t = list[i]; list[i] = list[j]; list[j] = t;
    }
    var seen = {}, out = [];
    for (var k = 0; k < list.length && out.length < ROUNDS; k++) {
      if (seen[list[k].department]) continue;
      seen[list[k].department] = true;
      out.push(list[k]);
    }
    return out;
  }

  // ---------- rules ----------
  function hasEdge(from, to) { return !!edgeSet[from + '>' + to]; }
  function check(route, dest) {
    if (!hasEdge(route.source, route.fund)) return { ok: false, at: 1, msg: byId[route.source].restriction };
    if (!hasEdge(route.fund, route.department)) {
      return { ok: false, at: 2, msg: byId[route.fund].restriction.replace('{dept}', byId[route.department].name) };
    }
    if (route.department !== dest.department) {
      return { ok: false, at: 3, msg: byId[route.department].name + ' does not handle ' + dest.label + '.' };
    }
    // Some destinations are paid for by one particular fund even though the
    // department gets money from several (e.g. garbage routes run on fees).
    if (dest.onlyFunds && dest.onlyFunds.indexOf(route.fund) < 0) return { ok: false, at: 2, msg: dest.fundNote };
    return { ok: true };
  }
  function legalRoute(dest) {
    var fe = data.edges.filter(function (e) {
      return e.type === 'fund-department' && e.to === dest.department && (!dest.onlyFunds || dest.onlyFunds.indexOf(e.from) >= 0);
    }).sort(function (a, b) { return b.amount - a.amount; })[0];
    var se = data.edges.filter(function (e) { return e.type === 'source-fund' && e.to === fe.from; })
      .sort(function (a, b) { return b.amount - a.amount; })[0];
    return { source: se.from, fund: fe.from, department: dest.department };
  }

  // How each source's money ends up split across departments, assuming the
  // source pays for the same share of everything its fund spends. Whatever
  // the fund spends outside the departments in this game (debt service,
  // reserves, other departments) shows as one "other uses" row.
  var OTHER = '__other';
  function sourceSplit(sourceId) {
    var out = {}, total = 0;
    data.edges.forEach(function (sf) {
      if (sf.type !== 'source-fund' || sf.from !== sourceId) return;
      total += sf.amount;
      var fund = byId[sf.to];
      var outs = data.edges.filter(function (e) { return e.type === 'fund-department' && e.from === sf.to; });
      var spent = outs.reduce(function (s, e) { return s + e.amount; }, 0);
      var fundTotal = Math.max(fund.total || 0, spent) || 1;
      outs.forEach(function (fd) { out[fd.to] = (out[fd.to] || 0) + sf.amount * fd.amount / fundTotal; });
      var rest = sf.amount * (fundTotal - spent) / fundTotal;
      if (rest > 0.05) out[OTHER] = (out[OTHER] || 0) + rest;
    });
    var rows = Object.keys(out).map(function (d) { return { id: d, amount: out[d] }; })
      .sort(function (a, b) { return (a.id === OTHER) - (b.id === OTHER) || b.amount - a.amount; });
    return { total: total, rows: rows };
  }
  function splitLabel(id) { return id === OTHER ? 'Other uses (debt, reserves, other departments)' : byId[id].name; }

  // ---------- screens ----------
  function sunny(cls) {
    return h('img', {
      class: 'ftd-sunny ' + (cls || ''),
      src: '/assets/img/sunny-trimmed-400.png',
      srcset: '/assets/img/sunny-trimmed-400.png 400w, /assets/img/sunny-trimmed.png 560w',
      sizes: '(min-width: 700px) 180px, 120px',
      width: '400', height: '463',
      alt: 'Sunny the Gator, the Commission Watch mascot, looking through binoculars'
    });
  }

  function showIntro() {
    var key = todayKey();
    var saved = store('ftd2-daily-' + key);
    root.innerHTML = '';
    root.appendChild(h('div', { class: 'ftd-card ftd-intro' }, [
      sunny('ftd-sunny-lg'),
      h('div', { class: 'ftd-intro-copy' }, [
        h('p', { class: 'ftd-bubble', text: 'Hi, I\'m Sunny. I have a dollar for the county budget and five places it needs to go. Help me get it there the legal way.' }),
        h('ol', { class: 'ftd-how' }, [
          h('li', { text: 'Pick where the dollar comes from (a revenue source).' }),
          h('li', { text: 'Pick the fund that holds it.' }),
          h('li', { text: 'Pick the department that spends it.' })
        ]),
        h('p', { class: 'ftd-small', text: '100 points per destination, minus 25 for each blocked route, plus up to ' + MAX_BONUS + ' bonus points for speed.' }),
        h('div', { class: 'btn-row ftd-btns' }, [
          h('button', { type: 'button', class: 'btn btn-primary', onclick: function () { saved ? showEnd(saved) : start('daily', key); } },
            [saved ? 'See today\'s result' : 'Play today\'s five']),
          h('button', { type: 'button', class: 'btn btn-secondary', onclick: function () { start('free'); } }, ['Free play'])
        ]),
        h('p', { class: 'ftd-small ftd-daily-note', text: 'Daily: the same five destinations for everyone on ' + prettyDate(key) + '. Free play: random destinations, as many times as you like.' })
      ])
    ]));
  }

  function start(mode, key) {
    var rand = mode === 'daily' ? mulberry32(hash('ftd-v1|' + key)) : Math.random;
    state = { mode: mode, key: key || null, rounds: pickRounds(rand), idx: 0, results: [] };
    startRound();
  }

  function startRound() {
    state.route = { source: null, fund: null, department: null };
    state.blocked = 0;
    state.busy = false;
    state.t0 = Date.now();
    renderRound();
  }

  var STEPS = [
    { key: 'source', list: 'sources', label: 'Revenue source', prompt: 'Step 1 of 3: Where does the dollar come from?' },
    { key: 'fund', list: 'funds', label: 'Fund', prompt: 'Step 2 of 3: Which fund holds it?' },
    { key: 'department', list: 'departments', label: 'Department', prompt: 'Step 3 of 3: Which department spends it?' }
  ];
  function currentStep() {
    for (var i = 0; i < STEPS.length; i++) if (!state.route[STEPS[i].key]) return i;
    return -1;
  }

  function renderRound() {
    var dest = state.rounds[state.idx];
    root.innerHTML = '';
    root.appendChild(h('div', { class: 'ftd-progress', 'aria-label': 'Progress' }, [
      h('span', { text: 'Destination ' + (state.idx + 1) + ' of ' + ROUNDS }),
      h('span', { text: (state.mode === 'daily' ? 'Daily ' + prettyDate(state.key) : 'Free play') + ' · Score ' + total() })
    ]));
    root.appendChild(h('div', { class: 'ftd-card ftd-dest' }, [
      sunny(),
      h('div', {}, [
        h('span', { class: 'eyebrow', text: 'Sunny\'s destination card' }),
        h('p', { class: 'ftd-dest-label', text: 'Send one dollar to ' + dest.label + '.' })
      ])
    ]));
    root.appendChild(renderPipe());
    root.appendChild(h('div', { class: 'ftd-feedback', id: 'ftd-feedback', role: 'status', 'aria-live': 'polite' }));
    root.appendChild(h('div', { id: 'ftd-picker' }));
    renderPicker();
  }

  function renderPipe() {
    var kids = [];
    STEPS.forEach(function (s, i) {
      if (i > 0) kids.push(h('div', { class: 'ftd-seg', 'data-seg': String(i) }, [
        h('span', { class: 'ftd-fill' }),
        h('span', { class: 'ftd-coin', 'aria-hidden': 'true', text: '$' }),
        h('span', { class: 'ftd-valve', 'aria-hidden': 'true' })
      ]));
      var picked = state.route[s.key];
      kids.push(h('button', {
        type: 'button', class: 'ftd-node' + (picked ? ' is-set' : ''), 'data-node': String(i + 1),
        'aria-label': s.label + ': ' + (picked ? byId[picked].name + '. Tap to change.' : 'not picked yet'),
        onclick: function () { if (!state.busy && picked) { clearFrom(i); } }
      }, [
        h('span', { class: 'ftd-node-k', text: s.label }),
        h('span', { class: 'ftd-node-v', text: picked ? (byId[picked].short || byId[picked].name) : '?' })
      ]));
    });
    return h('div', { class: 'ftd-pipe', id: 'ftd-pipe' }, kids);
  }

  function clearFrom(i) {
    for (var k = i; k < STEPS.length; k++) state.route[STEPS[k].key] = null;
    $('#ftd-pipe').replaceWith(renderPipe());
    renderPicker();
  }

  function renderPicker() {
    var picker = $('#ftd-picker');
    picker.innerHTML = '';
    var step = currentStep();
    if (step < 0) return;
    var s = STEPS[step];
    var grid = h('div', { class: 'ftd-grid ftd-grid-' + s.key });
    data[s.list].forEach(function (item) {
      grid.appendChild(h('button', {
        type: 'button', class: 'ftd-tile',
        onclick: function () { choose(s.key, item.id); }
      }, [
        h('span', { class: 'ftd-tile-name', text: item.name }),
        item.blurb ? h('span', { class: 'ftd-tile-blurb', text: item.blurb }) : null
      ]));
    });
    picker.appendChild(h('h2', { class: 'ftd-step', text: s.prompt }));
    picker.appendChild(grid);
    if (state.blocked >= REVEAL_AFTER) {
      picker.appendChild(h('p', { class: 'ftd-reveal' }, [
        h('button', { type: 'button', class: 'btn btn-secondary btn-small', onclick: reveal }, ['Show me a legal route (0 points)'])
      ]));
    }
  }

  function choose(key, id) {
    if (state.busy) return;
    state.route[key] = id;
    $('#ftd-pipe').replaceWith(renderPipe());
    if (currentStep() < 0) send();
    else {
      renderPicker();
      var p = $('#ftd-picker');
      if (p && p.getBoundingClientRect().top < 0) p.scrollIntoView({ block: 'start', behavior: reduceMotion ? 'auto' : 'smooth' });
    }
  }

  function setFeedback(kind, title, text, extra) {
    var box = $('#ftd-feedback');
    box.className = 'ftd-feedback is-' + kind;
    box.innerHTML = '';
    box.appendChild(h('span', { class: 'ftd-fb-icon ftd-icon-' + kind, 'aria-hidden': 'true' }));
    box.appendChild(h('div', {}, [h('strong', { text: title }), h('p', { text: text })].concat(extra || [])));
  }

  async function send() {
    var dest = state.rounds[state.idx];
    var route = state.route;
    var res = check(route, dest);
    state.busy = true;
    $('#ftd-picker').innerHTML = '';
    var pipe = $('#ftd-pipe');
    pipe.classList.add('is-running');
    var stopAt = res.ok ? 3 : res.at;
    for (var seg = 1; seg <= 2; seg++) {
      var el = pipe.querySelector('[data-seg="' + seg + '"]');
      if (seg === stopAt) { el.classList.add('is-blocked'); break; }
      el.classList.add('is-flowing');
      await wait(STEP_MS);
      el.classList.add('is-done');
      pipe.querySelector('[data-node="' + (seg + 1) + '"]').classList.add('is-reached');
    }
    if (!res.ok && res.at === 3) pipe.querySelector('[data-node="3"]').classList.add('is-blocked');
    await wait(STEP_MS / 2);
    pipe.classList.remove('is-running');

    if (res.ok) {
      pipe.querySelector('[data-node="3"]').classList.add('is-delivered');
      finishRound(false);
    } else {
      state.blocked++;
      setFeedback('blocked', 'Blocked. The valve closed.', res.msg, [
        h('button', { type: 'button', class: 'btn btn-primary btn-small', onclick: retry }, ['Try another route'])
      ]);
      state.busy = false;
    }
  }

  function retry() {
    state.route = { source: null, fund: null, department: null };
    $('#ftd-pipe').replaceWith(renderPipe());
    var fb = $('#ftd-feedback'); fb.className = 'ftd-feedback'; fb.innerHTML = '';
    renderPicker();
  }

  async function reveal() {
    state.route = legalRoute(state.rounds[state.idx]);
    state.revealed = true;
    $('#ftd-pipe').replaceWith(renderPipe());
    $('#ftd-picker').innerHTML = '';
    var pipe = $('#ftd-pipe');
    for (var seg = 1; seg <= 2; seg++) {
      pipe.querySelector('[data-seg="' + seg + '"]').classList.add('is-flowing', 'is-done');
      pipe.querySelector('[data-node="' + (seg + 1) + '"]').classList.add('is-reached');
    }
    pipe.querySelector('[data-node="3"]').classList.add('is-delivered');
    finishRound(true);
  }

  function finishRound(revealed) {
    var seconds = Math.round((Date.now() - state.t0) / 1000);
    var bonus = revealed ? 0 : Math.max(0, MAX_BONUS - seconds);
    var base = revealed ? 0 : Math.max(0, 100 - 25 * state.blocked);
    var points = base + bonus;
    var r = state.route;
    state.results.push({
      dest: state.rounds[state.idx].id, source: r.source, fund: r.fund, department: r.department,
      blocked: state.blocked, seconds: seconds, points: points, revealed: revealed
    });
    state.revealed = false;
    var last = state.idx === ROUNDS - 1;
    var detail = revealed
      ? 'Here is one legal route. No points this time.'
      : base + ' points' + (state.blocked ? ' (' + state.blocked + ' blocked)' : '') + ' + ' + bonus + ' speed bonus = ' + points + '.';
    setFeedback(revealed ? 'shown' : 'ok', revealed ? 'Route shown.' : 'Delivered!',
      byId[r.source].name + ' → ' + byId[r.fund].name + ' → ' + byId[r.department].name + '. ' + detail, [
        h('button', { type: 'button', class: 'btn btn-primary btn-small', onclick: function () {
          if (last) endGame(); else { state.idx++; startRound(); window.scrollTo({ top: root.offsetTop - 100, behavior: reduceMotion ? 'auto' : 'smooth' }); }
        } }, [last ? 'See my results' : 'Next destination'])
      ]);
    var btn = $('#ftd-feedback button'); if (btn) btn.focus({ preventScroll: true });
    state.busy = false;
  }

  function total(results) {
    return (results || (state && state.results) || []).reduce(function (s, r) { return s + r.points; }, 0);
  }

  function endGame() {
    var record = { mode: state.mode, key: state.key, results: state.results };
    if (state.mode === 'daily') store('ftd2-daily-' + state.key, record);
    showEnd(record);
  }

  function shareText(record) {
    var marks = record.results.map(function (r) { return r.revealed ? '💡' : r.blocked ? '🔁' : '🎯'; }).join('');
    var head = 'Follow the Dollar' + (record.mode === 'daily' ? ' (Daily, ' + prettyDate(record.key) + ')' : ' (Free play)');
    return head + '\nScore: ' + total(record.results) + '/' + (ROUNDS * (100 + MAX_BONUS)) + '\n' + marks + '\n' + GAME_URL;
  }

  function copy(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text).catch(function () { return legacyCopy(text); });
    }
    return legacyCopy(text);
  }
  function legacyCopy(text) {
    return new Promise(function (resolve, reject) {
      var ta = h('textarea', { 'aria-hidden': 'true', class: 'ftd-offscreen' });
      ta.value = text; document.body.appendChild(ta); ta.select();
      var ok = false; try { ok = document.execCommand('copy'); } catch (e) {}
      ta.remove(); ok ? resolve() : reject();
    });
  }

  function showEnd(record) {
    var score = total(record.results);
    root.innerHTML = '';
    var list = h('ol', { class: 'ftd-results' });
    record.results.forEach(function (r) {
      var dest = data.destinations.filter(function (d) { return d.id === r.dest; })[0];
      var mark = r.revealed ? 'Route shown' : r.blocked ? 'Delivered after ' + r.blocked + ' blocked' : 'Delivered first try';
      list.appendChild(h('li', {}, [
        h('span', { class: 'ftd-res-dest', text: dest ? dest.label : r.dest }),
        h('span', { class: 'ftd-res-route', text: byId[r.source].name + ' → ' + byId[r.fund].name + ' → ' + byId[r.department].name }),
        h('span', { class: 'ftd-res-pts', text: mark + ' · ' + r.points + ' pts' })
      ]));
    });

    var status = h('span', { class: 'ftd-copied', role: 'status', 'aria-live': 'polite' });
    var shareBtn = h('button', { type: 'button', class: 'btn btn-primary', onclick: function () {
      copy(shareText(record)).then(function () { status.textContent = 'Copied. Paste it anywhere.'; },
        function () { status.textContent = 'Could not copy automatically. Select the text below.'; showShareText(); });
    } }, ['Copy my result']);
    var shareBox = h('pre', { class: 'ftd-share-text', hidden: 'hidden', text: shareText(record) });
    function showShareText() { shareBox.hidden = false; }

    root.appendChild(h('div', { class: 'ftd-card ftd-end' }, [
      sunny('ftd-sunny-lg'),
      h('div', {}, [
        h('span', { class: 'eyebrow', text: record.mode === 'daily' ? 'Daily · ' + prettyDate(record.key) : 'Free play' }),
        h('h2', { class: 'ftd-score', text: score + ' of ' + (ROUNDS * (100 + MAX_BONUS)) + ' points' }),
        h('p', { class: 'ftd-bubble', text: endLine(score) }),
        h('div', { class: 'btn-row ftd-btns' }, [
          shareBtn,
          h('button', { type: 'button', class: 'btn btn-secondary', onclick: function () { start('free'); } }, ['Free play'])
        ]),
        status, shareBox
      ])
    ]));
    root.appendChild(h('section', { class: 'ftd-card' }, [h('h2', { class: 'ftd-h', text: 'Your routes' }), list]));
    root.appendChild(renderSplits(record));
    if (record.mode === 'daily') root.appendChild(h('p', { class: 'ftd-small ftd-center', text: 'A new daily five starts at midnight Eastern time.' }));
  }

  function endLine(score) {
    var max = ROUNDS * (100 + MAX_BONUS);
    if (score >= max * 0.8) return 'Every dollar got where it was going. You read a budget like a commission watcher.';
    if (score >= max * 0.5) return 'Nice work. A few valves closed, and now you know why.';
    return 'Budgets have a lot of rules. Try free play and see which routes open up.';
  }

  function renderSplits(record) {
    var used = [];
    record.results.forEach(function (r) { if (used.indexOf(r.source) < 0) used.push(r.source); });
    var wrap = h('section', { class: 'ftd-card ftd-splits' }, [
      h('span', { class: 'eyebrow', text: 'How the budget splits each source' }),
      h('h2', { class: 'ftd-h', text: 'Where these revenue sources go, ' + data.fiscalYear }),
      h('p', { class: 'ftd-small', text: 'Estimated split: each source is counted as paying the same share of everything its fund spends. Department amounts are operating budgets from the ' + (data.basisLabel || data.fiscalYear + ' budget') + '.' })
    ]);
    used.forEach(function (sid) {
      var split = sourceSplit(sid);
      var max = split.rows.reduce(function (m, r) { return Math.max(m, r.amount); }, 0) || 1;
      var rows = split.rows.map(function (row) {
        var pct = Math.round(row.amount / split.total * 100);
        return h('li', { class: 'ftd-bar-row' }, [
          h('span', { class: 'ftd-bar-label', text: splitLabel(row.id) }),
          h('span', { class: 'ftd-bar-track' }, [h('span', { class: 'ftd-bar' + (row.id === OTHER ? ' is-other' : ''), style: 'width:' + Math.max(2, row.amount / max * 100).toFixed(1) + '%' })]),
          h('span', { class: 'ftd-bar-val', text: money(row.amount) + (split.rows.length > 1 ? ' (' + (pct < 1 ? '<1' : pct) + '%)' : '') })
        ]);
      });
      wrap.appendChild(h('div', { class: 'ftd-split' }, [
        h('h3', { text: byId[sid].name }),
        h('p', { class: 'ftd-small', text: money(split.total) + ' in ' + data.fiscalYear + '.' }),
        h('ul', { class: 'ftd-bars' }, rows)
      ]));
    });
    return wrap;
  }

  // ---------- boot ----------
  function unverified(d) {
    return ['sources', 'funds', 'departments', 'edges', 'destinations'].some(function (k) {
      return d[k].some(function (x) { return x.verified !== true; });
    });
  }

  fetch(DATA_URL).then(function (r) {
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  }).then(function (d) {
    data = d;
    ['sources', 'funds', 'departments'].forEach(function (k) { d[k].forEach(function (x) { byId[x.id] = x; }); });
    d.edges.forEach(function (e) { edgeSet[e.from + '>' + e.to] = e; });
    // The banner stays up while any item is unverified, and while the figures
    // come from the proposed rather than the adopted budget.
    var banner = document.getElementById('ftd-beta');
    if (banner) {
      var pending = unverified(d);
      banner.hidden = !pending && d.basis !== 'proposed';
      var strong = banner.querySelector('strong'), span = banner.querySelector('span');
      if (!pending && strong && span) { strong.textContent = 'Beta.'; span.textContent = d.bannerText || ''; }
    }
    showIntro();
  }).catch(function () {
    root.innerHTML = '';
    root.appendChild(h('p', { class: 'ftd-card', text: 'The game data did not load. Check your connection and refresh the page.' }));
  });
})();
