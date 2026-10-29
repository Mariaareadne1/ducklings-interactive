import { DuckBody, type BodyEvents } from './body';
import { PathFollower } from './follower';
import { findPath, nearestFree, SWIM_SPEED, WALK_SPEED, type NavPoint } from './nav';
import { MOTHER_SCALE } from './DuckView';

/**
 * Mother duck: goes where she's led. A click plans the quickest route
 * (walking round, over the bridge or swimming) and she waddles it; a drag
 * keeps re-planning toward the pointer at a waddling pace, so she follows
 * without ever teleporting. Left alone she looks about and preens.
 */

const REPLAN_DISTANCE = 0.25;
const REPLAN_INTERVAL = 0.3;

export class Mother {
  readonly body: DuckBody;
  private readonly route = new PathFollower();
  private dragGoal: NavPoint | null = null;
  private replanTimer = 0;
  /** Seconds since she last moved. */
  stillFor = 0;
  private preenTimer = 6;
  private time = 0;

  constructor(x: number, z: number, heading: number, events: BodyEvents = {}, private readonly reducedMotion = false) {
    this.body = new DuckBody(x, z, heading, false, 3, WALK_SPEED, 0.36 * MOTHER_SCALE, 0.1, events);
  }

  get x(): number {
    return this.body.x;
  }

  get z(): number {
    return this.body.z;
  }

  get heading(): number {
    return this.body.heading;
  }

  get moving(): boolean {
    return this.route.active || this.body.speed > 0.05;
  }

  /** Where she's heading (for tests). */
  get goal(): NavPoint | null {
    return this.route.active ? this.route.goal : null;
  }

  private here(): NavPoint {
    return { x: this.body.x, z: this.body.z, deck: this.body.deck };
  }

  /** Walk (or swim) to a point. Returns false if there is nowhere to go. */
  leadTo(x: number, z: number, deck = false): boolean {
    this.dragGoal = null;
    const path = findPath(this.here(), { x, z, deck });
    if (path.points.length < 2) return false;
    this.route.set(path.points);
    this.stopPreening();
    return true;
  }

  /** Follow the pointer during a drag. */
  follow(x: number, z: number, deck = false): void {
    const goal = nearestFree(x, z, deck);
    const prev = this.dragGoal;
    this.dragGoal = goal;
    if (!prev || Math.hypot(goal.x - prev.x, goal.z - prev.z) > REPLAN_DISTANCE || this.replanTimer <= 0) this.replan();
  }

  endFollow(): void {
    this.dragGoal = null;
  }

  private replan(): void {
    if (!this.dragGoal) return;
    this.replanTimer = REPLAN_INTERVAL;
    if (Math.hypot(this.dragGoal.x - this.body.x, this.dragGoal.z - this.body.z) < 0.08) return;
    const path = findPath(this.here(), this.dragGoal);
    if (path.points.length > 1) this.route.set(path.points);
    this.stopPreening();
  }

  /** Stop where she is (a reset, or a scene load). */
  place(x: number, z: number, heading: number): void {
    this.route.clear();
    this.route.v = 0;
    this.dragGoal = null;
    this.body.x = x;
    this.body.z = z;
    this.body.deck = false;
    this.body.heading = heading;
    this.body.speed = 0;
  }

  private stopPreening(): void {
    this.body.preening = 0;
    this.preenTimer = 8;
  }

  update(dt: number): void {
    this.time += dt;
    if (this.dragGoal) {
      this.replanTimer -= dt;
      if (this.replanTimer <= 0) this.replan();
    }
    if (this.route.active) {
      const pace = this.body.swimming ? SWIM_SPEED : WALK_SPEED;
      const { p, face } = this.route.step(dt, this.body.busy ? pace * 0.7 : pace, 1.8, !this.dragGoal || this.route.remaining < 0.6);
      this.body.moveTo(p.x, p.z, p.deck, dt, face, 6);
      if (!this.route.active) this.route.v = 0;
    } else this.body.moveTo(this.body.x, this.body.z, this.body.deck, dt, null);
    this.stillFor = this.moving ? 0 : this.stillFor + dt;

    // left alone, she preens now and then
    if (!this.reducedMotion && this.stillFor > 3) {
      this.preenTimer -= dt;
      if (this.preenTimer <= 0) {
        if (this.body.preening) {
          this.body.preening = 0;
          this.preenTimer = 9 + (Math.sin(this.time * 7.1) * 0.5 + 0.5) * 8;
        } else {
          this.body.preening = Math.sin(this.time * 3.7) > 0 ? 1 : -1;
          this.preenTimer = 2.2;
        }
      }
    }
    this.body.update(dt);
  }
}
