# Evolution Arena

Design a species, release it into a petri-dish ecosystem, and watch natural selection decide whether it survives.

Every creature carries six heritable traits. Offspring inherit them with small random mutations, so lineages drift and adapt over generations. Some species take over the arena, others coexist, and plenty go extinct.

## Play

No build step and no dependencies. You can:

- open `index.html` in a browser, or
- serve the folder: `python3 -m http.server` and visit http://localhost:8000.

### Modes

- **Ecosystem**: wild species roam a round agar dish with drifting food patches. Spend your 30 trait points, press **Release**, and see whether your lineage finds a niche. When diversity drops, new wild species migrate in.
- **Duel**: your species against one rival in an empty dish for two minutes. The last lineage standing wins. If both survive, the larger population wins.

### Controls

| Input | Action |
| --- | --- |
| Click a creature | Inspect it: evolved traits vs. its founder, energy, behaviour |
| Click the agar | Drop a burst of food |
| `Space` | Pause / resume |
| `1` `2` `4` | Simulation speed |
| `R` | Release / start duel |
| `Esc` | Close inspector |

## Traits

Set each trait by clicking its pips or using the − / + buttons. Each strength costs energy. There are 30 points in total, and each trait is capped at 10.

| Trait | Benefit | Cost |
| --- | --- | --- |
| **Speed** | Faster movement | Movement cost grows with the square of speed |
| **Size** | More energy storage, harder hits, longer life | Higher upkeep, slower turning |
| **Aggression** | At 4 or more the creature becomes a hunter (drawn with jaws) and eats other species | Digests plants poorly |
| **Vision** | Sees food, prey and threats from farther away | Upkeep |
| **Armor** | Takes less damage, and its spines hurt attackers (thicker membrane) | Heavy, so movement and upkeep cost more |
| **Fertility** | Breeds sooner and more often, sometimes twins | Offspring start with smaller reserves |

Mutation shifts points between traits but never adds new ones. A lineage cannot become good at everything. It can only trade one strength for another.

## How the simulation works

- **Energy.** Creatures spend energy every tick on upkeep plus movement. They regain it by eating food (olive grains) or, for hunters, by biting other species.
- **Behaviour.** Every few ticks a creature looks around within its vision. It flees from a hunter that would win a fight, chases prey it can beat, or forages for the nearest food. Otherwise it wanders.
- **Reproduction.** Above an energy threshold (lower when fertility is higher), a creature splits off one or two offspring with mutated traits.
- **Density pressure.** Large species and local clumps pay extra upkeep, which stands in for disease and competition. This stops any one species from owning the arena forever and gives newcomers room.
- **Death.** Creatures die of starvation, predation or old age. Some of the dead return to the soil as food.

## Project layout

```
index.html       page shell
css/style.css    styling
js/sim.js        simulation core (no DOM, also runs under node)
js/render.js     canvas renderer: agar dish, cells with nuclei and flagella
js/ui.js         controls, stats, chart, inspector, main loop
```

`js/sim.js` exports itself under node, so you can test balance headlessly:

```js
const Evo = require('./js/sim.js');
const sim = new Evo.Sim(1200, 800);
sim.release({ speed: 5, size: 6, aggression: 5, vision: 6, armor: 4, fertility: 4 });
for (let i = 0; i < 6000; i++) sim.step();
console.log(sim.stats());
```
