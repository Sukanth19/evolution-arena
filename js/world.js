/*
 * Evolution Arena — the dish itself: a tile grid of terrain plus a mold layer
 * that follows Life-like cellular-automaton rules (Conway's Game of Life by default:
 * too few neighbours and a mold cell dies of loneliness, too many and it dies of
 * overcrowding, exactly three and an empty tile comes alive).
 * Pure logic, no DOM.
 */
(function (root) {
  'use strict';

  const TILE = 8;
  const T = { AGAR: 0, ROCK: 1, WATER: 2, SOIL: 3, TOXIN: 4 };
  const TERRAIN_NAMES = ['agar', 'rock', 'water', 'soil', 'toxin'];

  const RULES = {
    conway:   { label: "Conway's Life", rule: 'B3/S23' },
    highlife: { label: 'HighLife',      rule: 'B36/S23' },
    daynight: { label: 'Day & Night',   rule: 'B3678/S34678' },
    maze:     { label: 'Maze',          rule: 'B3/S12345' },
    coral:    { label: 'Coral',         rule: 'B3/S45678' },
    amoeba:   { label: 'Amoeba',        rule: 'B357/S1358' },
    seeds:    { label: 'Seeds',         rule: 'B2/S' },
  };

  const PATTERNS = {
    glider: ['.O.', '..O', 'OOO'],
    lwss: ['.O..O', 'O....', 'O...O', 'OOOO.'],
    rpent: ['.OO', 'OO.', '.O.'],
    acorn: ['.O.....', '...O...', 'OO..OOO'],
    pulsar: [
      '..OOO...OOO..', '.............', 'O....O.O....O', 'O....O.O....O', 'O....O.O....O',
      '..OOO...OOO..', '.............', '..OOO...OOO..', 'O....O.O....O', 'O....O.O....O',
      'O....O.O....O', '.............', '..OOO...OOO..',
    ],
    gun: [
      '........................O...........',
      '......................O.O...........',
      '............OO......OO............OO',
      '...........O...O....OO............OO',
      'OO........O.....O...OO..............',
      'OO........O...O.OO....O.O...........',
      '..........O.....O.......O...........',
      '...........O...O....................',
      '............OO......................',
    ],
  };
  const PATTERN_NAMES = {
    spray: 'Spray spores', glider: 'Glider', lwss: 'Spaceship', rpent: 'R-pentomino',
    acorn: 'Acorn', pulsar: 'Pulsar', gun: 'Glider gun',
  };

  function parseRule(str) {
    const m = /B(\d*)\/S(\d*)/i.exec(str);
    const b = new Uint8Array(9), s = new Uint8Array(9);
    if (m) {
      for (const ch of m[1]) b[+ch] = 1;
      for (const ch of m[2]) s[+ch] = 1;
    }
    return { b, s };
  }

  /* Smooth value noise for terrain generation. */
  function makeNoise() {
    const S = 64, g = new Float32Array(S * S);
    for (let i = 0; i < g.length; i++) g[i] = Math.random();
    const at = (x, y) => g[(y & (S - 1)) * S + (x & (S - 1))];
    const sm = (t) => t * t * (3 - 2 * t);
    return (x, y) => {
      const x0 = Math.floor(x), y0 = Math.floor(y);
      const fx = sm(x - x0), fy = sm(y - y0);
      const a = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * fx;
      const b = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * fx;
      return a + (b - a) * fy;
    };
  }
  const fbm = (n, x, y) => n(x, y) * 0.65 + n(x * 2.1 + 17, y * 2.1 + 31) * 0.35;

  /* Run-length encoding keeps saves small: terrain is mostly empty agar. */
  function rle(arr) {
    const out = [];
    for (let i = 0; i < arr.length;) {
      let j = i;
      while (j < arr.length && arr[j] === arr[i]) j++;
      out.push(arr[i], j - i);
      i = j;
    }
    return out;
  }
  function unrle(data, arr) {
    let k = 0;
    for (let i = 0; i < data.length; i += 2) for (let n = 0; n < data[i + 1] && k < arr.length; n++) arr[k++] = data[i];
  }

  class World {
    constructor(w, h, cx, cy, R) {
      this.cols = Math.ceil(w / TILE);
      this.rows = Math.ceil(h / TILE);
      const n = this.cols * this.rows;
      this.terrain = new Uint8Array(n);
      this.inDish = new Uint8Array(n);
      this.mold = new Uint8Array(n);
      this.moldAge = new Uint8Array(n);
      this._next = new Uint8Array(n);
      this.moldCount = 0;
      this.dirty = [];
      this.dirtyAll = true;
      this.soil = [];
      this.soilDirty = true;
      this.setRule('conway');
      for (let r = 0; r < this.rows; r++) {
        for (let c = 0; c < this.cols; c++) {
          const x = (c + 0.5) * TILE - cx, y = (r + 0.5) * TILE - cy;
          if (Math.hypot(x, y) < R - 6) this.inDish[r * this.cols + c] = 1;
        }
      }
    }

    setRule(name) {
      if (!RULES[name]) name = 'conway';
      this.ruleName = name;
      this.rule = parseRule(RULES[name].rule);
    }

    idx(x, y) {
      const c = Math.floor(x / TILE), r = Math.floor(y / TILE);
      if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) return -1;
      return r * this.cols + c;
    }

    at(x, y) {
      const i = this.idx(x, y);
      return i < 0 ? T.AGAR : this.terrain[i];
    }

    moldAllowed(i) {
      const t = this.terrain[i];
      return this.inDish[i] === 1 && (t === T.AGAR || t === T.SOIL);
    }

    set(i, type) {
      if (i < 0 || !this.inDish[i]) return false;
      const old = this.terrain[i];
      if (old === type) return false;
      this.terrain[i] = type;
      if (!this.moldAllowed(i) && this.mold[i]) { this.mold[i] = 0; this.moldAge[i] = 0; this.moldCount--; }
      if (old === T.SOIL || type === T.SOIL) this.soilDirty = true;
      this.dirty.push(i);
      return true;
    }

    /* Calls fn(i, dist) for each in-dish tile whose centre lies within radius of (x, y). */
    each(x, y, radius, fn) {
      const c0 = Math.max(0, Math.floor((x - radius) / TILE)), c1 = Math.min(this.cols - 1, Math.floor((x + radius) / TILE));
      const r0 = Math.max(0, Math.floor((y - radius) / TILE)), r1 = Math.min(this.rows - 1, Math.floor((y + radius) / TILE));
      const lim = Math.max(radius, TILE * 0.5);
      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) {
          const i = r * this.cols + c;
          if (!this.inDish[i]) continue;
          const d = Math.hypot((c + 0.5) * TILE - x, (r + 0.5) * TILE - y);
          if (d <= lim) fn(i, d);
        }
      }
    }

    paint(x, y, radius, type) {
      let n = 0;
      this.each(x, y, radius, (i) => { if (this.set(i, type)) n++; });
      return n;
    }

    setMold(i, v) {
      if (v && !this.moldAllowed(i)) return;
      if (!!this.mold[i] === !!v) return;
      this.mold[i] = v ? 1 : 0;
      this.moldAge[i] = 0;
      this.moldCount += v ? 1 : -1;
    }

    sprayMold(x, y, radius, density) {
      this.each(x, y, radius, (i) => { if (Math.random() < density) this.setMold(i, 1); });
    }

    eraseMold(x, y, radius) {
      this.each(x, y, radius, (i) => this.setMold(i, 0));
    }

    /* Stamp a named pattern centred on (x, y), randomly rotated/flipped so gliders fly different ways. */
    stamp(x, y, name) {
      const p = PATTERNS[name];
      if (!p) return 0;
      const h = p.length, w = p[0].length;
      const rot = (Math.random() * 4) | 0, flip = Math.random() < 0.5;
      const c0 = Math.floor(x / TILE), r0 = Math.floor(y / TILE);
      let n = 0;
      for (let py = 0; py < h; py++) {
        for (let px = 0; px < w; px++) {
          if (p[py][px] !== 'O') continue;
          let u = (flip ? w - 1 - px : px) - (w >> 1), v = py - (h >> 1);
          for (let k = 0; k < rot; k++) [u, v] = [-v, u];
          const c = c0 + u, r = r0 + v;
          if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) continue;
          const i = r * this.cols + c;
          if (this.moldAllowed(i)) { this.setMold(i, 1); n++; }
        }
      }
      return n;
    }

    /* One generation of the cellular automaton. Rock, water and toxin act as dead tiles. */
    stepMold() {
      const { cols, rows, mold, _next: next, moldAge } = this;
      const { b, s } = this.rule;
      let count = 0;
      for (let r = 0; r < rows; r++) {
        const up = r > 0, dn = r < rows - 1;
        for (let c = 0; c < cols; c++) {
          const i = r * cols + c;
          if (!this.inDish[i]) { next[i] = 0; continue; }
          const lf = c > 0, rt = c < cols - 1;
          let n = 0;
          if (up) { n += mold[i - cols]; if (lf) n += mold[i - cols - 1]; if (rt) n += mold[i - cols + 1]; }
          if (dn) { n += mold[i + cols]; if (lf) n += mold[i + cols - 1]; if (rt) n += mold[i + cols + 1]; }
          if (lf) n += mold[i - 1];
          if (rt) n += mold[i + 1];
          const alive = mold[i] ? s[n] : b[n];
          if (alive && this.moldAllowed(i)) {
            next[i] = 1;
            moldAge[i] = mold[i] ? Math.min(255, moldAge[i] + 1) : 0;
            count++;
          } else {
            next[i] = 0;
            moldAge[i] = 0;
          }
        }
      }
      this._next = mold;
      this.mold = next;
      this.moldCount = count;
    }

    soilTiles() {
      if (this.soilDirty) {
        this.soil = [];
        for (let i = 0; i < this.terrain.length; i++) if (this.terrain[i] === T.SOIL) this.soil.push(i);
        this.soilDirty = false;
      }
      return this.soil;
    }

    tileCenter(i) {
      return [((i % this.cols) + 0.5) * TILE, (Math.floor(i / this.cols) + 0.5) * TILE];
    }

    clear() {
      this.terrain.fill(0);
      this.mold.fill(0);
      this.moldAge.fill(0);
      this.moldCount = 0;
      this.dirty.length = 0;
      this.dirtyAll = true;
      this.soilDirty = true;
    }

    /* Procedural dish: rocky outcrops, ponds, fertile patches, a little toxin and some mold. */
    generate() {
      this.clear();
      const n1 = makeNoise(), n2 = makeNoise(), n3 = makeNoise(), n4 = makeNoise();
      for (let r = 0; r < this.rows; r++) {
        for (let c = 0; c < this.cols; c++) {
          const i = r * this.cols + c;
          if (!this.inDish[i]) continue;
          const x = c / 11, y = r / 11;
          if (fbm(n1, x, y) > 0.73) this.terrain[i] = T.ROCK;
          else if (fbm(n2, x * 0.8, y * 0.8) > 0.74) this.terrain[i] = T.WATER;
          else if (fbm(n3, x, y) > 0.68) this.terrain[i] = T.SOIL;
          else if (fbm(n4, x * 1.3, y * 1.3) > 0.79) this.terrain[i] = T.TOXIN;
        }
      }
      this.dirtyAll = true;
      this.soilDirty = true;
      const cx = this.cols * TILE / 2, cy = this.rows * TILE / 2;
      for (let k = 0; k < 4; k++) {
        const a = Math.random() * Math.PI * 2, d = Math.random() * cx * 0.6;
        this.sprayMold(cx + Math.cos(a) * d, cy + Math.sin(a) * d, 40, 0.4);
      }
    }

    serialize() {
      return { cols: this.cols, rows: this.rows, rule: this.ruleName, terrain: rle(this.terrain), mold: rle(this.mold) };
    }

    deserialize(o) {
      if (!o || o.cols !== this.cols || o.rows !== this.rows) return false;
      this.clear();
      unrle(o.terrain, this.terrain);
      unrle(o.mold, this.mold);
      for (let i = 0; i < this.mold.length; i++) if (this.mold[i]) this.moldCount++;
      this.setRule(o.rule);
      this.dirtyAll = true;
      this.soilDirty = true;
      return true;
    }
  }

  const EvoWorld = { World, TILE, T, TERRAIN_NAMES, RULES, PATTERNS, PATTERN_NAMES };
  root.EvoWorld = EvoWorld;
  if (typeof module !== 'undefined' && module.exports) module.exports = EvoWorld;
})(typeof window !== 'undefined' ? window : globalThis);
