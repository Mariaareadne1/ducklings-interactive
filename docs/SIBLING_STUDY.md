# Sibling study

DUCKLINGS is the sixth piece in a family by the same author — MEADOW (draw a sheep), POND, HIVE, SKY and TIDE. Before writing anything I read MEADOW and POND (both MIT, same author) and decided what to carry over and what to make new. DUCKLINGS is self-contained: code was copied and adapted, never imported across repositories.

## What defines the family's hand (kept almost unchanged)

| Piece | Source | Notes |
|---|---|---|
| Tile on paper, elevated three-quarter perspective camera solved to fit any aspect; tall screens turn a quarter | `meadow/src/scene/camera.ts`, POND's copy | Same pitch, FOV and margins; the tile is smaller (20 × 15 m) so the ducks read as characters. |
| Painted light: `paintLight` (two-tone ramp, lavender shade), `castLight` (contact-hardening PCSS-lite), `castLightFast` for fur shells | `shaderChunks.ts` | Verbatim. Linear colours: `new THREE.Color('#hex')` is already linear. |
| Dry-brush tile edge `paintEdge`, pigment stipple, long dry-brush strokes, flecks | `terrain.ts` | Re-aimed at a park: mown lawn stripes, a gravel path, a flowerbed. |
| Puff modelling: SDF unions + `woolField` scattered puffs, meshed by surface nets in a Web Worker | `sdf.ts`, `wool.ts`, `geometry.worker.ts` | Used for the ducklings' fluff (finer, softer puffs), mum's body, trees and clouds. |
| One part-material per creature with a `uPart` switch; reveal (`revealClip`), flat colour first then light, wet edge of fresh paint, blue selection rim; shadow enabled after 60 % of the reveal | POND `creatures/materials.ts` | Kept the brush-sweep reveal (mode 0) as the brief asks; the watercolour bloom only stains the water when a duckling is drawn on it. |
| Painted water: depth bands in the bed, a transparent surface with sky, streaks, wet shore line, cool shadows and a pool of ripple rings | POND `water.ts`, `terrain.ts` | Ripples are how wakes, plops and paddling show. |
| Reeds that sway in clumps with a shared depth material; dragonfly; drifting petals | POND `reeds.ts`, `life.ts` | Trimmed to what never competes with the line. |
| Pointer state machine (press-creature → drag, press-tile → draw), SVG ink overlay with ghost and shiver-away | `interaction/*` | Tools are Draw and Lead. In Lead, a press on the tile moves mum and a drag steers her. |
| Immutable versioned document, undo/redo over snapshots, `amend` for non-undoable updates, validation of untrusted files | `state/*` | New schema: `{ version: 1, mother, ducklings[] }`, line order = array order, capped at 12. |
| Recorder that composites the SVG ink over the canvas (canvas-only capture loses the pen line) | `capture/recorder.ts` | Verbatim. |
| Dynamic resolution by median frame time; context-loss handling; reduced motion | `engine/Engine.ts`, `App.tsx` | Verbatim. |
| Playwright on real Chromium with `--use-angle=metal`; dev and production builds; QA scripts that shoot, film and contact-sheet | `playwright.config.ts`, `scripts/*.mjs` | Same harness, new specs. |

## Lessons the siblings paid for

- **Behaviours are pure functions of time** (MEADOW `behaviors.ts`): interrupting never strands a joint, and everything is testable. Controllers cross-fade from the pose actually shown.
- **Integrate stride phase**, don't compute it as `time × speed` (POND: a speed change made the feet leap).
- **One steering model**, continuous avoidance, slide along edges instead of teleporting (POND's smoothness work).
- **Things mid-reveal stay pickable; shadows appear only after the reveal.**
- **Benchmark with back-to-back frames and a GPU sync**; the machine is often loaded.
- **Seen from above, height reads through the shadow separating** — hops and plops need visible shadows and splash rings.
- **White feathers go lilac in shade** unless the shade is softened for them (POND's duck): keep `keep`/`softness` high for cream and yellow fluff.

## What is new in DUCKLINGS

- The **follow line**: mum's path is recorded as a breadcrumb polyline with cumulative arc length; each duckling sits a fixed arc length behind the one in front *on that polyline*, so the line snakes through exactly the curves mum took. The steady-state line is a pure function of the trail and each follower's index (`src/ducks/trail.ts`).
- **Pathing** on a cost grid where walking and swimming are priced by time; the water can only be entered and left along the gentle bank, the steep edge is impassable, and the bridge is a walkable strip over the water. Paths are string-pulled and smoothed.
- **Plop-in**: crossing into the water triggers a small hop, a squash, a splash and a ring; each duckling plops at the spot mum did because it walks her trail.
- **Huddle, preen, sit, straggle, peep ripple** — small, rare, characterful.
