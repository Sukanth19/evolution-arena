/* Evolution Arena — challenges: goals to chase, remembered across visits. */
(function (root) {
  'use strict';

  const KEY = 'evo-progress-v1';

  /* Each check gets ctx = { sim, stats, progress } and returns true once the goal is met. */
  const LIST = [
    { id: 'first', title: 'First steps', desc: 'Release your first species.',
      check: ({ progress }) => progress.releases >= 1 },
    { id: 'gen25', title: 'Deep roots', desc: 'Reach generation 25 with one of your lineages.',
      check: ({ sim }) => sim.playerMaxGen() >= 25 },
    { id: 'gen100', title: 'Ancient line', desc: 'Reach generation 100.',
      check: ({ sim }) => sim.playerMaxGen() >= 100 },
    { id: 'pop80', title: 'Population boom', desc: 'Have 80 of your cells alive at once.',
      check: ({ stats }) => stats.player >= 80 },
    { id: 'survive', title: 'Stubborn', desc: 'Keep one lineage alive for 5 in-game minutes.',
      check: ({ sim }) => sim.species.some((s) => s.owner === 'player' && !s.extinct && sim.tick - s.bornTick >= 60 * 300) },
    { id: 'apex', title: 'Apex predator', desc: 'One of your cells makes 10 kills.',
      check: ({ sim }) => sim.orgs.some((o) => o.sp.owner === 'player' && o.kills >= 10) },
    { id: 'top', title: 'Top of the dish', desc: 'Your lineage is the most numerous species (30+ cells).',
      check: ({ sim }) => {
        if (sim.mode !== 'ecosystem') return false;
        const alive = sim.species.filter((s) => !s.extinct).sort((a, b) => b.count - a.count);
        return alive.length > 1 && alive[0].owner === 'player' && alive[0].count >= 30;
      } },
    { id: 'night', title: 'Night shift', desc: 'Keep a lineage alive through a whole night.',
      check: ({ progress }) => progress.nightsSurvived >= 1 },
    { id: 'meteor', title: 'Impact survivor', desc: 'Your lineage lives on 30 s after a meteor strike.',
      check: ({ progress }) => progress.meteorSurvived >= 1 },
    { id: 'duel1', title: 'Duellist', desc: 'Win a duel.',
      check: ({ progress }) => progress.duelsWon >= 1 },
    { id: 'duel5', title: 'Champion', desc: 'Win 5 duels.',
      check: ({ progress }) => progress.duelsWon >= 5 },
    { id: 'builder', title: 'Architect', desc: 'Place 300 blocks of terrain.',
      check: ({ progress }) => progress.blocks >= 300 },
    { id: 'garden', title: 'Petri gardener', desc: 'Grow a mold colony of 500 cells.',
      check: ({ sim }) => sim.world.moldCount >= 500 },
    { id: 'gun', title: 'Glider factory', desc: 'Stamp a glider gun into the mold.',
      check: ({ progress }) => progress.guns >= 1 },
    { id: 'witness', title: 'Witness', desc: 'See 15 species go extinct.',
      check: ({ progress }) => progress.extinctions >= 15 },
  ];

  function load() {
    const base = { done: {}, releases: 0, duelsWon: 0, blocks: 0, guns: 0, extinctions: 0, nightsSurvived: 0, meteorSurvived: 0 };
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) return Object.assign(base, JSON.parse(raw));
    } catch (e) { /* storage blocked: progress lasts for this visit only */ }
    return base;
  }

  function save(progress) {
    try { localStorage.setItem(KEY, JSON.stringify(progress)); } catch (e) { /* ignore */ }
  }

  /* Returns the challenges newly completed by this check. */
  function evaluate(ctx) {
    const fresh = [];
    for (const c of LIST) {
      if (ctx.progress.done[c.id]) continue;
      let ok = false;
      try { ok = c.check(ctx); } catch (e) { ok = false; }
      if (ok) {
        ctx.progress.done[c.id] = Date.now();
        fresh.push(c);
      }
    }
    if (fresh.length) save(ctx.progress);
    return fresh;
  }

  root.EvoChallenges = { LIST, load, save, evaluate };
})(window);
