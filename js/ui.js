/* Evolution Arena — UI wiring and main loop. */
(function () {
  'use strict';
  const E = window.Evo;
  const $ = (s) => document.querySelector(s);

  const TRAIT_META = {
    speed:      { label: 'Speed',      short: 'move',     color: '#e39b2d', tip: 'Faster movement — but energy cost grows with the square of speed.' },
    size:       { label: 'Size',       short: 'mass',     color: '#8a6ad8', tip: 'Bigger bodies store more energy and hit harder, but cost more and turn slower.' },
    aggression: { label: 'Aggression', short: '4+ hunts', color: '#d9462b', tip: '4+ makes a hunter that eats other species. Hunters digest plants poorly.' },
    vision:     { label: 'Vision',     short: 'sight',    color: '#2a9bb5', tip: 'How far it can see food, prey and threats. Costs upkeep.' },
    armor:      { label: 'Armor',      short: 'shell',    color: '#7a8590', tip: 'Reduces damage taken and spines hurt attackers. Heavy to carry.' },
    fertility:  { label: 'Fertility',  short: 'breed',    color: '#cf4f8c', tip: 'Breeds sooner and more often, sometimes twins — with smaller energy reserves.' },
  };

  const state = {
    mode: 'ecosystem',
    traits: { speed: 5, size: 6, aggression: 5, vision: 6, armor: 4, fertility: 4 },
    rival: E.randomTraits(),
    rivalName: E.randomName(),
    speed: 1,
    paused: false,
    selected: null,
    locked: false,
  };

  const stage = $('#stage');
  const canvas = $('#world');
  const renderer = new window.EvoRenderer(canvas);
  const sim = new E.Sim(Math.max(200, stage.clientWidth), Math.max(200, stage.clientHeight));

  const fmtTime = (ticks) => {
    const s = Math.floor(ticks / 60);
    return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  };
  const pipsHTML = (v, interactive) =>
    `<div class="pips">${Array.from({ length: E.MAX_TRAIT }, (_, i) =>
      `<button class="pip${i < v ? ' on' : ''}" ${interactive ? `data-v="${i + 1}" aria-label="Set to ${i + 1}"` : 'tabindex="-1" aria-hidden="true"'}></button>`).join('')}</div>`;

  /* ------------------------------------------------------------ genome editor */

  const traitsEl = $('#traits');
  function setTrait(k, v) {
    if (state.locked) return;
    const others = E.sumTraits(state.traits) - state.traits[k];
    state.traits[k] = Math.max(0, Math.min(E.MAX_TRAIT, v, E.BUDGET - others));
    renderTraits();
  }

  function renderTraits() {
    const used = E.sumTraits(state.traits);
    const left = E.BUDGET - used;
    traitsEl.innerHTML = E.TRAITS.map((k) => {
      const m = TRAIT_META[k], v = state.traits[k];
      return `<div class="trait" data-k="${k}" style="--c:${m.color}" title="${m.tip}">
        <span class="trait-name">${m.label} <small>${m.short}</small></span>
        <div class="stepper">
          <button data-d="-1" aria-label="Less ${m.label}" ${state.locked || v <= 0 ? 'disabled' : ''}>−</button>
          <output>${v}</output>
          <button data-d="1" aria-label="More ${m.label}" ${state.locked || v >= E.MAX_TRAIT || left <= 0 ? 'disabled' : ''}>+</button>
        </div>
        ${pipsHTML(v, true)}
      </div>`;
    }).join('');
    if (state.locked) traitsEl.querySelectorAll('.pip').forEach((p) => (p.disabled = true));
    $('#points-used').textContent = used;
    $('#budget-fill').style.width = (used / E.BUDGET) * 100 + '%';
    $('.budget').classList.toggle('full', left === 0);
    $('#genome-sub').textContent = state.locked
      ? 'locked during the duel'
      : left > 0 ? `${left} point${left === 1 ? '' : 's'} unspent` : 'all points spent';
  }

  traitsEl.addEventListener('click', (e) => {
    const row = e.target.closest('.trait');
    if (!row) return;
    const k = row.dataset.k;
    const step = e.target.closest('[data-d]');
    const pip = e.target.closest('.pip');
    if (step) setTrait(k, state.traits[k] + +step.dataset.d);
    else if (pip) {
      const v = +pip.dataset.v;
      setTrait(k, v === state.traits[k] ? v - 1 : v); // click the top pip again to lower it
    }
  });

  function lock(locked) {
    state.locked = locked;
    $('#randomize').disabled = locked;
    $('#reroll').disabled = locked;
    renderTraits();
  }

  $('#randomize').addEventListener('click', () => {
    state.traits = E.randomTraits();
    renderTraits();
  });

  /* ------------------------------------------------------------ rival */

  function renderRival() {
    $('#rival-name').textContent = state.rivalName;
    $('#rival-bars').innerHTML = E.TRAITS.map((k) => {
      const m = TRAIT_META[k];
      return `<div class="rbar" style="--c:${m.color}"><span>${m.label}</span>${pipsHTML(state.rival[k], false)}<output>${state.rival[k]}</output></div>`;
    }).join('');
  }

  function newRival() {
    state.rival = E.randomTraits();
    state.rivalName = E.randomName();
    renderRival();
  }

  $('#reroll').addEventListener('click', () => { newRival(); resetWorld(); });

  /* ------------------------------------------------------------ modes */

  function setMode(mode) {
    if (state.mode === mode) return;
    state.mode = mode;
    document.querySelectorAll('.tab').forEach((b) => {
      const on = b.dataset.mode === mode;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', on);
    });
    $('#rival').hidden = mode !== 'duel';
    $('#duel-tile').hidden = mode !== 'duel';
    $('#release').textContent = mode === 'duel' ? 'Start duel' : 'Release';
    $('#s-lineage-label').textContent = mode === 'duel' ? 'you : rival' : 'yours';
    if (mode === 'duel') renderRival();
    resetWorld();
    note(mode === 'duel'
      ? 'Duel: two species, one dish, two minutes. Last lineage standing wins.'
      : 'Ecosystem: release species into a living dish and see who endures.', null);
  }
  document.querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));

  function resetWorld() {
    sim.reset(state.mode);
    state.selected = null;
    hideInspector();
    hideOverlay();
    lock(false);
    clearLog();
    drawChart();
    updateLegend();
  }
  $('#reset').addEventListener('click', resetWorld);

  let releaseLockUntil = 0;
  function release() {
    if (state.mode === 'duel') return startDuel();
    if (performance.now() < releaseLockUntil) return;
    sim.release(Object.assign({}, state.traits));
    releaseLockUntil = performance.now() + 1200;
    const btn = $('#release');
    btn.disabled = true;
    setTimeout(() => (btn.disabled = false), 1200);
  }

  function startDuel() {
    clearLog();
    sim.startDuel(Object.assign({}, state.traits), Object.assign({}, state.rival), state.rivalName);
    state.selected = null;
    hideInspector();
    hideOverlay();
    lock(true);
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
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.code === 'Space') { e.preventDefault(); setSpeed(state.paused ? state.speed : 0); }
    else if (e.key === 'r' || e.key === 'R') release();
    else if (e.key === '1') setSpeed(1);
    else if (e.key === '2') setSpeed(2);
    else if (e.key === '3' || e.key === '4') setSpeed(4);
    else if (e.key === 'Escape') { state.selected = null; hideInspector(); }
  });

  /* ------------------------------------------------------------ dish input */

  canvas.addEventListener('pointerdown', (e) => {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    const o = sim.pick(x, y);
    if (o) {
      state.selected = o;
      showInspector();
      return;
    }
    state.selected = null;
    hideInspector();
    if (Math.hypot(x - sim.cx, y - sim.cy) < sim.R) {
      sim.dropFood(x, y, 10);
      renderer.ripple(x, y);
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
    const status = o.alive ? `gen ${o.gen} · ${E.MODE_NAMES[o.mode]}` : `<span class="ins-dead">died · ${o.cause}</span>`;
    const ePct = Math.max(0, Math.min(100, (o.energy / o.d.maxEnergy) * 100));
    const owner = sp.owner === 'player' ? ' (yours)' : sp.owner === 'rival' ? ' (rival)' : '';
    inspector.innerHTML = `
      <div class="ins-head">
        <i class="swatch" style="--h:${Math.round(o.hue)}"></i>
        <div><div class="ins-name">${sp.name}${owner}</div><div class="ins-sub">${status}</div></div>
        <button class="ins-close" aria-label="Close">×</button>
      </div>
      <div class="ins-energy"><span>energy</span><div class="track"><b style="width:${ePct}%"></b></div>
        <span>${Math.max(0, Math.round(o.energy))}/${Math.round(o.d.maxEnergy)}</span></div>
      <div class="ins-traits">
        ${E.TRAITS.map((k) => `
          <div class="ins-trait" style="--c:${TRAIT_META[k].color}">
            <span>${TRAIT_META[k].label}</span>
            <div class="track" title="Black mark = species founder"><b style="width:${o.t[k] * 10}%"></b><s style="left:calc(${sp.traits[k] * 10}% - 1px)"></s></div>
            <output>${o.t[k].toFixed(1)}</output>
          </div>`).join('')}
      </div>
      <div class="ins-foot">age ${Math.round(o.age / 60)}s · ${o.children} offspring · ${o.kills} kill${o.kills === 1 ? '' : 's'}</div>`;
  }

  /* ------------------------------------------------------------ field notes */

  const log = $('#log');
  function clearLog() {
    log.innerHTML = '<li class="empty">Nothing observed yet.</li>';
  }
  function note(text, hue) {
    log.querySelector('.empty')?.remove();
    const li = document.createElement('li');
    li.innerHTML = `<time>${fmtTime(sim.tick)}</time>${hue == null ? '<span></span>' : `<i class="swatch" style="--h:${Math.round(hue)}"></i>`}<span></span>`;
    li.lastChild.textContent = text;
    log.prepend(li);
    while (log.children.length > 40) log.lastChild.remove();
  }

  /* ------------------------------------------------------------ duel verdict */

  const overlay = $('#overlay');
  function hideOverlay() { overlay.hidden = true; overlay.innerHTML = ''; }
  function showDuelResult(ev) {
    const D = sim.duel;
    const title = { win: 'Victory', lose: 'Defeat', draw: 'Draw' }[ev.result];
    const secs = Math.round(D.endTick / 60);
    let line;
    if (ev.result === 'win' && ev.rival === 0) line = `${D.rival.name} was wiped out in ${secs}s. Your lineage reached generation ${D.player.maxGen}.`;
    else if (ev.result === 'lose' && ev.you === 0) line = `Your lineage collapsed after ${secs}s. ${D.rival.name} reached generation ${D.rival.maxGen}.`;
    else line = `Time's up: ${ev.you} of yours vs ${ev.rival} ${D.rival.name}.`;
    overlay.innerHTML = `
      <div class="verdict">
        <div class="kicker">duel result</div>
        <h2 class="${ev.result}">${title}</h2>
        <p>${line}</p>
        <div class="row">
          <button class="btn btn-main" data-act="rematch">Rematch</button>
          <button class="btn btn-quiet" data-act="new">New rival</button>
          <button class="btn btn-quiet" data-act="watch">Keep watching</button>
        </div>
      </div>`;
    overlay.hidden = false;
    note(`Duel ${ev.result === 'win' ? 'won' : ev.result === 'lose' ? 'lost' : 'drawn'}`, D.player.hue);
    lock(false);
  }
  overlay.addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'rematch') startDuel();
    else if (act === 'new') { newRival(); resetWorld(); }
    else if (act === 'watch') hideOverlay();
  });

  /* ------------------------------------------------------------ census */

  function drainEvents() {
    if (!sim.events.length) return;
    for (const ev of sim.events) {
      if (ev.type === 'duel-end') showDuelResult(ev);
      else note(ev.text, ev.hue);
    }
    sim.events.length = 0;
  }

  function updateStats() {
    const st = sim.stats();
    $('#s-orgs').textContent = st.organisms;
    $('#s-gen').textContent = st.generation;
    $('#s-species').textContent = st.species;
    $('#s-food').textContent = st.food;
    $('#clock').textContent = 't ' + fmtTime(sim.tick);
    if (state.mode === 'duel') {
      const D = sim.duel;
      $('#s-lineage').textContent = D ? `${D.player.count}:${D.rival.count}` : '–';
      const left = D ? Math.max(0, (D.over ? D.limit - D.endTick : D.limit - sim.tick) / 60) : E.DUEL_TICKS / 60;
      $('#s-time').textContent = `${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, '0')}`;
    } else {
      $('#s-lineage').textContent = st.player;
    }
  }

  const chart = $('#chart');
  const chartCtx = chart.getContext('2d');
  let chartDpr = 1;
  function sizeChart() {
    chartDpr = Math.min(window.devicePixelRatio || 1, 2);
    chart.width = Math.round(chart.clientWidth * chartDpr);
    chart.height = Math.round(chart.clientHeight * chartDpr);
  }

  function drawChart() {
    const g = chartCtx;
    const W = chart.clientWidth, H = chart.clientHeight;
    g.setTransform(chartDpr, 0, 0, chartDpr, 0, 0);
    g.clearRect(0, 0, W, H);
    const N = E.HISTORY_MAX, end = sim.sampleIdx, start = end - N;
    let max = 10;
    for (const s of sim.species) for (const v of s.hist) if (v > max) max = v;
    const pad = 6;
    // Graph-paper grid.
    g.strokeStyle = 'rgba(120,100,60,0.12)';
    g.lineWidth = 1;
    g.beginPath();
    for (let x = 0; x <= W; x += 16) { g.moveTo(x + 0.5, 0); g.lineTo(x + 0.5, H); }
    for (let y = 0; y <= H; y += 16) { g.moveTo(0, y + 0.5); g.lineTo(W, y + 0.5); }
    g.stroke();
    g.font = '10px "IBM Plex Mono", monospace';
    g.fillStyle = '#a29d8e';
    g.fillText(String(max), 4, 12);

    const xs = (i) => ((i - start) / N) * W;
    const ys = (v) => H - pad - (v / max) * (H - pad * 2);
    const ordered = sim.species.slice().sort((a, b) => (a.owner === 'player') - (b.owner === 'player'));
    for (const s of ordered) {
      if (!s.hist.length) continue;
      const mine = s.owner === 'player';
      g.strokeStyle = `hsl(${s.hue},60%,${mine ? 38 : 48}%)`;
      g.lineWidth = mine ? 2.2 : 1.3;
      g.setLineDash(mine || s.owner === 'rival' ? [] : [4, 2]);
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
    g.setLineDash([]);
  }

  const legend = $('#legend');
  function updateLegend() {
    const alive = sim.species.filter((s) => !s.extinct).sort((a, b) => b.count - a.count).slice(0, 7);
    if (!alive.length) {
      legend.innerHTML = `<li class="empty">${state.mode === 'duel' ? 'Press "Start duel" to begin.' : 'The dish is sterile. Release a species.'}</li>`;
      return;
    }
    legend.innerHTML = alive.map((s) => {
      const tag = s.owner === 'player' ? '<span class="tag you">yours</span>' : s.owner === 'rival' ? '<span class="tag rival">rival</span>' : '<span class="tag">wild</span>';
      return `<li><i class="swatch" style="--h:${Math.round(s.hue)}"></i><span class="name">${s.name}</span>${tag}<b>${s.count}</b></li>`;
    }).join('');
  }

  /* ------------------------------------------------------------ specimen preview */

  const specimen = $('#specimen');
  const sctx = specimen.getContext('2d');
  function sizeSpecimen() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    specimen.width = Math.round(specimen.clientWidth * dpr);
    specimen.height = Math.round(specimen.clientHeight * dpr);
    sctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function drawSpecimen(now) {
    const w = specimen.clientWidth, h = specimen.clientHeight;
    sctx.clearRect(0, 0, w, h);
    const t = state.traits;
    const d = E.derive(t);
    const hue = E.traitHue(t);
    const a = now * (0.0008 + t.speed * 0.00015);
    const x = w / 2 + 4 + Math.sin(a) * 6, y = h / 2 + Math.sin(a * 2) * 3;
    const vx = 0.4 + t.speed * 0.15, vy = Math.cos(a * 2) * 0.3;
    renderer.drawCell(sctx, x, y, vx, vy, d.radius * 1.6, hue, t.armor, d.hunter, 0, now);
  }

  /* ------------------------------------------------------------ resize & loop */

  function resize() {
    const w = Math.max(200, stage.clientWidth), h = Math.max(200, stage.clientHeight);
    renderer.resize(w, h);
    sim.resize(w, h);
    sizeChart();
    sizeSpecimen();
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
    drawSpecimen(now);
    drainEvents();
    frame++;
    if (frame % 8 === 0) updateStats();
    if (frame % 15 === 0) { drawChart(); updateLegend(); updateInspector(); }
    requestAnimationFrame(loop);
  }

  renderTraits();
  renderRival();
  clearLog();
  updateStats();
  updateLegend();
  requestAnimationFrame(loop);
})();
