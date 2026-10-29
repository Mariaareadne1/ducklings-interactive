import { useSyncExternalStore } from 'react';
import { amend, commit, createHistory, redo, undo, type History } from './history';
import type { DucksDoc } from './document';

/** Minimal external store: React reads it through useSyncExternalStore. */

export type Tool = 'draw' | 'lead';

export interface AppState {
  readonly history: History;
  readonly selectedId: string | null;
  readonly tool: Tool;
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

  constructor(doc: DucksDoc) {
    this.state = {
      history: createHistory(doc),
      selectedId: null,
      tool: 'draw',
      hasDrawn: false,
      uiHidden: false,
      toast: null,
      loading: true,
      recording: false,
      fatal: null,
    };
  }

  get = (): AppState => this.state;

  get doc(): DucksDoc {
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

  commit(doc: DucksDoc, patch: Partial<AppState> = {}): void {
    this.set({ ...patch, history: commit(this.state.history, doc) });
  }

  amend(doc: DucksDoc): void {
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
    if (id && id !== 'mother' && !this.doc.ducklings.some((c) => c.id === id)) this.set({ selectedId: null });
  }
}

export function useAppState<T>(store: Store, select: (s: AppState) => T): T {
  return useSyncExternalStore(store.subscribe, () => select(store.get()));
}
