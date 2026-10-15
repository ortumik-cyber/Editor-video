import { test } from 'node:test';
import assert from 'node:assert/strict';
import { autosave, createAsset, createClip, createMemoryBackend, createRepo, createStore } from '../src/core/index.js';
import { createProjectManager, parseRoute, relativeTime, routeHash } from '../src/app/projects.js';

const setup = () => {
  const repo = createRepo(createMemoryBackend());
  return { repo, manager: createProjectManager({ repo }) };
};
/** Un proyecto con un medio de vídeo (con miniatura) en un clip, y sus archivos en el repositorio. */
async function withMedia(repo, project, name = 'a.mp4') {
  const asset = createAsset({ kind: 'video', name, duration: 5, width: 100, height: 100, hasAudio: true, hasThumb: true });
  const track = project.tracks.find((t) => t.kind === 'video');
  const clip = createClip({ trackId: track.id, kind: 'video', assetId: asset.id, start: 0, duration: 3 });
  const full = {
    ...project,
    assets: { ...project.assets, [asset.id]: asset },
    clips: { ...project.clips, [clip.id]: clip },
    tracks: project.tracks.map((t) => (t.id === track.id ? { ...t, clipIds: [...t.clipIds, clip.id] } : t)),
  };
  await repo.putMedia(asset.id, new Uint8Array([1, 2, 3]));
  await repo.putMedia(`${asset.id}:thumb`, new Uint8Array([9]));
  await repo.save(full);
  return { project: full, asset };
}

test('crear, abrir, renombrar y listar con el último editado primero', async () => {
  const { manager } = setup();
  const a = await manager.create({ name: '  Viaje  ', aspect: '16:9' });
  assert.equal(a.name, 'Viaje');
  assert.equal(a.settings.aspect, '16:9');
  assert.equal((await manager.create({ name: '   ' })).name, 'Proyecto sin título');
  await new Promise((r) => setTimeout(r, 5));
  await manager.rename(a.id, 'Viaje a Roma');
  const list = await manager.list();
  assert.equal(list[0].id, a.id, 'el recién renombrado va primero');
  assert.deepEqual([list[0].name, list[0].aspect, list[0].duration, list[0].clips, list[0].coverAssetId], ['Viaje a Roma', '16:9', 0, 0, null]);
  assert.equal((await manager.open(a.id)).name, 'Viaje a Roma');
  assert.equal(await manager.open('nada'), null);
  await assert.rejects(() => manager.rename(a.id, '   '), /vacío/);
  await assert.rejects(() => manager.rename('nada', 'x'), /inexistente/);
  assert.equal((await manager.open(a.id)).name, 'Viaje a Roma', 'un renombrado inválido no cambia nada');
  await manager.rename(a.id, 'x'.repeat(200));
  assert.equal((await manager.open(a.id)).name.length, 80);
});

test('la lista da duración, nº de clips y portada del primer medio visual', async () => {
  const { repo, manager } = setup();
  const { project, asset } = await withMedia(repo, await manager.create({ name: 'P' }));
  const [row] = await manager.list();
  assert.deepEqual([row.id, row.duration, row.clips, row.coverAssetId], [project.id, 3, 1, asset.id]);
});

test('duplicar: copia independiente que comparte los archivos', async () => {
  const { repo, manager } = setup();
  const { project, asset } = await withMedia(repo, await manager.create({ name: 'Original' }));
  const copy = await manager.duplicate(project.id);
  assert.notEqual(copy.id, project.id);
  assert.equal(copy.name, 'Copia de Original');
  assert.deepEqual(Object.keys(copy.assets), [asset.id], 'mismo medio');
  assert.equal((await manager.list()).length, 2);
  await manager.rename(copy.id, 'Otra');
  assert.equal((await manager.open(project.id)).name, 'Original', 'cambiar la copia no toca el original');
  copy.name = 'mutado';
  assert.equal((await manager.open(copy.id)).name, 'Otra');
});

test('borrar un proyecto conserva los medios que otro sigue usando', async () => {
  const { repo, manager } = setup();
  const { project, asset } = await withMedia(repo, await manager.create({ name: 'A' }));
  const copy = await manager.duplicate(project.id);
  assert.equal(await manager.remove(project.id), 0, 'el medio lo usa la copia: no se borra nada');
  assert.ok(await repo.getMedia(asset.id));
  assert.ok(await repo.getMedia(`${asset.id}:thumb`));
  assert.equal(await manager.open(project.id), null);
  assert.equal(await manager.remove(copy.id), 1, 'al borrar el último que lo usa, se va el archivo');
  assert.equal(await repo.getMedia(asset.id), null);
  assert.equal(await repo.getMedia(`${asset.id}:thumb`), null);
  assert.equal(await manager.remove('nada'), 0);
});

test('borrar solo elimina los medios propios, no los de otros proyectos', async () => {
  const { repo, manager } = setup();
  const one = await withMedia(repo, await manager.create({ name: 'Uno' }), 'uno.mp4');
  const two = await withMedia(repo, await manager.create({ name: 'Dos' }), 'dos.mp4');
  await manager.remove(one.project.id);
  assert.equal(await repo.getMedia(one.asset.id), null);
  assert.ok(await repo.getMedia(two.asset.id), 'el medio del otro proyecto sigue');
  assert.deepEqual([...(await manager.liveAssetIds())], [two.asset.id]);
  assert.deepEqual([...(await manager.liveAssetIds(two.project.id))], []);
});

test('la recolección de basura de la biblioteca respeta los medios de otros proyectos', async () => {
  const { createLibrary } = await import('../src/library/index.js');
  const { repo, manager } = setup();
  const other = await withMedia(repo, await manager.create({ name: 'Otro' }), 'otro.mp4');
  const current = await manager.create({ name: 'Actual' });
  await repo.putMedia('ast_huerfano', new Uint8Array([7]));
  const store = createStore(current);
  const library = createLibrary({ store, repo, adapters: {}, urlApi: { createObjectURL: () => 'u', revokeObjectURL() {} } });
  const removed = await library.collectGarbage(await manager.liveAssetIds(current.id));
  assert.equal(removed, 1, 'solo el huérfano');
  assert.ok(await repo.getMedia(other.asset.id), 'el medio de otro proyecto sobrevive');
  assert.equal(await repo.getMedia('ast_huerfano'), null);
  const bad = await library.collectGarbage();
  assert.equal(bad, 2, 'sin pasar los medios de otros proyectos los borraría (por eso el parámetro es obligatorio en la app)');
});

test('autosave: .flush() guarda ya sin esperar y sin parar el guardado', async () => {
  const { repo, manager } = setup();
  const project = await manager.create({ name: 'Auto' });
  const store = createStore(project);
  const stop = autosave(store, repo, { delay: 60_000 });
  store.dispatch({ type: 'project/rename', name: 'Cambiado' });
  assert.equal((await repo.load(project.id)).name, 'Auto', 'aún no se ha guardado');
  await stop.flush();
  assert.equal((await repo.load(project.id)).name, 'Cambiado');
  store.dispatch({ type: 'project/rename', name: 'Otra vez' });
  await stop.flush();
  assert.equal((await repo.load(project.id)).name, 'Otra vez', 'sigue activo tras vaciar');
  await stop();
});

test('rutas y tiempo relativo', () => {
  assert.deepEqual(parseRoute('#/p/prj_abc-1'), { name: 'editor', id: 'prj_abc-1' });
  assert.deepEqual(parseRoute('#/'), { name: 'home' });
  assert.deepEqual(parseRoute(''), { name: 'home' });
  assert.deepEqual(parseRoute('#/p/../x'), { name: 'home' });
  assert.deepEqual(parseRoute('#/p/'), { name: 'home' });
  assert.equal(routeHash({ name: 'editor', id: 'prj_1' }), '#/p/prj_1');
  assert.equal(routeHash({ name: 'home' }), '#/');
  const now = 1_700_000_000_000;
  assert.equal(relativeTime(now - 5_000, now), 'ahora mismo');
  assert.equal(relativeTime(now - 5 * 60_000, now), 'hace 5 min');
  assert.equal(relativeTime(now - 3 * 3600_000, now), 'hace 3 h');
  assert.equal(relativeTime(now - 30 * 3600_000, now), 'ayer');
  assert.equal(relativeTime(now - 5 * 86400_000, now), 'hace 5 días');
  assert.match(relativeTime(now - 90 * 86400_000, now), /\d{4}/);
});
