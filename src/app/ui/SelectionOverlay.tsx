import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import type { DucksApp } from '../DucksApp';
import { useAppState } from '../../state/store';
import { NAME_MAX, cleanName, findDuckling, suggestName, type DucklingRecord } from '../../state/document';
import { MOTHER_ID } from '../../ducks/Flock';
import { Icon } from './icons';

/**
 * MEADOW's thin blue box around the selected duck with a small bar of its
 * three actions: a name (with a 🎲 suggestion), Peep and Remove. Mother duck
 * only peeps. Positions are written straight to the DOM every frame.
 */

export function screenBox(app: DucksApp, box3: THREE.Box3): { minX: number; minY: number; maxX: number; maxY: number } {
  const corner = new THREE.Vector3();
  const cam = app.engine.camera;
  const rect = app.rect;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < 8; i++) {
    corner.set(i & 1 ? box3.max.x : box3.min.x, i & 2 ? box3.max.y : box3.min.y, i & 4 ? box3.max.z : box3.min.z).project(cam);
    const sx = ((corner.x + 1) / 2) * rect.width;
    const sy = ((1 - corner.y) / 2) * rect.height;
    minX = Math.min(minX, sx); maxX = Math.max(maxX, sx);
    minY = Math.min(minY, sy); maxY = Math.max(maxY, sy);
  }
  return { minX, minY, maxX, maxY };
}

function NameField({ app, duck }: { app: DucksApp; duck: DucklingRecord }) {
  const [draft, setDraft] = useState(duck.name ?? '');
  const [seen, setSeen] = useState(duck.name ?? '');
  // keep the field in step with undo/redo without fighting the person typing
  if ((duck.name ?? '') !== seen) {
    setSeen(duck.name ?? '');
    if (cleanName(draft) !== (duck.name ?? '')) setDraft(duck.name ?? '');
  }
  const rename = (value: string) => {
    setDraft(value);
    app.rename(duck.id, value);
  };
  const dice = () => rename(suggestName(app.store.doc.ducklings.map((d) => d.name ?? '').filter(Boolean)));
  return (
    <div className="duck-name">
      <input
        type="text"
        value={draft}
        maxLength={NAME_MAX + 4}
        placeholder="Name this duckling"
        aria-label="Duckling's name"
        spellCheck={false}
        onChange={(e) => rename(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === 'Escape') (e.target as HTMLInputElement).blur();
          e.stopPropagation();
        }}
      />
      <button className="icon-btn" aria-label="Suggest a name" title="Suggest a name" onClick={dice}>
        <span aria-hidden="true">🎲</span>
      </button>
    </div>
  );
}

export function SelectionOverlay({ app }: { app: DucksApp }) {
  const selectedId = useAppState(app.store, (s) => s.selectedId);
  const duck = useAppState(app.store, (s) => findDuckling(s.history.present, s.selectedId));
  const boxRef = useRef<HTMLDivElement>(null);
  const labelRef = useRef<HTMLSpanElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const isMother = selectedId === MOTHER_ID;

  useEffect(() => {
    if (!selectedId) return;
    const box3 = new THREE.Box3();
    const size = new THREE.Vector3();
    const update = () => {
      const view = app.flock.viewOf(selectedId);
      const box = boxRef.current;
      const bar = barRef.current;
      if (!view || !box || !bar) return;
      view.bounds(box3);
      if (box3.isEmpty()) return;
      const { minX, minY, maxX, maxY } = screenBox(app, box3);
      const rect = app.rect;
      const pad = 6;
      box.style.transform = `translate(${(minX - pad).toFixed(1)}px, ${(minY - pad).toFixed(1)}px)`;
      box.style.width = `${(maxX - minX + pad * 2).toFixed(1)}px`;
      box.style.height = `${(maxY - minY + pad * 2).toFixed(1)}px`;
      box3.getSize(size);
      if (labelRef.current) {
        const dist = app.engine.camera.position.distanceTo(view.root.position);
        labelRef.current.textContent = `${Math.max(size.x, size.z).toFixed(2)} m  ·  ${dist.toFixed(1)} m away`;
      }
      const barW = bar.offsetWidth;
      const barH = bar.offsetHeight;
      const cx = Math.min(rect.width - barW / 2 - 12, Math.max(barW / 2 + 12, (minX + maxX) / 2));
      const below = maxY + pad + 34 + barH < rect.height - 120;
      const y = below ? maxY + pad + 30 : minY - pad - barH - 12;
      bar.style.transform = `translate(${(cx - barW / 2).toFixed(1)}px, ${Math.max(8, y).toFixed(1)}px)`;
    };
    update();
    return app.engine.onBeforeRender(update);
  }, [app, selectedId]);

  if (!selectedId || (!duck && !isMother)) return null;
  return (
    <>
      <div className="select-box" ref={boxRef} aria-hidden="true">
        <i className="h tl" /><i className="h tr" /><i className="h bl" /><i className="h br" />
        <span className="select-label" ref={labelRef} />
      </div>
      <div className="creature-bar" ref={barRef} role="toolbar" aria-label={isMother ? 'Mother duck' : `Selected duckling${duck?.name ? ` ${duck.name}` : ''}`} data-kind={isMother ? 'mother' : 'duckling'}>
        {isMother ? <span className="who">Mother duck</span> : duck && <NameField key={duck.id} app={app} duck={duck} />}
        <button className="chip" data-action="peep" title="Peep (P)" onClick={() => app.peep()}>
          Peep
        </button>
        {!isMother && (
          <>
            <span className="sep" />
            <button className="icon-btn" data-action="remove" title="Remove (Delete)" aria-label="Remove" onClick={() => app.remove()}>
              <Icon name="trash" />
            </button>
          </>
        )}
      </div>
    </>
  );
}
