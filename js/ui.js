/* Evolution Arena — UI wiring and main loop. */
(function () {
  'use strict';
  const E = window.Evo;
  const $ = (s) => document.querySelector(s);

  const TRAIT_META = {
    speed:      { label: 'Speed',      color: '#f6b26b', tip: 'Faster movement — but energy cost grows with the square of speed.' },
    size:       { label: 'Size',       color: '#a78bfa', tip: 'Bigger bodies store more energy and hit harder, but cost more and turn slower.' },
    aggression: { label: 'Aggression', color: '#f87171', tip: '4+ makes a hunter that eats other species. Hunters digest plants poorly.' },
    vision:     { label: 'Vision',     color: '#5ee0f5', tip: 'How far it can see food, prey and threats. Costs upkeep.' },
    armor:      { label: 'Armor',      color: '#9aa7b8', tip: 'Reduces damage taken and spines hurt attackers. Heavy to carry.' },
    fertility:  { label: 'Fertility',  color: '#f472b6', tip: 'Breeds sooner and more often, sometimes twins — with smaller energy reserves.' },
  };

  const state = {
    mode: 'ecosystem',
    traits: { speed: 5, size: 6, aggression: 5, vision: 6, armor: 4, fertility: 4 },
    rival: E.randomTraits(),
    rivalName: E.randomName(),
    speed: 1,
    paused: false,
    selected: null,
    releaseLock: 0,
  };

  const stage = $('#stage');
  const canvas = $('#world');
  const renderer = new window.EvoRenderer(canvas);
  const sim = new E.Sim(Math.max(200, stage.clientWidth), Math.max(200, stage.clientHeight));

  /* ------------------------------------------------------------ sliders */

  const sliderEls = {};
  for (const k of E.TRAITS) {
    const m = TRAIT_META[k];
    const row = document.createElement('label');
    row.className = 'slider';
    row.style.setProperty('--c', m.color);
    row.title = m.tip;
    row.innerHTML = `<span class="slider-top"><span>${m.label}</span><span class="val"></span></span>
      <input type="range" min="0" max="${E.MAX_TRAIT}" step="1" aria-label="${m.label}">`;
    const input = row.querySelector('input');
    input.value = state.traits[k];
    input.addEventListener('input', () => {
      const others = E.sumTraits(state.traits) - state.traits[k];
      let v = +input.value;
      const max = E.BUDGET - others;
      if (v > max) { v = max; input.value = v; }
      state.traits[k] = v;
      refreshTraits();
    });
    sliderEls[k] = { input, val: row.querySelector('.val') };
    $('#sliders').appendChild(row);
  }

  function refreshTraits() {
    for (const k of E.TRAITS) {
      const el = sliderEls[k];
      el.input.value = state.traits[k];
      el.val.textContent = state.traits[k];
      el.input.style.setProperty('--p', (state.traits[k] / E.MAX_TRAIT) * 100 + '%');
    }
    $('#points-left').textContent = E.BUDGET - E.sumTraits(state.traits);
  }

  function lockSliders(locked) {
    for (const k of E.TRAITS) sliderEls[k].input.disabled = locked;
    $('#randomize').disabled = locked;
    $('#reroll').disabled = locked;
  }

  $('#randomize').addEventListener('click', () => {
    state.traits = E.randomTraits();
    refreshTraits();
  });

  /* ------------------------------------------------------------ rival */

  function renderRival() {
    $('#rival-name').textContent = state.rivalName;
    $('#rival-bars').innerHTML = E.TRAITS.map((k) => {
      const m = TRAIT_META[k], v = state.rival[k];
      return `<div class="rbar" style="--c:${m.color}"><span>${m.label}</span>
        <div class="track"><b style="width:${v * 10}%"></b></div><span>${v}</span></div>`;
    }).join('');
  }

  function newRival() {
    state.rival = E.randomTraits();
    state.rivalName = E.randomName();
    renderRival();
  }

  $('#reroll').addEventListener('click', () => {
    newRival();
    resetWorld();
  });

  /* ------------------------------------------------------------ modes */

  function setMode(mode) {
    if (state.mode === mode) return;
    state.mode = mode;
    document.querySelectorAll('.seg-btn').forEach((b) => {
      const on = b.dataset.mode === mode;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', on);
    });
    $('#rival').hidden = mode !== 'duel';
    $('#duel-row').hidden = mode !== 'duel';
    $('#release').textContent = mode === 'duel' ? 'Start duel' : 'Release';
    $('#s-lineage-label').textContent = mode === 'duel' ? 'You vs rival' : 'Your lineage';
    if (mode === 'duel') renderRival();
    resetWorld();
    toast(mode === 'duel'
      ? 'Duel: two species, one arena, two minutes. Last lineage standing wins.'
      : 'Ecosystem: release species into a living world and see who endures.', 195);
  }

  document.querySelectorAll('.seg-btn').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));

  function resetWorld() {
    sim.reset(state.mode);
    state.selected = null;
    hideInspector();
    hideOverlay();
    lockSliders(false);
    drawChart();
    updateLegend();
  }

  $('#reset').addEventListener('click', resetWorld);

  function release() {
    if (state.mode === 'ecosystem') {
      if (performance.now() < state.releaseLock) return;
      sim.release(Object.assign({}, state.traits));
      state.releaseLock = performance.now() + 1200;
      const btn = $('#release');
      btn.disabled = true;
      setTimeout(() => (btn.disabled = false), 1200);
    } else {
      startDuel();
    }
  }

  function startDuel() {
    sim.startDuel(Object.assign({}, state.traits), Object.assign({}, state.rival), state.rivalName);
    state.selected = null;
    hideInspector();
    hideOverlay();
    lockSliders(true);
    if (state.paused) setSpeed(1);
  }

  $('#release').addEventListener('click', release);

  /* ------------------------------------------------------------ speed */

  function setSpeed(s) {
    state.paused = s === 0;
    if (s > 0) state.speed = s;
    document.querySelectorAll('.speed button').forEach((b) => {
      const v = +b.dataset.speed;
      b.classList.toggle('active', state.paused ? v === 0 : v === state.speed);
    });
  }
  document.querySelectorAll('.speed button').forEach((b) => b.addEventListener('click', () => setSpeed(+b.dataset.speed)));

  window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' && e.code !== 'Space') return;
    if (e.code === 'Space') { e.preventDefault(); setSpeed(state.paused ? state.speed : 0); }
    else if (e.key === 'r' || e.key === 'R') release();
    else if (e.key === '1') setSpeed(1);
    else if (e.key === '2') setSpeed(2);
    else if (e.key === '3' || e.key === '4') setSpeed(4);
    else if (e.key === 'Escape') { state.selected = null; hideInspector(); }
  });

  /* ------------------------------------------------------------ canvas input */

  canvas.addEventListener('pointerdown', (e) => {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    const o = sim.pick(x, y);
    if (o) {
      state.selected = o;
      showInspector();
    } else {
      sim.dropFood(x, y, 10);
      renderer.ripple(x, y, E.FOOD_HUE);
      state.selected = null;
      hideInspector();
    }
  });

  /* ------------------------------------------------------------ inspector */

  const inspector = $('#inspector');
  inspector.addEventListener('click', (e) => {
    if (e.target.closest('.ins-close')) { state.selected = null; hideInspector(); }
  });
  function showInspector() { inspector.hidden = false; updateInspector(); }
  function hideInspector() { inspector.hidden = true; }

  function updateInspector() {
    const o = state.selected;
    if (!o || inspector.hidden) return;
    const sp = o.sp;
    const status = o.alive
      ? `Gen ${o.gen} · ${E.MODE_NAMES[o.mode]}`
      : `<span class="ins-dead">Died · ${o.cause}</span>`;
    const ePct = Math.max(0, Math.min(100, (o.energy / o.d.maxEnergy) * 100));
    const owner = sp.owner === 'player' ? ' (yours)' : sp.owner === 'rival' ? ' (rival)' : '';
    inspector.innerHTML = `
      <div class="ins-head">
        <i class="ins-dot" style="--h:${Math.round(o.hue)}"></i>
        <div><div class="ins-name">${sp.name}${owner}</div><div class="ins-sub">${status}</div></div>
        <button class="ins-close" aria-label="Close">×</button>
      </div>
      <div class="ins-energy">
        <div class="row"><span>Energy</span><span>${Math.max(0, Math.round(o.energy))} / ${Math.round(o.d.maxEnergy)}</span></div>
        <div class="track"><b style="width:${ePct}%"></b></div>
      </div>
      <div class="ins-traits">
        ${E.TRAITS.map((k) => `
          <div class="ins-trait" style="--c:${TRAIT_META[k].color}">
            <span>${TRAIT_META[k].label}</span>
            <div class="track" title="Marker = species founder"><b style="width:${o.t[k] * 10}%"></b><s style="left:${sp.traits[k] * 10}%"></s></div>
            <span>${o.t[k].toFixed(1)}</span>
          </div>`).join('')}
      </div>
      <div class="ins-foot">Age ${Math.round(o.age / 60)}s · ${o.children} offspring · ${o.kills} kill${o.kills === 1 ? '' : 's'}</div>`;
  }

  /* ------------------------------------------------------------ toasts */

  const toasts = $('#toasts');
  function toast(text, hue) {
    const el = document.createElement('div');
    el.className = 'toast';
    el.innerHTML = `<i style="--h:${Math.round(hue)}"></i><span></span>`;
    el.querySelector('span').textContent = text;
    toasts.prepend(el);
    while (toasts.children.length > 4) toasts.lastChild.remove();
    setTimeout(() => el.classList.add('out'), 3800);
    setTimeout(() => el.remove(), 4400);
  }

  /* ------------------------------------------------------------ overlay */

  const overlay = $('#overlay');
  function hideOverlay() { overlay.hidden = true; overlay.innerHTML = ''; }
  function showDuelResult(ev) {
    const D = sim.duel;
    const title = { win: 'Victory', lose: 'Defeat', draw: 'Draw' }[ev.result];
    const secs = Math.round(D.endTick / 60);
    let line;
    if (ev.result === 'win' && ev.rival === 0) line = `${D.rival.name} was wiped out in ${secs}s. Your lineage reached generation ${D.player.maxGen}.`;
    else if (ev.result === 'lose' && ev.you === 0) line = `Your lineage collapsed after ${secs}s. ${D.rival.name} reached generation ${D.rival.maxGen}.`;
    else line = `Time's up — ${ev.you} of yours vs ${ev.rival} ${D.rival.name}.`;
    overlay.innerHTML = `
      <div class="overlay-card">
        <div class="overlay-kicker">Duel complete</div>
        <h2 class="${ev.result}">${title}</h2>
        <p>${line}</p>
        <div class="overlay-actions">
          <button class="primary" data-act="rematch">Rematch</button>
          <button class="ghost" data-act="new">New rival</button>
          <button class="ghost" data-act="watch">Watch</button>
        </div>
      </div>`;
    overlay.hidden = false;
    lockSliders(false);
  }
  overlay.addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'rematch') startDuel();
    else if (act === 'new') { newRival(); resetWorld(); }
    else if (act === 'watch') hideOverlay();
  });

  /* ------------------------------------------------------------ stats, chart, legend */

  function drainEvents() {
    if (!sim.events.length) return;
    for (const ev of sim.events) {
      if (ev.type === 'duel-end') showDuelResult(ev);
      else toast(ev.text, ev.hue);
    }
    sim.events.length = 0;
  }

  function updateStats() {
    const st = sim.stats();
    $('#s-orgs').textContent = st.organisms;
    $('#s-gen').textContent = st.generation;
    $('#s-species').textContent = st.species;
    $('#s-food').textContent = st.food;
    if (state.mode === 'duel') {
      const D = sim.duel;
      $('#s-lineage').textContent = D ? `${D.player.count} : ${D.rival.count}` : '—';
      const left = D ? Math.max(0, (D.over ? D.limit - D.endTick : D.limit - sim.tick) / 60) : E.DUEL_TICKS / 60;
      $('#s-time').textContent = `${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, '0')}`;
    } else {
      $('#s-lineage').textContent = st.player;
    }
  }

  const chart = $('#chart');
  const chartCtx = chart.getContext('2d');
  function sizeChart() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    chart.width = Math.round(chart.clientWidth * dpr);
    chart.height = Math.round(chart.clientHeight * dpr);
  }

  function drawChart() {
    const W = chart.width, H = chart.height;
    const g = chartCtx;
    g.clearRect(0, 0, W, H);
    const N = E.HISTORY_MAX, end = sim.sampleIdx, start = end - N;
    let max = 10;
    for (const s of sim.species) for (const v of s.hist) if (v > max) max = v;
    const pad = 3 * (W / chart.clientWidth || 1);
    g.strokeStyle = 'rgba(148,170,210,0.1)';
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(0, H - 0.5);
    g.lineTo(W, H - 0.5);
    g.stroke();
    const xs = (i) => ((i - start) / N) * W;
    const ys = (v) => H - pad - (v / max) * (H - pad * 2);
    const ordered = sim.species.slice().sort((a, b) => (a.owner === 'player') - (b.owner === 'player'));
    for (const s of ordered) {
      if (!s.hist.length) continue;
      const mine = s.owner === 'player';
      g.strokeStyle = `hsla(${s.hue},100%,${mine ? 70 : 62}%,${mine ? 1 : 0.7})`;
      g.lineWidth = (mine ? 2 : 1.2) * (W / chart.clientWidth || 1);
      g.beginPath();
      let first = true;
      for (let j = 0; j < s.hist.length; j++) {
        const idx = s.histStart + j + 1;
        if (idx <= start) continue;
        const x = xs(idx), y = ys(s.hist[j]);
        if (first) { g.moveTo(x, y); first = false; } else g.lineTo(x, y);
      }
      g.stroke();
    }
  }

  const legend = $('#legend');
  function updateLegend() {
    const alive = sim.species.filter((s) => !s.extinct).sort((a, b) => b.count - a.count).slice(0, 7);
    if (!alive.length) {
      legend.innerHTML = `<li class="empty">${state.mode === 'duel' ? 'Press Start duel to begin.' : 'No life left. Release a species.'}</li>`;
      return;
    }
    legend.innerHTML = alive.map((s) => {
      const tag = s.owner === 'player' ? '<span class="tag you">you</span>' : s.owner === 'rival' ? '<span class="tag rival">rival</span>' : '<span class="tag">wild</span>';
      return `<li><i style="--h:${Math.round(s.hue)}"></i><span class="name">${s.name}</span>${tag}<b>${s.count}</b></li>`;
    }).join('');
  }

  /* ------------------------------------------------------------ preview orb */

  const preview = $('#preview');
  const pctx = preview.getContext('2d');
  function sizePreview() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    preview.width = Math.round(preview.clientWidth * dpr);
    preview.height = Math.round(preview.clientHeight * dpr);
    pctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function drawPreview(now) {
    const w = preview.clientWidth, h = preview.clientHeight;
    pctx.clearRect(0, 0, w, h);
    const d = E.derive(state.traits);
    const hue = E.traitHue(state.traits);
    const cx = w / 2, cy = h / 2;
    const om = 0.0006 + state.traits.speed * 0.00012;
    const t = now * om;
    const ax = Math.min(46, w * 0.22), ay = 9;
    const x = cx + Math.sin(t) * ax, y = cy + Math.sin(t * 2) * ay;
    const vx = Math.cos(t) * ax * om * 16, vy = Math.cos(t * 2) * 2 * ay * om * 16;

    // Vision halo.
    pctx.strokeStyle = `hsla(${hue},80%,70%,0.12)`;
    pctx.setLineDash([2, 5]);
    pctx.beginPath();
    pctx.arc(x, y, 8 + state.traits.vision * 2.2, 0, Math.PI * 2);
    pctx.stroke();
    pctx.setLineDash([]);

    pctx.globalCompositeOperation = 'lighter';
    renderer.drawOrganism(pctx, x, y, vx, vy, d.radius * 1.5, hue);
    pctx.globalAlpha = 1;
    pctx.globalCompositeOperation = 'source-over';
    if (state.traits.armor >= 6) {
      pctx.strokeStyle = `hsla(${hue},70%,82%,${((state.traits.armor - 5) / 5) * 0.5})`;
      pctx.beginPath();
      pctx.arc(x, y, d.radius * 1.5 + 2.5, 0, Math.PI * 2);
      pctx.stroke();
    }
  }

  /* ------------------------------------------------------------ resize & loop */

  function resize() {
    const w = Math.max(200, stage.clientWidth), h = Math.max(200, stage.clientHeight);
    renderer.resize(w, h);
    sim.resize(w, h);
    sizeChart();
    sizePreview();
    drawChart();
  }
  new ResizeObserver(resize).observe(stage);
  resize();

  let last = performance.now(), acc = 0, frame = 0;
  function loop(now) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (!state.paused) {
      acc += dt * 60 * state.speed;
      let n = 0;
      const maxSteps = 6 * state.speed;
      while (acc >= 1 && n < maxSteps) { sim.step(); acc -= 1; n++; }
      if (acc > 3) acc = 0; // fell behind: drop time rather than spiral
    }
    renderer.draw(sim, state.selected, now);
    drawPreview(now);
    drainEvents();
    frame++;
    if (frame % 8 === 0) updateStats();
    if (frame % 15 === 0) { drawChart(); updateLegend(); updateInspector(); }
    requestAnimationFrame(loop);
  }

  refreshTraits();
  renderRival();
  updateStats();
  updateLegend();
  requestAnimationFrame(loop);
})();
