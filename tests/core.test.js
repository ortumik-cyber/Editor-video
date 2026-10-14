import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  autosave, clipEnd, clipsAt, createAsset, createClip, createMemoryBackend, createProject,
  createRepo, createStore, firstFreeStart, projectDuration, reduce, trackClips,
} from '../src/core/index.js';

function setup() {
  const store = createStore(createProject({ name: 'T' }));
  const [video, text, audio] = store.getProject().tracks;
  const clip = createAsset({ kind: 'video', name: 'a.mp4', duration: 10, width: 1080, height: 1920, hasAudio: true });
  const song = createAsset({ kind: 'audio', name: 'm.mp3', duration: 30 });
  store.dispatch({ type: 'asset/add', asset: clip });
  store.dispatch({ type: 'asset/add', asset: song });
  return { store, video, text, audio, clip, song };
}
const addVideo = (store, trackId, assetId, start, duration, inPoint = 0) => {
  const c = createClip({ trackId, kind: 'video', assetId, start, duration, in: inPoint });
  const r = store.dispatch({ type: 'clip/add', clip: c });
  return { c, r };
};

test('proyecto nuevo: 3 pistas y formato 9:16', () => {
  const p = createProject();
  assert.deepEqual(p.tracks.map((t) => t.kind), ['video', 'text', 'audio']);
  assert.equal(p.settings.width, 1080);
  assert.equal(p.settings.height, 1920);
});

test('clip/add valida pista, medio, límites y solapes', () => {
  const { store, video, text, clip } = setup();
  assert.ok(addVideo(store, video.id, clip.id, 0, 5).r.ok);
  assert.equal(addVideo(store, video.id, clip.id, 4, 3).r.error.code, 'overlap');
  assert.equal(addVideo(store, video.id, clip.id, 6, 11).r.error.code, 'bounds');
  assert.equal(addVideo(store, video.id, 'nope', 6, 1).r.error.code, 'no_asset');
  assert.equal(addVideo(store, text.id, clip.id, 0, 1).r.error.code, 'kind');
  assert.equal(addVideo(store, video.id, clip.id, 5, 0.05).r.error.code, 'bounds');
});

test('clip/move mantiene orden y rechaza solape; permite cambiar de pista', () => {
  const { store, video, clip } = setup();
  const a = addVideo(store, video.id, clip.id, 0, 3).c;
  const b = addVideo(store, video.id, clip.id, 3, 3).c;
  assert.equal(store.dispatch({ type: 'clip/move', clipId: a.id, start: 2 }).error.code, 'overlap');
  assert.ok(store.dispatch({ type: 'clip/move', clipId: a.id, start: 10 }).ok);
  assert.deepEqual(store.getProject().tracks[0].clipIds, [b.id, a.id]);
  store.dispatch({ type: 'track/add', kind: 'video' });
  const overlay = store.getProject().tracks.at(-1);
  assert.ok(store.dispatch({ type: 'clip/move', clipId: b.id, start: 0, trackId: overlay.id }).ok);
  assert.equal(store.getProject().clips[b.id].trackId, overlay.id);
  assert.deepEqual(store.getProject().tracks[0].clipIds, [a.id]);
});

test('clip/split reparte duración, punto de entrada, fundidos y efectos', () => {
  const { store, video, clip } = setup();
  const { c } = addVideo(store, video.id, clip.id, 2, 6, 1);
  store.dispatch({ type: 'clip/update', clipId: c.id, patch: { fadeIn: 1, fadeOut: 1 } });
  store.dispatch({ type: 'effect/add', clipId: c.id, effect: { type: 'blur', params: { radius: 4 } } });
  assert.ok(store.dispatch({ type: 'clip/split', clipId: c.id, at: 5, newId: 'right' }).ok);
  const { clips } = store.getProject();
  assert.equal(clips[c.id].duration, 3);
  assert.equal(clips[c.id].fadeOut, 0);
  assert.equal(clips.right.start, 5);
  assert.equal(clips.right.duration, 3);
  assert.equal(clips.right.in, 4);
  assert.equal(clips.right.fadeIn, 0);
  assert.equal(clips.right.fadeOut, 1);
  assert.notEqual(clips.right.effects[0].id, clips[c.id].effects[0].id);
  assert.equal(store.dispatch({ type: 'clip/split', clipId: c.id, at: 2.05 }).error.code, 'bounds');
});

test('clip/trim ajusta in/duración y respeta los límites del medio', () => {
  const { store, video, clip } = setup();
  const { c } = addVideo(store, video.id, clip.id, 2, 6, 1);
  assert.ok(store.dispatch({ type: 'clip/trim', clipId: c.id, edge: 'start', time: 3 }).ok);
  let cl = store.getProject().clips[c.id];
  assert.deepEqual([cl.start, cl.duration, cl.in], [3, 5, 2]);
  assert.equal(store.dispatch({ type: 'clip/trim', clipId: c.id, edge: 'end', time: 20 }).error.code, 'bounds');
  assert.equal(store.dispatch({ type: 'clip/trim', clipId: c.id, edge: 'start', time: 0 }).error.code, 'bounds');
  assert.ok(store.dispatch({ type: 'clip/trim', clipId: c.id, edge: 'end', time: 7 }).ok);
  cl = store.getProject().clips[c.id];
  assert.equal(cl.duration, 4);
});

test('velocidad conserva el tramo de origen y acorta la duración', () => {
  const { store, video, clip } = setup();
  const { c } = addVideo(store, video.id, clip.id, 0, 8);
  assert.ok(store.dispatch({ type: 'clip/update', clipId: c.id, patch: { speed: 2 } }).ok);
  const cl = store.getProject().clips[c.id];
  assert.equal(cl.duration, 4);
  assert.equal(cl.speed, 2);
  assert.equal(store.dispatch({ type: 'clip/update', clipId: c.id, patch: { fadeIn: 3, fadeOut: 3 } }).error.code, 'bounds');
});

test('clip/remove con ripple cierra el hueco', () => {
  const { store, video, clip } = setup();
  const a = addVideo(store, video.id, clip.id, 0, 2).c;
  const b = addVideo(store, video.id, clip.id, 2, 2).c;
  const d = addVideo(store, video.id, clip.id, 4, 2).c;
  store.dispatch({ type: 'clip/remove', clipId: b.id, ripple: true });
  const { clips } = store.getProject();
  assert.equal(clips[a.id].start, 0);
  assert.equal(clips[d.id].start, 2);
  assert.equal(projectDuration(store.getProject()), 4);
});

test('asset/remove borra los clips que lo usan; pista de texto y bloqueo', () => {
  const { store, video, text, clip } = setup();
  const { c } = addVideo(store, video.id, clip.id, 0, 2);
  store.dispatch({ type: 'asset/remove', assetId: clip.id });
  assert.equal(store.getProject().clips[c.id], undefined);
  assert.deepEqual(store.getProject().tracks[0].clipIds, []);
  const t = createClip({ trackId: text.id, kind: 'text', start: 0, text: { content: 'Hola' } });
  assert.ok(store.dispatch({ type: 'clip/add', clip: t }).ok);
  assert.equal(store.getProject().clips[t.id].duration, 3);
  store.dispatch({ type: 'track/update', trackId: text.id, patch: { locked: true } });
  assert.equal(store.dispatch({ type: 'clip/move', clipId: t.id, start: 1 }).error.code, 'locked');
});

test('no se puede borrar la última pista de vídeo', () => {
  const { store, video } = setup();
  assert.equal(store.dispatch({ type: 'track/remove', trackId: video.id }).error.code, 'last_video_track');
});

test('efectos: añadir, actualizar, reordenar, quitar', () => {
  const { store, video, clip } = setup();
  const { c } = addVideo(store, video.id, clip.id, 0, 4);
  store.dispatch({ type: 'effect/add', clipId: c.id, effect: { id: 'f1', type: 'brightness', params: { value: 0.2 } } });
  store.dispatch({ type: 'effect/add', clipId: c.id, effect: { id: 'f2', type: 'blur', params: { radius: 3 } } });
  store.dispatch({ type: 'effect/update', clipId: c.id, effectId: 'f1', params: { value: 0.5 } });
  store.dispatch({ type: 'effect/reorder', clipId: c.id, from: 0, to: 1 });
  let fx = store.getProject().clips[c.id].effects;
  assert.deepEqual(fx.map((e) => e.id), ['f2', 'f1']);
  assert.equal(fx[1].params.value, 0.5);
  store.dispatch({ type: 'effect/remove', clipId: c.id, effectId: 'f2' });
  fx = store.getProject().clips[c.id].effects;
  assert.deepEqual(fx.map((e) => e.id), ['f1']);
  assert.equal(store.dispatch({ type: 'effect/remove', clipId: c.id, effectId: 'zz' }).error.code, 'no_effect');
});

test('undo/redo, comandos fallidos sin ruido y límite de historial', () => {
  const { store, video, clip } = setup();
  const before = store.getProject();
  const { c } = addVideo(store, video.id, clip.id, 0, 2);
  assert.equal(store.dispatch({ type: 'clip/move', clipId: c.id, start: -1 }).ok, false);
  assert.ok(store.undo());
  assert.equal(store.getProject().clips[c.id], undefined);
  assert.ok(store.redo());
  assert.ok(store.getProject().clips[c.id]);
  assert.notEqual(store.getProject(), before);
  const small = createStore(createProject(), { historyLimit: 2 });
  for (const name of ['a', 'b', 'c', 'd']) small.dispatch({ type: 'project/rename', name });
  assert.ok(small.undo());
  assert.ok(small.undo());
  assert.equal(small.undo(), false);
  assert.equal(small.getProject().name, 'b');
});

test('coalesce fusiona un arrastre en una sola entrada de historial', () => {
  const { store, video, clip } = setup();
  const { c } = addVideo(store, video.id, clip.id, 0, 2);
  for (const start of [1, 2, 3, 4]) store.dispatch({ type: 'clip/move', clipId: c.id, start, coalesce: `drag:${c.id}` });
  assert.equal(store.getProject().clips[c.id].start, 4);
  store.undo();
  assert.equal(store.getProject().clips[c.id].start, 0);
});

test('la selección descarta clips que ya no existen', () => {
  const { store, video, clip } = setup();
  const { c } = addVideo(store, video.id, clip.id, 0, 2);
  store.select([c.id]);
  assert.deepEqual(store.getState().selection, [c.id]);
  store.dispatch({ type: 'clip/remove', clipId: c.id });
  assert.deepEqual(store.getState().selection, []);
});

test('selectores: clipsAt, firstFreeStart, trackClips', () => {
  const { store, video, clip } = setup();
  const a = addVideo(store, video.id, clip.id, 0, 2).c;
  const b = addVideo(store, video.id, clip.id, 3, 2).c;
  const p = store.getProject();
  assert.deepEqual(clipsAt(p, 1).map((c) => c.id), [a.id]);
  assert.deepEqual(clipsAt(p, 2.5), []);
  assert.deepEqual(clipsAt(p, 2).map((c) => c.id), []);
  assert.equal(firstFreeStart(p, video.id, 1, 0), 2);
  assert.equal(firstFreeStart(p, video.id, 2, 0), 5);
  assert.deepEqual(trackClips(p, video.id).map(clipEnd), [2, 5]);
  assert.equal(b.start, 3);
});

test('comando desconocido lanza CommandError controlado', () => {
  const { store } = setup();
  assert.equal(store.dispatch({ type: 'nada' }).error.code, 'unknown');
  assert.throws(() => reduce(store.getProject(), { type: 'nada' }), /desconocido/);
});

test('persistencia: guardar, listar, cargar, borrar y autosave', async () => {
  const repo = createRepo(createMemoryBackend());
  const { store } = setup();
  await repo.save(store.getProject());
  await repo.putMedia('ast_x', new Uint8Array([1, 2, 3]));
  assert.equal((await repo.list())[0].name, 'T');
  assert.equal((await repo.load(store.getProject().id)).name, 'T');
  assert.equal(await repo.load('nope'), null);
  const stop = autosave(store, repo, { delay: 5 });
  store.dispatch({ type: 'project/rename', name: 'Nuevo' });
  store.select([]);
  await stop();
  assert.equal((await repo.load(store.getProject().id)).name, 'Nuevo');
  await repo.remove(store.getProject());
  assert.equal(await repo.load(store.getProject().id), null);
});
