import { useEffect, useRef, useState } from 'react';
import type { PondApp } from '../PondApp';
import { useAppState, type DrawKind } from '../../state/store';
import { canRedo, canUndo } from '../../state/history';
import { showcaseDoc } from '../../state/document';
import { exportDocFile, importDocFile } from '../../state/persistence';
import { Icon } from './icons';

interface ChromeProps {
  app: PondApp;
  onCapture: () => void;
  onRecord: () => void;
}

const SHORTCUTS: [string, string][] = [
  ['Draw · Move · Feed', 'D · V · F'],
  ['Draw a…', 'A auto · 1–4 on the picker'],
  ['Creature actions', '1 – 4'],
  ['Turn', 'Q · E  or scroll'],
  ['Duplicate', 'Shift D'],
  ['Remove', 'Delete'],
  ['Rain · Breeze', 'R · B'],
  ['Undo · Redo', '⌘Z · ⇧⌘Z'],
  ['Next creature', 'Tab'],
  ['Deselect / cancel', 'Esc'],
  ['Hide interface', 'H'],
];

const DRAW_KINDS: { id: DrawKind; label: string }[] = [
  { id: 'auto', label: 'Auto' },
  { id: 'fish', label: 'Fish' },
  { id: 'duck', label: 'Duck' },
  { id: 'lily', label: 'Lily' },
  { id: 'frog', label: 'Frog' },
];

export function Chrome({ app, onCapture, onRecord }: ChromeProps) {
  const { store } = app;
  const tool = useAppState(store, (s) => s.tool);
  const drawKind = useAppState(store, (s) => s.drawKind);
  const history = useAppState(store, (s) => s.history);
  const hasDrawn = useAppState(store, (s) => s.hasDrawn);
  const count = useAppState(store, (s) => s.history.present.creatures.length);
  const toast = useAppState(store, (s) => s.toast);
  const loading = useAppState(store, (s) => s.loading);
  const recording = useAppState(store, (s) => s.recording);
  const sound = useAppState(store, (s) => s.sound);
  const selectedId = useAppState(store, (s) => s.selectedId);
  const comeFor = useAppState(store, (s) => s.comeFor);
  const [panel, setPanel] = useState<'none' | 'help' | 'menu'>('none');
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (panel === 'none') return;
    const close = (e: PointerEvent) => {
      if (!(e.target as HTMLElement).closest('.panel, .top-actions')) setPanel('none');
    };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [panel]);

  const quiet = hasDrawn || selectedId !== null || count > 8;
  const hint = comeFor
    ? 'Tap the water.'
    : tool === 'feed'
      ? 'Tap the water to feed.'
      : quiet
        ? null
        : tool === 'draw'
          ? 'Draw a fish.'
          : 'Drag anything to move it.';

  const runMenu = (action: string) => {
    setPanel('none');
    if (action === 'reset') app.reset();
    if (action === 'showcase') app.loadDoc(showcaseDoc());
    if (action === 'export') exportDocFile(store.doc);
    if (action === 'import') fileRef.current?.click();
    if (action === 'hide') store.set({ uiHidden: true });
    if (action === 'record') onRecord();
    if (action === 'sound') store.set({ sound: !sound });
  };

  return (
    <>
      <header className="wordmark">
        <h1>POND</h1>
        <p>a place to draw fish</p>
      </header>

      <div className="top-actions">
        <button className="icon-btn ghost" aria-label="Help" aria-expanded={panel === 'help'} title="Help" onClick={() => setPanel(panel === 'help' ? 'none' : 'help')}>
          <Icon name="help" />
        </button>
        <button className="icon-btn ghost" aria-label="Pond menu" aria-expanded={panel === 'menu'} title="More" onClick={() => setPanel(panel === 'menu' ? 'none' : 'menu')}>
          <Icon name="menu" />
        </button>
      </div>

      {panel === 'help' && (
        <section className="panel help" aria-label="How to play">
          <p className="lede">Draw on the water: a long loop becomes a fish, a loop with a head on top a duck, a round one a lily pad. Draw a small loop on the bank or a pad for a frog. Click anything to see what it can do.</p>
          <dl>
            {SHORTCUTS.map(([what, key]) => (
              <div key={what}><dt>{what}</dt><dd>{key}</dd></div>
            ))}
          </dl>
        </section>
      )}
      {panel === 'menu' && (
        <section className="panel menu" aria-label="Pond menu">
          <button onClick={() => runMenu('showcase')}>Showcase arrangement</button>
          <button onClick={() => runMenu('record')} disabled={recording}>Record 12-second clip</button>
          <button onClick={() => runMenu('hide')}>Hide interface <kbd>H</kbd></button>
          <button onClick={() => runMenu('sound')} aria-pressed={sound}>Sound <kbd>{sound ? 'on' : 'off'}</kbd></button>
          <hr />
          <button onClick={() => runMenu('export')}>Export scene…</button>
          <button onClick={() => runMenu('import')}>Import scene…</button>
          <hr />
          <button className="danger" onClick={() => runMenu('reset')} disabled={count === 0}>Clear the pond</button>
        </section>
      )}
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        hidden
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (!file) return;
          try {
            app.loadDoc(await importDocFile(file));
            store.toast('Scene imported.');
          } catch (err) {
            store.toast(err instanceof Error ? err.message : 'Could not import that file.');
          }
        }}
      />

      {hint && <p className="hint" aria-live="polite">{hint}</p>}
      {loading && <p className="loading" aria-live="polite">Mixing the paints…</p>}

      <div className="dock">
        {tool === 'draw' && (
          <div className="picker" role="radiogroup" aria-label="What to draw">
            <span className="picker-label">Draw</span>
            {DRAW_KINDS.map((k) => (
              <button
                key={k.id}
                role="radio"
                aria-checked={drawKind === k.id}
                className={drawKind === k.id ? 'seg on' : 'seg'}
                onClick={() => store.set({ drawKind: k.id })}
              >
                {k.label}
              </button>
            ))}
          </div>
        )}
        <nav className="toolbar" aria-label="Tools">
          <button className={tool === 'draw' ? 'tool on' : 'tool'} aria-pressed={tool === 'draw'} title="Draw (D)" onClick={() => store.set({ tool: 'draw', comeFor: null })}>
            <Icon name="draw" /><span>Draw</span>
          </button>
          <button className={tool === 'move' ? 'tool on' : 'tool'} aria-pressed={tool === 'move'} title="Move (V)" onClick={() => store.set({ tool: 'move', comeFor: null })}>
            <Icon name="move" /><span>Move</span>
          </button>
          <button className={tool === 'feed' ? 'tool on' : 'tool'} aria-pressed={tool === 'feed'} title="Feed: tap the water (F)" onClick={() => store.set({ tool: tool === 'feed' ? 'draw' : 'feed', selectedId: null, comeFor: null })}>
            <Icon name="feed" /><span>Feed</span>
          </button>
          <span className="sep" />
          <button className="icon-btn" aria-label="Rain" title="Rain (R)" onClick={() => app.rain()}>
            <Icon name="rain" />
          </button>
          <button className="icon-btn" aria-label="Breeze" title="Breeze (B)" onClick={() => app.breeze()}>
            <Icon name="breeze" />
          </button>
          <span className="sep" />
          <button className="icon-btn" aria-label="Undo" title="Undo (⌘Z)" disabled={!canUndo(history)} onClick={() => app.undo()}>
            <Icon name="undo" />
          </button>
          <button className="icon-btn" aria-label="Redo" title="Redo (⇧⌘Z)" disabled={!canRedo(history)} onClick={() => app.redo()}>
            <Icon name="redo" />
          </button>
          <span className="sep" />
          <button className="icon-btn" aria-label="Save image" title="Save image" onClick={onCapture}>
            <Icon name="camera" />
          </button>
        </nav>
      </div>

      {recording && <p className="rec" aria-live="polite"><i />Recording</p>}
      {toast && <Toast key={toast.id} text={toast.text} />}
    </>
  );
}

function Toast({ text }: { text: string }) {
  const [gone, setGone] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setGone(true), 3200);
    return () => window.clearTimeout(t);
  }, []);
  if (gone) return null;
  return <p className="toast" role="status">{text}</p>;
}
