/* Evolution Arena — petri-dish renderer: agar, block terrain, mold, cells, day/night, camera. */
(function (root) {
  'use strict';

  const TAU = Math.PI * 2;
  const { TILE, T } = root.EvoWorld;

  /* Small pixel-art textures (TILE×TILE) for each terrain type, a few variants each. */
  const PALETTES = {
    [T.ROCK]:  { base: [128, 122, 112], dark: [92, 87, 80], light: [160, 154, 143], speck: [104, 98, 90] },
    [T.WATER]: { base: [74, 146, 196], dark: [56, 118, 170], light: [128, 190, 228], speck: [96, 166, 210] },
    [T.SOIL]:  { base: [122, 84, 52], dark: [94, 63, 38], light: [146, 104, 66], speck: [104, 150, 58] },
    [T.TOXIN]: { base: [132, 74, 156], dark: [104, 54, 126], light: [160, 102, 182], speck: [178, 226, 72] },
  };

  function makeTextures() {
    const tex = {};
    for (const type of [T.ROCK, T.WATER, T.SOIL, T.TOXIN]) {
      const p = PALETTES[type];
      tex[type] = [];
      for (let v = 0; v < 4; v++) {
        const img = new ImageData(TILE, TILE);
        for (let y = 0; y < TILE; y++) {
          for (let x = 0; x < TILE; x++) {
            let c = p.base;
            const r = Math.random();
            if (type === T.ROCK) {
              if (y === 0 || x === 0) c = p.light; // bevel
              else if (y === TILE - 1 || x === TILE - 1) c = p.dark;
              else if (r < 0.22) c = p.speck;
              else if (r < 0.3) c = p.light;
            } else if (type === T.WATER) {
              if ((y + v) % 4 === 0 && r < 0.6) c = p.light;
              else if (r < 0.2) c = p.speck;
            } else if (type === T.SOIL) {
              if (r < 0.12) c = p.speck;
              else if (r < 0.3) c = p.dark;
              else if (r < 0.38) c = p.light;
            } else if (type === T.TOXIN) {
              if (r < 0.1) c = p.speck;
              else if (r < 0.3) c = p.dark;
              else if (r < 0.36) c = p.light;
            }
            const k = (y * TILE + x) * 4;
            img.data[k] = c[0];
            img.data[k + 1] = c[1];
            img.data[k + 2] = c[2];
            img.data[k + 3] = 255;
          }
        }
        tex[type].push(img);
      }
    }
    return tex;
  }

  class Renderer {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.ripples = [];
      this.fx = [];
      this.w = 0;
      this.h = 0;
      this.dpr = 1;
      this.paper = null;
      this.dish = null;
      this.dishKey = '';
      this.textures = makeTextures();
      this.terrain = null;
      this.shake = 0;
      this.view = { x: 0, y: 0, zoom: 1 };
      this.insetBottom = 0; // screen space kept clear for the hotbar
    }

    resize(w, h) {
      this.dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.w = w;
      this.h = h;
      this.canvas.width = Math.round(w * this.dpr);
      this.canvas.height = Math.round(h * this.dpr);
      this.paper = null;
      this.dishKey = '';
    }

    /* ------------------------------------------------------------ camera */

    viewH() {
      return Math.max(100, this.h - this.insetBottom);
    }
    fit(sim) {
      return Math.min(this.w / sim.w, this.viewH() / sim.h) * 0.98;
    }
    scale(sim) {
      return this.fit(sim) * this.view.zoom;
    }
    screenToWorld(sim, sx, sy) {
      const s = this.scale(sim);
      return [(sx - this.w / 2) / s + this.view.x, (sy - this.viewH() / 2) / s + this.view.y];
    }
    clampView(sim) {
      const v = this.view, s = this.scale(sim);
      const hw = this.w / 2 / s, hh = this.viewH() / 2 / s;
      v.x = hw * 2 >= sim.w ? sim.w / 2 : Math.min(sim.w - hw, Math.max(hw, v.x));
      v.y = hh * 2 >= sim.h ? sim.h / 2 : Math.min(sim.h - hh, Math.max(hh, v.y));
    }

    /* ------------------------------------------------------------ static layers */

    paperLayer() {
      if (this.paper) return this.paper;
      const c = document.createElement('canvas');
      c.width = this.canvas.width;
      c.height = this.canvas.height;
      const g = c.getContext('2d');
      g.fillStyle = '#e7e0d0';
      g.fillRect(0, 0, c.width, c.height);
      for (let i = 0, n = (c.width * c.height) / 120; i < n; i++) {
        g.fillStyle = Math.random() < 0.5 ? 'rgba(90,70,40,0.05)' : 'rgba(255,255,255,0.18)';
        g.fillRect(Math.random() * c.width, Math.random() * c.height, this.dpr, this.dpr);
      }
      this.paper = c;
      return c;
    }

    /* Dish shadow, glass lip, agar and rim ticks, in world space (transparent elsewhere). */
    dishLayer(sim) {
      const k = Math.min(2.5, this.fit(sim) * this.dpr * 2);
      const key = `${sim.w}:${k.toFixed(3)}`;
      if (this.dishKey === key) return this.dish;
      const c = document.createElement('canvas');
      c.width = Math.round(sim.w * k);
      c.height = Math.round(sim.h * k);
      const g = c.getContext('2d');
      g.scale(k, k);
      const { cx, cy, R } = sim;

      g.save();
      g.filter = 'blur(12px)';
      g.fillStyle = 'rgba(60,45,20,0.28)';
      g.beginPath();
      g.ellipse(cx + 5, cy + 10, R + 10, R + 8, 0, 0, TAU);
      g.fill();
      g.restore();

      g.fillStyle = 'rgba(250,248,240,0.92)';
      g.beginPath();
      g.arc(cx, cy, R + 10, 0, TAU);
      g.fill();
      g.strokeStyle = 'rgba(70,60,40,0.35)';
      g.lineWidth = 1.2;
      g.stroke();

      const agar = g.createRadialGradient(cx - R * 0.25, cy - R * 0.3, R * 0.1, cx, cy, R);
      agar.addColorStop(0, '#fbf3da');
      agar.addColorStop(0.75, '#f3e6bd');
      agar.addColorStop(1, '#e9d6a1');
      g.fillStyle = agar;
      g.beginPath();
      g.arc(cx, cy, R, 0, TAU);
      g.fill();

      g.save();
      g.beginPath();
      g.arc(cx, cy, R, 0, TAU);
      g.clip();
      for (let i = 0, n = (R * R) / 60; i < n; i++) {
        g.fillStyle = `rgba(150,110,40,${Math.random() * 0.06})`;
        g.beginPath();
        g.arc(cx + (Math.random() * 2 - 1) * R, cy + (Math.random() * 2 - 1) * R, Math.random() * 2.2, 0, TAU);
        g.fill();
      }
      g.restore();

      g.strokeStyle = 'rgba(120,95,45,0.45)';
      g.lineWidth = 1.5;
      g.beginPath();
      g.arc(cx, cy, R, 0, TAU);
      g.stroke();

      g.strokeStyle = 'rgba(255,255,255,0.85)';
      g.lineWidth = 3;
      g.lineCap = 'round';
      g.beginPath();
      g.arc(cx, cy, R + 5, Math.PI * 1.08, Math.PI * 1.42);
      g.stroke();

      g.strokeStyle = 'rgba(70,60,40,0.4)';
      g.lineWidth = 1;
      for (let i = 0; i < 72; i++) {
        const a = (i / 72) * TAU, long = i % 6 === 0;
        const r0 = R + 13, r1 = R + (long ? 21 : 17);
        g.beginPath();
        g.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
        g.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
        g.stroke();
      }

      this.dish = c;
      this.dishKey = key;
      return c;
    }

    /* Terrain is a world-sized pixel canvas updated tile by tile as the dish is painted. */
    terrainLayer(sim) {
      const w = sim.world;
      if (!this.terrain || this.terrain.width !== w.cols * TILE) {
        this.terrain = document.createElement('canvas');
        this.terrain.width = w.cols * TILE;
        this.terrain.height = w.rows * TILE;
        this.tctx = this.terrain.getContext('2d');
        w.dirtyAll = true;
      }
      const g = this.tctx;
      const drawTile = (i) => {
        const x = (i % w.cols) * TILE, y = Math.floor(i / w.cols) * TILE;
        const t = w.terrain[i];
        if (t === T.AGAR) g.clearRect(x, y, TILE, TILE);
        else g.putImageData(this.textures[t][(i * 7919) % 4], x, y);
      };
      if (w.dirtyAll) {
        g.clearRect(0, 0, this.terrain.width, this.terrain.height);
        for (let i = 0; i < w.terrain.length; i++) if (w.terrain[i] !== T.AGAR) drawTile(i);
        w.dirtyAll = false;
        w.dirty.length = 0;
      } else if (w.dirty.length) {
        for (const i of w.dirty) drawTile(i);
        w.dirty.length = 0;
      }
      return this.terrain;
    }

    /* A tile's texture, scaled up — used for hotbar icons. */
    tileIcon(type, size) {
      const c = document.createElement('canvas');
      c.width = c.height = size;
      const g = c.getContext('2d');
      const t = document.createElement('canvas');
      t.width = t.height = TILE * 2;
      const tg = t.getContext('2d');
      for (let k = 0; k < 4; k++) tg.putImageData(this.textures[type][k], (k % 2) * TILE, (k >> 1) * TILE);
      g.imageSmoothingEnabled = false;
      g.drawImage(t, 0, 0, size, size);
      return c;
    }

    /* ------------------------------------------------------------ effects */

    ripple(x, y, color) {
      this.ripples.push({ x, y, color: color || '90,110,30', t0: performance.now() });
    }

    effect(kind, x, y) {
      this.fx.push({ kind, x, y, t0: performance.now() });
      if (kind === 'meteor') this.shake = performance.now() + 500;
    }

    /* ------------------------------------------------------------ cells */

    /* A single cell: wiggling flagellum, stretched membrane, nucleus; hunters get jaws. */
    drawCell(ctx, x, y, vx, vy, r, hue, armor, hunter, phase, now) {
      const sp = Math.hypot(vx, vy);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(sp > 0.03 ? Math.atan2(vy, vx) : phase);

      const stretch = 1 + Math.min(0.35, sp * 0.13);
      const rx = r * stretch, ry = r / Math.sqrt(stretch);
      const ink = `hsl(${hue},55%,${hunter ? 22 : 30}%)`;

      const L = r * 1.5 + sp * 6;
      ctx.strokeStyle = `hsla(${hue},45%,28%,0.6)`;
      ctx.lineWidth = Math.max(0.7, r * 0.2);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(-rx * 0.9, 0);
      for (let i = 1; i <= 6; i++) {
        const u = i / 6;
        ctx.lineTo(-rx * 0.9 - L * u, Math.sin(now * 0.018 * (0.5 + sp) + phase - u * 5) * r * 0.4 * u);
      }
      ctx.stroke();

      if (hunter) {
        ctx.fillStyle = ink;
        ctx.beginPath();
        ctx.moveTo(rx * 0.8, -ry * 0.55);
        ctx.lineTo(rx + r * 0.55, -ry * 0.15);
        ctx.lineTo(rx * 0.9, 0);
        ctx.lineTo(rx + r * 0.55, ry * 0.15);
        ctx.lineTo(rx * 0.8, ry * 0.55);
        ctx.fill();
      }

      ctx.beginPath();
      ctx.ellipse(0, 0, rx, ry, 0, 0, TAU);
      ctx.fillStyle = `hsla(${hue},72%,62%,0.88)`;
      ctx.fill();
      ctx.lineWidth = 0.8 + armor * 0.2;
      ctx.strokeStyle = ink;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(rx * 0.18, -ry * 0.05, r * 0.36, 0, TAU);
      ctx.fillStyle = `hsla(${hue},60%,26%,0.85)`;
      ctx.fill();
      ctx.restore();
    }

    /* ------------------------------------------------------------ frame */

    /* ui: { selected, cursor: {x, y, r, color} | null } */
    draw(sim, ui, now) {
      const ctx = this.ctx, dpr = this.dpr;
      this.clampView(sim);
      const s = this.scale(sim);
      let ox = this.w / 2 - this.view.x * s, oy = this.viewH() / 2 - this.view.y * s;
      if (now < this.shake) {
        const k = (this.shake - now) / 500;
        ox += (Math.random() - 0.5) * 14 * k;
        oy += (Math.random() - 0.5) * 14 * k;
      }

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      ctx.drawImage(this.paperLayer(), 0, 0);
      ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * ox, dpr * oy);

      ctx.drawImage(this.dishLayer(sim), 0, 0, sim.w, sim.h);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(this.terrainLayer(sim), 0, 0);
      ctx.imageSmoothingEnabled = true;

      this.drawMold(ctx, sim.world);

      ctx.fillStyle = '#7f9b2e';
      ctx.beginPath();
      for (const f of sim.food) {
        if (!f.alive) continue;
        ctx.moveTo(f.x + 2, f.y);
        ctx.arc(f.x, f.y, 2, 0, TAU);
      }
      ctx.fill();

      for (const o of sim.orgs) {
        this.drawCell(ctx, o.x, o.y, o.vx, o.vy, o.d.radius, o.hue, o.t.armor, o.d.hunter, o.id * 1.7, now);
      }
      // Cysts around freshly released cells.
      ctx.strokeStyle = 'rgba(29,35,38,0.45)';
      ctx.setLineDash([2, 2]);
      ctx.lineWidth = 1;
      for (const o of sim.orgs) {
        if (!(o.cyst > sim.tick)) continue;
        ctx.beginPath();
        ctx.arc(o.x, o.y, o.d.radius + 4, 0, TAU);
        ctx.stroke();
      }
      ctx.setLineDash([]);

      this.drawNight(ctx, sim, now);
      this.drawEffects(ctx, sim, now);
      if (ui.selected && ui.selected.alive) this.drawSelection(ctx, ui.selected, now, sim);
      if (ui.cursor) {
        const c = ui.cursor;
        ctx.strokeStyle = c.color || 'rgba(29,35,38,0.7)';
        ctx.lineWidth = 1.5 / s;
        ctx.setLineDash([4 / s, 3 / s]);
        ctx.beginPath();
        ctx.arc(c.x, c.y, c.r, 0, TAU);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    drawMold(ctx, w) {
      if (!w.moldCount) return;
      const { cols, mold, moldAge } = w;
      // Dark rims first, then fresh (bright) and established (greyer) cores.
      ctx.fillStyle = 'rgba(38,84,72,0.85)';
      ctx.beginPath();
      for (let i = 0; i < mold.length; i++) if (mold[i]) ctx.rect((i % cols) * TILE + 0.5, Math.floor(i / cols) * TILE + 0.5, TILE - 1, TILE - 1);
      ctx.fill();
      ctx.fillStyle = '#f2fbf5';
      ctx.beginPath();
      for (let i = 0; i < mold.length; i++) if (mold[i] && moldAge[i] < 4) ctx.rect((i % cols) * TILE + 1.5, Math.floor(i / cols) * TILE + 1.5, TILE - 3, TILE - 3);
      ctx.fill();
      ctx.fillStyle = '#b9d6c6';
      ctx.beginPath();
      for (let i = 0; i < mold.length; i++) if (mold[i] && moldAge[i] >= 4) ctx.rect((i % cols) * TILE + 1.5, Math.floor(i / cols) * TILE + 1.5, TILE - 3, TILE - 3);
      ctx.fill();
    }

    /* Night: darken the bench, then let the cells glow (bioluminescence). */
    drawNight(ctx, sim, now) {
      const dark = Math.pow(1 - sim.light, 1.3);
      if (dark < 0.02) return;
      ctx.fillStyle = `rgba(14,18,48,${0.62 * dark})`;
      ctx.fillRect(-sim.w, -sim.h, sim.w * 3, sim.h * 3);
      ctx.globalCompositeOperation = 'lighter';
      for (const o of sim.orgs) {
        const flick = 0.75 + 0.25 * Math.sin(now * 0.004 + o.id);
        ctx.fillStyle = `hsla(${o.hue},90%,55%,${0.3 * dark * flick})`;
        ctx.beginPath();
        ctx.arc(o.x, o.y, o.d.radius * 2.4, 0, TAU);
        ctx.fill();
        ctx.fillStyle = `hsla(${o.hue},100%,80%,${0.45 * dark})`;
        ctx.beginPath();
        ctx.arc(o.x, o.y, o.d.radius * 0.8, 0, TAU);
        ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';
    }

    drawEffects(ctx, sim, now) {
      this.ripples = this.ripples.filter((r) => now - r.t0 < 700);
      for (const r of this.ripples) {
        const k = (now - r.t0) / 700;
        ctx.strokeStyle = `rgba(${r.color},${0.7 * (1 - k)})`;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(r.x, r.y, 5 + k * 30, 0, TAU);
        ctx.stroke();
      }
      this.fx = this.fx.filter((f) => now - f.t0 < 1400);
      for (const f of this.fx) {
        const k = (now - f.t0) / 1400;
        if (f.kind === 'meteor') {
          ctx.fillStyle = `rgba(255,170,60,${0.55 * (1 - k)})`;
          ctx.beginPath();
          ctx.arc(f.x, f.y, 20 + k * 60, 0, TAU);
          ctx.fill();
          ctx.strokeStyle = `rgba(120,50,20,${0.8 * (1 - k)})`;
          ctx.lineWidth = 3;
          ctx.stroke();
        } else if (f.kind === 'zap') {
          ctx.fillStyle = `rgba(150,110,255,${0.4 * (1 - k * 2)})`;
          if (k < 0.5) {
            ctx.beginPath();
            ctx.arc(f.x, f.y, 10 + k * 40, 0, TAU);
            ctx.fill();
          }
        } else {
          const col = f.kind === 'flood' ? '60,130,200' : '40,110,90';
          ctx.strokeStyle = `rgba(${col},${0.7 * (1 - k)})`;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(f.x, f.y, 10 + k * 70, 0, TAU);
          ctx.stroke();
        }
      }
    }

    drawSelection(ctx, o, now, sim) {
      const pulse = 0.5 + 0.5 * Math.sin(now * 0.006);
      ctx.strokeStyle = sim.light < 0.4 ? '#fff6d8' : '#1d2326';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(o.x, o.y, o.d.radius + 6 + pulse * 2, 0, TAU);
      ctx.stroke();

      ctx.setLineDash([2, 5]);
      ctx.globalAlpha = 0.45;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(o.x, o.y, o.d.vision * sim.visionMul, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;

      if (o.tgt && o.tgt.alive) {
        const colors = ['', 'rgba(95,120,30,0.8)', 'rgba(200,50,40,0.8)', 'rgba(200,130,20,0.8)'];
        ctx.strokeStyle = colors[o.mode] || 'rgba(0,0,0,0.4)';
        ctx.beginPath();
        ctx.moveTo(o.x, o.y);
        ctx.lineTo(o.tgt.x, o.tgt.y);
        ctx.stroke();
      }
    }
  }

  root.EvoRenderer = Renderer;
})(window);
