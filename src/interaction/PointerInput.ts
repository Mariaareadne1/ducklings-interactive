import type { PondApp } from '../app/PondApp';
import { DrawingOverlay } from './DrawingOverlay';
import { analyzeStroke, smooth, type Pt } from './stroke';

/**
 * One pointer state machine for mouse, pen and touch:
 *   "come here" armed -> the tap sets where the fish comes
 *   feed tool         -> a tap on the water sprinkles crumbs
 *   press a creature  -> select; move past a few pixels -> drag it
 *   press the tile    -> draw (draw tool) or deselect (move tool)
 * A second finger, pointercancel or Escape abandons a stroke cleanly.
 */

type Gesture =
  | { kind: 'none' }
  | { kind: 'press-creature'; id: string; x: number; y: number; pointerId: number }
  | { kind: 'press-pad'; id: string; points: Pt[]; pointerId: number }
  | { kind: 'drag'; id: string; pointerId: number }
  | { kind: 'stroke'; points: Pt[]; pointerId: number }
  | { kind: 'press-empty'; pointerId: number };

const DRAG_THRESHOLD = 4;

export class PointerInput {
  private gesture: Gesture = { kind: 'none' };
  private readonly overlay: DrawingOverlay;
  private readonly activePointers = new Set<number>();
  private hoverRaf = 0;
  lastHover: { x: number; y: number } | null = null;
  /** Feedback hook (toasts) for rejected strokes. */
  onMessage: ((text: string) => void) | null = null;

  constructor(private readonly el: HTMLElement, private readonly app: PondApp) {
    this.overlay = new DrawingOverlay(el);
    el.addEventListener('pointerdown', this.down);
    el.addEventListener('pointermove', this.move);
    el.addEventListener('pointerup', this.up);
    el.addEventListener('pointercancel', this.cancel);
    el.addEventListener('lostpointercapture', this.lost);
    el.addEventListener('wheel', this.wheel, { passive: false });
    el.addEventListener('contextmenu', this.noMenu);
  }

  get isDrawing(): boolean {
    return this.gesture.kind === 'stroke';
  }

  private local(e: PointerEvent): Pt {
    return { x: e.clientX, y: e.clientY };
  }

  /** Only the canvas itself is drawable; the interface floats above it. */
  private onCanvas(e: Event): boolean {
    return (e.target as Element | null)?.tagName === 'CANVAS';
  }

  private down = (e: PointerEvent) => {
    if (!this.onCanvas(e)) return;
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    this.activePointers.add(e.pointerId);
    if (this.activePointers.size > 1) {
      this.abort(); // pinch / two-finger: not ours
      return;
    }
    e.preventDefault();
    try {
      this.el.setPointerCapture(e.pointerId);
    } catch {
      // the pointer is already gone (or synthetic); events still arrive on the element
    }
    const state = this.app.store.get();
    if (state.comeFor) {
      if (!this.app.comeTo(e.clientX, e.clientY)) this.onMessage?.('That fish can only come to the water.');
      return;
    }
    if (state.tool === 'feed') {
      if (!this.app.feedAt(e.clientX, e.clientY)) this.onMessage?.('Sprinkle crumbs on the water.');
      return;
    }
    const id = this.app.pickAt(e.clientX, e.clientY);
    // with the pen, a stroke that starts on an unselected lily pad draws (a frog on the pad);
    // a tap selects it, and a selected pad drags as usual
    if (id && state.tool === 'draw' && this.app.store.doc.creatures.find((c) => c.id === id)?.kind === 'lily' && state.selectedId !== id) {
      this.gesture = { kind: 'press-pad', id, points: [this.local(e)], pointerId: e.pointerId };
      return;
    }
    if (id) {
      this.app.select(id);
      this.gesture = { kind: 'press-creature', id, x: e.clientX, y: e.clientY, pointerId: e.pointerId };
      this.setCursor('grabbing');
      return;
    }
    if (state.tool === 'draw') {
      this.gesture = { kind: 'stroke', points: [this.local(e)], pointerId: e.pointerId };
      this.overlay.begin();
      this.app.store.set({ selectedId: null });
    } else {
      this.gesture = { kind: 'press-empty', pointerId: e.pointerId };
    }
  };

  private move = (e: PointerEvent) => {
    const g = this.gesture;
    if (g.kind === 'none') {
      if (!this.onCanvas(e)) return;
      this.lastHover = { x: e.clientX, y: e.clientY };
      if (!this.hoverRaf) this.hoverRaf = requestAnimationFrame(this.hover);
      return;
    }
    if ('pointerId' in g && g.pointerId !== e.pointerId) return;
    if (g.kind === 'press-pad') {
      g.points.push(this.local(e));
      const p0 = g.points[0];
      if (Math.hypot(e.clientX - p0.x, e.clientY - p0.y) > DRAG_THRESHOLD) {
        this.gesture = { kind: 'stroke', points: g.points, pointerId: g.pointerId };
        this.overlay.begin();
        this.overlay.update(g.points, false);
        this.app.store.set({ selectedId: null });
      }
      return;
    }
    if (g.kind === 'press-creature') {
      if (Math.hypot(e.clientX - g.x, e.clientY - g.y) > DRAG_THRESHOLD) {
        this.app.beginDrag(g.id, g.x, g.y);
        this.gesture = { kind: 'drag', id: g.id, pointerId: g.pointerId };
        this.app.dragTo(e.clientX, e.clientY);
      }
      return;
    }
    if (g.kind === 'drag') {
      const ok = this.app.dragTo(e.clientX, e.clientY);
      this.setCursor(ok ? 'grabbing' : 'not-allowed');
      return;
    }
    if (g.kind === 'stroke') {
      const events = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
      for (const c of events.length ? events : [e]) g.points.push(this.local(c));
      const a = analyzeStroke(g.points);
      this.overlay.update(smooth(g.points, 1), a.closed && a.length > 120);
    }
  };

  private up = (e: PointerEvent) => {
    this.activePointers.delete(e.pointerId);
    const g = this.gesture;
    if (g.kind === 'none' || ('pointerId' in g && g.pointerId !== e.pointerId)) return;
    this.gesture = { kind: 'none' };
    if (g.kind === 'drag') this.app.endDrag();
    else if (g.kind === 'press-empty') this.app.select(null);
    else if (g.kind === 'press-pad') this.app.select(g.id);
    else if (g.kind === 'stroke') this.finishStroke(g.points);
    this.updateHover(e.clientX, e.clientY);
  };

  private finishStroke(points: Pt[]): void {
    const a = analyzeStroke(points);
    if (a.length < 6) {
      // a tap on the tile: just clears the selection
      this.overlay.settle(false);
      return;
    }
    const result = this.app.createFromStroke(smooth(points, 2));
    this.overlay.settle(result.ok);
    if (!result.ok) this.onMessage?.(result.message);
  }

  private cancel = (e: PointerEvent) => {
    this.activePointers.delete(e.pointerId);
    this.abort();
  };

  private lost = (e: PointerEvent) => {
    // capture lost without pointerup (e.g. window blur): treat as cancel
    if ('pointerId' in this.gesture && this.gesture.pointerId === e.pointerId && !this.activePointers.has(e.pointerId)) this.abort();
  };

  /** Abandon whatever is in progress without creating or committing anything. */
  abort(): void {
    const g = this.gesture;
    this.gesture = { kind: 'none' };
    if (g.kind === 'stroke') this.overlay.cancelLive();
    if (g.kind === 'drag') this.app.endDrag(true);
  }

  private wheel = (e: WheelEvent) => {
    const id = this.app.store.get().selectedId;
    if (!id || !this.onCanvas(e)) return;
    e.preventDefault();
    this.app.rotate(Math.sign(e.deltaY || e.deltaX) * 0.12);
  };

  private noMenu = (e: Event) => e.preventDefault();

  private hover = () => {
    this.hoverRaf = 0;
    if (this.lastHover) this.updateHover(this.lastHover.x, this.lastHover.y);
  };

  private updateHover(x: number, y: number): void {
    const id = this.app.pickAt(x, y);
    this.app.hoverId = id;
    const s = this.app.store.get();
    if (s.comeFor || s.tool === 'feed') this.setCursor(this.app.surfaceAt(x, y).surface === 'water' ? 'draw' : 'default');
    else if (id) this.setCursor('grab');
    else if (s.tool === 'draw' && this.app.isOnTile(x, y)) this.setCursor('draw');
    else this.setCursor('default');
  }

  private setCursor(c: 'grab' | 'grabbing' | 'draw' | 'default' | 'not-allowed'): void {
    this.el.dataset.cursor = c;
  }

  dispose(): void {
    cancelAnimationFrame(this.hoverRaf);
    this.el.removeEventListener('pointerdown', this.down);
    this.el.removeEventListener('pointermove', this.move);
    this.el.removeEventListener('pointerup', this.up);
    this.el.removeEventListener('pointercancel', this.cancel);
    this.el.removeEventListener('lostpointercapture', this.lost);
    this.el.removeEventListener('wheel', this.wheel);
    this.el.removeEventListener('contextmenu', this.noMenu);
    this.overlay.dispose();
  }
}
