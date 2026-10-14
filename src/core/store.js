import { CommandError, reduce } from './commands.js';

/**
 * Estado = proyecto (con historial) + UI efímera (selección, cursor).
 * El historial guarda proyectos inmutables: compartir estructura lo hace barato.
 *
 * `coalesce` en un comando fusiona arrastres consecutivos (mover, recortar, deslizar un
 * valor) en una sola entrada de historial. Cualquier otra acción cierra la fusión.
 */
export function createStore(project, { historyLimit = 100 } = {}) {
  let state = { project, selection: [], playhead: 0 };
  let past = [];
  let future = [];
  let coalesceKey = null;
  const listeners = new Set();

  const notify = (meta) => { for (const fn of listeners) fn(state, meta); };

  const prune = (selection, proj) => selection.filter((id) => proj.clips[id]);

  function commit(next, meta) {
    state = { ...state, project: next, selection: prune(state.selection, next) };
    notify(meta);
  }

  function dispatch(command) {
    let next;
    try {
      next = reduce(state.project, command);
    } catch (error) {
      if (error instanceof CommandError) return { ok: false, error };
      throw error;
    }
    if (next === state.project) return { ok: true };

    const merges = command.coalesce !== undefined && command.coalesce === coalesceKey && past.length > 0;
    if (!merges) {
      past.push(state.project);
      if (past.length > historyLimit) past.shift();
    }
    coalesceKey = command.coalesce ?? null;
    future = [];
    commit(next, { type: 'dispatch', command });
    return { ok: true };
  }

  function undo() {
    if (!past.length) return false;
    future.push(state.project);
    coalesceKey = null;
    commit(past.pop(), { type: 'undo' });
    return true;
  }

  function redo() {
    if (!future.length) return false;
    past.push(state.project);
    coalesceKey = null;
    commit(future.pop(), { type: 'redo' });
    return true;
  }

  return {
    getState: () => state,
    getProject: () => state.project,
    dispatch,
    undo,
    redo,
    canUndo: () => past.length > 0,
    canRedo: () => future.length > 0,
    endCoalesce: () => { coalesceKey = null; },
    select(ids) {
      state = { ...state, selection: prune([...ids], state.project) };
      notify({ type: 'select' });
    },
    setPlayhead(t) {
      state = { ...state, playhead: Math.max(0, t) };
      notify({ type: 'playhead' });
    },
    /** Sustituye el proyecto (abrir/importar) y vacía el historial. */
    load(next) {
      past = []; future = []; coalesceKey = null;
      state = { project: next, selection: [], playhead: 0 };
      notify({ type: 'load' });
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}
