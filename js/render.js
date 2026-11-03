/* Evolution Arena — petri-dish renderer: agar, glass rim, cells with flagella. */
(function (root) {
  'use strict';

  const TAU = Math.PI * 2;

  class Renderer {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.ripples = [];
      this.w = 0;
      this.h = 0;
      this.dpr = 1;
      this.bg = null;
      this.bgKey = '';
    }

    resize(w, h) {
      this.dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.w = w;
      this.h = h;
      this.canvas.width = Math.round(w * this.dpr);
      this.canvas.height = Math.round(h * this.dpr);
      this.bgKey = '';
    }

    /* Bench, dish shadow, agar and glass rim are static: render once per size. */
    background(sim) {
      const key = `${this.canvas.width}x${this.canvas.height}:${sim.R}`;
      if (this.bgKey === key) return this.bg;
      const c = document.createElement('canvas');
      c.width = this.canvas.width;
      c.height = this.canvas.height;
      const g = c.getContext('2d');
      g.scale(this.dpr, this.dpr);
      const { cx, cy, R } = sim;

      g.fillStyle = '#e7e0d0';
      g.fillRect(0, 0, this.w, this.h);
      // Paper grain.
      for (let i = 0, n = (this.w * this.h) / 120; i < n; i++) {
        g.fillStyle = Math.random() < 0.5 ? 'rgba(90,70,40,0.05)' : 'rgba(255,255,255,0.18)';
        g.fillRect(Math.random() * this.w, Math.random() * this.h, 1, 1);
      }

      // Soft shadow under the dish.
      g.save();
      g.filter = 'blur(14px)';
      g.fillStyle = 'rgba(60,45,20,0.28)';
      g.beginPath();
      g.ellipse(cx + 6, cy + 12, R + 10, R + 8, 0, 0, TAU);
      g.fill();
      g.restore();

      // Glass lip.
      g.fillStyle = 'rgba(250,248,240,0.9)';
      g.beginPath();
      g.arc(cx, cy, R + 10, 0, TAU);
      g.fill();
      g.strokeStyle = 'rgba(70,60,40,0.35)';
      g.lineWidth = 1.2;
      g.stroke();

      // Agar.
      const agar = g.createRadialGradient(cx - R * 0.25, cy - R * 0.3, R * 0.1, cx, cy, R);
      agar.addColorStop(0, '#fbf3da');
      agar.addColorStop(0.75, '#f3e6bd');
      agar.addColorStop(1, '#e9d6a1');
      g.fillStyle = agar;
      g.beginPath();
      g.arc(cx, cy, R, 0, TAU);
      g.fill();

      // Faint agar texture.
      g.save();
      g.beginPath();
      g.arc(cx, cy, R, 0, TAU);
      g.clip();
      for (let i = 0, n = (R * R) / 60; i < n; i++) {
        const [x, y] = [cx + (Math.random() * 2 - 1) * R, cy + (Math.random() * 2 - 1) * R];
        g.fillStyle = `rgba(150,110,40,${Math.random() * 0.06})`;
        g.beginPath();
        g.arc(x, y, Math.random() * 2.2, 0, TAU);
        g.fill();
      }
      g.restore();

      g.strokeStyle = 'rgba(120,95,45,0.45)';
      g.lineWidth = 1.5;
      g.beginPath();
      g.arc(cx, cy, R, 0, TAU);
      g.stroke();

      // Glass highlight.
      g.strokeStyle = 'rgba(255,255,255,0.85)';
      g.lineWidth = 3;
      g.lineCap = 'round';
      g.beginPath();
      g.arc(cx, cy, R + 5, Math.PI * 1.08, Math.PI * 1.42);
      g.stroke();

      // Measurement ticks around the rim.
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

      this.bg = c;
      this.bgKey = key;
      return c;
    }

    ripple(x, y) {
      this.ripples.push({ x, y, t0: performance.now() });
    }

    /* A single cell: wiggling flagellum, stretched membrane, nucleus; hunters get jaws. */
    drawCell(ctx, x, y, vx, vy, r, hue, armor, hunter, phase, now) {
      const sp = Math.hypot(vx, vy);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(sp > 0.03 ? Math.atan2(vy, vx) : phase);

      const stretch = 1 + Math.min(0.35, sp * 0.13);
      const rx = r * stretch, ry = r / Math.sqrt(stretch);
      const ink = `hsl(${hue},55%,${hunter ? 22 : 30}%)`;

      // Flagellum.
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

    draw(sim, selected, now) {
      const ctx = this.ctx, dpr = this.dpr;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(this.background(sim), 0, 0);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // Food: olive grains, batched into one path.
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

      this.ripples = this.ripples.filter((r) => now - r.t0 < 700);
      for (const r of this.ripples) {
        const k = (now - r.t0) / 700;
        ctx.strokeStyle = `rgba(90,110,30,${0.7 * (1 - k)})`;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(r.x, r.y, 5 + k * 30, 0, TAU);
        ctx.stroke();
      }

      if (selected && selected.alive) this.drawSelection(ctx, selected, now);
    }

    drawSelection(ctx, o, now) {
      const pulse = 0.5 + 0.5 * Math.sin(now * 0.006);
      ctx.strokeStyle = '#1d2326';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(o.x, o.y, o.d.radius + 6 + pulse * 2, 0, TAU);
      ctx.stroke();

      ctx.setLineDash([2, 5]);
      ctx.strokeStyle = 'rgba(29,35,38,0.4)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(o.x, o.y, o.d.vision, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);

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
