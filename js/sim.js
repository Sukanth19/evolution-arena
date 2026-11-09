/*
 * Evolution Arena — simulation core.
 * Pure logic, no DOM: runs in the browser and in node (for headless balance tests).
 */
(function (root) {
  'use strict';

  const W = root.EvoWorld || (typeof require !== 'undefined' ? require('./world.js') : null);
  const { World } = W;

  const TRAITS = ['speed', 'size', 'aggression', 'vision', 'armor', 'fertility'];
  const BUDGET = 30;
  const MAX_TRAIT = 10;
  // Each trait "pulls" a species' colour toward its own hue.
  const TRAIT_HUES = { speed: 32, size: 268, aggression: 350, vision: 198, armor: 224, fertility: 318 };
  const FOOD_HUE = 158;
  const POP_CAP = 900;
  const MUTATION = 0.45;
  const HISTORY_MAX = 360;
  const SAMPLE_EVERY = 20;
  const DUEL_TICKS = 60 * 120;
  const CROWD_R2 = 45 * 45;
  const DENSITY_RATIO = 0.43; // density pressure bites at this fraction of the food cap
  const WORLD_SIZE = 820;
  const DAY_TICKS = 60 * 120; // one full day/night cycle = 2 minutes at 1×
  const MOLD_EVERY = 10; // ticks per mold generation
  const EVENT_TYPES = ['bloom', 'heat', 'cold', 'meteor', 'outbreak'];

  const WANDER = 0, FORAGE = 1, HUNT = 2, FLEE = 3;
  const MODE_NAMES = ['wandering', 'foraging', 'hunting', 'fleeing'];

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const rand = (a, b) => a + Math.random() * (b - a);
  function gauss() {
    let u = 0, v = 0;
    while (!u) u = Math.random();
    while (!v) v = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  const hueDiff = (a, b) => ((a - b + 540) % 360) - 180;

  function sumTraits(t) {
    let s = 0;
    for (const k of TRAITS) s += t[k] || 0;
    return s;
  }

  /* Rescale traits so they keep the same total: mutation shifts points, never adds them. */
  function normalizeTraits(t, total) {
    const out = {};
    for (const k of TRAITS) out[k] = clamp(t[k] || 0, 0, MAX_TRAIT);
    for (let pass = 0; pass < 5; pass++) {
      const s = sumTraits(out);
      if (s <= 0) break;
      const f = total / s;
      if (Math.abs(f - 1) < 1e-3) break;
      for (const k of TRAITS) out[k] = clamp(out[k] * f, 0, MAX_TRAIT);
    }
    return out;
  }

  function randomTraits() {
    const w = TRAITS.map(() => Math.pow(Math.random(), 1.4) + 0.08);
    const s = w.reduce((a, b) => a + b, 0);
    const t = {};
    let used = 0;
    TRAITS.forEach((k, i) => {
      t[k] = Math.min(MAX_TRAIT, Math.floor((w[i] / s) * BUDGET));
      used += t[k];
    });
    while (used < BUDGET) {
      const k = TRAITS[(Math.random() * TRAITS.length) | 0];
      if (t[k] < MAX_TRAIT) { t[k]++; used++; }
    }
    return t;
  }

  function avoidFoodHue(h) {
    const d = hueDiff(h, FOOD_HUE);
    if (Math.abs(d) < 42) h = FOOD_HUE + (d < 0 ? -42 : 42);
    return (h + 360) % 360;
  }

  function traitHue(t) {
    let x = 0, y = 0;
    for (const k of TRAITS) {
      const w = (t[k] || 0) * (t[k] || 0);
      const a = (TRAIT_HUES[k] * Math.PI) / 180;
      x += Math.cos(a) * w;
      y += Math.sin(a) * w;
    }
    if (x === 0 && y === 0) return 200;
    return avoidFoodHue((Math.atan2(y, x) * 180) / Math.PI + 360);
  }

  /* Traits (0..10) -> concrete physical stats. Every strength has an energy price. */
  function derive(t) {
    return {
      maxSpeed: 0.5 + t.speed * 0.21,
      radius: 2.2 + t.size * 0.42,
      vision: 26 + t.vision * 11,
      attack: t.aggression * (0.3 + t.size * 0.07),
      defense: 1 / (1 + t.armor * 0.3),
      maxEnergy: 70 + t.size * 9,
      reproAt: 0.9 - t.fertility * 0.025,
      cooldown: Math.round(260 - t.fertility * 17),
      maxAge: Math.round(3000 + t.size * 160 + t.armor * 60 - t.fertility * 80),
      baseCost: 0.018 + t.size * 0.0035 + t.vision * 0.0024 + t.armor * 0.0028 +
        t.aggression * 0.002 + t.fertility * 0.001,
      moveCost: 0.005 * (0.75 + t.size * 0.07 + t.armor * 0.03),
      foodGain: 22 * (1 - t.aggression * 0.055),
      hunter: t.aggression >= 4,
      agility: 0.2 - t.size * 0.009,
    };
  }

  const SYL_A = ['Vel', 'Mor', 'Cal', 'Nyx', 'Tor', 'Zep', 'Ar', 'Lum', 'Kry', 'Sol', 'Vex', 'Or', 'Pha', 'Ixa', 'Bel', 'Quo', 'Syl', 'Dra', 'Ery', 'Hal'];
  const SYL_B = ['ox', 'ith', 'ara', 'umi', 'ex', 'ion', 'ys', 'ora', 'ent', 'ax', 'ia', 'eon', 'ula', 'isk'];
  const pick = (arr) => arr[(Math.random() * arr.length) | 0];
  const randomName = () => pick(SYL_A) + pick(SYL_B);
  function roman(n) {
    const map = [[10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
    let s = '';
    if (n >= 40) return String(n);
    for (const [v, r] of map) while (n >= v) { s += r; n -= v; }
    return s;
  }

  /* Uniform bucket grid for neighbour queries. */
  class Grid {
    constructor(cell) {
      this.cell = cell;
      this.cols = 0;
      this.rows = 0;
      this.cells = [];
    }
    rebuild(items, w, h) {
      const cols = Math.max(1, Math.ceil(w / this.cell));
      const rows = Math.max(1, Math.ceil(h / this.cell));
      if (cols !== this.cols || rows !== this.rows) {
        this.cols = cols;
        this.rows = rows;
        this.cells = [];
        for (let i = 0; i < cols * rows; i++) this.cells.push([]);
      } else {
        for (const c of this.cells) c.length = 0;
      }
      for (const it of items) {
        if (!it.alive) continue;
        const cx = clamp((it.x / this.cell) | 0, 0, cols - 1);
        const cy = clamp((it.y / this.cell) | 0, 0, rows - 1);
        this.cells[cy * cols + cx].push(it);
      }
    }
    query(x, y, r, out) {
      out.length = 0;
      const c = this.cell;
      const x0 = clamp(Math.floor((x - r) / c), 0, this.cols - 1);
      const x1 = clamp(Math.floor((x + r) / c), 0, this.cols - 1);
      const y0 = clamp(Math.floor((y - r) / c), 0, this.rows - 1);
      const y1 = clamp(Math.floor((y + r) / c), 0, this.rows - 1);
      for (let cy = y0; cy <= y1; cy++) {
        for (let cx = x0; cx <= x1; cx++) {
          const cell = this.cells[cy * this.cols + cx];
          for (let i = 0; i < cell.length; i++) out.push(cell[i]);
        }
      }
      return out;
    }
  }

  class Sim {
    constructor(w = WORLD_SIZE, h = WORLD_SIZE) {
      this.setBounds(w, h);
      this.mode = 'ecosystem';
      this.foodGrid = new Grid(48);
      this.orgGrid = new Grid(64);
      this._q = [];
      this.world = new World(w, h, this.cx, this.cy, this.R);
      this.eventsOn = true;
      this.reset('ecosystem');
    }

    /* The world is a round dish centred in a w×h box. */
    setBounds(w, h) {
      this.w = w;
      this.h = h;
      this.cx = w / 2;
      this.cy = h / 2;
      this.R = Math.max(60, Math.min(w, h) / 2 - 26);
    }

    randPoint(frac) {
      const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * this.R * frac;
      return [this.cx + Math.cos(a) * r, this.cy + Math.sin(a) * r];
    }

    /* Push a point back inside the dish; returns the outward normal if it was outside. */
    keepInside(p, margin) {
      const dx = p.x - this.cx, dy = p.y - this.cy, d = Math.hypot(dx, dy), lim = this.R - margin;
      if (d <= lim || d === 0) return null;
      const nx = dx / d, ny = dy / d;
      p.x = this.cx + nx * lim;
      p.y = this.cy + ny * lim;
      return [nx, ny];
    }

    /* opts.keepWorld keeps the mold as it is; opts.blank starts with no mold at all. */
    reset(mode, opts = {}) {
      if (mode) this.mode = mode;
      if (!opts.keepWorld) {
        if (opts.blank) this.world.clear();
        else this.world.seed();
      }
      this.tick = 0;
      this.effects = { heat: 0, cold: 0 };
      this.heatMul = 1;
      this.coldMul = 1;
      this.visionMul = 1;
      this.light = 1;
      this.night = false;
      this.nextEventTick = 60 * 75;
      this.orgs = [];
      this.food = [];
      this.species = [];
      this.events = [];
      this.nextId = 1;
      this.nextSpeciesId = 1;
      this.sampleIdx = 0;
      this.foodAcc = 0;
      this.playerReleases = 0;
      this.genMilestone = 0;
      this.duel = null;
      this.patches = [];
      for (let i = 0; i < 3; i++) {
        const [px, py] = this.randPoint(0.6);
        this.patches.push({
          x: px,
          y: py,
          vx: rand(-0.12, 0.12),
          vy: rand(-0.12, 0.12),
          r: rand(60, 110),
        });
      }
      const cap = this.foodCap();
      for (let i = 0; i < cap * 0.6; i++) this.addFood();
      if (this.mode === 'ecosystem') for (let i = 0; i < 3; i++) this.spawnWild(14, true);
    }

    foodCap() {
      return Math.max(60, Math.floor((Math.PI * this.R * this.R) / 1500));
    }

    emit(type, text, hue, extra) {
      this.events.push(Object.assign({ type, text, hue }, extra));
    }

    addFood(x, y) {
      if (x === undefined) {
        if (Math.random() < 0.55) {
          const p = pick(this.patches);
          x = p.x + gauss() * p.r;
          y = p.y + gauss() * p.r;
        } else {
          [x, y] = this.randPoint(0.98);
        }
      }
      const f = { x, y, alive: true };
      this.keepInside(f, 5);
      this.food.push(f);
      return f;
    }

    dropFood(x, y, n) {
      for (let i = 0; i < n; i++) this.addFood(x + gauss() * (8 + n), y + gauss() * (8 + n));
    }

    /* A hue far from living species; when a base is given, stay as close to it as possible. */
    distinctHue(base) {
      const alive = this.species.filter((s) => !s.extinct);
      const gap = (h) => {
        let g = 180;
        for (const s of alive) g = Math.min(g, Math.abs(hueDiff(h, s.hue)));
        return g;
      };
      if (base !== undefined) {
        for (let off = 0; off <= 180; off += 15) {
          for (const sgn of [1, -1]) {
            const h = avoidFoodHue(base + off * sgn);
            if (gap(h) >= 26) return h;
          }
        }
        return avoidFoodHue(base);
      }
      let best = 0, bestGap = -1;
      for (let i = 0; i < 24; i++) {
        const h = avoidFoodHue(rand(0, 360));
        const g = gap(h);
        if (g > bestGap) { bestGap = g; best = h; }
      }
      return best;
    }

    newSpecies(traits, owner, name, hue) {
      const s = {
        id: this.nextSpeciesId++,
        name,
        owner, // 'player' | 'wild' | 'rival'
        hue,
        traits: Object.assign({}, traits),
        count: 0,
        peak: 0,
        maxGen: 1,
        extinct: false,
        bornTick: this.tick,
        hist: [],
        histStart: this.sampleIdx,
      };
      this.species.push(s);
      return s;
    }

    makeOrg(sp, traits, x, y, energy, gen, hue) {
      const d = derive(traits);
      const a = Math.random() * Math.PI * 2;
      return {
        id: this.nextId++,
        sp,
        t: traits,
        d,
        x,
        y,
        vx: Math.cos(a) * d.maxSpeed * 0.4,
        vy: Math.sin(a) * d.maxSpeed * 0.4,
        heading: a,
        energy: Math.min(energy, d.maxEnergy),
        age: 0,
        gen,
        hue,
        mode: WANDER,
        tgt: null,
        cool: (d.cooldown * 0.5) | 0,
        alive: true,
        kills: 0,
        children: 0,
        cause: null,
        crowd: 0,
        cyst: 0,
      };
    }

    spawnGroup(sp, n, cx, cy, spread) {
      for (let i = 0; i < n; i++) {
        const o = this.makeOrg(
          sp,
          Object.assign({}, sp.traits),
          cx + gauss() * spread,
          cy + gauss() * spread,
          derive(sp.traits).maxEnergy * 0.9,
          1,
          (sp.hue + gauss() * 4 + 360) % 360
        );
        this.keepInside(o, 8);
        this.orgs.push(o);
      }
      sp.count += n;
      sp.peak = Math.max(sp.peak, sp.count);
    }

    spawnWild(n, quiet) {
      const sp = this.newSpecies(randomTraits(), 'wild', randomName(), this.distinctHue());
      const [x, y] = this.randPoint(0.6);
      this.spawnGroup(sp, n, x, y, 40);
      if (!quiet) this.emit('arrive', `${sp.name} migrated into the arena`, sp.hue);
      return sp;
    }

    release(traits) {
      this.playerReleases++;
      const sp = this.newSpecies(traits, 'player', `Lineage ${roman(this.playerReleases)}`, this.distinctHue(traitHue(traits)));
      const [x, y] = this.randPoint(0.55);
      this.spawnGroup(sp, 12, x, y, 30);
      // Fresh releases start inside protective cysts for 5 seconds.
      for (const o of this.orgs) if (o.sp === sp) o.cyst = this.tick + 300;
      this.dropFood(x, y, 24); // a starter cache so newcomers get a foothold
      this.emit('release', `${sp.name} released into the wild`, sp.hue);
      return sp;
    }

    startDuel(playerTraits, rivalTraits, rivalName) {
      this.reset('duel', { keepWorld: true });
      const p = this.newSpecies(playerTraits, 'player', 'Your lineage', avoidFoodHue(traitHue(playerTraits)));
      let rh = traitHue(rivalTraits);
      if (Math.abs(hueDiff(rh, p.hue)) < 50) rh = avoidFoodHue(p.hue + 180);
      const r = this.newSpecies(rivalTraits, 'rival', rivalName || randomName(), rh);
      this.spawnGroup(p, 16, this.cx - this.R * 0.6, this.cy, 30);
      this.spawnGroup(r, 16, this.cx + this.R * 0.6, this.cy, 30);
      this.duel = { limit: DUEL_TICKS, over: false, result: null, player: p, rival: r };
      this.emit('duel-start', `Duel begins — ${r.name} enters the arena`, r.hue);
    }

    pick(x, y) {
      let best = null, bd = Infinity;
      for (const o of this.orgs) {
        const dx = o.x - x, dy = o.y - y, dd = dx * dx + dy * dy;
        const lim = Math.max(14, o.d.radius + 8);
        if (dd < lim * lim && dd < bd) { bd = dd; best = o; }
      }
      return best;
    }

    /* ---------------------------------------------------------------- step */

    step() {
      this.tick++;
      this.densityK = this.foodCap() * DENSITY_RATIO;
      this.updateSky();
      this.updatePatches();
      this.spawnFood();
      if (this.tick % MOLD_EVERY === 0) {
        this.world.stepMold();
        // Stray spores drift in now and then, so the Life layer never dies out for good.
        if (Math.random() < 0.06) {
          const [x, y] = this.randPoint(0.85);
          this.world.sprayMold(x, y, 18, 0.45);
        }
      }
      this.heatMul = this.tick < this.effects.heat ? 1.5 : 1;
      this.coldMul = this.tick < this.effects.cold ? 0.62 : 1;
      this.visionMul = 0.6 + 0.4 * this.light;
      this.foodGrid.rebuild(this.food, this.w, this.h);
      this.orgGrid.rebuild(this.orgs, this.w, this.h);

      const born = [];
      const orgs = this.orgs;
      for (let i = 0; i < orgs.length; i++) if (orgs[i].alive) this.updateOrg(orgs[i], born);

      this.orgs = orgs.filter((o) => o.alive);
      for (const b of born) this.orgs.push(b);
      if (this.tick % 4 === 0) this.food = this.food.filter((f) => f.alive);

      this.bookkeeping();
    }

    updatePatches() {
      for (const p of this.patches) {
        p.vx = clamp(p.vx + gauss() * 0.004, -0.2, 0.2);
        p.vy = clamp(p.vy + gauss() * 0.004, -0.2, 0.2);
        p.x += p.vx;
        p.y += p.vy;
        const n = this.keepInside(p, this.R * 0.35);
        if (n) {
          const vn = p.vx * n[0] + p.vy * n[1];
          p.vx -= 2 * vn * n[0];
          p.vy -= 2 * vn * n[1];
        }
      }
    }

    spawnFood() {
      const cap = this.foodCap();
      const daylight = 0.35 + 0.65 * this.light; // plants grow slower at night
      this.foodAcc += (cap / 320) * 0.85 * daylight;
      while (this.foodAcc >= 1) {
        this.foodAcc -= 1;
        if (this.food.length < cap) this.addFood();
      }
    }

    /* Day/night: light runs 0 (midnight) .. 1 (noon). A new dish starts mid-morning. */
    dayPhase() {
      return (this.tick / DAY_TICKS + 0.3) % 1;
    }
    dayNumber() {
      return Math.floor(this.tick / DAY_TICKS + 0.3) + 1;
    }
    updateSky() {
      this.light = 0.5 - 0.5 * Math.cos(this.dayPhase() * Math.PI * 2);
      const night = this.light < 0.25;
      if (night !== this.night && this.tick > 1) {
        this.emit('sky', night ? 'Night falls. Food grows slowly and eyes see less' : `Dawn of day ${this.dayNumber()}`, night ? 240 : 45);
      }
      this.night = night;
    }

    /* ---------------------------------------------------------------- world events */

    triggerEvent(type) {
      const w = this.world;
      if (type === 'bloom') {
        for (let i = 0; i < 140; i++) this.addFood();
        this.emit('event', 'Nutrient bloom: food rains across the dish', 80);
      } else if (type === 'heat') {
        this.effects.heat = this.tick + 1500;
        this.emit('event', 'Heat wave: every cell burns energy 50% faster', 20);
      } else if (type === 'cold') {
        this.effects.cold = this.tick + 1500;
        this.emit('event', 'Cold snap: everything slows down', 205);
      } else if (type === 'meteor') {
        const [x, y] = this.randPoint(0.75);
        let killed = 0;
        for (const o of this.orgs) {
          if (o.alive && Math.hypot(o.x - x, o.y - y) < 34) { this.kill(o, 'meteor'); killed++; }
        }
        for (const f of this.food) if (Math.hypot(f.x - x, f.y - y) < 34) f.alive = false;
        w.eraseMold(x, y, 40);
        // The impact scatters nutrients around the blast.
        for (let i = 0; i < 30; i++) {
          const a = Math.random() * Math.PI * 2, d = rand(38, 60);
          this.addFood(x + Math.cos(a) * d, y + Math.sin(a) * d);
        }
        this.emit('event', `Meteor strike! ${killed} cell${killed === 1 ? '' : 's'} vaporised`, 15, { x, y, fx: 'meteor' });
      } else if (type === 'outbreak') {
        const [x, y] = this.randPoint(0.7);
        w.sprayMold(x, y, 56, 0.45);
        this.emit('event', 'Life outbreak: a new colony bursts onto the agar', 150, { x, y, fx: 'outbreak' });
      }
    }

    maybeRandomEvent() {
      if (!this.eventsOn || this.mode !== 'ecosystem' || this.tick < this.nextEventTick) return;
      this.nextEventTick = this.tick + 60 * rand(60, 110);
      this.triggerEvent(pick(EVENT_TYPES));
    }

    /* UV lamp: sterilises everything in a radius. */
    zap(x, y, radius) {
      let n = 0;
      for (const o of this.orgs) if (o.alive && Math.hypot(o.x - x, o.y - y) < radius + o.d.radius) { this.kill(o, 'UV light'); n++; }
      for (const f of this.food) if (Math.hypot(f.x - x, f.y - y) < radius) f.alive = false;
      this.world.eraseMold(x, y, radius);
      return n;
    }

    grazeMold(o, i) {
      const w = this.world;
      if (i >= 0 && w.mold[i]) {
        w.setMold(i, 0);
        o.energy += o.d.foodGain * 0.4;
      }
    }

    perceive(o) {
      const d = o.d, r = d.vision * this.visionMul, r2 = r * r;
      let food = null, fd = r2, threat = null, td = r2, prey = null, pd = r2;

      const fq = this.foodGrid.query(o.x, o.y, r, this._q);
      for (let i = 0; i < fq.length; i++) {
        const f = fq[i];
        if (!f.alive) continue;
        const dx = f.x - o.x, dy = f.y - o.y, dd = dx * dx + dy * dy;
        if (dd < fd) { fd = dd; food = f; }
      }

      let kin = 0;
      const nq = this.orgGrid.query(o.x, o.y, r, this._q);
      for (let i = 0; i < nq.length; i++) {
        const p = nq[i];
        if (p === o || !p.alive) continue;
        const dx = p.x - o.x, dy = p.y - o.y, dd = dx * dx + dy * dy;
        if (p.sp === o.sp) {
          if (dd < CROWD_R2) kin++;
          continue;
        }
        if (dd >= r2) continue;
        const pd2 = p.d;
        // Could p hunt me, and would it win the exchange?
        if (pd2.hunter && dd < td && d.radius <= pd2.radius * 1.2 &&
            pd2.attack * d.defense > d.attack * pd2.defense) {
          td = dd; threat = p;
        }
        // Could I hunt p without getting wrecked?
        if (d.hunter && dd < pd && pd2.radius <= d.radius * 1.2 && !(p.cyst > this.tick) &&
            pd2.attack * d.defense < d.attack * pd2.defense * 1.5) {
          pd = dd; prey = p;
        }
      }

      // No grains in sight and getting hungry? Look for a patch of mold to graze.
      if (!food && this.world.moldCount > 0 && o.energy < d.maxEnergy * 0.45) {
        const w = this.world;
        let best = -1, bd = r2;
        for (let k = 0; k < 10; k++) {
          const a = Math.random() * Math.PI * 2, rr = Math.sqrt(Math.random()) * r;
          const i = w.idx(o.x + Math.cos(a) * rr, o.y + Math.sin(a) * rr);
          if (i >= 0 && w.mold[i]) {
            const [mx, my] = w.tileCenter(i);
            const dd = (mx - o.x) ** 2 + (my - o.y) ** 2;
            if (dd < bd) { bd = dd; best = i; }
          }
        }
        if (best >= 0) {
          const [mx, my] = w.tileCenter(best);
          food = { x: mx, y: my, alive: true, ti: best };
          fd = bd;
        }
      }

      o.crowd = kin > 14 ? 14 : kin;
      const hungry = o.energy < d.maxEnergy * 0.85;
      if (threat && td < r2 * 0.6) { o.mode = FLEE; o.tgt = threat; }
      else if (prey && hungry && (!food || o.t.aggression >= 6 || pd < fd * 0.5)) { o.mode = HUNT; o.tgt = prey; }
      else if (food) { o.mode = FORAGE; o.tgt = food; }
      else { o.mode = WANDER; o.tgt = null; }
    }

    updateOrg(o, born) {
      const d = o.d;
      const w = this.world;
      o.age++;
      if (o.cool > 0) o.cool--;
      if (o.tgt && o.tgt.ti !== undefined && !w.mold[o.tgt.ti]) o.tgt.alive = false;
      if ((this.tick + o.id) % 3 === 0 || (o.tgt && !o.tgt.alive)) this.perceive(o);

      const t = o.tgt;
      let dx, dy, sp = d.maxSpeed * this.coldMul;
      if (o.mode === FLEE && t) {
        dx = o.x - t.x; dy = o.y - t.y;
      } else if ((o.mode === FORAGE || o.mode === HUNT) && t) {
        dx = t.x - o.x; dy = t.y - o.y;
        if (o.mode === FORAGE) sp *= 0.85;
      } else {
        o.heading += gauss() * 0.22;
        dx = Math.cos(o.heading); dy = Math.sin(o.heading);
        sp *= 0.5;
      }
      let len = Math.hypot(dx, dy) || 1;
      dx /= len; dy /= len;

      // Soft wall: steer away from the dish rim.
      const ox = o.x - this.cx, oy = o.y - this.cy, od = Math.hypot(ox, oy) || 1, edge = this.R - 28;
      if (od > edge) {
        const k = (od - edge) / 28;
        dx -= (ox / od) * k;
        dy -= (oy / od) * k;
      }
      len = Math.hypot(dx, dy) || 1;
      dx /= len; dy /= len;
      if (o.mode === WANDER) o.heading = Math.atan2(dy, dx);

      o.vx += (dx * sp - o.vx) * d.agility;
      o.vy += (dy * sp - o.vy) * d.agility;
      o.x += o.vx;
      o.y += o.vy;
      const r = d.radius;
      const n = this.keepInside(o, r);
      if (n) {
        const vn = o.vx * n[0] + o.vy * n[1];
        if (vn > 0) { o.vx -= 2 * vn * n[0]; o.vy -= 2 * vn * n[1]; }
      }

      if (t && t.alive) {
        const ddx = t.x - o.x, ddy = t.y - o.y, dist2 = ddx * ddx + ddy * ddy;
        if (o.mode === FORAGE) {
          const rr = r + 3;
          if (dist2 < rr * rr) {
            if (t.ti !== undefined) this.grazeMold(o, t.ti);
            else o.energy += d.foodGain;
            t.alive = false;
          }
        } else if (o.mode === HUNT) {
          const rr = r + t.d.radius + 1.5;
          if (dist2 < rr * rr) this.bite(o, t);
        }
      }

      // Crowding: local clumps and globally abundant species burn extra energy
      // (disease, competition) — keeps any one species from owning the arena.
      const dens = o.sp.count / this.densityK;
      o.energy -= d.baseCost * this.heatMul * (1 + o.crowd * 0.06 + dens * dens * 0.6) + d.moveCost * (o.vx * o.vx + o.vy * o.vy);
      if (o.energy > d.maxEnergy) o.energy = d.maxEnergy;
      if (o.cool <= 0 && o.age > 120 && o.energy >= d.maxEnergy * d.reproAt) this.reproduce(o, born);
      if (o.energy <= 0) this.kill(o, 'starved');
      else if (o.age > d.maxAge) this.kill(o, 'old age');
    }

    bite(o, q) {
      const dmg = o.d.attack * 0.5 * q.d.defense;
      q.energy -= dmg;
      o.energy += dmg * 0.9 - dmg * q.t.armor * 0.03; // armour spines hurt back
      if (q.energy <= 0) {
        this.kill(q, 'eaten');
        o.energy += q.d.maxEnergy * 0.35;
        o.kills++;
      }
    }

    reproduce(o, born) {
      if (this.orgs.length + born.length >= POP_CAP) return;
      const litter = 1 + (Math.random() < o.t.fertility * 0.035 ? 1 : 0);
      const share = (o.energy * 0.5) / litter;
      o.energy *= 0.45;
      o.cool = o.d.cooldown;
      const total = sumTraits(o.t);
      for (let i = 0; i < litter; i++) {
        const ct = {};
        for (const k of TRAITS) ct[k] = o.t[k] + gauss() * MUTATION;
        const nt = normalizeTraits(ct, total);
        const dh = clamp(hueDiff(o.hue + gauss() * 1.5, o.sp.hue), -18, 18);
        const child = this.makeOrg(o.sp, nt, o.x + gauss() * 3, o.y + gauss() * 3, share, o.gen + 1, (o.sp.hue + dh + 360) % 360);
        born.push(child);
        o.children++;
        if (child.gen > o.sp.maxGen) o.sp.maxGen = child.gen;
      }
    }

    kill(o, cause) {
      o.alive = false;
      o.cause = cause;
      if (cause !== 'eaten' && cause !== 'UV light' && cause !== 'meteor' && Math.random() < 0.6) this.addFood(o.x, o.y);
    }

    bookkeeping() {
      for (const s of this.species) s.count = 0;
      for (const o of this.orgs) o.sp.count++;

      for (const s of this.species) {
        if (s.count > s.peak) s.peak = s.count;
        if (!s.extinct && s.count === 0) {
          s.extinct = true;
          s.extinctTick = this.tick;
          const who = s.owner === 'player' && this.mode === 'ecosystem' ? `${s.name} (yours)` : s.name;
          this.emit('extinct', `${who} went extinct after ${s.maxGen} generations`, s.hue);
        }
      }

      if (this.tick % SAMPLE_EVERY === 0) {
        this.sampleIdx++;
        for (const s of this.species) {
          if (s.extinct && s.hist.length && s.hist[s.hist.length - 1] === 0) continue;
          s.hist.push(s.count);
          if (s.hist.length > HISTORY_MAX) { s.hist.shift(); s.histStart++; }
        }
        const horizon = this.sampleIdx - HISTORY_MAX;
        this.species = this.species.filter((s) => !s.extinct || s.histStart + s.hist.length > horizon);
      }

      if (this.mode === 'ecosystem' && this.tick % 600 === 0) {
        const wild = this.species.filter((s) => s.owner === 'wild' && !s.extinct).length;
        if (wild < 2 || this.orgs.length < 30) this.spawnWild(12);
      }

      const pg = this.playerMaxGen();
      if (pg >= this.genMilestone + 10) {
        this.genMilestone = Math.floor(pg / 10) * 10;
        this.emit('milestone', `Your lineage reached generation ${this.genMilestone}`, 195);
      }

      if (this.duel && !this.duel.over) this.checkDuel();
      this.maybeRandomEvent();
    }

    checkDuel() {
      const D = this.duel, p = D.player.count, r = D.rival.count;
      let result = null;
      if (p === 0 && r === 0) result = 'draw';
      else if (p === 0) result = 'lose';
      else if (r === 0) result = 'win';
      else if (this.tick >= D.limit) result = p > r ? 'win' : p < r ? 'lose' : 'draw';
      if (result) {
        D.over = true;
        D.result = result;
        D.endTick = this.tick;
        this.emit('duel-end', '', D.player.hue, { result, you: p, rival: r });
      }
    }

    playerMaxGen() {
      let g = 0;
      for (const s of this.species) if (s.owner === 'player' && !s.extinct) g = Math.max(g, s.maxGen);
      return g;
    }

    stats() {
      let player = 0, maxGen = 0;
      for (const o of this.orgs) {
        if (o.sp.owner === 'player') player++;
        if (o.gen > maxGen) maxGen = o.gen;
      }
      return {
        organisms: this.orgs.length,
        generation: maxGen,
        player,
        species: this.species.filter((s) => !s.extinct).length,
        food: this.food.length,
        mold: this.world.moldCount,
        day: this.dayNumber(),
      };
    }

    /* ---------------------------------------------------------------- save / load */

    serialize() {
      const live = this.species.filter((s) => !s.extinct);
      const round = (v) => Math.round(v * 100) / 100;
      return {
        v: 2,
        tick: this.tick,
        nextId: this.nextId,
        nextSpeciesId: this.nextSpeciesId,
        playerReleases: this.playerReleases,
        genMilestone: this.genMilestone,
        eventsOn: this.eventsOn,
        effects: this.effects,
        nextEventTick: this.nextEventTick,
        patches: this.patches,
        world: this.world.serialize(),
        food: this.food.filter((f) => f.alive).flatMap((f) => [round(f.x), round(f.y)]),
        species: live.map((s) => ({ id: s.id, name: s.name, owner: s.owner, hue: s.hue, traits: s.traits, maxGen: s.maxGen, peak: s.peak, bornTick: s.bornTick })),
        orgs: this.orgs.map((o) => ({
          sp: o.sp.id, t: Object.fromEntries(TRAITS.map((k) => [k, round(o.t[k])])), x: round(o.x), y: round(o.y),
          vx: round(o.vx), vy: round(o.vy), e: round(o.energy), age: o.age, gen: o.gen, hue: round(o.hue), kills: o.kills, children: o.children,
        })),
      };
    }

    deserialize(data) {
      if (!data || data.v !== 2) return false;
      this.reset('ecosystem', { blank: true });
      this.orgs = [];
      this.food = [];
      this.species = [];
      if (!this.world.deserialize(data.world)) return false;
      Object.assign(this, {
        tick: data.tick, nextId: data.nextId, nextSpeciesId: data.nextSpeciesId, playerReleases: data.playerReleases,
        genMilestone: data.genMilestone, eventsOn: data.eventsOn, effects: data.effects, nextEventTick: data.nextEventTick,
        patches: data.patches,
      });
      for (let i = 0; i < data.food.length; i += 2) this.food.push({ x: data.food[i], y: data.food[i + 1], alive: true });
      const byId = new Map();
      for (const s of data.species) {
        const sp = Object.assign({ count: 0, extinct: false, hist: [], histStart: this.sampleIdx }, s);
        this.species.push(sp);
        byId.set(s.id, sp);
      }
      for (const q of data.orgs) {
        const sp = byId.get(q.sp);
        if (!sp) continue;
        const o = this.makeOrg(sp, q.t, q.x, q.y, q.e, q.gen, q.hue);
        Object.assign(o, { id: o.id, vx: q.vx, vy: q.vy, age: q.age, kills: q.kills, children: q.children });
        this.orgs.push(o);
        sp.count++;
      }
      this.updateSky();
      this.night = this.light < 0.25;
      this.events.length = 0;
      return true;
    }
  }

  const Evo = {
    Sim, TRAITS, BUDGET, MAX_TRAIT, TRAIT_HUES, FOOD_HUE, MODE_NAMES, HISTORY_MAX, DUEL_TICKS, DAY_TICKS, WORLD_SIZE, EVENT_TYPES,
    derive, traitHue, randomTraits, randomName, sumTraits, normalizeTraits,
  };
  root.Evo = Evo;
  if (typeof module !== 'undefined' && module.exports) module.exports = Evo;
})(typeof window !== 'undefined' ? window : globalThis);
