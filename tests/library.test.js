import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryBackend, createProject, createRepo, createStore } from '../src/core/index.js';
import {
  bucketsFor, computePeaks, createLibrary, detectKind, formatClock, formatDuration, thumbnailTime, validateFile,
} from '../src/library/index.js';

const file = (name, type = '', size = 1000) => ({ name, type, size });

test('detectKind: MIME primero, extensión como respaldo', () => {
  assert.equal(detectKind(file('a.mp4', 'video/mp4')), 'video');
  assert.equal(detectKind(file('a.weba', 'audio/webm')), 'audio');
  assert.equal(detectKind(file('foto.JPG', '')), 'image');
  assert.equal(detectKind(file('clip.mkv', '')), 'video');
  assert.equal(detectKind(file('notas.txt', 'text/plain')), null);
});

test('validateFile: vacío, grande y desconocido', () => {
  assert.equal(validateFile(file('a.mp4', 'video/mp4', 0)).code, 'empty');
  assert.equal(validateFile(file('a.mp4', 'video/mp4', 11), { maxBytes: 10 }).code, 'too_big');
  assert.equal(validateFile(file('a.doc')).code, 'unsupported');
  assert.deepEqual(validateFile(file('a.mp4', 'video/mp4')), { ok: true, kind: 'video' });
});

test('formatDuration', () => {
  assert.equal(formatDuration(0), '0:00');
  assert.equal(formatDuration(65.4), '1:05');
  assert.equal(formatDuration(3725), '1:02:05');
});

test('formatClock: m:ss.d sin redondeo hacia arriba', () => {
  assert.equal(formatClock(0), '0:00.0');
  assert.equal(formatClock(1.26), '0:01.2');
  assert.equal(formatClock(59.99), '0:59.9');
  assert.equal(formatClock(125.5), '2:05.5');
  assert.equal(formatClock(-3), '0:00.0');
});

test('computePeaks: máximo por tramo y entre canales', () => {
  const left = new Float32Array([0, 0.5, 0, 0, 0, 0, 0, 0]);
  const right = new Float32Array([0, 0, 0, 0, 0, 0, -1, 0]);
  assert.deepEqual(computePeaks([left, right], 4), [128, 0, 0, 255]);
  assert.deepEqual(computePeaks([new Float32Array(0)], 3), [0, 0, 0]);
  assert.equal(computePeaks([new Float32Array([2])], 1)[0], 255);
});

test('bucketsFor y thumbnailTime', () => {
  assert.equal(bucketsFor(1), 50);
  assert.equal(bucketsFor(60), 300);
  assert.equal(bucketsFor(6000), 1000);
  assert.equal(thumbnailTime(1), 0.5);
  assert.equal(thumbnailTime(30), 1);
});

function setup(inspect) {
  const store = createStore(createProject());
  const repo = createRepo(createMemoryBackend());
  let n = 0;
  const revoked = [];
  const urlApi = { createObjectURL: () => `blob:${n++}`, revokeObjectURL: (u) => revoked.push(u) };
  const library = createLibrary({ store, repo, adapters: { inspect }, urlApi });
  return { store, repo, library, revoked };
}

const okInspect = async (f, kind) => ({
  info: { duration: kind === 'image' ? 0 : 4.2, width: 640, height: 360 },
  thumb: kind === 'audio' ? null : new Uint8Array([1, 2, 3]),
  peaks: kind === 'image' ? null : [10, 20],
  hasAudio: kind !== 'image',
});

test('importFiles: registra medios, guarda archivo y miniatura, informa rechazos', async () => {
  const { store, repo, library } = setup(okInspect);
  const progress = [];
  const { added, rejected } = await library.importFiles(
    [file('a.mp4', 'video/mp4'), file('b.png', 'image/png'), file('c.mp3', 'audio/mpeg'), file('d.txt', 'text/plain')],
    { onProgress: (p) => progress.push(p.index) },
  );
  assert.deepEqual(added.map((a) => a.kind), ['video', 'image', 'audio']);
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].code, 'unsupported');
  assert.deepEqual(progress, [0, 1, 2, 3, 4]);
  const [video, image, audio] = added;
  assert.equal(video.duration, 4.2);
  assert.equal(image.duration, 0);
  assert.equal(audio.hasThumb, false);
  assert.deepEqual(video.peaks, [10, 20]);
  assert.ok(await repo.getMedia(video.id));
  assert.ok(await repo.getMedia(`${video.id}:thumb`));
  assert.equal(await repo.getMedia(`${audio.id}:thumb`), null);
  assert.equal(Object.keys(store.getProject().assets).length, 3);
});

test('importar un lote es un solo paso de historial', async () => {
  const { store, library } = setup(okInspect);
  await library.importFiles([file('a.mp4', 'video/mp4'), file('b.png', 'image/png')]);
  assert.equal(Object.keys(store.getProject().assets).length, 2);
  store.undo();
  assert.equal(Object.keys(store.getProject().assets).length, 0);
});

test('archivo ilegible o sin duración se rechaza sin tocar el proyecto', async () => {
  const bad = async (f) => { if (f.name === 'roto.mp4') throw new Error('codec'); return { info: { duration: 0 }, thumb: null, peaks: null, hasAudio: false }; };
  const { store, library, repo } = setup(bad);
  const { added, rejected } = await library.importFiles([file('roto.mp4', 'video/mp4'), file('cero.mp4', 'video/mp4')]);
  assert.equal(added.length, 0);
  assert.deepEqual(rejected.map((r) => r.code), ['unreadable', 'unreadable']);
  assert.equal(Object.keys(store.getProject().assets).length, 0);
  assert.deepEqual(await repo.pruneMedia(() => true), 0);
});

test('URLs en caché, miniatura solo si existe, revocación al borrar y al cerrar', async () => {
  const { library, revoked } = setup(okInspect);
  const { added: [video, , audio] } = await library.importFiles([file('a.mp4', 'video/mp4'), file('b.png', 'image/png'), file('c.mp3', 'audio/mpeg')]);
  const u1 = await library.getUrl(video.id);
  assert.equal(await library.getUrl(video.id), u1);
  assert.ok(await library.getThumbUrl(video.id));
  assert.equal(await library.getThumbUrl(audio.id), null);
  assert.equal(await library.getUrl('nope'), null);
  library.removeAsset(video.id);
  await library.collectGarbage();
  assert.ok(revoked.includes(u1));
  library.dispose();
});

test('collectGarbage borra medios huérfanos y respeta los vivos', async () => {
  const { store, library, repo } = setup(okInspect);
  const { added: [a, b] } = await library.importFiles([file('a.mp4', 'video/mp4'), file('b.mp4', 'video/mp4')]);
  library.removeAsset(a.id);
  assert.ok(await repo.getMedia(a.id));
  const removed = await library.collectGarbage();
  assert.equal(removed, 2);
  assert.equal(await repo.getMedia(a.id), null);
  assert.ok(await repo.getMedia(b.id));
  assert.ok(store.getProject().assets[b.id]);
});
