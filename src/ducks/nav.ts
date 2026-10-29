import {
  BOUNDS, BRIDGE, TILE, bridgeLocal, edgeDistance, gentleness, obstacleSDF, pondSDF,
} from '../scene/park';

/**
 * Pathing for the ducks on a cost grid over the tile, priced by time:
 * walking and swimming have their own pace, and slipping into or climbing
 * out of the water costs a moment — and can only happen along the gentle
 * bank. The steep edge is a wall. The bridge is a second layer of nodes on
 * top of the water, joined to the lawn at its two ends, so a duck can walk
 * over it while another swims underneath. A* finds the quickest route
 * (walking round, over the bridge, or swimming — whichever is shorter in
 * time), then the route is string-pulled and gently smoothed.
 */

export const CELL = 0.2;
export const WALK_SPEED = 0.95;
export const SWIM_SPEED = 0.72;
/** Seconds added for getting into or out of the water. */
const TRANSITION_COST = 0.9;

const W = Math.ceil((TILE.halfX * 2) / CELL);
const H = Math.ceil((TILE.halfZ * 2) / CELL);
const N = W * H;

export interface NavPoint {
  x: number;
  z: number;
  /** On the bridge deck (rather than the ground or water beneath it). */
  deck: boolean;
}

const enum Kind { Blocked = 0, Land = 1, Water = 2 }

interface Grid {
  ground: Uint8Array;
  /** 1 where the bridge deck is walkable. */
  deck: Uint8Array;
  /** 1 where the bank is gentle enough to get in and out. */
  gentle: Uint8Array;
}

const cellX = (i: number) => -TILE.halfX + (i + 0.5) * CELL;
const cellZ = (j: number) => -TILE.halfZ + (j + 0.5) * CELL;
const colOf = (x: number) => Math.min(W - 1, Math.max(0, Math.floor((x + TILE.halfX) / CELL)));
const rowOf = (z: number) => Math.min(H - 1, Math.max(0, Math.floor((z + TILE.halfZ) / CELL)));

/** What a point is for a duck on the ground layer. */
export function groundKind(x: number, z: number): Kind {
  if (edgeDistance(x, z) < BOUNDS.edge) return Kind.Blocked;
  const s = pondSDF(x, z);
  const g = gentleness(x, z) > 0.5;
  if (s < 0) {
    // keep off the steep wall; on the gentle side the water runs right up the sand
    return s < (g ? -0.02 : -0.2) ? Kind.Water : Kind.Blocked;
  }
  if (obstacleSDF(x, z) < BOUNDS.obstacle) return Kind.Blocked;
  if (!g && s < 0.24) return Kind.Blocked;
  return Kind.Land;
}

const DECK_OVERLAP = 0.45;

/** Is (x, z) on the walkable part of the deck? */
export function deckWalkable(x: number, z: number): boolean {
  const [u, v] = bridgeLocal(x, z);
  // the deck runs a little way onto the lawn at each end, where the two layers meet
  return Math.abs(u) < BRIDGE.length / 2 + DECK_OVERLAP && Math.abs(v) < BRIDGE.width / 2 - 0.14;
}

let grid: Grid | null = null;

function buildGrid(): Grid {
  const ground = new Uint8Array(N);
  const deck = new Uint8Array(N);
  const gentle = new Uint8Array(N);
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const x = cellX(i), z = cellZ(j), c = i + j * W;
      ground[c] = groundKind(x, z);
      deck[c] = deckWalkable(x, z) ? 1 : 0;
      gentle[c] = gentleness(x, z) > 0.5 ? 1 : 0;
    }
  }
  return { ground, deck, gentle };
}

function getGrid(): Grid {
  grid ??= buildGrid();
  return grid;
}

/** Deck nodes near the bridge's ends meet the lawn. */
function deckEnd(c: number): boolean {
  const [u] = bridgeLocal(cellX(c % W), cellZ(Math.floor(c / W)));
  return Math.abs(u) > BRIDGE.length / 2 - 0.05;
}

// --- A* -----------------------------------------------------------------------------

class Heap {
  private ids: number[] = [];
  private keys: number[] = [];
  get size(): number {
    return this.ids.length;
  }
  push(id: number, key: number): void {
    const a = this.ids, k = this.keys;
    a.push(id);
    k.push(key);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= k[i]) break;
      [a[p], a[i]] = [a[i], a[p]];
      [k[p], k[i]] = [k[i], k[p]];
      i = p;
    }
  }
  pop(): number {
    const a = this.ids, k = this.keys;
    const top = a[0];
    const lastId = a.pop()!;
    const lastKey = k.pop()!;
    if (a.length) {
      a[0] = lastId;
      k[0] = lastKey;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < a.length && k[l] < k[m]) m = l;
        if (r < a.length && k[r] < k[m]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        [k[m], k[i]] = [k[i], k[m]];
        i = m;
      }
    }
    return top;
  }
}

const NEIGHBOURS: [number, number, number][] = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2],
];

/** Passable kind of a node (node = cell + layer · N). */
function nodeKind(g: Grid, node: number): Kind {
  return node >= N ? (g.deck[node - N] ? Kind.Land : Kind.Blocked) : (g.ground[node] as Kind);
}

/** Cost in seconds of stepping from node a to its neighbour b, or Infinity. */
function stepCost(g: Grid, a: number, b: number, dist: number): number {
  const ka = nodeKind(g, a);
  const kb = nodeKind(g, b);
  if (kb === Kind.Blocked) return Infinity;
  const ca = a % N, cb = b % N;
  let t = (dist * CELL) / (kb === Kind.Water || ka === Kind.Water ? SWIM_SPEED : WALK_SPEED);
  if (ka !== kb) {
    if (!(g.gentle[ca] && g.gentle[cb])) return Infinity;
    t += TRANSITION_COST;
  }
  return t;
}

function neighbours(g: Grid, node: number, out: [number, number][]): void {
  out.length = 0;
  const layer = node >= N ? 1 : 0;
  const c = node % N;
  const i = c % W, j = (c - i) / W;
  for (const [di, dj, d] of NEIGHBOURS) {
    const ni = i + di, nj = j + dj;
    if (ni < 0 || nj < 0 || ni >= W || nj >= H) continue;
    // no cutting corners past a blocked cell
    if (di && dj) {
      const n1 = i + di + j * W + layer * N;
      const n2 = i + (j + dj) * W + layer * N;
      if (nodeKind(g, n1) === Kind.Blocked || nodeKind(g, n2) === Kind.Blocked) continue;
    }
    out.push([ni + nj * W + layer * N, d]);
  }
  // between the deck's ends and the lawn
  if (layer === 1 && deckEnd(c) && g.ground[c] === Kind.Land) out.push([c, 0.5]);
  if (layer === 0 && g.deck[c] && deckEnd(c) && g.ground[c] === Kind.Land) out.push([c + N, 0.5]);
}

/** The nearest passable node to a point (searching outward), on the deck if asked and possible. */
export function nearestNode(x: number, z: number, deck = false): number {
  const g = getGrid();
  const c0 = colOf(x) + rowOf(z) * W;
  if (deck && g.deck[c0]) return c0 + N;
  if (g.ground[c0] !== Kind.Blocked) return c0;
  let best = -1;
  let bestD = Infinity;
  const i0 = c0 % W, j0 = Math.floor(c0 / W);
  for (let r = 1; r < 30 && best < 0; r++) {
    for (let dj = -r; dj <= r; dj++) {
      for (let di = -r; di <= r; di++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
        const i = i0 + di, j = j0 + dj;
        if (i < 0 || j < 0 || i >= W || j >= H) continue;
        const c = i + j * W;
        const d = Math.hypot(cellX(i) - x, cellZ(j) - z);
        if (g.ground[c] !== Kind.Blocked && d < bestD) {
          bestD = d;
          best = c;
        }
        if (g.deck[c] && d < bestD) {
          bestD = d;
          best = c + N;
        }
      }
    }
  }
  return best < 0 ? c0 : best;
}

function nodePoint(node: number): NavPoint {
  const c = node % N;
  return { x: cellX(c % W), z: cellZ(Math.floor(c / W)), deck: node >= N };
}

/** Is a point free for a duck (on the given layer)? */
export function passable(x: number, z: number, deck = false): boolean {
  return deck ? deckWalkable(x, z) : groundKind(x, z) !== Kind.Blocked;
}

/** The nearest free point to (x, z): itself if it's free, else the centre of the nearest free cell. */
export function nearestFree(x: number, z: number, deck = false): NavPoint {
  if (passable(x, z, deck)) return { x, z, deck: deck && deckWalkable(x, z) };
  return nodePoint(nearestNode(x, z, deck));
}

function astar(start: number, goal: number): number[] {
  const g = getGrid();
  const cost = new Float32Array(N * 2).fill(Infinity);
  const from = new Int32Array(N * 2).fill(-1);
  const closed = new Uint8Array(N * 2);
  const heap = new Heap();
  const gp = nodePoint(goal);
  const h = (n: number) => {
    const p = nodePoint(n);
    return Math.hypot(p.x - gp.x, p.z - gp.z) / WALK_SPEED;
  };
  cost[start] = 0;
  heap.push(start, h(start));
  let best = start;
  let bestH = h(start);
  const nb: [number, number][] = [];
  while (heap.size) {
    const n = heap.pop();
    if (closed[n]) continue;
    closed[n] = 1;
    if (n === goal) {
      best = n;
      break;
    }
    const hn = h(n);
    if (hn < bestH) {
      bestH = hn;
      best = n;
    }
    neighbours(g, n, nb);
    for (const [m, d] of nb) {
      if (closed[m]) continue;
      const c = cost[n] + stepCost(g, n, m, d);
      if (c < cost[m]) {
        cost[m] = c;
        from[m] = n;
        heap.push(m, c + h(m));
      }
    }
  }
  const out: number[] = [];
  for (let n = best; n >= 0; n = from[n]) out.push(n);
  return out.reverse();
}

// --- smoothing ------------------------------------------------------------------------

/** Ground-layer medium at a point, or blocked. */
function kindAt(p: NavPoint): Kind {
  return p.deck ? (deckWalkable(p.x, p.z) ? Kind.Land : Kind.Blocked) : groundKind(p.x, p.z);
}

/** Can a duck go straight from a to b (same layer; medium changes only at the gentle bank)? */
function clearLine(a: NavPoint, b: NavPoint): boolean {
  if (a.deck !== b.deck) return false;
  const len = Math.hypot(b.x - a.x, b.z - a.z);
  const steps = Math.max(1, Math.ceil(len / 0.08));
  let prev = kindAt(a);
  if (prev === Kind.Blocked) return false;
  for (let s = 1; s <= steps; s++) {
    const t = s / steps;
    const p = { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, deck: a.deck };
    const k = kindAt(p);
    if (k === Kind.Blocked) return false;
    if (k !== prev && gentleness(p.x, p.z) < 0.5) return false;
    prev = k;
  }
  return true;
}

/** Greedy string-pulling: keep only the corners the route needs. */
function stringPull(pts: NavPoint[]): NavPoint[] {
  if (pts.length < 3) return pts;
  const out = [pts[0]];
  let i = 0;
  while (i < pts.length - 1) {
    let j = pts.length - 1;
    while (j > i + 1 && !clearLine(pts[i], pts[j])) j--;
    out.push(pts[j]);
    i = j;
  }
  return out;
}

/** Round the corners (Chaikin), keeping every point somewhere a duck can be. */
function roundCorners(pts: NavPoint[], passes = 3): NavPoint[] {
  let cur = pts;
  for (let k = 0; k < passes; k++) {
    if (cur.length < 3) return cur;
    const next: NavPoint[] = [cur[0]];
    for (let i = 0; i < cur.length - 1; i++) {
      const a = cur[i], b = cur[i + 1];
      if (a.deck !== b.deck) {
        next.push(b);
        continue;
      }
      const q = { x: a.x * 0.75 + b.x * 0.25, z: a.z * 0.75 + b.z * 0.25, deck: a.deck };
      const r = { x: a.x * 0.25 + b.x * 0.75, z: a.z * 0.25 + b.z * 0.75, deck: a.deck };
      if (i > 0) next.push(kindAt(q) !== Kind.Blocked ? q : a);
      if (i < cur.length - 2) next.push(kindAt(r) !== Kind.Blocked ? r : b);
    }
    next.push(cur[cur.length - 1]);
    cur = next;
  }
  return cur;
}

/** Resample a polyline at roughly even spacing. */
function resample(pts: NavPoint[], step = 0.1): NavPoint[] {
  if (pts.length < 2) return pts;
  const out: NavPoint[] = [pts[0]];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const n = Math.max(1, Math.round(len / step));
    for (let s = 1; s <= n; s++) {
      const t = s / n;
      out.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, deck: t < 0.5 ? a.deck : b.deck });
    }
  }
  return out;
}

export interface NavPath {
  points: NavPoint[];
  /** Did it reach the goal (false: it gets as close as it can)? */
  complete: boolean;
}

/** The quickest route from one point to another, smoothed and evenly sampled. */
export function findPath(from: NavPoint, to: NavPoint): NavPath {
  const start = nearestNode(from.x, from.z, from.deck);
  const goalFree = nearestFree(to.x, to.z, to.deck);
  const goal = nearestNode(goalFree.x, goalFree.z, goalFree.deck);
  const nodes = astar(start, goal);
  const complete = nodes[nodes.length - 1] === goal;
  const pts = nodes.map(nodePoint);
  // begin exactly where the duck is, end exactly where it was asked to go (when free)
  pts[0] = { ...from };
  if (complete) pts[pts.length - 1] = goalFree;
  if (pts.length === 1) pts.push({ ...pts[0] });
  return { points: resample(roundCorners(stringPull(pts))), complete };
}

/** For tests and QA. */
export const navInfo = { W, H, CELL, kindAt: (x: number, z: number) => groundKind(x, z) };
