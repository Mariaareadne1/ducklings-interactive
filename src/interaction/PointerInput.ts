import type { DucksApp } from '../app/DucksApp';
import { MESSAGES } from '../app/DucksApp';
import { DrawingOverlay } from './DrawingOverlay';
import { analyzeStroke, smooth, type Pt } from './stroke';

/**
 * One pointer state machine for mouse, pen and touch:
 *   press a duck   -> select; move past a few pixels -> carry a duckling (or lead mum)
 *   press the tile -> draw (Draw tool), or lead mum there (Lead tool; keep
 *                     holding and moving and she follows the pointer)
 * A second finger, pointercancel or Escape abandons a gesture cleanly.
 */

type Gesture =
  | { kind: 'none' }
  | { kind: 'press-duck'; id: string; x: number; y: number; pointerId: number }
  | { kind: 'drag'; id: string; pointerId: number }
  | { kind: 'stroke'; points: Pt[]; pointerId: number }
  | { kind: 'lead'; x: number; y: number; following: boolean; pointerId: number };

const DRAG_THRESHOLD = 5;

export class PointerInput {
  private gesture: Gesture = { kind: 'none' };
  readonly overlay: DrawingOverlay;
  private readonly activePointers = new Set<number>();
  private hoverRaf = 0;
  lastHover: { x: number; y: number } | null = null;
  /** Feedback hook (toasts) for rejected strokes. */
  onMessage: ((text: string) => void) | null = null;

  constructor(private readonly el: HTMLElement, private readonly app: DucksApp) {
    this.overlay = new DrawingOverlay(el);
    el.addEventListener('pointerdown', this.down);
    el.addEventListener('pointermove', this.move);
    el.addEventListener('pointerup', this.up);
    el.addEventListener('pointercancel', this.cancel);
    el.addEventListener('lostpointercapture', this.lost);
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
    const id = this.app.pickAt(e.clientX, e.clientY);
    if (id) {
      this.app.select(id);
      this.gesture = { kind: 'press-duck', id, x: e.clientX, y: e.clientY, pointerId: e.pointerId };
      this.setCursor('grabbing');
      return;
    }
    if (this.app.store.get().tool === 'draw') {
      this.gesture = { kind: 'stroke', points: [this.local(e)], pointerId: e.pointerId };
      this.overlay.begin();
      this.app.select(null);
      return;
    }
    // lead: a tap sends her there; holding and moving, she follows
    this.app.select(null);
    if (!this.app.isOnTile(e.clientX, e.clientY)) {
      this.onMessage?.(MESSAGES.leadPaper);
      return;
    }
    this.gesture = { kind: 'lead', x: e.clientX, y: e.clientY, following: false, pointerId: e.pointerId };
    this.app.leadAt(e.clientX, e.clientY);
    this.overlay.mark(e.clientX, e.clientY);
  };

  private move = (e: PointerEvent) => {
    const g = this.gesture;
    if (g.kind === 'none') {
      if (!this.onCanvas(e)) return;
      this.lastHover = { x: e.clientX, y: e.clientY };
      if (!this.hoverRaf) this.hoverRaf = requestAnimationFrame(this.hover);
      return;
    }
    if (g.pointerId !== e.pointerId) return;
    if (g.kind === 'press-duck') {
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
    if (g.kind === 'lead') {
      if (!g.following && Math.hypot(e.clientX - g.x, e.clientY - g.y) > DRAG_THRESHOLD * 2) g.following = true;
      if (g.following) this.app.leadFollow(e.clientX, e.clientY);
      return;
    }
    const events = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
    for (const c of events.length ? events : [e]) g.points.push(this.local(c));
    const a = analyzeStroke(g.points);
    this.overlay.update(smooth(g.points, 1), a.closed && a.length > 60);
  };

  private up = (e: PointerEvent) => {
    this.activePointers.delete(e.pointerId);
    const g = this.gesture;
    if (g.kind === 'none' || g.pointerId !== e.pointerId) return;
    this.gesture = { kind: 'none' };
    if (g.kind === 'drag') this.app.endDrag();
    else if (g.kind === 'lead') {
      // a drag ends where the pointer let go; she finishes walking there
      if (g.following) {
        this.app.endLead();
        this.app.leadAt(e.clientX, e.clientY);
      }
    } else if (g.kind === 'stroke') this.finishStroke(g.points);
    this.updateHover(e.clientX, e.clientY);
  };

  private finishStroke(points: Pt[]): void {
    const a = analyzeStroke(points);
    if (a.length < 6) {
      // a tap on the tile: just clears the selection
      this.overlay.settle(false);
      return;
    }
    // classify the raw line (smoothing pulls a nearly-closed loop's ends apart); place with the smoothed one
    const result = this.app.createFromStroke(points);
    this.overlay.settle(result.ok);
    if (!result.ok) this.onMessage?.(result.message);
  }

  private cancel = (e: PointerEvent) => {
    this.activePointers.delete(e.pointerId);
    this.abort();
  };

  private lost = (e: PointerEvent) => {
    const g = this.gesture;
    if (g.kind !== 'none' && g.pointerId === e.pointerId && !this.activePointers.has(e.pointerId)) this.abort();
  };

  /** Abandon whatever is in progress without creating anything. */
  abort(): void {
    const g = this.gesture;
    this.gesture = { kind: 'none' };
    if (g.kind === 'stroke') this.overlay.cancelLive();
    if (g.kind === 'drag') this.app.endDrag();
    if (g.kind === 'lead') this.app.endLead();
  }

  private noMenu = (e: Event) => e.preventDefault();

  private hover = () => {
    this.hoverRaf = 0;
    if (this.lastHover) this.updateHover(this.lastHover.x, this.lastHover.y);
  };

  private updateHover(x: number, y: number): void {
    const id = this.app.pickAt(x, y);
    this.app.hoverId = id;
    const tool = this.app.store.get().tool;
    if (id) this.setCursor('grab');
    else if (this.app.isOnTile(x, y)) this.setCursor(tool === 'draw' ? 'draw' : 'lead');
    else this.setCursor('default');
  }

  private setCursor(c: 'grab' | 'grabbing' | 'draw' | 'lead' | 'default' | 'not-allowed'): void {
    this.el.dataset.cursor = c;
  }

  dispose(): void {
    cancelAnimationFrame(this.hoverRaf);
    this.el.removeEventListener('pointerdown', this.down);
    this.el.removeEventListener('pointermove', this.move);
    this.el.removeEventListener('pointerup', this.up);
    this.el.removeEventListener('pointercancel', this.cancel);
    this.el.removeEventListener('lostpointercapture', this.lost);
    this.el.removeEventListener('contextmenu', this.noMenu);
    this.overlay.dispose();
  }
}
