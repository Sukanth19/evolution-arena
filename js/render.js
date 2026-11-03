/* Evolution Arena — canvas renderer (glow sprites + motion tails). */
(function (root) {
  'use strict';
  const { FOOD_HUE } = root.Evo;
  const SPRITE = 64;

  class Renderer {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.sprites = new Map();
      this.foodSprite = this.makeSprite(FOOD_HUE, true);
      this.ripples = [];
      this.w = 0;
      this.h = 0;
      this.dpr = 1;
      this.bg = null;
    }

    resize(w, h) {
      this.dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.w = w;
      this.h = h;
      this.canvas.width = Math.round(w * this.dpr);
      this.canvas.height = Math.round(h * this.dpr);
      this.bg = this.makeBackground();
    }

    makeSprite(hue, food) {
      const c = document.createElement('canvas');
      c.width = c.height = SPRITE;
      const g = c.getContext('2d');
      const h = SPRITE / 2;
      const grd = g.createRadialGradient(h, h, 0, h, h, h);
      if (food) {
        grd.addColorStop(0, `hsla(${hue},100%,88%,1)`);
        grd.addColorStop(0.22, `hsla(${hue},90%,62%,0.9)`);
        grd.addColorStop(0.5, `hsla(${hue},90%,50%,0.16)`);
        grd.addColorStop(1, `hsla(${hue},90%,45%,0)`);
      } else {
        grd.addColorStop(0, `hsla(${hue},100%,97%,1)`);
        grd.addColorStop(0.18, `hsla(${hue},100%,74%,1)`);
        grd.addColorStop(0.4, `hsla(${hue},100%,60%,0.42)`);
        grd.addColorStop(0.7, `hsla(${hue},100%,55%,0.08)`);
        grd.addColorStop(1, `hsla(${hue},100%,50%,0)`);
      }
      g.fillStyle = grd;
      g.fillRect(0, 0, SPRITE, SPRITE);
      return c;
    }

    sprite(hue) {
      const key = (Math.round(hue / 4) * 4) % 360;
      let s = this.sprites.get(key);
      if (!s) {
        s = this.makeSprite(key, false);
        this.sprites.set(key, s);
      }
      return s;
    }

    makeBackground() {
      const c = document.createElement('canvas');
      c.width = this.canvas.width;
      c.height = this.canvas.height;
      const g = c.getContext('2d');
      const W = c.width, H = c.height;
      g.fillStyle = '#04060c';
      g.fillRect(0, 0, W, H);
      let grd = g.createRadialGradient(W * 0.5, H * 0.45, 0, W * 0.5, H * 0.45, Math.max(W, H) * 0.7);
      grd.addColorStop(0, 'rgba(22,32,58,0.45)');
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grd;
      g.fillRect(0, 0, W, H);
      // Faint organic speckle so the void has texture.
      const n = Math.floor((W * H) / 700);
      for (let i = 0; i < n; i++) {
        g.fillStyle = `rgba(120,140,190,${Math.random() * 0.05})`;
        const s = (0.6 + Math.random() * 1.6) * this.dpr;
        g.fillRect(Math.random() * W, Math.random() * H, s, s);
      }
      grd = g.createRadialGradient(W * 0.5, H * 0.5, Math.min(W, H) * 0.35, W * 0.5, H * 0.5, Math.max(W, H) * 0.75);
      grd.addColorStop(0, 'rgba(0,0,0,0)');
      grd.addColorStop(1, 'rgba(0,0,0,0.55)');
      g.fillStyle = grd;
      g.fillRect(0, 0, W, H);
      return c;
    }

    ripple(x, y, hue) {
      this.ripples.push({ x, y, hue, t0: performance.now() });
    }

    /* Draw one glowing organism with a fading comet tail. Shared with the preview. */
    drawOrganism(ctx, x, y, vx, vy, radius, hue) {
      const sp = Math.hypot(vx, vy);
      if (sp > 0.05) {
        const len = radius * 1.2 + sp * 9;
        const tx = x - (vx / sp) * len, ty = y - (vy / sp) * len;
        const grd = ctx.createLinearGradient(x, y, tx, ty);
        grd.addColorStop(0, `hsla(${hue},100%,72%,0.75)`);
        grd.addColorStop(1, `hsla(${hue},100%,60%,0)`);
        ctx.globalAlpha = 1;
        ctx.strokeStyle = grd;
        ctx.lineWidth = radius * 0.9;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(tx, ty);
        ctx.stroke();
      }
      const D = radius * 4.4;
      ctx.globalAlpha = 1;
      ctx.drawImage(this.sprite(hue), x - D / 2, y - D / 2, D, D);
    }

    draw(sim, selected, now) {
      const ctx = this.ctx, dpr = this.dpr;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      if (this.bg) ctx.drawImage(this.bg, 0, 0);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      ctx.globalCompositeOperation = 'lighter';
      const fs = this.foodSprite;
      for (const f of sim.food) {
        if (!f.alive) continue;
        const s = 9 + Math.sin(now * 0.002 + f.tw) * 1.3;
        ctx.drawImage(fs, f.x - s / 2, f.y - s / 2, s, s);
      }
      for (const o of sim.orgs) this.drawOrganism(ctx, o.x, o.y, o.vx, o.vy, o.d.radius, o.hue);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';

      // Heavily armoured creatures carry a faint shell.
      ctx.lineWidth = 1;
      for (const o of sim.orgs) {
        if (o.t.armor < 6) continue;
        ctx.strokeStyle = `hsla(${o.hue},70%,82%,${((o.t.armor - 5) / 5) * 0.45})`;
        ctx.beginPath();
        ctx.arc(o.x, o.y, o.d.radius + 2, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Click ripples.
      this.ripples = this.ripples.filter((r) => now - r.t0 < 700);
      for (const r of this.ripples) {
        const k = (now - r.t0) / 700;
        ctx.strokeStyle = `hsla(${r.hue},90%,70%,${0.6 * (1 - k)})`;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(r.x, r.y, 6 + k * 34, 0, Math.PI * 2);
        ctx.stroke();
      }

      if (selected && selected.alive) this.drawSelection(ctx, selected, now);
    }

    drawSelection(ctx, o, now) {
      const pulse = 0.5 + 0.5 * Math.sin(now * 0.006);
      ctx.strokeStyle = `hsla(${o.hue},90%,80%,${0.55 + pulse * 0.35})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(o.x, o.y, o.d.radius + 7 + pulse * 2, 0, Math.PI * 2);
      ctx.stroke();

      ctx.setLineDash([3, 6]);
      ctx.strokeStyle = `hsla(${o.hue},80%,70%,0.22)`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(o.x, o.y, o.d.vision, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);

      if (o.tgt && o.tgt.alive) {
        const colors = ['', 'rgba(110,240,190,0.5)', 'rgba(255,110,120,0.6)', 'rgba(255,210,120,0.55)'];
        ctx.strokeStyle = colors[o.mode] || 'rgba(255,255,255,0.3)';
        ctx.beginPath();
        ctx.moveTo(o.x, o.y);
        ctx.lineTo(o.tgt.x, o.tgt.y);
        ctx.stroke();
      }
    }
  }

  root.EvoRenderer = Renderer;
})(window);
