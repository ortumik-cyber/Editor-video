import { SCHEMA_VERSION } from './project.js';

/**
 * Repositorio: proyectos (JSON) y medios (Blob) por separado.
 * El backend se inyecta: IndexedDB en el navegador, memoria en tests.
 * Interfaz del backend: put(store, key, value), get(store, key), delete(store, key), all(store), keys(store).
 * Claves de medios: `<assetId>` para el archivo y `<assetId>:thumb` para la miniatura.
 */
export function createRepo(backend) {
  return {
    async save(project) {
      await backend.put('projects', project.id, { project, updatedAt: Date.now() });
    },
    async load(id) {
      const row = await backend.get('projects', id);
      return row ? migrate(row.project) : null;
    },
    async list() {
      const rows = await backend.all('projects');
      return rows
        .map(({ project, updatedAt }) => ({ id: project.id, name: project.name, updatedAt }))
        .sort((a, b) => b.updatedAt - a.updatedAt);
    },
    /** Todos los proyectos guardados, completos. */
    async loadAll() {
      return (await backend.all('projects')).map((row) => migrate(row.project));
    },
    /** Borra solo el proyecto: los medios pueden ser de otros. Ver `createProjectManager`. */
    deleteProject: (id) => backend.delete('projects', id),
    /** Borra el proyecto y todos sus medios. Solo es seguro si ningún otro proyecto los usa. */
    async remove(project) {
      for (const assetId of Object.keys(project.assets)) {
        await backend.delete('media', assetId);
        await backend.delete('media', `${assetId}:thumb`);
      }
      await backend.delete('projects', project.id);
    },
    /** Borra los medios cuya clave no cumple `keep(key)`. Devuelve cuántos borró. */
    async pruneMedia(keep) {
      let removed = 0;
      for (const key of await backend.keys('media')) {
        if (!keep(key)) { await backend.delete('media', key); removed++; }
      }
      return removed;
    },
    putMedia: (assetId, blob) => backend.put('media', assetId, blob),
    getMedia: (assetId) => backend.get('media', assetId),
    removeMedia: (assetId) => backend.delete('media', assetId),
  };
}

/** Punto único para migrar proyectos guardados con un esquema anterior. */
export function migrate(project) {
  if (project.version > SCHEMA_VERSION) {
    throw new Error(`Proyecto de una versión más nueva (${project.version}); actualiza la app`);
  }
  return project;
}

/** Guarda tras una pausa sin cambios. Devuelve una función para parar (vacía lo pendiente); `.flush()` guarda ya, sin parar. */
export function autosave(store, repo, { delay = 800 } = {}) {
  let timer = null;
  let dirty = false;
  const flush = async () => {
    clearTimeout(timer);
    timer = null;
    if (!dirty) return;
    dirty = false;
    await repo.save(store.getProject());
  };
  const unsubscribe = store.subscribe((_, meta) => {
    if (meta.type === 'select' || meta.type === 'playhead') return;
    dirty = true;
    clearTimeout(timer);
    timer = setTimeout(flush, delay);
  });
  const stop = async () => { unsubscribe(); await flush(); };
  stop.flush = flush;
  return stop;
}

export function createMemoryBackend() {
  const stores = { projects: new Map(), media: new Map() };
  return {
    async put(store, key, value) { stores[store].set(key, structuredClone(value)); },
    async get(store, key) { return stores[store].get(key) ?? null; },
    async delete(store, key) { stores[store].delete(key); },
    async all(store) { return [...stores[store].values()]; },
    async keys(store) { return [...stores[store].keys()]; },
  };
}

export function createIndexedDbBackend(name = 'editor-video') {
  const opened = new Promise((resolve, reject) => {
    const req = indexedDB.open(name, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore('projects');
      req.result.createObjectStore('media');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  const run = async (store, mode, fn) => {
    const db = await opened;
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, mode);
      const request = fn(tx.objectStore(store));
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  };
  return {
    put: (store, key, value) => run(store, 'readwrite', (s) => s.put(value, key)),
    get: async (store, key) => (await run(store, 'readonly', (s) => s.get(key))) ?? null,
    delete: (store, key) => run(store, 'readwrite', (s) => s.delete(key)),
    all: (store) => run(store, 'readonly', (s) => s.getAll()),
    keys: (store) => run(store, 'readonly', (s) => s.getAllKeys()),
  };
}
