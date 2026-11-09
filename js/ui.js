/* Evolution Arena — UI wiring, tools, camera and main loop. */
(function () {
  'use strict';
  const E = window.Evo;
  const W = window.EvoWorld;
  const C = window.EvoChallenges;
  const { T, TILE } = W;
  const $ = (s) => document.querySelector(s);
  const SAVE_KEY = 'evo-world-v1';

  const TRAIT_META = {
    speed:      { label: 'Speed',      short: 'move',     color: '#e39b2d', tip: 'Faster movement — but energy cost grows with the square of speed.' },
    size:       { label: 'Size',       short: 'mass',     color: '#8a6ad8', tip: 'Bigger bodies store more energy and hit harder, but cost more and turn slower.' },
    aggression: { label: 'Aggression', short: '4+ hunts', color: '#d9462b', tip: '4+ makes a hunter that eats other species. Hunters digest plants poorly.' },
    vision:     { label: 'Vision',     short: 'sight',    color: '#2a9bb5', tip: 'How far it can see food, prey and threats. Costs upkeep, and shrinks at night.' },
    armor:      { label: 'Armor',      short: 'shell',    color: '#7a8590', tip: 'Reduces damage taken, spines hurt attackers, resists toxin. Heavy to carry.' },
    fertility:  { label: 'Fertility',  short: 'breed',    color: '#cf4f8c', tip: 'Breeds sooner and more often, sometimes twins — with smaller energy reserves.' },
  };

  const svg = (body) => `<svg viewBox="0 0 24 24" fill="none" stroke="#1d2326" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
  const TOOLS = [
    { id: 'inspect', name: 'Inspect', hint: 'click a cell to inspect it', icon: svg('<circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5 5"/>') },
    { id: 'food', name: 'Nutrients', hint: 'sprinkle food grains', brush: true, color: 'rgba(95,120,30,0.9)',
      icon: svg('<circle cx="7" cy="8" r="2" fill="#7f9b2e"/><circle cx="15" cy="6" r="2" fill="#7f9b2e"/><circle cx="12" cy="13" r="2" fill="#7f9b2e"/><circle cx="6" cy="17" r="2" fill="#7f9b2e"/><circle cx="17" cy="16" r="2" fill="#7f9b2e"/>') },
    { id: 'rock', name: 'Rock', terrain: T.ROCK, hint: "walls cells can't pass", brush: true },
    { id: 'water', name: 'Water', terrain: T.WATER, hint: 'ponds: cells swim at half speed, nothing grows', brush: true },
    { id: 'soil', name: 'Soil', terrain: T.SOIL, hint: 'fertile ground: extra food and fresh spores', brush: true },
    { id: 'toxin', name: 'Toxin', terrain: T.TOXIN, hint: 'drains energy (armor resists) and kills mold', brush: true },
    { id: 'mold', name: 'Mold', brush: true, color: 'rgba(38,84,72,0.9)',
      icon: svg('<rect x="3" y="3" width="5" height="5" fill="#b9d6c6"/><rect x="10" y="3" width="5" height="5" fill="#f2fbf5"/><rect x="16" y="10" width="5" height="5" fill="#b9d6c6"/><rect x="3" y="16" width="5" height="5" fill="#f2fbf5"/><rect x="10" y="16" width="5" height="5" fill="#b9d6c6"/><rect x="16" y="16" width="5" height="5" fill="#f2fbf5"/>') },
    { id: 'erase', name: 'Eraser', hint: 'back to bare agar, scrapes off mold', brush: true,
      icon: svg('<path d="M4 15l8-8 7 7-6 6H8z" fill="#f3e6bd"/><path d="M9 20h11"/>') },
    { id: 'zap', name: 'UV lamp', hint: 'sterilise: kills every cell under the lamp', brush: true, color: 'rgba(120,80,230,0.9)',
      icon: svg('<path d="M13 2L5 14h6l-1 8 8-12h-6z" fill="#b8a3ff"/>') },
  ];

  const EVENT_LABELS = { bloom: 'Bloom', heat: 'Heat wave', cold: 'Cold snap', meteor: 'Meteor', flood: 'Flood', outbreak: 'Outbreak' };

  const state = {
    mode: 'ecosystem',
    traits: { speed: 5, size: 6, aggression: 5, vision: 6, armor: 4, fertility: 4 },
    rival: E.randomTraits(),
    rivalName: E.randomName(),
    speed: 1,
    paused: false,
    selected: null,
    locked: false,
    tool: 0,
    brush: 2,
    pattern: 'spray',
    mouse: null,
    follow: false,
    keys: new Set(),
    meteorWatch: 0,
    duskHadPlayer: false,
  };
  const progress = C.load();

  const stage = $('#stage');
  const canvas = $('#world');
  const renderer = new window.EvoRenderer(canvas);
  const sim = new E.Sim();
  const view = renderer.view;
  view.x = sim.w / 2;
  view.y = sim.h / 2;

  const fmtTime = (ticks) => {
    const s = Math.floor(ticks / 60);
    return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  };
  const pipsHTML = (v, interactive) =>
    `<div class="pips">${Array.from({ length: E.MAX_TRAIT }, (_, i) =>
      `<button class="pip${i < v ? ' on' : ''}" ${interactive ? `data-v="${i + 1}" aria-label="Set to ${i + 1}"` : 'tabindex="-1" aria-hidden="true"'}></button>`).join('')}</div>`;
  const duelRunning = () => sim.duel && !sim.duel.over;

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
    updateToolLabel();
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

  $('#reroll').addEventListener('click', () => { newRival(); resetWorld({ keepWorld: true }); });

  /* ------------------------------------------------------------ modes & world lifecycle */

  function setModeUI(mode) {
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
    $('#save-world').disabled = mode !== 'ecosystem';
    if (mode === 'duel') renderRival();
  }

  function setMode(mode) {
    if (state.mode === mode) return;
    setModeUI(mode);
    resetWorld({ keepWorld: true });
    note(mode === 'duel'
      ? 'Duel: build your arena with the hotbar, then start. Two minutes, last lineage standing wins.'
      : 'Ecosystem: release species into the dish and see who endures.', null);
  }
  document.querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));

  function resetWorld(opts) {
    sim.reset(state.mode, opts || {});
    state.selected = null;
    state.follow = false;
    state.meteorWatch = 0;
    hideInspector();
    hideOverlay();
    lock(false);
    clearLog();
    drawChart();
    updateLegend();
  }
  $('#reset').addEventListener('click', () => resetWorld({ keepWorld: true }));
  $('#new-world').addEventListener('click', () => { resetWorld({}); note('A freshly poured dish: new terrain generated.', null); });
  $('#blank-world').addEventListener('click', () => { resetWorld({ blank: true }); note('A blank dish: bare agar, ready to build on.', null); });

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

  /* ------------------------------------------------------------ save / load */

  $('#save-world').addEventListener('click', () => {
    if (state.mode !== 'ecosystem') return;
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(sim.serialize()));
      note(`World saved (day ${sim.dayNumber()}, ${sim.orgs.length} cells).`, null);
      banner('World saved', 'stored in this browser', 'event', '#9fd47a', '✓');
    } catch (e) {
      note('Could not save: browser storage is unavailable or full.', null);
    }
  });
  $('#load-world').addEventListener('click', () => {
    let data = null;
    try { data = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); } catch (e) { data = null; }
    if (!data) { note('No saved world in this browser yet.', null); return; }
    setModeUI('ecosystem');
    if (!sim.deserialize(data)) { note('That save could not be read.', null); sim.reset('ecosystem'); return; }
    state.selected = null;
    hideInspector();
    hideOverlay();
    lock(false);
    clearLog();
    $('#rule').value = sim.world.ruleName;
    $('#events-on').checked = sim.eventsOn;
    renderRuleHelp();
    note(`World loaded: day ${sim.dayNumber()}, ${sim.orgs.length} cells.`, null);
  });

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

  /* ------------------------------------------------------------ hotbar & tools */

  const hotbar = $('#hotbar');
  TOOLS.forEach((t, i) => {
    const b = document.createElement('button');
    b.className = 'slot';
    b.title = `${t.name} (${i + 1})`;
    b.innerHTML = `<span class="num">${i + 1}</span>`;
    if (t.terrain !== undefined) b.appendChild(renderer.tileIcon(t.terrain, 60));
    else b.insertAdjacentHTML('beforeend', t.icon);
    b.addEventListener('click', () => setTool(i));
    hotbar.appendChild(b);
  });

  function setTool(i) {
    state.tool = Math.max(0, Math.min(TOOLS.length - 1, i));
    hotbar.querySelectorAll('.slot').forEach((s, k) => s.classList.toggle('active', k === state.tool));
    canvas.style.cursor = TOOLS[state.tool].id === 'inspect' ? 'pointer' : 'crosshair';
    updateToolLabel();
  }

  function updateToolLabel() {
    const t = TOOLS[state.tool];
    let hint = t.hint;
    if (t.id === 'mold') {
      hint = state.pattern === 'spray' ? 'spray living spores' : `click to stamp a ${W.PATTERN_NAMES[state.pattern].toLowerCase()}`;
    }
    let text = `${t.name}: ${hint}`;
    if (t.brush && !(t.id === 'mold' && state.pattern !== 'spray')) text += ` · brush ${state.brush}`;
    if (t.id !== 'inspect' && duelRunning()) text = 'Tools are locked while the duel runs. Build your arena before you start.';
    $('#tool-label').textContent = text;
  }

  const brushRadius = () => (state.brush - 0.5) * TILE;
  function setBrush(b) {
    state.brush = Math.max(1, Math.min(8, b));
    updateToolLabel();
  }

  let lastApply = 0;
  function applyTool(x, y, first) {
    const t = TOOLS[state.tool];
    if (duelRunning()) return;
    if (Math.hypot(x - sim.cx, y - sim.cy) > sim.R) return;
    const now = performance.now();
    const throttled = !first && now - lastApply < 80;
    const r = brushRadius();
    const w = sim.world;
    if (t.terrain !== undefined) {
      progress.blocks += w.paint(x, y, r, t.terrain);
    } else if (t.id === 'erase') {
      w.paint(x, y, r, T.AGAR);
      w.eraseMold(x, y, r);
    } else if (t.id === 'mold') {
      if (state.pattern === 'spray') {
        if (throttled) return;
        w.sprayMold(x, y, r + 4, 0.5);
      } else {
        if (!first) return;
        w.stamp(x, y, state.pattern);
        if (state.pattern === 'gun') progress.guns++;
        renderer.ripple(x, y, '38,84,72');
      }
    } else if (t.id === 'food') {
      if (throttled) return;
      sim.dropFood(x, y, 2 + state.brush * 2);
      if (first) renderer.ripple(x, y);
    } else if (t.id === 'zap') {
      if (throttled) return;
      sim.zap(x, y, Math.max(10, r));
      renderer.effect('zap', x, y);
    } else {
      return;
    }
    lastApply = now;
  }

  /* ------------------------------------------------------------ camera */

  function zoomAt(sx, sy, factor) {
    const [wx, wy] = renderer.screenToWorld(sim, sx, sy);
    view.zoom = Math.max(1, Math.min(6, view.zoom * factor));
    const s = renderer.scale(sim);
    view.x = wx - (sx - renderer.w / 2) / s;
    view.y = wy - (sy - renderer.viewH() / 2) / s;
    renderer.clampView(sim);
  }
  function resetView() {
    view.zoom = 1;
    view.x = sim.w / 2;
    view.y = sim.h / 2;
    state.follow = false;
  }
  $('#zoom-in').addEventListener('click', () => zoomAt(renderer.w / 2, renderer.viewH() / 2, 1.4));
  $('#zoom-out').addEventListener('click', () => zoomAt(renderer.w / 2, renderer.viewH() / 2, 1 / 1.4));
  $('#zoom-reset').addEventListener('click', resetView);

  function toggleFollow() {
    if (!state.selected || !state.selected.alive) { state.follow = false; return; }
    state.follow = !state.follow;
    if (state.follow && view.zoom < 2.5) view.zoom = 2.5;
    note(state.follow ? `Following ${state.selected.sp.name}. Press F or Esc to stop.` : 'Stopped following.', state.follow ? state.selected.hue : null);
  }

  /* ------------------------------------------------------------ dish input */

  let drag = null;
  const local = (e) => {
    const rect = canvas.getBoundingClientRect();
    return [e.clientX - rect.left, e.clientY - rect.top];
  };

  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('pointerdown', (e) => {
    const [sx, sy] = local(e);
    const [x, y] = renderer.screenToWorld(sim, sx, sy);
    canvas.setPointerCapture(e.pointerId);
    if (e.button === 1 || e.button === 2 || (e.button === 0 && e.shiftKey)) {
      drag = { kind: 'pan', sx, sy };
      state.follow = false;
      canvas.style.cursor = 'grabbing';
      return;
    }
    if (e.button !== 0) return;
    if (TOOLS[state.tool].id === 'inspect') {
      const o = sim.pick(x, y);
      if (o) { state.selected = o; showInspector(); }
      else { state.selected = null; state.follow = false; hideInspector(); }
      return;
    }
    drag = { kind: 'paint', x, y };
    applyTool(x, y, true);
  });

  canvas.addEventListener('pointermove', (e) => {
    const [sx, sy] = local(e);
    const [x, y] = renderer.screenToWorld(sim, sx, sy);
    state.mouse = { x, y };
    if (!drag) return;
    if (drag.kind === 'pan') {
      const s = renderer.scale(sim);
      view.x -= (sx - drag.sx) / s;
      view.y -= (sy - drag.sy) / s;
      drag.sx = sx;
      drag.sy = sy;
    } else {
      // Interpolate so fast strokes leave no gaps.
      const d = Math.hypot(x - drag.x, y - drag.y), steps = Math.max(1, Math.ceil(d / (TILE * 0.5)));
      for (let k = 1; k <= steps; k++) applyTool(drag.x + ((x - drag.x) * k) / steps, drag.y + ((y - drag.y) * k) / steps, false);
      drag.x = x;
      drag.y = y;
    }
  });

  const endDrag = () => {
    if (drag && drag.kind === 'pan') canvas.style.cursor = TOOLS[state.tool].id === 'inspect' ? 'pointer' : 'crosshair';
    drag = null;
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('pointerleave', () => { state.mouse = null; });

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const [sx, sy] = local(e);
    zoomAt(sx, sy, Math.exp(-e.deltaY * 0.0015));
  }, { passive: false });

  /* ------------------------------------------------------------ keyboard */

  const PAN_KEYS = { w: [0, -1], a: [-1, 0], s: [0, 1], d: [1, 0], arrowup: [0, -1], arrowleft: [-1, 0], arrowdown: [0, 1], arrowright: [1, 0] };
  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const tag = e.target.tagName;
    if (tag === 'SELECT' || (tag === 'INPUT' && e.target.type !== 'checkbox')) return;
    const k = e.key.toLowerCase();
    if (PAN_KEYS[k]) { state.keys.add(k); state.follow = false; e.preventDefault(); return; }
    if (e.code === 'Space') { e.preventDefault(); setSpeed(state.paused ? state.speed : 0); }
    else if (/^[1-9]$/.test(e.key)) setTool(+e.key - 1);
    else if (k === '[') setBrush(state.brush - 1);
    else if (k === ']') setBrush(state.brush + 1);
    else if (k === '+' || k === '=') zoomAt(renderer.w / 2, renderer.viewH() / 2, 1.4);
    else if (k === '-' || k === '_') zoomAt(renderer.w / 2, renderer.viewH() / 2, 1 / 1.4);
    else if (k === '0') resetView();
    else if (k === 'f') toggleFollow();
    else if (k === 'r') release();
    else if (k === 'escape') { state.selected = null; state.follow = false; hideInspector(); }
  });
  window.addEventListener('keyup', (e) => state.keys.delete(e.key.toLowerCase()));
  window.addEventListener('blur', () => state.keys.clear());

  /* ------------------------------------------------------------ world card */

  const ruleSel = $('#rule');
  ruleSel.innerHTML = Object.entries(W.RULES).map(([k, r]) => `<option value="${k}">${r.label} (${r.rule})</option>`).join('');
  function renderRuleHelp() {
    const r = W.RULES[sim.world.ruleName].rule;
    const [, b, s] = /B(\d*)\/S(\d*)/.exec(r);
    const list = (d) => (d ? d.split('').join(', ') : 'never');
    $('#rule-help').textContent =
      `Bare agar sprouts mold with ${list(b)} mold neighbours. A mold cell survives with ${s ? list(s) : 'no'} neighbours, otherwise it dies of loneliness or overcrowding. Cells eat mold when hungry.`;
  }
  ruleSel.addEventListener('change', () => {
    sim.world.setRule(ruleSel.value);
    renderRuleHelp();
    note(`Mold now follows ${W.RULES[ruleSel.value].label} (${W.RULES[ruleSel.value].rule}).`, 150);
  });

  const patSel = $('#pattern');
  patSel.innerHTML = Object.entries(W.PATTERN_NAMES).map(([k, n]) => `<option value="${k}">${n}</option>`).join('');
  patSel.addEventListener('change', () => {
    state.pattern = patSel.value;
    setTool(TOOLS.findIndex((t) => t.id === 'mold'));
  });

  $('#events-on').addEventListener('change', (e) => { sim.eventsOn = e.target.checked; });
  $('#event-btns').innerHTML = E.EVENT_TYPES.map((t) => `<button data-ev="${t}" title="Trigger now">${EVENT_LABELS[t]}</button>`).join('');
  $('#event-btns').addEventListener('click', (e) => {
    const t = e.target.closest('[data-ev]');
    if (!t) return;
    if (duelRunning()) { note('World events are paused during a duel.', null); return; }
    sim.triggerEvent(t.dataset.ev);
  });

  /* ------------------------------------------------------------ inspector */

  const inspector = $('#inspector');
  inspector.addEventListener('click', (e) => {
    if (e.target.closest('.ins-close')) { state.selected = null; state.follow = false; hideInspector(); }
    if (e.target.closest('.ins-follow')) toggleFollow();
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
    const ground = W.TERRAIN_NAMES[sim.world.at(o.x, o.y)];
    const crowdPct = Math.round(o.crowd * 6);
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
      <div class="ins-crowd${o.crowd >= 5 ? ' warn' : ''}">${o.crowd} kin nearby${o.crowd ? ` · +${crowdPct}% upkeep` : ''}${o.crowd >= 5 ? ' (crowded)' : ''} · on ${ground}</div>
      <div class="ins-foot">age ${Math.round(o.age / 60)}s · ${o.children} offspring · ${o.kills} kill${o.kills === 1 ? '' : 's'}
        ${o.alive ? ` · <button class="link ins-follow">${state.follow ? 'unfollow' : 'follow (F)'}</button>` : ''}</div>`;
  }

  /* ------------------------------------------------------------ field notes & banners */

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

  const bannerEl = $('#banner');
  function banner(title, sub, kind, color, glyph) {
    const el = document.createElement('div');
    el.className = `banner-item ${kind || ''}`;
    if (color) el.style.setProperty('--b', color);
    el.innerHTML = `<span class="badge">${glyph || '★'}</span><div><small></small><b></b></div>`;
    el.querySelector('small').textContent = sub;
    el.querySelector('b').textContent = title;
    bannerEl.prepend(el);
    while (bannerEl.children.length > 3) bannerEl.lastChild.remove();
    setTimeout(() => el.classList.add('out'), 4200);
    setTimeout(() => el.remove(), 4800);
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
    if (ev.result === 'win') progress.duelsWon++;
    lock(false);
  }
  overlay.addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'rematch') startDuel();
    else if (act === 'new') { newRival(); resetWorld({ keepWorld: true }); }
    else if (act === 'watch') hideOverlay();
  });

  /* ------------------------------------------------------------ sim events */

  function drainEvents() {
    if (!sim.events.length) return;
    const st = sim.stats();
    for (const ev of sim.events) {
      if (ev.type === 'duel-end') { showDuelResult(ev); continue; }
      note(ev.text, ev.hue);
      if (ev.type === 'release') progress.releases++;
      else if (ev.type === 'extinct') progress.extinctions++;
      else if (ev.type === 'event') {
        banner(ev.text.split(':')[0].split('!')[0], 'world event', 'event', `hsl(${ev.hue},80%,65%)`, '!');
        if (ev.fx) renderer.effect(ev.fx, ev.x, ev.y);
        if (ev.fx === 'meteor' && st.player > 0) state.meteorWatch = sim.tick + 1800;
      } else if (ev.type === 'sky') {
        if (sim.night) state.duskHadPlayer = st.player > 0;
        else if (state.duskHadPlayer && st.player > 0) progress.nightsSurvived++;
      }
    }
    sim.events.length = 0;
  }

  /* ------------------------------------------------------------ challenges */

  const challengeList = $('#challenges');
  function renderChallenges() {
    const done = C.LIST.filter((c) => progress.done[c.id]).length;
    $('#challenge-sub').textContent = `${done} / ${C.LIST.length} complete`;
    challengeList.innerHTML = C.LIST.map((c) => `
      <li class="${progress.done[c.id] ? 'done' : ''}">
        <span class="box">${progress.done[c.id] ? '✓' : ''}</span>
        <div><b>${c.title}</b><small>${c.desc}</small></div>
      </li>`).join('');
  }
  let lastProgressSave = 0;
  function checkChallenges(stats) {
    if (state.meteorWatch && sim.tick >= state.meteorWatch) {
      if (stats.player > 0) progress.meteorSurvived++;
      state.meteorWatch = 0;
    }
    const fresh = C.evaluate({ sim, stats, progress });
    for (const c of fresh) {
      banner(c.title, 'challenge complete', '', null, '✓');
      note(`Challenge complete: ${c.title}`, 45);
    }
    if (fresh.length) renderChallenges();
    if (performance.now() - lastProgressSave > 5000) { C.save(progress); lastProgressSave = performance.now(); }
  }

  /* ------------------------------------------------------------ census */

  const PARTS = [[0.2, 'night'], [0.3, 'dawn'], [0.45, 'morning'], [0.6, 'midday'], [0.75, 'afternoon'], [0.83, 'dusk'], [1.01, 'night']];
  function updateStats() {
    const st = sim.stats();
    $('#s-orgs').textContent = st.organisms;
    $('#s-gen').textContent = st.generation;
    $('#s-species').textContent = st.species;
    $('#s-food').textContent = st.food;
    $('#s-mold').textContent = st.mold;

    const phase = sim.dayPhase();
    const mins = Math.floor(phase * 24 * 60);
    $('#clock-text').textContent = `day ${st.day} · ${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
    const sky = $('#sky');
    const L = sim.light;
    sky.style.setProperty('--sky', L > 0.55 ? '#f5c542' : L > 0.25 ? '#f08a4b' : '#e9e6ff');
    sky.style.setProperty('--moon', L > 0.25 ? '0' : '4px');
    const part = PARTS.find(([p]) => phase < p)[1];
    const fx = [];
    if (sim.tick < sim.effects.heat) fx.push(`heat wave ${Math.ceil((sim.effects.heat - sim.tick) / 60)}s`);
    if (sim.tick < sim.effects.cold) fx.push(`cold snap ${Math.ceil((sim.effects.cold - sim.tick) / 60)}s`);
    $('#world-sub').textContent = [`day ${st.day} · ${part}`, ...fx].join(' · ');

    if (state.mode === 'duel') {
      const D = sim.duel;
      $('#s-lineage').textContent = D ? `${D.player.count}:${D.rival.count}` : '–';
      const left = D ? Math.max(0, (D.over ? D.limit - D.endTick : D.limit - sim.tick) / 60) : E.DUEL_TICKS / 60;
      $('#s-time').textContent = `${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, '0')}`;
    } else {
      $('#s-lineage').textContent = st.player;
    }
    return st;
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
    const Wd = chart.clientWidth, H = chart.clientHeight;
    g.setTransform(chartDpr, 0, 0, chartDpr, 0, 0);
    g.clearRect(0, 0, Wd, H);
    const N = E.HISTORY_MAX, end = sim.sampleIdx, start = end - N;
    let max = 10;
    for (const s of sim.species) for (const v of s.hist) if (v > max) max = v;
    const pad = 6;
    g.strokeStyle = 'rgba(120,100,60,0.12)';
    g.lineWidth = 1;
    g.beginPath();
    for (let x = 0; x <= Wd; x += 16) { g.moveTo(x + 0.5, 0); g.lineTo(x + 0.5, H); }
    for (let y = 0; y <= H; y += 16) { g.moveTo(0, y + 0.5); g.lineTo(Wd, y + 0.5); }
    g.stroke();
    g.font = '10px "IBM Plex Mono", monospace';
    g.fillStyle = '#a29d8e';
    g.fillText(String(max), 4, 12);

    const xs = (i) => ((i - start) / N) * Wd;
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
      legend.innerHTML = `<li class="empty">${state.mode === 'duel' ? 'Build an arena, then press "Start duel".' : 'The dish is sterile. Release a species.'}</li>`;
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
    renderer.insetBottom = $('.dock').offsetHeight + 14;
    renderer.resize(Math.max(200, stage.clientWidth), Math.max(200, stage.clientHeight));
    sizeChart();
    sizeSpecimen();
    drawChart();
  }
  new ResizeObserver(resize).observe(stage);
  resize();

  function updateCamera(dt) {
    if (state.keys.size) {
      let dx = 0, dy = 0;
      for (const k of state.keys) { dx += PAN_KEYS[k][0]; dy += PAN_KEYS[k][1]; }
      const sp = (420 * dt) / view.zoom;
      view.x += dx * sp;
      view.y += dy * sp;
    }
    if (state.follow) {
      const o = state.selected;
      if (!o || !o.alive) state.follow = false;
      else {
        view.x += (o.x - view.x) * 0.12;
        view.y += (o.y - view.y) * 0.12;
      }
    }
  }

  function cursorInfo() {
    const t = TOOLS[state.tool];
    if (!state.mouse || t.id === 'inspect' || duelRunning() || drag?.kind === 'pan') return null;
    if (Math.hypot(state.mouse.x - sim.cx, state.mouse.y - sim.cy) > sim.R) return null;
    const stampMode = t.id === 'mold' && state.pattern !== 'spray';
    return {
      x: state.mouse.x,
      y: state.mouse.y,
      r: stampMode ? TILE * 2 : t.id === 'zap' ? Math.max(10, brushRadius()) : brushRadius() + (t.id === 'mold' ? 4 : 0),
      color: t.color,
    };
  }

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
    updateCamera(dt);
    renderer.draw(sim, { selected: state.selected, cursor: cursorInfo() }, now);
    drawSpecimen(now);
    drainEvents();
    frame++;
    if (frame % 8 === 0) {
      const st = updateStats();
      if (frame % 32 === 0) checkChallenges(st);
    }
    if (frame % 15 === 0) { drawChart(); updateLegend(); updateInspector(); updateToolLabel(); }
    requestAnimationFrame(loop);
  }

  setModeUI('ecosystem');
  setTool(0);
  renderTraits();
  renderRival();
  renderRuleHelp();
  renderChallenges();
  clearLog();
  note('Welcome to the dish. Release a species, then shape the world with the hotbar below.', null);
  updateStats();
  updateLegend();
  requestAnimationFrame(loop);
})();
