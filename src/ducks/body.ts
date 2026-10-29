import { bridgeLocal, deckHeight, groundHeight, pondSDF, WATER_Y } from '../scene/park';
import { hopLayer, idle, layer, mixPose, peepLayer, plopLayer, preen, shakeLayer, sit, swim, waddle, waveLayer, type Pose } from './gait';

/**
 * A duck's body in the world, shared by mum and the ducklings: where it is,
 * which way it faces, what it stands on, its integrated stride, and the
 * short moves layered on its gait. Controllers decide where it goes; the
 * body turns movement into a waddle or a paddle, notices when it crosses
 * into or out of the water (a plop, or a hop and a shake), and reports
 * those moments so the scene can splash and ripple.
 */

export type Move = 'plop' | 'hop' | 'shake' | 'peep' | 'wave';

const MOVE_LENGTH: Record<Move, number> = { plop: 0.55, hop: 0.38, shake: 0.85, peep: 0.6, wave: 1.1 };

export interface BodyEvents {
  /** The body just entered (true) or left (false) the water at (x, z). */
  onWater?: (x: number, z: number, entering: boolean) => void;
  /** A paddle stroke while swimming (for wake rings), alternate sides. */
  onPaddle?: (x: number, z: number, side: number) => void;
  /** A move started. */
  onMove?: (move: Move) => void;
}

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** The height a duck's feet (or waterline) sit at, on the deck or the ground layer. */
export function surfaceAt(x: number, z: number, deck: boolean): number {
  if (deck) return Math.max(deckHeight(bridgeLocal(x, z)[0]), groundHeight(x, z));
  return pondSDF(x, z) < 0 ? WATER_Y : Math.max(WATER_Y, groundHeight(x, z));
}

export function inWater(x: number, z: number, deck: boolean): boolean {
  return !deck && pondSDF(x, z) < 0;
}

export class DuckBody {
  x: number;
  z: number;
  deck: boolean;
  heading: number;
  /** Smoothed ground speed (m/s). */
  speed = 0;
  /** Integrated stride cycles. */
  phase = 0;
  /** 0..1 how much the swimming gait shows (eases across the shoreline). */
  swimW: number;
  /** 0..1 how wet the fluff is; dries over time. */
  wet = 0;
  /** 0..1 sitting (ducklings at rest). */
  sitW = 0;
  sitting = false;
  /** Preening side (−1 / 1) or 0. */
  preening = 0;
  private preenW = 0;
  /** Extra head turn toward something interesting (radians, relative), and how strongly. */
  look = 0;
  lookW = 0;
  /** Head down, pecking at the grass (0..1). */
  peck = 0;
  private moves: { move: Move; t: number }[] = [];
  private paddleAcc = 0;
  private paddleSide = 1;
  private water: boolean;

  constructor(x: number, z: number, heading: number, deck: boolean, readonly seed: number, readonly pace: number, readonly strideLength: number, readonly hopHeight: number, private readonly events: BodyEvents = {}) {
    this.x = x;
    this.z = z;
    this.heading = heading;
    this.deck = deck;
    this.water = inWater(x, z, deck);
    this.swimW = this.water ? 1 : 0;
  }

  get swimming(): boolean {
    return this.water;
  }

  get y(): number {
    return surfaceAt(this.x, this.z, this.deck);
  }

  /** Begin a short move (a plop, a peep...). A move already running restarts. */
  play(move: Move): void {
    this.moves = this.moves.filter((m) => m.move !== move);
    this.moves.push({ move, t: 0 });
    this.events.onMove?.(move);
  }

  playing(move: Move): boolean {
    return this.moves.some((m) => m.move === move);
  }

  /** Is anything in the middle of carrying the body (a plop's leap, a climb-out hop)? */
  get busy(): boolean {
    return this.moves.some((m) => m.move === 'plop' || m.move === 'hop');
  }

  /**
   * Move to a new spot this frame. The controller has already decided
   * where; this measures speed, advances the stride, turns toward `face`
   * (a heading, or null to face the direction of travel) and notices the
   * shoreline.
   */
  moveTo(x: number, z: number, deck: boolean, dt: number, face: number | null = null, turnRate = 7): void {
    const dx = x - this.x;
    const dz = z - this.z;
    const d = Math.hypot(dx, dz);
    const v = dt > 0 ? d / dt : 0;
    this.speed += (v - this.speed) * Math.min(1, dt * 10);
    this.x = x;
    this.z = z;
    this.deck = deck;
    const want = face ?? (d > 1e-4 ? Math.atan2(-dz, dx) : this.heading);
    const diff = wrap(want - this.heading);
    const maxTurn = turnRate * dt;
    this.heading = wrap(this.heading + Math.max(-maxTurn, Math.min(maxTurn, diff)));
    this.phase += (d / this.strideLength) * (this.water ? 0.8 : 1);
    // standing still, the feet settle back to a neutral stride
    if (this.speed < 0.03) {
      const frac = this.phase - Math.floor(this.phase);
      const target = frac < 0.25 ? 0 : frac < 0.75 ? 0.5 : 1;
      this.phase += (target - frac) * Math.min(1, dt * 6);
    }

    const water = inWater(x, z, deck);
    if (water !== this.water) {
      this.water = water;
      if (water) this.play('plop');
      else {
        this.play('hop');
        this.wet = 1;
      }
      this.events.onWater?.(x, z, water);
    }
    if (water && this.speed > 0.05) {
      this.paddleAcc += d;
      if (this.paddleAcc > this.strideLength * 0.9) {
        this.paddleAcc = 0;
        this.paddleSide = -this.paddleSide;
        this.events.onPaddle?.(x, z, this.paddleSide);
      }
    }
  }

  update(dt: number): void {
    for (const m of this.moves) m.t += dt;
    const hop = this.moves.find((m) => m.move === 'hop');
    // a shake follows climbing out, once the feet are down
    if (hop && hop.t >= MOVE_LENGTH.hop && !this.playing('shake')) this.play('shake');
    this.moves = this.moves.filter((m) => m.t < MOVE_LENGTH[m.move]);
    const target = this.water ? 1 : 0;
    this.swimW += (target - this.swimW) * Math.min(1, dt * (this.water ? 7 : 9));
    this.wet = Math.max(0, this.wet - dt / 25);
    this.sitW += ((this.sitting ? 1 : 0) - this.sitW) * Math.min(1, dt * 3);
    this.preenW += ((this.preening ? 1 : 0) - this.preenW) * Math.min(1, dt * 4);
  }

  /** The pose this frame. */
  pose(t: number): Pose {
    const ctx = { t, phase: this.phase, speed: this.speed, seed: this.seed, pace: this.pace };
    const walk = this.speed > 0.04 ? waddle(ctx) : idle(ctx);
    let p = this.swimW > 0.001 ? mixPose(walk, swim(ctx), this.swimW) : walk;
    if (this.sitW > 0.01 && !this.water) p = mixPose(p, sit(ctx), this.sitW);
    if (this.preenW > 0.01) p = mixPose(p, preen(ctx, this.preening || 1), this.preenW);
    if (this.lookW > 0.001) p.headYaw += (this.look - p.headYaw) * this.lookW;
    if (this.peck > 0.001) p.headPitch -= 0.55 * this.peck * (0.7 + 0.3 * Math.sin(t * 14));
    for (const m of this.moves) {
      const u = m.t / MOVE_LENGTH[m.move];
      if (m.move === 'plop') layer(p, plopLayer(u, this.hopHeight));
      else if (m.move === 'hop') layer(p, hopLayer(u, this.hopHeight * 0.8));
      else if (m.move === 'shake') layer(p, shakeLayer(u));
      else if (m.move === 'peep') layer(p, peepLayer(u));
      else layer(p, waveLayer(u));
    }
    return p;
  }
}
