import { noise2 } from '../scene/noise';

/**
 * The ducks' body language as pure functions of time: (time, stride phase,
 * speed, seed) -> a flat pose. Nothing here holds state, so every pose is
 * reproducible and testable, and an interrupted motion can never strand a
 * joint (MEADOW's rule). Controllers integrate the stride phase (never
 * time × speed, POND's lesson) and layer short moves — a plop, a shake, a
 * peep — over the gait.
 */

export interface Pose {
  /** Vertical offsets of the root: a gentle bob, and the arc of a hop. */
  bob: number;
  lift: number;
  /** Body rock side to side, nose up/down, squash (+) / stretch (−). */
  roll: number;
  pitch: number;
  squash: number;
  headYaw: number;
  headPitch: number;
  headRoll: number;
  /** Mother's neck bend (forward/back). */
  neck: number;
  tail: number;
  /** Wings: spread 0..1 and a beat for each side. */
  spread: number;
  wingL: number;
  wingR: number;
  blink: number;
  /** Feet: swing (−1 back .. 1 forward) and how high each is lifted (0..1). */
  footL: number;
  footR: number;
  stepL: number;
  stepR: number;
  /** 0..1 fluffed out (a shake), 0..1 sitting down, 0..1 swimming (legs folded, body at the waterline). */
  fluff: number;
  sit: number;
  swim: number;
  /** Bill open, 0..1 (a peep). */
  bill: number;
}

export const emptyPose = (): Pose => ({
  bob: 0, lift: 0, roll: 0, pitch: 0, squash: 0, headYaw: 0, headPitch: 0, headRoll: 0, neck: 0, tail: 0,
  spread: 0, wingL: 0, wingR: 0, blink: 0, footL: 0, footR: 0, stepL: 0, stepR: 0, fluff: 0, sit: 0, swim: 0, bill: 0,
});

export const POSE_KEYS = Object.keys(emptyPose()) as (keyof Pose)[];

const TAU = Math.PI * 2;
const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
const smooth = (t: number) => t * t * (3 - 2 * t);
const wobble = (t: number, seed: number, lane: number) => noise2(t, seed * 13.7 + lane * 31.1);
const hashf = (n: number) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

/** Short events (blinks, tail flicks) at irregular but deterministic times. */
export function pulse(t: number, seed: number, period: number, width: number, lane: number): number {
  const i = Math.floor(t / period);
  let v = 0;
  for (const k of [i - 1, i, i + 1]) {
    const at = (k + 0.15 + hashf(k + seed * 7.1 + lane) * 0.7) * period;
    if (hashf(k * 3.3 + seed + lane * 9.9) < 0.75) v = Math.max(v, Math.exp(-(((t - at) / width) ** 2)));
  }
  return v;
}

export interface GaitContext {
  /** Seconds (any running clock). */
  t: number;
  /** Integrated stride cycles (two steps per cycle). */
  phase: number;
  /** Ground or water speed, m/s. */
  speed: number;
  seed: number;
  /** Walking pace at which the waddle is fully developed (m/s). */
  pace: number;
}

/** Breathing, blinking and the odd tail flick: shared by everything. */
function life(p: Pose, t: number, seed: number): void {
  p.blink = pulse(t, seed, 3.4, 0.06, 1);
  p.tail += 0.35 * pulse(t, seed, 5.1, 0.16, 7) * Math.sin(t * 26);
  p.squash += 0.012 * Math.sin((t * TAU) / 2.6 + seed);
}

/** Standing about: looking around, the occasional tilt of the head. */
export function idle(ctx: GaitContext): Pose {
  const { t, seed } = ctx;
  const p = emptyPose();
  life(p, t, seed);
  p.headYaw = 0.55 * wobble(t * 0.22, seed, 10) + 0.5 * (pulse(t, seed, 6.3, 0.7, 11) - pulse(t, seed, 7.7, 0.7, 12));
  p.headPitch = 0.1 * wobble(t * 0.3, seed, 13);
  p.headRoll = 0.25 * pulse(t, seed, 4.9, 0.5, 14) * Math.sign(Math.sin(seed * 9.1 + Math.floor(t / 4.9)));
  return p;
}

/**
 * The waddle: the body rocks over the planted foot, the feet paddle in turn
 * and lift as they swing, a squash on each footfall and a stretch as it
 * pushes off; the head stays steadier than the body.
 */
export function waddle(ctx: GaitContext): Pose {
  const { t, phase, speed, seed, pace } = ctx;
  const p = emptyPose();
  life(p, t, seed);
  const k = smooth(clamp01(speed / pace));
  const run = clamp01(speed / pace - 1);
  const a = phase * TAU;
  p.roll = (0.16 - 0.05 * run) * Math.sin(a) * k;
  p.bob = 0.014 * (0.5 - 0.5 * Math.cos(2 * a)) * k * (1 + run);
  p.squash = 0.06 * Math.cos(2 * a) * k;
  p.footL = Math.sin(a) * k;
  p.footR = -Math.sin(a) * k;
  p.stepL = Math.max(0, Math.cos(a)) * k * (0.8 + 0.4 * run);
  p.stepR = Math.max(0, -Math.cos(a)) * k * (0.8 + 0.4 * run);
  p.pitch = -(0.04 + 0.12 * run) * k;
  p.headRoll = -p.roll * 0.6;
  p.headPitch = -0.03 * Math.cos(2 * a) * k + 0.05 * run;
  p.headYaw = 0.12 * wobble(t * 0.3, seed, 15) * (1 - k);
  p.tail += 0.28 * Math.sin(a + 0.7) * k;
  // little wings held out a touch for balance when running
  p.spread = 0.12 * run;
  return p;
}

/** Paddling on the water: a gentle bob and rock, feet working in turn below. */
export function swim(ctx: GaitContext): Pose {
  const { t, phase, speed, seed, pace } = ctx;
  const p = emptyPose();
  life(p, t, seed);
  const k = smooth(clamp01(speed / pace));
  const a = phase * TAU;
  p.swim = 1;
  p.bob = 0.008 * Math.sin(t * 2.3 + seed) + 0.004 * Math.sin(a * 2) * k;
  p.roll = 0.03 * Math.sin(t * 1.7 + seed) + 0.04 * Math.sin(a) * k;
  p.pitch = 0.02 * Math.sin(t * 1.3 + seed * 2) - 0.03 * k;
  p.footL = Math.sin(a) * (0.3 + 0.7 * k);
  p.footR = -Math.sin(a) * (0.3 + 0.7 * k);
  p.headYaw = 0.35 * wobble(t * 0.25, seed, 16) * (1 - 0.7 * k);
  p.headPitch = 0.05 * wobble(t * 0.4, seed, 17);
  return p;
}

/** Sitting down in the grass: body lowered onto folded legs, eyes heavy. */
export function sit(ctx: GaitContext): Pose {
  const p = idle(ctx);
  p.sit = 1;
  p.squash += 0.08;
  p.headPitch -= 0.12;
  p.headYaw *= 0.5;
  p.blink = Math.max(p.blink, 0.35 + 0.3 * wobble(ctx.t * 0.2, ctx.seed, 18));
  return p;
}

/** Preening: the head turns right round into the back fluff and nibbles. */
export function preen(ctx: GaitContext, side: number): Pose {
  const p = idle(ctx);
  p.headYaw = side * 2.3;
  p.headPitch = -0.5 + 0.08 * Math.sin(ctx.t * 13);
  p.headRoll = side * 0.4;
  p.neck = -0.3;
  p.roll = side * 0.06;
  p.blink = 0.6;
  return p;
}

// --- short moves layered over the gait (u = 0..1 through the move) -----------------------

/** Plop: a crouch, a little hop off the edge, a splash-down squash and a bob. Height in local units. */
export function plopLayer(u: number, height: number): Partial<Pose> {
  const crouch = smooth(clamp01(u / 0.18)) * (1 - smooth(clamp01((u - 0.18) / 0.1)));
  const air = clamp01((u - 0.2) / 0.5);
  const lift = air > 0 && air < 1 ? 4 * height * air * (1 - air) : 0;
  const land = clamp01((u - 0.7) / 0.3);
  const splat = land > 0 ? Math.exp(-land * 4) * Math.cos(land * 9) : 0;
  return {
    lift,
    squash: 0.18 * crouch - 0.12 * (air > 0 && air < 1 ? Math.sin(air * Math.PI) : 0) + 0.22 * splat,
    pitch: -0.25 * (air > 0 && air < 1 ? Math.sin(air * Math.PI) : 0) - 0.1 * crouch,
    spread: 0.5 * (air > 0 && air < 1 ? Math.sin(air * Math.PI) : 0),
  };
}

/** Climb out: a scrambling hop up the bank. */
export function hopLayer(u: number, height: number): Partial<Pose> {
  const air = clamp01(u);
  return {
    lift: 4 * height * air * (1 - air),
    squash: -0.1 * Math.sin(air * Math.PI) + 0.12 * Math.exp(-((air - 1) ** 2) * 60),
    pitch: 0.2 * Math.sin(air * Math.PI),
    spread: 0.4 * Math.sin(air * Math.PI),
  };
}

/** Shake: a quick shiver from tail to head, fluff puffed out, wings fluttered. */
export function shakeLayer(u: number): Partial<Pose> {
  const env = Math.sin(clamp01(u) * Math.PI);
  return {
    fluff: env,
    roll: 0.22 * env * Math.sin(u * 46),
    headRoll: 0.4 * env * Math.sin(u * 46 + 1.2),
    tail: 0.6 * env * Math.sin(u * 60),
    spread: 0.35 * env,
    wingL: 0.2 * env * Math.sin(u * 50),
    wingR: 0.2 * env * Math.sin(u * 50 + 0.5),
    blink: env,
  };
}

/** Peep: the head tips up, the bill opens, a tiny hop. */
export function peepLayer(u: number): Partial<Pose> {
  const e = Math.sin(clamp01(u) * Math.PI);
  return { headPitch: 0.45 * e, bill: e, lift: 0.025 * Math.sin(clamp01(u * 1.6) * Math.PI), squash: -0.05 * e };
}

/** Wave goodbye: one wing lifted and waggled. */
export function waveLayer(u: number): Partial<Pose> {
  const e = Math.sin(clamp01(u) * Math.PI);
  return { wingR: e * (0.9 + 0.35 * Math.sin(u * 30)), headYaw: -0.5 * e, headPitch: 0.15 * e };
}

/** Add a partial pose onto a pose, scaled by w (blink and fluff take the max). */
export function layer(p: Pose, add: Partial<Pose>, w = 1): Pose {
  for (const key of Object.keys(add) as (keyof Pose)[]) {
    const v = (add[key] ?? 0) * w;
    if (key === 'blink' || key === 'fluff' || key === 'bill') p[key] = Math.max(p[key], v);
    else p[key] += v;
  }
  return p;
}

/** Blend two poses: a + (b − a)·w. */
export function mixPose(a: Pose, b: Pose, w: number): Pose {
  const out = emptyPose();
  for (const k of POSE_KEYS) out[k] = a[k] + (b[k] - a[k]) * w;
  return out;
}
