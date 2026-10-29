import { useEffect, useRef, useState } from 'react';
import { Engine } from '../engine/Engine';
import { Store, useAppState } from '../state/store';
import { defaultDoc, emptyDoc, findCreature, showcaseDoc, type PondDoc } from '../state/document';
import { downloadBlob, loadDoc } from '../state/persistence';
import { PondApp } from './PondApp';
import { PointerInput } from '../interaction/PointerInput';
import { recordCanvas } from '../capture/recorder';
import { Chrome } from './ui/Chrome';
import { SelectionOverlay } from './ui/SelectionOverlay';
import { InsteadChip } from './ui/InsteadChip';
import { actionsFor } from './ui/actions';

interface Running {
  engine: Engine;
  app: PondApp;
  input: PointerInput;
}

declare global {
  interface Window {
    __pond?: Running & { store: Store };
  }
}

function initialDoc(params: URLSearchParams): PondDoc {
  if (params.has('showcase')) return showcaseDoc();
  if (params.has('empty')) return emptyDoc();
  return loadDoc() ?? defaultDoc();
}

function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));
}

export function App() {
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [store] = useState(() => new Store(initialDoc(new URLSearchParams(location.search))));
  const [running, setRunning] = useState<Running | null>(null);
  const fatal = useAppState(store, (s) => s.fatal);
  const uiHidden = useAppState(store, (s) => s.uiHidden);
  const tool = useAppState(store, (s) => s.tool);

  useEffect(() => {
    const canvas = canvasRef.current;
    const stage = stageRef.current;
    if (!canvas || !stage) return;
    const params = new URLSearchParams(location.search);
    let engine: Engine;
    try {
      engine = new Engine({ canvas, quality: params.get('quality') === 'low' ? 'low' : 'high' });
    } catch (error) {
      store.set({ fatal: `POND needs WebGL 2, which this browser could not start. (${error instanceof Error ? error.message : String(error)})` });
      return;
    }
    const app = new PondApp(engine, store);
    const input = new PointerInput(stage, app);
    input.onMessage = (text) => store.toast(text);
    const resize = () => engine.resize(canvas.clientWidth, canvas.clientHeight);
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    app.start();
    engine.start();

    const lost = (e: Event) => {
      e.preventDefault();
      engine.stop();
      store.toast('The graphics context was lost. Restoring…');
    };
    const restored = () => engine.start();
    canvas.addEventListener('webglcontextlost', lost);
    canvas.addEventListener('webglcontextrestored', restored);
    const visibility = () => (document.hidden ? engine.stop() : engine.start());
    document.addEventListener('visibilitychange', visibility);

    const r: Running = { engine, app, input };
    window.__pond = { ...r, store };
    setRunning(r);
    return () => {
      document.removeEventListener('visibilitychange', visibility);
      canvas.removeEventListener('webglcontextlost', lost);
      canvas.removeEventListener('webglcontextrestored', restored);
      ro.disconnect();
      input.dispose();
      app.dispose();
      engine.dispose();
      delete window.__pond;
    };
  }, [store]);

  const capture = async () => {
    if (!running) return;
    try {
      const { engine } = running;
      const dpr = engine.renderer.getPixelRatio();
      const scale = Math.max(1, Math.min(2.5, 3840 / (engine.canvas.clientWidth * dpr)));
      downloadBlob(await engine.capturePNG(scale), `pond-${stamp()}.png`);
    } catch (error) {
      store.toast(error instanceof Error ? error.message : 'Could not save the image.');
    }
  };

  const record = async () => {
    if (!running || store.get().recording) return;
    store.set({ recording: true, uiHidden: true, selectedId: null });
    try {
      const rec = await recordCanvas(running.engine.canvas, { seconds: 12, ink: stageRef.current?.querySelector('svg.ink') });
      downloadBlob(rec.blob, `pond-${stamp()}.${rec.extension}`);
      store.toast(`Saved a ${(rec.durationMs / 1000).toFixed(0)}-second ${rec.extension.toUpperCase()} clip.`);
    } catch (error) {
      store.toast(error instanceof Error ? error.message : 'Recording failed.');
    } finally {
      store.set({ recording: false, uiHidden: false });
    }
  };

  useEffect(() => {
    if (!running) return;
    const { app, input } = running;
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.altKey) return;
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();
      if (mod && key === 'z') {
        e.preventDefault();
        if (e.shiftKey) app.redo();
        else app.undo();
        return;
      }
      if (mod && key === 'y') {
        e.preventDefault();
        app.redo();
        return;
      }
      if (mod) return;
      const selected = store.get().selectedId;
      const rec = findCreature(store.doc, selected);
      switch (key) {
        case 'escape':
          if (input.isDrawing) input.abort();
          else if (store.get().comeFor) store.set({ comeFor: null });
          else if (store.get().uiHidden) store.set({ uiHidden: false });
          else if (store.get().tool === 'feed') store.set({ tool: 'draw' });
          else store.set({ selectedId: null });
          break;
        case 'd':
          if (e.shiftKey && selected) app.duplicate();
          else store.set({ tool: 'draw' });
          break;
        case 'v': store.set({ tool: 'move' }); break;
        case 'f': store.set({ tool: store.get().tool === 'feed' ? 'draw' : 'feed', selectedId: null }); break;
        case 'a': store.set({ drawKind: 'auto', tool: 'draw' }); break;
        case 'r': app.rain(); break;
        case 'b': app.breeze(); break;
        case 'c':
          // "come here" to wherever the pointer is
          if (rec?.kind === 'fish' && input.lastHover) app.comeToPoint(rec.id, input.lastHover.x, input.lastHover.y);
          break;
        case 'h': if (!store.get().recording) store.set({ uiHidden: !store.get().uiHidden }); break;
        case '1': case '2': case '3': case '4': {
          const n = Number(key) - 1;
          if (rec) {
            const action = actionsFor(rec, store.doc)[n];
            if (action) app.act(action.id);
          } else if (store.get().tool === 'draw') {
            store.set({ drawKind: (['fish', 'duck', 'lily', 'frog'] as const)[n] });
          }
          break;
        }
        case 'q': case '[': app.rotate(0.3); break;
        case 'e': case ']': app.rotate(-0.3); break;
        case 'delete': case 'backspace':
          if (selected) {
            e.preventDefault();
            app.remove();
          }
          break;
        case 'tab': {
          // keyboard selection: cycle through the pond
          const ids = store.doc.creatures.map((c) => c.id);
          if (!ids.length) break;
          e.preventDefault();
          const i = selected ? ids.indexOf(selected) : -1;
          store.set({ selectedId: ids[(i + (e.shiftKey ? ids.length - 1 : 1)) % ids.length] });
          break;
        }
        default:
          return;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [running, store]);

  return (
    <div className={`stage tool-${tool}${uiHidden ? ' ui-hidden' : ''}`} ref={stageRef}>
      <canvas ref={canvasRef} aria-label="A painted pond. Draw on the water to make a fish, a duck or a lily pad, or on the bank for a frog." role="img" />
      {running && (
        <div className="chrome">
          <SelectionOverlay app={running.app} />
          <InsteadChip app={running.app} />
          <Chrome app={running.app} onCapture={capture} onRecord={record} />
        </div>
      )}
      {fatal && (
        <div className="fatal" role="alert">
          <h2>The pond could not open</h2>
          <p>{fatal}</p>
        </div>
      )}
    </div>
  );
}
