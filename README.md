# Evolution Arena

Evolution meets Conway's Game of Life. Design a species, release it into a petri dish, and watch natural selection decide whether it survives, while a Game-of-Life colony grows on the agar around it.

Every creature carries six heritable traits. Offspring inherit them with small random mutations, so lineages drift and adapt over generations. Underneath the creatures, the Life layer follows Conway's rules, and you can paint it, stamp classic patterns, switch its rules, trigger world events and chase challenges.

## Play

No build step and no dependencies. You can:

- open `index.html` in a browser, or
- serve the folder: `python3 -m http.server` and visit http://localhost:8000.

### Modes

- **Ecosystem**: wild species roam a dish seeded with Life colonies. Spend your 30 trait points, press **Release**, and see whether your lineage finds a niche. When diversity drops, new wild species migrate in.
- **Duel**: your species against one rival for two minutes. Tools lock while the duel runs. The last lineage standing wins; if both survive, the larger population wins.

### Tools

| Key | Tool | Effect |
| --- | --- | --- |
| `1` | Inspect | Click a cell to see its evolved traits, energy, behaviour and crowding |
| `2` | Nutrients | Sprinkle food grains |
| `3` | Life | Paint live Life cells, or stamp a pattern: glider, spaceship, R-pentomino, acorn, pulsar, glider gun |
| `4` | Scrape | Remove Life cells |
| `5` | UV lamp | Kills every creature and Life cell under the lamp |

### Controls

| Input | Action |
| --- | --- |
| Left-drag | Use the current tool |
| `[` `]` | Brush size |
| Mouse wheel, `+` `-` | Zoom |
| `WASD` / arrows, right-drag, shift-drag | Pan |
| `0` | Show the whole dish |
| `F` | Follow the inspected cell |
| `Space` | Pause / resume |
| `R` | Release / start duel |
| `Esc` | Close inspector |

## The world

- **The Life layer (Conway's Game of Life).** The agar is a grid of 8 px tiles, and each one is either alive or empty. Every few ticks the whole layer advances one generation. Under Conway's rule (B3/S23), a live cell with fewer than 2 neighbours dies of loneliness, one with more than 3 dies of overcrowding, and an empty tile with exactly 3 neighbours comes alive. You can switch the rule to HighLife, Day & Night, Maze, Coral, Amoeba or Seeds. Hungry creatures graze Life cells, and stray spores drift in now and then so the layer never dies out completely.
- **Day and night.** A full day lasts two minutes at 1×. At night food grows more slowly, vision shrinks, and cells glow.
- **World events.** These happen at random, or you can trigger them from the World card: nutrient bloom, heat wave (upkeep +50%), cold snap (everything slows), meteor strike (wipes out everything in the blast and scatters nutrients around it), and Life outbreak.
- **Save / Load.** Saves the whole ecosystem dish (Life layer, creatures, food) in this browser.

## Traits

Set each trait by clicking its pips or using the − / + buttons. Each strength costs energy. There are 30 points in total, and each trait is capped at 10.

| Trait | Benefit | Cost |
| --- | --- | --- |
| **Speed** | Faster movement | Movement cost grows with the square of speed |
| **Size** | More energy storage, harder hits, longer life | Higher upkeep, slower turning |
| **Aggression** | At 4 or more the creature becomes a hunter (drawn with jaws) and eats other species | Digests plants poorly |
| **Vision** | Sees food, prey and threats from farther away | Upkeep |
| **Armor** | Takes less damage, spines hurt attackers (thicker membrane) | Heavy, so movement and upkeep cost more |
| **Fertility** | Breeds sooner and more often, sometimes twins | Offspring start with smaller reserves |

Mutation shifts points between traits but never adds new ones. A lineage cannot become good at everything. It can only trade one strength for another.

## How the creatures work

- **Energy.** Creatures spend energy every tick on upkeep plus movement. They regain it by eating food grains, grazing Life cells, or (for hunters) biting other species.
- **Behaviour.** Every few ticks a creature looks around within its vision. It flees from a hunter that would win a fight, chases prey it can beat, or forages. Otherwise it wanders.
- **Reproduction.** Above an energy threshold (lower when fertility is higher), a creature splits off one or two offspring with mutated traits. Newly released colonies start inside protective cysts for 5 seconds.
- **Crowding.** Each creature counts nearby kin. The more neighbours it has, the more upkeep it pays, and very common species pay extra too, which stands in for disease and competition. The inspector shows the count.
- **Death.** Creatures die of starvation, predation, old age, meteors or UV light. Some of the dead return to the soil as food.

## Challenges

There are 15 goals, including reaching generation 100, surviving a meteor, winning 5 duels, growing the Life layer to 500 cells, trying 4 Life rules and stamping a glider gun. Progress is remembered in your browser.

## Project layout

```
index.html         page shell
css/style.css      styling
js/world.js        the Life layer: cellular automaton, rules, patterns (no DOM)
js/sim.js          creatures, food, day/night, events, save/load (no DOM, runs under node)
js/challenges.js   challenge definitions and saved progress
js/render.js       canvas renderer: dish, Life colonies, cells, night, camera
js/ui.js           tools, camera input, cards, inspector, main loop
```

`js/sim.js` runs under node, so you can test balance headlessly:

```js
const Evo = require('./js/sim.js');
const sim = new Evo.Sim();
sim.release({ speed: 5, size: 6, aggression: 5, vision: 6, armor: 4, fertility: 4 });
for (let i = 0; i < 6000; i++) sim.step();
console.log(sim.stats());
```
