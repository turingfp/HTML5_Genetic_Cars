# BoxCar3D

Cars that evolve their shape and the little neural network that drives them, on
Erin Catto's Box3D physics, in a browser tab.

![Four wheeled cars evolving on a banked road](docs/screenshot-3d.png)

Twenty random cars set off down a road that gets steeper and starts to bank. A
car scores by how far it gets, plus a bonus for average speed. It dies when it
stops earning ground or rolls off the edge. When the round is over the best ones
get paired up, their genes spliced together and lightly mutated, and the next
twenty set off. Do that for a while and something that can actually climb the
hill falls out of it.

## Where this came from

This began as [rednuht's Genetic Cars](http://rednuht.org/genetic_cars_2/), a
2011 page that was itself a take on BoxCar2D. It was a lovely, simple thing:
throw random two wheeled shapes at a hill, keep the ones that get furthest,
breed them, watch a car appear out of nothing. The code had not been touched
since 2013. It was one 1,119 line file of globals running on a Flash era port of
Box2D, with `Math.random` monkey patched, two `setInterval` timers that drifted
apart, a fixed 800x400 layout, and DOM writes on every physics step.

BoxCar3D is a rebuild of that idea. Three things are genuinely different:

1. **It is 3D.** Cars run on [Box3D](https://github.com/erincatto/box3d), Erin
   Catto's newer engine and a direct descendant of the Box2D the original used,
   via [box3d-wasm](https://github.com/monteslu/box3d-wasm). The road banks from
   side to side, so a car can roll off the edge rather than only ever getting
   stuck.
2. **Cars have a driver.** Each one carries a small neural network that reads
   how the car is sitting and moving and sets the speed of each wheel. Its
   weights are genes like any other.
3. **You can watch the search, not just the run.** There is a live view of the
   winning car's network, a heatmap of the whole population's weights, and a
   graveyard of every car that has ever died on this course.

The original 2D game is still here under the **2D** button, rebuilt on
[planck.js](https://piqnt.com/planck.js/). Both modes share the seed, the
population controls and the genetic algorithm itself. Records are kept apart,
because a flat car and a four wheeled one are solving different problems on
different scales.

## The driver

In the original a wheel spun at one fixed speed forever. A car was a shape and
nothing else, and the whole search was "what silhouette survives being dragged
over a hill".

Now every car also has a network. It sees six things:

| Input   | What it is                                     |
| ------- | ---------------------------------------------- |
| `pitch` | nose up or nose down                           |
| `roll`  | leaning left or right, and always 0 in 2D      |
| `speed` | how fast it is going along the course          |
| `drop`  | how fast it is falling                         |
| `spin`  | how fast the body is tumbling                  |
| `slope` | how steeply the ground rises about 3 m ahead   |

Those feed five hidden units, which feed one output per wheel. Each output sets
that wheel's speed somewhere between a dead stop and half again the base speed,
so a car can ease off before a crest, dig in on a climb, or back off a touch to
get a run at something.

It is 47 weights. That is small on purpose: it fits on screen, it runs twenty
times per physics step without showing up in a profile, and it is enough to be
interesting without needing anything cleverer than a genetic algorithm to train
it. The floor on a wheel's speed sits just above reverse rather than at full
reverse, because a network wired at random still has to produce a car that
moves. Otherwise generation one is twenty motionless boxes and selection has
nothing to work with.

The **Driver** panel draws it live for whichever car the camera is on. Green
edges push, red ones hold back, thickness is the size of the weight, and
brightness is how much signal is actually flowing through it right now. Watch
one car through a hard climb and you can see which senses it leans on. The edges
out of a sense nothing depends on fade away over a few generations.

Under it, **Gene pool** is one row per car and one column per weight, coloured
by value. Generation one is noise. Leave it running and columns start to agree,
which is selection fixing a weight because every car that survived happens to
share it. Bands that stay noisy are weights nothing depends on. The fitness
chart tells you the search is working; this tells you where.

## The 3D mode

A 3D car is the 2D silhouette given a width. The chassis outline is extruded
into a convex hull and each wheel becomes a pair, so a car evolved in 2D is
still a valid car here. That adds two genes, how wide the body is and how far
the wheels sit outboard, and one new way to fail. Narrow and tall wins the early
flat ground, and something wider usually has to evolve to survive the camber.

Wheels are real wheels: sixteen sided prisms about the axle, so a tyre has a
flat tread and a contact patch that grips. They started as capsules, which on a
large radius are geometrically spheres. They looked wrong and behaved wrong,
rolling sideways instead of tracking. Tread width now scales with radius.

The road is one continuous ribbon stitched from a cross section per joint, drawn
from the same samples the physics colliders are built from, with bars painted
across it every ten metres so there is something to measure speed against.
Lighting is ACES filmic tone mapped and each car takes a slightly different hue,
so you can follow one through the pack.

### Seeing the search

![The graveyard after ten generations](docs/screenshot-graveyard.png)

Every car leaves a marker where it died, kept across every generation. Bright
ones are recent, faded blue ones are ancient history, and a tilted marker means
the car went over the edge rather than grinding to a halt. Drag to orbit, scroll
to zoom, or hit **Survey the graveyard** to pull back and look down the course.

What you get is a map of the problem rather than of one attempt. Deaths pile up
in dense bands at the obstacles the population cannot yet pass, thin out behind
the frontier as evolution solves them, and spray off both edges wherever the
camber is steep enough to throw a car off. Motion trails show the current
generation fanning out over the same ground.

All the markers are a single `InstancedMesh`, so several thousand of them cost
one draw call, and they are recoloured once per generation rather than per
frame.

## Running it

```sh
npm install
npm run dev
```

| Command             | What it does                                  |
| ------------------- | --------------------------------------------- |
| `npm run dev`       | Development server with hot reload            |
| `npm run build`     | Production build into `dist/`                 |
| `npm run preview`   | Serve the production build                    |
| `npm run typecheck` | TypeScript, no emit                           |
| `npm test`          | Unit tests for the GA, terrain and simulation |
| `npm run test:e2e`  | Playwright smoke tests against the built app  |

The end-to-end tests download their own Chromium by default. To reuse one that
is already installed, set `CHROMIUM_PATH` to the binary.

## Deploying

The build is a self contained static site, so any static host will serve it.
There is no server side. `vercel.json` configures Vercel directly: import the
repository and it builds with `npm run build` and serves `dist/`.

It sets two caching rules. Everything under `/assets/` carries a content hash in
its filename, so it is cached for a year and marked immutable. The entry
document is not, and must always be revalidated, since a cached `index.html`
would otherwise keep pointing at asset filenames from an older deployment.
Vercel's config schema rejects unknown keys, so those rules cannot be commented
in place, hence this note.

Two things worth knowing if you host it elsewhere. Vite is configured with a
relative `base`, so the site works from a subdirectory as well as from a domain
root. And the 3D mode uses the single threaded Box3D build deliberately, so it
needs no `SharedArrayBuffer` and therefore no cross origin isolation headers. It
will run from a plain file host.

## How the code is organised

The physics engine is kept behind a boundary. The simulation fills a plain
snapshot of positions, angles and activations, and the renderer draws from that,
so nothing outside `src/sim*/` refers to an engine and the genetic algorithm is
pure functions over plain data that can be tested without a browser.

Evolution is generic over the genome. `ga/evolution.ts` takes a `GenomeOps`
describing how to create, breed and mutate one kind of car, so both modes share
a single implementation of selection, crossover and elitism.

```
src/
  config.ts        every tunable constant, with the real ranges documented
  core/rng.ts      seedable generator (no global Math.random patching)
  ga/              genomes, the driver network, and evolution: all pure
  sim/             2D terrain, car construction, the world and its rules
  sim3d/           the same on Box3D, with a banked road and four wheels
  replay/          compact pose recording and the ghost of the best run
  render/          camera, main view, minimap, fitness chart, driver panels
  render3d/        the three.js scene
  ui/              controls, readouts, hall of fame, persistence
  app/             the fixed timestep loop and the wiring between all of it
```

Box3D and three.js are dynamically imported, so the flat mode never downloads
them. Opening in 3D means waiting for that once, behind a banner, which is why
the first second or two of a fresh load shows an empty stage.

## What changed from the original

The original single file version is preserved in this repository's git history.

- **Physics** moved from a vendored Box2DFlash 2.1a build to planck.js in 2D and
  Box3D in 3D, and solver iterations dropped from 20/20 to Box2D's 8/3 defaults.
- **One `requestAnimationFrame` loop** on a fixed timestep replaces two
  independent `setInterval` timers that drifted apart and got throttled to a
  crawl in background tabs. Speed runs from 0.5x up to a max mode that spends a
  fixed slice of each frame on physics, so evolution races ahead while the page
  stays responsive.
- **No DOM writes during physics.** The original rewrote inline styles on forty
  elements and two `innerHTML` strings every step. Canvases and readouts now
  refresh once per animation frame.
- **Replays store nine floats per frame** instead of a full geometry snapshot of
  every car on every frame.
- **The interface** was rebuilt responsively with device pixel ratio aware
  canvases, replacing a fixed 800x400 layout positioned with absolute pixel
  offsets.
- Dead Google Analytics, a PayPal form and an HTTP only widget were removed.

Bugs fixed along the way: leader tracking aliased a live physics vector, and the
function meant to recompute it never updated its own accumulator; a cached "last
drawn tile" index was never reset, so the ground vanished at the start of each
generation; the fitness graph plotted raw scores as pixel coordinates and went
off canvas above 200; mutation and crossover could both seat both wheels on the
same chassis vertex, producing cars that could not drive; and the tilt formula
reached 129 degrees on late tiles, folding the track back over itself so the
surface was no longer a function of x. Tilt is now clamped just under a quarter
turn.

### Cars that would not die

A car creeping forward at a millimetre a second used to be immortal. Any gain
over two centimetres refilled its health bar completely, so a single crawler
could hold a generation open indefinitely. Health is now earned in proportion to
ground gained, which sets a minimum sustained speed, and a generation has a hard
ninety second cap.

That was not enough on its own. A car can keep clearing a per car speed bar
while contributing nothing, rocking against an obstacle or trickling along
ground the population passed generations ago. In 3D the first generation still
ran the full cap with its last real progress made at nine seconds. So a round
now also ends when the population as a whole stops getting anywhere: six seconds
with nobody beating the round's furthest point closes it. Wasted rounds went
from ninety seconds to eleven, and four generations of 3D from 217 seconds to
50. Rounds that are still making progress are untouched, which
`tests/stall.test.ts` pins down from both sides.

Two behavioural notes: the physics feel is close but not identical, since the
solver differs, and track seeds are not compatible with the original, which used
seedrandom's RC4 generator.

## Licence

The original code carries no licence, so it remains the property of its authors.
This rebuild is published in the same spirit. Please credit
[rednuht](http://rednuht.org/genetic_cars_2/) if you build on it.
