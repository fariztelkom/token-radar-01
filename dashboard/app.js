/* Launch Radar: a static board driven by window.RADAR. No fetch, no external script, no network. */
(() => {
  'use strict';

  const data = window.RADAR || {};
  const rows = Array.isArray(data.rows) ? data.rows : [];
  const live = Array.isArray(data.live) ? data.live : [];
  const comps = data.comparables || {};
  const state = { q: '', category: '', tab: 'pre', sort: 'rank', dir: 'asc', selected: null };
  const app = document.getElementById('app');

  function esc(value) {
    return String(value === null || value === undefined ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function money(n) {
    const v = Number(n) || 0;
    if (v >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'B';
    if (v >= 1e6) return '$' + (v / 1e6).toFixed(1) + 'M';
    if (v >= 1e3) return '$' + (v / 1e3).toFixed(1) + 'K';
    return '$' + Math.round(v);
  }

  function fullMoney(n) {
    return '$' + Math.round(Number(n) || 0).toLocaleString('en-US');
  }

  function pct(n) {
    if (n === null || n === undefined || !Number.isFinite(Number(n))) return '—';
    const v = Number(n);
    return (v > 0 ? '+' : '') + v.toFixed(1) + '%';
  }

  function tenure(n) {
    if (n === null || n === undefined || !Number.isFinite(Number(n))) return 'unknown';
    const d = Number(n);
    return d < 365 ? d + 'd' : (d / 365).toFixed(1) + 'y';
  }

  function readHash() {
    const p = new URLSearchParams(location.hash.replace(/^#/, ''));
    state.selected = p.get('p') || null;
    state.tab = p.get('tab') === 'live' ? 'live' : 'pre';
    state.category = p.get('category') || '';
    state.q = p.get('q') || '';
  }

  function setParam(name, value) {
    const p = new URLSearchParams(location.hash.replace(/^#/, ''));
    if (value === null || value === '') p.delete(name);
    else p.set(name, value);
    const query = p.toString();
    history.replaceState(null, '', query ? '#' + query : location.pathname + location.search);
    if (name === 'p') state.selected = value;
    if (name === 'tab') state.tab = value === 'live' ? 'live' : 'pre';
    if (name === 'category') state.category = value || '';
    if (name === 'q') state.q = value || '';
    render();
  }

  function baseRows() {
    if (state.tab === 'live') {
      return live.map((l, i) => ({
        rank: i + 1,
        slug: l.slug,
        name: l.name,
        category: l.category,
        chains: l.chains || [],
        tvl_usd: l.tvl_usd,
        change_7d: l.change_7d,
        mcap_usd: l.mcap_usd,
        age_days: null,
        implied_value_usd: l.mcap_usd || 0,
        comp_multiple: null,
        comp_source: 'market cap, not a fitted value',
        growth_multiplier: 1,
        maturity_multiplier: 1,
        size_tilt: 1,
        farm_steps: [],
      }));
    }
    return rows;
  }

  function visibleRows() {
    const q = state.q.trim().toLowerCase();
    const out = baseRows().filter((r) => {
      const hay = [r.name, r.slug, r.category || 'Unclassified', ...(r.chains || [])].join(' ').toLowerCase();
      return (!q || hay.indexOf(q) >= 0) && (!state.category || r.category === state.category);
    });
    const key = state.sort === 'rank'
      ? (state.tab === 'live' ? 'implied_value_usd' : 'rank')
      : state.sort;
    const dir = state.sort === 'rank' ? (state.tab === 'live' ? -1 : 1) : (state.dir === 'asc' ? 1 : -1);
    out.sort((a, b) => {
      const av = a[key];
      const bv = b[key];
      if (typeof av === 'string' || typeof bv === 'string') {
        return dir * String(av || '').localeCompare(String(bv || ''));
      }
      return dir * ((Number(av) || 0) - (Number(bv) || 0));
    });
    return out;
  }

  function masthead() {
    return '<header class="masthead">' +
      '<div class="brand"><div class="mark" aria-hidden="true">&#9678;</div><div>' +
      '<h1>Launch Radar</h1><p>PRE-TOKEN PROTOCOL INTELLIGENCE</p></div></div>' +
      '<div class="stamp"><div>Sealed snapshot <b>' + esc(data.as_of) + '</b></div>' +
      '<div>Model <b>' + esc(data.model_version) + '</b></div></div></header>';
  }

  function kpis() {
    const cells = [
      ['Watchlist covered', data.watchlist_size + ' / ' + data.watchlist_size, 'amber'],
      ['Pre-token ranked', String(rows.length), ''],
      ['Early, below the floor', String(data.early_size || 0), ''],
      ['Top implied value', money(rows.length ? rows[0].implied_value_usd : 0), ''],
    ];
    return '<section class="kpis" aria-label="Summary">' + cells.map((c) =>
      '<div class="kpi"><div class="label">' + esc(c[0]) + '</div>' +
      '<div class="value ' + c[2] + '">' + esc(c[1]) + '</div></div>').join('') + '</section>';
  }

  function modelNote() {
    const global = Number(comps.global || 0).toFixed(2);
    return '<section class="model-note" aria-label="Valuation model">' +
      '<span class="tag">VALUE MODEL</span>' +
      '<span class="formula">implied = TVL &times; fitted comp &times; growth &times; tenure &times; size tilt</span>' +
      '<span class="pill">comp = <em>' + esc(global) + '</em> (fitted from live comparables)</span>' +
      '<span class="note-right">Fitted from ' + esc(comps.count || 0) + ' live-token protocols in the same snapshot &middot; ' +
      esc(comps.category_count || 0) + ' category and ' + esc(comps.chain_count || 0) + ' chain medians.</span>' +
      '</section>';
  }

  function categories() {
    const names = Array.from(new Set(rows.map((r) => r.category || 'Unclassified'))).sort();
    return ['<option value="">All categories</option>'].concat(
      names.map((n) => '<option value="' + esc(n) + '"' + (state.category === n ? ' selected' : '') + '>' + esc(n) + '</option>')
    ).join('');
  }

  function controls(list) {
    return '<div class="controls">' +
      '<div class="tabs" role="tablist">' +
      '<button class="tab ' + (state.tab === 'pre' ? 'active' : '') + '" data-tab="pre" role="tab" aria-selected="' + (state.tab === 'pre') + '">Pre-token board</button>' +
      '<button class="tab ' + (state.tab === 'live' ? 'active' : '') + '" data-tab="live" role="tab" aria-selected="' + (state.tab === 'live') + '">Live tokens</button>' +
      '</div>' +
      '<input class="search" id="search" type="search" value="' + esc(state.q) + '" placeholder="Search name, category or chain" aria-label="Search protocols">' +
      '<select class="select" id="category" aria-label="Filter by category">' + categories() + '</select>' +
      '<span class="hint">' + list.length + ' rows &middot; click a row for its model and farm plan</span>' +
      '</div>';
  }

  function headCell(label, sortKey, cls) {
    const active = state.sort === sortKey;
    const arrow = active ? (state.dir === 'asc' ? ' ↑' : ' ↓') : '';
    return '<span class="' + (cls || '') + '"><button class="hbtn" data-sort="' + sortKey + '">' + label + arrow + '</button></span>';
  }

  function rowHtml(r) {
    const change = Number(r.change_7d);
    const tone = !Number.isFinite(change) ? '' : change > 0 ? 'pos' : change < 0 ? 'neg' : '';
    return '<div class="trow ' + (state.selected === r.slug ? 'selected' : '') + '" role="button" tabindex="0" data-slug="' + esc(r.slug) + '">' +
      '<span class="rank">' + (state.tab === 'live' ? '' : r.rank) + '</span>' +
      '<span class="proto"><b>' + esc(r.name) + '</b><small>' + esc(r.category || 'Unclassified') + ' &middot; ' +
      esc((r.chains || []).slice(0, 2).join(', ') || '—') + '</small></span>' +
      '<span class="num col-tvl">' + money(r.tvl_usd) + '</span>' +
      '<span class="num col-chg ' + tone + '">' + pct(r.change_7d) + '</span>' +
      '<span class="num implied">' + money(state.tab === 'live' ? r.mcap_usd : r.implied_value_usd) + '</span>' +
      '<span class="num col-age">' + (state.tab === 'live' ? marketTag() : tenure(r.age_days)) + '</span>' +
      '<span class="chev" aria-hidden="true">&#8250;</span></div>';
  }

  function marketTag() { return 'live'; }

  function table(list) {
    const last = state.tab === 'live' ? 'MARKET CAP' : 'IMPLIED VALUE';
    const ageLabel = state.tab === 'live' ? 'TOKEN' : 'NO TOKEN';
    const head = '<div class="thead">' + headCell('#', 'rank') +
      '<span><button class="hbtn" data-sort="name">PROTOCOL</button></span>' +
      headCell('TVL', 'tvl_usd', 'h-col-tvl') +
      headCell('7D CHANGE', 'change_7d', 'h-col-chg') +
      headCell(last, 'implied_value_usd') +
      headCell(ageLabel, 'age_days', 'h-col-age') +
      '<span></span></div>';
    const body = list.length === 0
      ? '<div class="empty">No protocol matches these filters.</div>'
      : list.slice(0, 60).map(rowHtml).join('');
    return '<section class="board" aria-label="Protocol board">' + head + body + '</section>';
  }

  function footer() {
    return '<footer><span>Sealed snapshot ' + esc(data.as_of) + ' &middot; ' +
      esc(rows.length) + ' pre-token protocols ranked &middot; ' + esc(live.length) + ' live tokens shown separately</span>' +
      '<span>' + esc(data.model_version) + ' &middot; deterministic fit from the snapshot</span></footer>';
  }

  function drawer() {
    if (!state.selected) return '<div class="backdrop" id="backdrop" hidden></div><aside class="drawer" id="drawer" aria-hidden="true"></aside>';
    const r = rows.find((x) => x.slug === state.selected) || live.find((x) => x.slug === state.selected);
    if (!r) return '<div class="backdrop" id="backdrop" hidden></div><aside class="drawer" id="drawer" aria-hidden="true"></aside>';
    const isLive = !('implied_value_usd' in r) || state.tab === 'live';
    const implied = isLive ? (r.mcap_usd || 0) : r.implied_value_usd;
    const rankLine = isLive ? 'LIVE TOKEN' : 'RANK ' + r.rank + ' / ' + rows.length;
    const kv = [
      ['TVL', fullMoney(r.tvl_usd)],
      ['Seven-day change', pct(r.change_7d)],
      ['Age with no token', isLive ? 'already trading' : tenure(r.age_days)],
      ['Fitted comparable', isLive ? '—' : Number(r.comp_multiple || 0).toFixed(4) + 'x'],
      ['Comp source', isLive ? 'market cap, not a fitted value' : r.comp_source],
      ['Growth &times; tenure', isLive ? '—' : Number(r.growth_multiplier || 0).toFixed(3) + ' &times; ' + Number(r.maturity_multiplier || 0).toFixed(4)],
      ['Implied value', fullMoney(implied)],
    ].map((pair) => '<div class="kv"><span class="k">' + pair[0] + '</span><span class="v' + (pair[0] === 'Implied value' ? ' mint' : '') + '">' + pair[1] + '</span></div>').join('');

    const formula = isLive
      ? 'This protocol records a token. Its figure above is the market cap in the snapshot, not a model output.'
      : 'implied = TVL &times; ' + Number(r.comp_multiple || 0).toFixed(4) + ' (fitted) &times; ' +
        Number(r.growth_multiplier || 0).toFixed(3) + ' (growth) &times; ' +
        Number(r.maturity_multiplier || 0).toFixed(4) + ' (tenure) = ' + fullMoney(implied) +
        ' &middot; the fitted comp already carries this TVL&rsquo;s size tilt (x' + Number(r.size_tilt || 0).toFixed(2) + ').';

    const steps = (r.farm_steps || []).map((s, i) => {
      const at = s.indexOf(' Cost: ');
      const action = at < 0 ? s : s.slice(0, at);
      const meta = at < 0 ? '' : s.slice(at + 1);
      return '<li><span class="stepnum">' + String(i + 1).padStart(2, '0') + '</span><div>' +
        '<div class="steptext">' + esc(action) + '</div>' +
        '<div class="stepmeta">' + esc(meta) + '</div></div></li>';
    }).join('');
    const plan = steps.length ? '<ol class="farm">' + steps + '</ol>' :
      '<p class="steptext">Farm plans are written for protocols that record no token.</p>';

    return '<div class="backdrop" id="backdrop"></div>' +
      '<aside class="drawer" id="drawer" aria-hidden="false">' +
      '<div class="drawer-head"><div><div class="eyebrow">' + esc(rankLine) + '</div>' +
      '<h2>' + esc(r.name) + '</h2><p>' + esc(r.category || 'Unclassified') + ' &middot; ' +
      esc((r.chains || []).join(', ') || 'chains not reported') + '</p></div>' +
      '<button class="close" id="closeDrawer" type="button">Close</button></div>' +
      '<div class="section-label">VALUATION</div>' + kv +
      '<div class="formula-box">' + formula + '</div>' +
      '<div class="section-label">FARM PLAN</div>' + plan +
      '</aside>';
  }

  function render() {
    const list = visibleRows();
    document.getElementById('board').setAttribute('aria-busy', 'false');
    app.innerHTML = '<div class="wrap">' + masthead() + kpis() + modelNote() +
      controls(list) + table(list) + footer() + '</div>' + drawer();
  }

  document.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const tab = target.closest('[data-tab]');
    if (tab) { setParam('tab', tab.getAttribute('data-tab')); return; }
    const sort = target.closest('[data-sort]');
    if (sort) {
      const key = sort.getAttribute('data-sort');
      if (state.sort === key) state.dir = state.dir === 'asc' ? 'desc' : 'asc';
      else { state.sort = key; state.dir = key === 'rank' || key === 'name' ? 'asc' : 'desc'; }
      render();
      return;
    }
    const row = target.closest('[data-slug]');
    if (row) { setParam('p', row.getAttribute('data-slug')); return; }
    if (target.closest('#closeDrawer') || target.closest('#backdrop')) setParam('p', null);
  });

  document.addEventListener('input', (event) => {
    if (event.target && event.target.id === 'search') setParam('q', event.target.value);
  });

  document.addEventListener('change', (event) => {
    if (event.target && event.target.id === 'category') setParam('category', event.target.value);
  });

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (state.selected) setParam('p', null);
  });

  window.addEventListener('hashchange', () => { readHash(); render(); });

  readHash();
  render();
})();
