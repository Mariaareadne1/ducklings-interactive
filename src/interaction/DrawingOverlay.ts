import type { Pt } from './stroke';

/**
 * The pen line, drawn in an SVG over the canvas: thin, cream, slightly
 * organic. Closed shapes get a faint fill. After release the line lingers as
 * a ghost while the duckling is painted in, then fades; rejected strokes
 * shiver away. A tap in Lead leaves a small ring that fades.
 */

const NS = 'http://www.w3.org/2000/svg';

export function pathData(pts: readonly Pt[]): string {
  if (pts.length === 0) return '';
  if (pts.length < 3) return `M${pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' L')}`;
  // quadratic curves through midpoints: smooth without overshoot
  let d = `M${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i].x + pts[i + 1].x) / 2;
    const my = (pts[i].y + pts[i + 1].y) / 2;
    d += ` Q${pts[i].x.toFixed(1)},${pts[i].y.toFixed(1)} ${mx.toFixed(1)},${my.toFixed(1)}`;
  }
  const last = pts[pts.length - 1];
  return `${d} L${last.x.toFixed(1)},${last.y.toFixed(1)}`;
}

export class DrawingOverlay {
  readonly svg: SVGSVGElement;
  private live: SVGPathElement | null = null;
  private fill: SVGPathElement | null = null;

  constructor(parent: HTMLElement) {
    this.svg = document.createElementNS(NS, 'svg');
    this.svg.classList.add('ink');
    this.svg.setAttribute('aria-hidden', 'true');
    parent.appendChild(this.svg);
  }

  begin(): void {
    this.cancelLive();
    this.fill = document.createElementNS(NS, 'path');
    this.fill.classList.add('ink-fill');
    this.live = document.createElementNS(NS, 'path');
    this.live.classList.add('ink-line');
    this.svg.append(this.fill, this.live);
  }

  update(pts: readonly Pt[], closedish: boolean): void {
    if (!this.live || !this.fill) return;
    const d = pathData(pts);
    this.live.setAttribute('d', d);
    this.fill.setAttribute('d', closedish ? `${d} Z` : '');
  }

  /** Keep the line as a ghost while the sheep condenses, then let it go. */
  settle(accepted: boolean): void {
    const line = this.live;
    const fill = this.fill;
    this.live = this.fill = null;
    if (!line || !fill) return;
    const cls = accepted ? 'ink-ghost' : 'ink-reject';
    line.classList.add(cls);
    fill.classList.add(cls);
    const done = () => {
      line.remove();
      fill.remove();
    };
    line.addEventListener('animationend', done, { once: true });
    window.setTimeout(done, 2500); // in case animations are disabled
  }

  /** A small pen ring where mum was sent, drawn as a path so recordings keep it. */
  mark(x: number, y: number): void {
    const ring = document.createElementNS(NS, 'path');
    const r = 9;
    ring.setAttribute('d', `M${(x - r).toFixed(1)},${y.toFixed(1)} a${r},${r * 0.55} 0 1,0 ${2 * r},0 a${r},${r * 0.55} 0 1,0 ${-2 * r},0`);
    ring.classList.add('ink-line', 'ink-mark');
    this.svg.append(ring);
    const done = () => ring.remove();
    ring.addEventListener('animationend', done, { once: true });
    window.setTimeout(done, 1500);
  }

  cancelLive(): void {
    this.settle(false);
  }

  dispose(): void {
    this.svg.remove();
  }
}
