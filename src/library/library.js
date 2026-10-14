import { createAsset } from '../core/project.js';
import { newId } from '../core/ids.js';
import { validateFile } from './kinds.js';

/**
 * Biblioteca de medios: valida, inspecciona (duración, tamaño, miniatura, onda), guarda el
 * archivo en el repositorio y registra el medio en el proyecto.
 *
 * `adapters.inspect(file, kind)` devuelve
 *   { info: { duration, width, height }, thumb: Blob|null, peaks: number[]|null, hasAudio: boolean }
 * y lanza si el navegador no puede leer el archivo. En el navegador se usa `createDomAdapters()`.
 *
 * Los blobs de medios quitados siguen en el repositorio mientras se pueda deshacer.
 * `collectGarbage()` los borra; llámalo al abrir un proyecto, con el historial vacío.
 */
export function createLibrary({ store, repo, adapters, urlApi = globalThis.URL, maxBytes }) {
  const urls = new Map();

  const thumbKey = (assetId) => `${assetId}:thumb`;

  async function importFile(file, coalesce) {
    const check = validateFile(file, { maxBytes });
    if (!check.ok) return { ok: false, name: file.name, code: check.code, message: check.message };

    let inspected;
    try {
      inspected = await adapters.inspect(file, check.kind);
    } catch (error) {
      return {
        ok: false, name: file.name, code: 'unreadable',
        message: `El navegador no puede leer ${file.name}. Puede que el códec no esté soportado.`,
        cause: error,
      };
    }
    const { info, thumb, peaks, hasAudio } = inspected;
    if (check.kind !== 'image' && !(info.duration > 0)) {
      return { ok: false, name: file.name, code: 'unreadable', message: `${file.name} no tiene duración válida.` };
    }

    const asset = createAsset({
      kind: check.kind,
      name: file.name,
      duration: check.kind === 'image' ? 0 : info.duration,
      width: info.width ?? 0,
      height: info.height ?? 0,
      hasAudio: check.kind === 'audio' ? true : Boolean(hasAudio),
      mime: file.type || '',
      size: file.size,
      peaks: peaks ?? null,
      hasThumb: Boolean(thumb),
    });

    await repo.putMedia(asset.id, file);
    if (thumb) await repo.putMedia(thumbKey(asset.id), thumb);
    const result = store.dispatch({ type: 'asset/add', asset, coalesce });
    if (!result.ok) {
      await repo.removeMedia(asset.id);
      await repo.removeMedia(thumbKey(asset.id));
      return { ok: false, name: file.name, code: result.error.code, message: result.error.message };
    }
    return { ok: true, asset };
  }

  /** Importa en serie (un archivo grande a la vez) y agrupa todo en un solo paso de historial. */
  async function importFiles(files, { onProgress } = {}) {
    const list = [...files];
    const batch = `import:${newId('b')}`;
    const added = [];
    const rejected = [];
    for (let index = 0; index < list.length; index++) {
      onProgress?.({ index, total: list.length, name: list[index].name });
      const result = await importFile(list[index], batch);
      if (result.ok) added.push(result.asset);
      else rejected.push({ name: result.name, code: result.code, message: result.message });
    }
    store.endCoalesce();
    onProgress?.({ index: list.length, total: list.length, name: '' });
    return { added, rejected };
  }

  async function urlFor(key) {
    if (urls.has(key)) return urls.get(key);
    const blob = await repo.getMedia(key);
    if (!blob) return null;
    const url = urlApi.createObjectURL(blob);
    urls.set(key, url);
    return url;
  }

  function removeAsset(assetId) {
    return store.dispatch({ type: 'asset/remove', assetId });
  }

  async function collectGarbage() {
    const live = new Set(Object.keys(store.getProject().assets));
    for (const key of [...urls.keys()]) {
      if (!live.has(key.split(':')[0])) { urlApi.revokeObjectURL(urls.get(key)); urls.delete(key); }
    }
    return repo.pruneMedia?.((key) => live.has(key.split(':')[0])) ?? 0;
  }

  function dispose() {
    for (const url of urls.values()) urlApi.revokeObjectURL(url);
    urls.clear();
  }

  return {
    importFiles,
    removeAsset,
    getUrl: (assetId) => urlFor(assetId),
    getThumbUrl: (assetId) => (store.getProject().assets[assetId]?.hasThumb ? urlFor(thumbKey(assetId)) : Promise.resolve(null)),
    getFile: (assetId) => repo.getMedia(assetId),
    collectGarbage,
    dispose,
  };
}
