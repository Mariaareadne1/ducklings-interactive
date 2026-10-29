import { useSyncExternalStore } from 'react';
import { amend, commit, createHistory, redo, undo, type History } from './history';
import type { PondDoc } from './document';
import type { Kind } from '../creatures/types';

/** Minimal external store: React reads it through useSyncExternalStore. */

export type Tool = 'draw' | 'move' | 'feed';
export type DrawKind = 'auto' | Kind;

/** After an unsure reading: offer the other readings for a few seconds. */
export interface InsteadOffer {
  readonly id: string;
  readonly kinds: readonly Kind[];
  readonly key: number;
}

export interface AppState {
  readonly history: History;
  readonly selectedId: string | null;
  readonly tool: Tool;
  readonly drawKind: DrawKind;
  /** "Come here": the next tap on the water is where this fish should come. */
  readonly comeFor: string | null;
  readonly instead: InsteadOffer | null;
  readonly sound: boolean;
  readonly hasDrawn: boolean;
  readonly uiHidden: boolean;
  readonly toast: { id: number; text: string } | null;
  readonly loading: boolean;
  readonly recording: boolean;
  readonly fatal: string | null;
}

type Listener = () => void;

export class Store {
  private state: AppState;
  private readonly listeners = new Set<Listener>();
  private toastId = 0;

  constructor(doc: PondDoc) {
    this.state = {
      history: createHistory(doc),
      selectedId: null,
      tool: 'draw',
      drawKind: 'auto',
      comeFor: null,
      instead: null,
      sound: false,
      hasDrawn: false,
      uiHidden: false,
      toast: null,
      loading: true,
      recording: false,
      fatal: null,
    };
  }

  get = (): AppState => this.state;

  get doc(): PondDoc {
    return this.state.history.present;
  }

  subscribe = (fn: Listener): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  set(patch: Partial<AppState>): void {
    this.state = { ...this.state, ...patch };
    for (const fn of this.listeners) fn();
  }

  commit(doc: PondDoc, patch: Partial<AppState> = {}): void {
    this.set({ ...patch, history: commit(this.state.history, doc) });
  }

  amend(doc: PondDoc): void {
    this.set({ history: amend(this.state.history, doc) });
  }

  undo(): void {
    this.set({ history: undo(this.state.history) });
    this.dropMissingSelection();
  }

  redo(): void {
    this.set({ history: redo(this.state.history) });
    this.dropMissingSelection();
  }

  toast(text: string): void {
    this.set({ toast: { id: ++this.toastId, text } });
  }

  private dropMissingSelection(): void {
    const id = this.state.selectedId;
    if (id && !this.doc.creatures.some((c) => c.id === id)) this.set({ selectedId: null });
  }
}

export function useAppState<T>(store: Store, select: (s: AppState) => T): T {
  return useSyncExternalStore(store.subscribe, () => select(store.get()));
}
