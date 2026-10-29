import { DuckBody, type BodyEvents } from './body';
import { PathFollower } from './follower';
import { findPath, SWIM_SPEED, WALK_SPEED, type NavPoint } from './nav';
import { FIRST_GAP, SPACING, Trail, slotS } from './trail';
import { DUCKLING_SCALE } from './DuckView';

/**
 * A duckling. Most of the time it is *on the line*: it owns an arc length
 * on mum's trail and moves along it, keeping its gap to the duckling in
 * front, so it goes exactly where she went. Off the line it is a little
 * free agent: running to join the end of the line after being drawn or
 * dropped, toddling to a huddle spot when mum rests, being carried, or
 * waddling away when it's removed.
 */

export type DucklingMode = 'forming' | 'join' | 'line' | 'huddle' | 'held' | 'leaving';

export interface LineContext {
  trail: Trail;
  /** Mum's arc length on the trail and her speed. */
  leaderS: number;
  leaderSpeed: number;
  /** Stretch / bunch of the line. */
  scale: number;
  /** Place in line (0 = first). */
  index: number;
  /** Arc length of the duckling in front, if it is on the line. */
  prevS: number | null;
  /** Seconds mum has been standing still. */
  mumStill: number;
  /** Where to huddle (around mum) when she rests. */
  huddleSlot: NavPoint;
  /** Whether this duckling is the one that sits down in a huddle. */
  sitter: boolean;
}

/** How long mum must rest before the line breaks into a huddle. */
export const HUDDLE_DELAY = 1.3;
const RUN = 1.75;
const SWIM_RUN = 1.05;
/** Fastest a duckling moves along the trail when catching up. */
const LINE_MAX = 2.1;
const JOIN_RADIUS = 0.2;

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

export class Duckling {
  readonly body: DuckBody;
  mode: DucklingMode;
  /** Arc length on the trail while on the line. */
  s = 0;
  private vs = 0;
  private readonly route = new PathFollower();
  private replanTimer = 0;
  private routeGoal: NavPoint | null = null;
  /** Offset left over from joining the trail, eased away so nothing pops. */
  private ox = 0;
  private oz = 0;
  private straggle: { t: number; dur: number; lookX: number; lookZ: number; noticed: boolean } | null = null;
  private time = 0;
  private restTimer = 2;
  /** Seconds spent leaving (the view fades over the last stretch). */
  leaveTime = 0;
  private leaveGoal: NavPoint | null = null;
  /** Set when a leaving duckling has gone. */
  gone = false;
  private heldLift = 0;

  constructor(readonly id: string, x: number, z: number, heading: number, deck: boolean, seed: number, readonly size: number, events: BodyEvents = {}, private readonly reducedMotion = false) {
    const k = DUCKLING_SCALE * size;
    this.body = new DuckBody(x, z, heading, deck, seed, WALK_SPEED, 0.11 * k / 0.5, 0.09, events);
    this.mode = 'forming';
  }

  get straggling(): boolean {
    return !!this.straggle;
  }

  get lift(): number {
    return this.heldLift;
  }

  /** Finished being painted in: blink, peep, hurry to the line. */
  formed(): void {
    if (this.mode === 'forming') this.mode = 'join';
  }

  /** Mum set off again after a rest: fall back into line. */
  rejoin(): void {
    if (this.mode === 'huddle') {
      this.mode = 'join';
      this.body.sitting = false;
      this.body.preening = 0;
      this.replanTimer = 0;
    }
  }

  /** Get distracted for a moment by something at (x, z). */
  distract(x: number, z: number, seconds: number): void {
    if (this.mode !== 'line' || this.straggle) return;
    this.straggle = { t: 0, dur: seconds, lookX: x, lookZ: z, noticed: false };
  }

  hold(x: number, z: number, deck: boolean): void {
    this.mode = 'held';
    this.straggle = null;
    this.body.sitting = false;
    this.body.preening = 0;
    this.body.x = x;
    this.body.z = z;
    this.body.deck = deck;
  }

  release(): void {
    if (this.mode === 'held') {
      this.mode = 'join';
      this.replanTimer = 0;
    }
  }

  leave(exit: NavPoint): void {
    this.mode = 'leaving';
    this.straggle = null;
    this.body.sitting = false;
    this.body.preening = 0;
    this.leaveGoal = exit;
    this.route.set(findPath({ x: this.body.x, z: this.body.z, deck: this.body.deck }, exit).points, false);
    this.body.play('wave');
  }

  private here(): NavPoint {
    return { x: this.body.x, z: this.body.z, deck: this.body.deck };
  }

  /** Walk a route to `goal`, re-planning when it moves. Returns the distance left. */
  private seek(goal: NavPoint, dt: number, pace: number, accel: number): number {
    this.replanTimer -= dt;
    const moved = !this.routeGoal || Math.hypot(goal.x - this.routeGoal.x, goal.z - this.routeGoal.z) > 0.3 || goal.deck !== this.routeGoal.deck;
    if (moved || this.replanTimer <= 0) {
      this.routeGoal = goal;
      this.replanTimer = 0.45;
      this.route.set(findPath(this.here(), goal).points);
    }
    const dist = Math.hypot(goal.x - this.body.x, goal.z - this.body.z);
    if (this.route.active) {
      const { p, face } = this.route.step(dt, pace, accel);
      this.body.moveTo(p.x, p.z, p.deck, dt, face, 9);
    } else this.body.moveTo(this.body.x, this.body.z, this.body.deck, dt, null);
    return dist;
  }

  /** Where this duckling belongs on the trail right now. */
  private targetS(ctx: LineContext): number {
    const own = slotS(ctx.trail, ctx.leaderS, ctx.index, ctx.scale);
    const behind = ctx.prevS === null ? own : Math.min(own, ctx.prevS - SPACING * ctx.scale);
    return Math.max(ctx.trail.start, Math.min(behind, ctx.leaderS - FIRST_GAP * ctx.scale * 0.85));
  }

  update(dt: number, ctx: LineContext): void {
    this.time += dt;
    switch (this.mode) {
      case 'forming':
        this.body.moveTo(this.body.x, this.body.z, this.body.deck, dt, null);
        break;
      case 'held':
        this.heldLift = Math.min(1, this.heldLift + dt * 6);
        this.body.moveTo(this.body.x, this.body.z, this.body.deck, dt, null);
        break;
      case 'join':
        this.updateJoin(dt, ctx);
        break;
      case 'line':
        this.updateLine(dt, ctx);
        break;
      case 'huddle':
        this.updateHuddle(dt, ctx);
        break;
      case 'leaving':
        this.updateLeaving(dt);
        break;
    }
    if (this.mode !== 'held') this.heldLift = Math.max(0, this.heldLift - dt * 5);
    this.body.update(dt);
  }

  private updateJoin(dt: number, ctx: LineContext): void {
    if (ctx.mumStill > HUDDLE_DELAY) {
      this.mode = 'huddle';
      this.replanTimer = 0;
      return;
    }
    const target = this.targetS(ctx);
    const goal = ctx.trail.sample(target);
    const far = Math.hypot(goal.x - this.body.x, goal.z - this.body.z);
    const pace = (this.body.swimming ? SWIM_RUN : RUN) * (this.reducedMotion ? 0.75 : 1) * (far < 1 ? 0.75 : 1);
    const dist = this.seek({ x: goal.x, z: goal.z, deck: goal.deck }, dt, pace, 3.2);
    if (dist < JOIN_RADIUS && goal.deck === this.body.deck) {
      this.mode = 'line';
      this.s = target;
      this.vs = this.route.v;
      this.ox = this.body.x - goal.x;
      this.oz = this.body.z - goal.z;
    }
  }

  private updateLine(dt: number, ctx: LineContext): void {
    if (ctx.mumStill > HUDDLE_DELAY) {
      this.mode = 'huddle';
      this.straggle = null;
      this.body.lookW = 0;
      this.body.peck = 0;
      this.replanTimer = 0;
      return;
    }
    let target = this.targetS(ctx);
    let max = LINE_MAX;
    const st = this.straggle;
    if (st) {
      st.t += dt;
      const looking = st.t < st.dur;
      // stand and stare (and peck), then notice the gap and scamper
      if (looking) {
        target = this.s;
        const ang = Math.atan2(-(st.lookZ - this.body.z), st.lookX - this.body.x);
        this.body.look = Math.max(-1.4, Math.min(1.4, wrap(ang - this.body.heading)));
        this.body.lookW = Math.min(1, st.t * 4);
        this.body.peck = Math.max(0, Math.sin(st.t * 1.7)) * 0.7;
      } else {
        if (!st.noticed) {
          st.noticed = true;
          this.body.play('peep');
        }
        this.body.lookW = Math.max(0, this.body.lookW - dt * 5);
        this.body.peck = 0;
        max = LINE_MAX * 1.15;
        if (target - this.s < 0.05) this.straggle = null;
      }
    }
    // feed-forward on mum's speed plus a spring on the gap, with eased acceleration
    const err = target - this.s;
    const want = Math.max(0, Math.min(max, (st && st.t < st.dur ? 0 : ctx.leaderSpeed) + 2.4 * err));
    this.vs += Math.max(-5 * dt, Math.min(5 * dt, want - this.vs));
    if (this.vs < 0) this.vs = 0;
    this.s = Math.min(this.s + this.vs * dt, Math.max(this.s, target + 0.02));
    const p = ctx.trail.sample(this.s);
    const decay = Math.exp(-dt * 5);
    this.ox *= decay;
    this.oz *= decay;
    const moving = this.vs > 0.03;
    this.body.moveTo(p.x + this.ox, p.z + this.oz, p.deck, dt, moving ? p.heading : null, 10);
  }

  private updateHuddle(dt: number, ctx: LineContext): void {
    const slot = ctx.huddleSlot;
    const dist = Math.hypot(slot.x - this.body.x, slot.z - this.body.z);
    if (dist > 0.12) {
      this.seek(slot, dt, (this.body.swimming ? SWIM_SPEED : WALK_SPEED) * 0.65, 1.5);
      this.body.sitting = false;
      this.body.preening = 0;
      return;
    }
    this.body.moveTo(this.body.x, this.body.z, this.body.deck, dt, null);
    if (this.reducedMotion) return;
    // settled: look about, preen now and then; the sitter sits
    this.restTimer -= dt;
    if (ctx.sitter && !this.body.swimming && ctx.mumStill > 4) this.body.sitting = true;
    if (this.restTimer <= 0) {
      const r = (Math.sin(this.time * 12.9898 + this.body.seed) * 43758.5453) % 1;
      const roll = Math.abs(r);
      if (this.body.preening) {
        this.body.preening = 0;
        this.restTimer = 3 + roll * 5;
      } else if (roll < 0.35 && !this.body.sitting) {
        this.body.preening = roll < 0.17 ? 1 : -1;
        this.restTimer = 1.6;
      } else this.restTimer = 2 + roll * 4;
    }
  }

  private updateLeaving(dt: number): void {
    this.leaveTime += dt;
    if (this.leaveTime < 0.9) {
      // the wave first
      this.body.moveTo(this.body.x, this.body.z, this.body.deck, dt, null);
      return;
    }
    if (this.route.active) {
      const { p, face } = this.route.step(dt, this.body.swimming ? SWIM_SPEED : WALK_SPEED * 0.9, 1.6, false);
      this.body.moveTo(p.x, p.z, p.deck, dt, face, 8);
    } else if (this.leaveGoal) {
      // past the last free spot: on off the edge of the tile
      const h = this.body.heading;
      this.body.moveTo(this.body.x + Math.cos(h) * 0.6 * dt, this.body.z - Math.sin(h) * 0.6 * dt, false, dt, null);
    }
    if (this.leaveTime > 7) this.gone = true;
  }
}
