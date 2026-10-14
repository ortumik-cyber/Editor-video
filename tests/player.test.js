import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAsset, createClip, createProject, createStore } from '../src/core/index.js';
import { fadeFactor, mediaPlan, sourceTime, upcomingMedia, visualPlan } from '../src/player/plan.js';
import { fitSize, layerGeometry, wrapLines } from '../src/player/compose.js';

function setup() {
  const store = createStore(createProject());
  const [video, text, audio] = store.getProject().tracks;
  const movie = createAsset({ kind: 'video', name: 'v', duration: 20, width: 1600, height: 900, hasAudio: true });
  const mute = createAsset({ kind: 'video', name: 'm', duration: 20, width: 100, height: 100, hasAudio: false });
  const song = createAsset({ kind: 'audio', name: 's', duration: 60 });
  for (const asset of [movie, mute, song]) store.dispatch({ type: 'asset/add', asset });
  const add = (trackId, kind, assetId, start, duration, inPoint = 0) => {
    const clip = createClip({ trackId, kind, assetId, start, duration, in: inPoint });
    assert.ok(store.dispatch({ type: 'clip/add', clip }).ok);
    return clip;
  };
  return { store, video, text, audio, movie, mute, song, add };
}

test('fadeFactor: rampas de entrada y salida, y cruce de ambas', () => {
  const { store, video, movie, add } = setup();
  const c = add(video.id, 'video', movie.id, 10, 4);
  store.dispatch({ type: 'clip/update', clipId: c.id, patch: { fadeIn: 2, fadeOut: 1 } });
  const clip = store.getProject().clips[c.id];
  assert.equal(fadeFactor(clip, 10), 0);
  assert.equal(fadeFactor(clip, 11), 0.5);
  assert.equal(fadeFactor(clip, 12), 1);
  assert.equal(fadeFactor(clip, 13.5), 0.5);
  assert.equal(fadeFactor({ ...clip, fadeIn: 0, fadeOut: 0 }, 10.01), 1);
  const both = { ...clip, fadeIn: 2, fadeOut: 2 };
  assert.equal(fadeFactor(both, 12), 1);
  assert.equal(fadeFactor(both, 13), 0.5);
  const overlapping = { start: 0, duration: 2, fadeIn: 1.5, fadeOut: 1.5 };
  assert.ok(Math.abs(fadeFactor(overlapping, 1) - 1 / 1.5) < 1e-9, 'con rampas cruzadas manda la más baja');
});

test('sourceTime: entrada + avance por velocidad; imagen y texto = 0', () => {
  const { store, video, movie, add } = setup();
  const c = add(video.id, 'video', movie.id, 5, 4, 3);
  assert.equal(sourceTime(store.getProject().clips[c.id], 6), 4);
  store.dispatch({ type: 'clip/update', clipId: c.id, patch: { speed: 2 } });
  assert.equal(sourceTime(store.getProject().clips[c.id], 6), 5);
  assert.equal(sourceTime({ kind: 'image', start: 0, in: 0, speed: 1 }, 3), 0);
});

test('visualPlan: orden de abajo arriba, límites del clip y opacidad con fundido', () => {
  const { store, video, text, movie, add } = setup();
  const base = add(video.id, 'video', movie.id, 0, 5);
  store.dispatch({ type: 'track/add', kind: 'video' });
  const upper = store.getProject().tracks.at(-1);
  const photo = createAsset({ kind: 'image', name: 'p', width: 10, height: 10 });
  store.dispatch({ type: 'asset/add', asset: photo });
  const over = add(upper.id, 'image', photo.id, 2, 2);
  const title = createClip({ trackId: text.id, kind: 'text', start: 1, duration: 3 });
  store.dispatch({ type: 'clip/add', clip: title });
  store.dispatch({ type: 'clip/update', clipId: over.id, patch: { fadeIn: 2, transform: { opacity: 0.5 } } });
  const p = store.getProject();
  assert.deepEqual(visualPlan(p, 0.5).map((l) => l.clip.id), [base.id]);
  assert.deepEqual(visualPlan(p, 3).map((l) => l.clip.kind), ['video', 'text', 'image']);
  assert.equal(visualPlan(p, 3).at(-1).opacity, 0.25);
  assert.deepEqual(visualPlan(p, 5), []);
  assert.deepEqual(visualPlan(p, 4).map((l) => l.clip.kind), ['video'], 'texto e imagen ya terminaron (fin exclusivo)');
});

test('mediaPlan: ganancia por volumen, fundido, silencio de pista y vídeo sin audio', () => {
  const { store, video, audio, movie, mute, song, add } = setup();
  const v = add(video.id, 'video', movie.id, 0, 10);
  const a = add(audio.id, 'audio', song.id, 0, 10);
  store.dispatch({ type: 'clip/update', clipId: a.id, patch: { volume: 0.5, fadeOut: 4 } });
  let plan = mediaPlan(store.getProject(), 8);
  assert.equal(plan.find((i) => i.clip.id === a.id).gain, 0.25);
  assert.equal(plan.find((i) => i.clip.id === v.id).gain, 1);
  store.dispatch({ type: 'track/update', trackId: audio.id, patch: { muted: true } });
  plan = mediaPlan(store.getProject(), 8);
  assert.equal(plan.find((i) => i.clip.id === a.id).gain, 0);
  store.dispatch({ type: 'clip/remove', clipId: v.id });
  const m = add(video.id, 'video', mute.id, 0, 3);
  const item = mediaPlan(store.getProject(), 1).find((i) => i.clip.id === m.id);
  assert.equal(item.hasAudio, false);
  assert.equal(item.gain, 0);
});

test('upcomingMedia: solo lo que empieza dentro del horizonte', () => {
  const { store, video, audio, movie, song, add } = setup();
  const a = add(video.id, 'video', movie.id, 5, 2);
  add(audio.id, 'audio', song.id, 20, 2);
  assert.deepEqual(upcomingMedia(store.getProject(), 4.5, 1).map((c) => c.id), [a.id]);
  assert.deepEqual(upcomingMedia(store.getProject(), 4.5, 0.2), []);
  assert.deepEqual(upcomingMedia(store.getProject(), 5, 1), []);
});

test('fitSize y layerGeometry: contain, cover, escala, desplazamiento y rotación', () => {
  assert.deepEqual(fitSize(1600, 900, 1080, 1920, 'contain'), { w: 1080, h: 607.5 });
  const cover = fitSize(1600, 900, 1080, 1920, 'cover');
  assert.ok(Math.abs(cover.h - 1920) < 1e-9 && Math.abs(cover.w - 3413.3333333333335) < 1e-6);
  const g = layerGeometry({ srcW: 1600, srcH: 900, fit: 'contain', transform: { x: 0.25, y: -0.1, scale: 0.5, rotation: 90, opacity: 1 } }, 1080, 1920);
  assert.deepEqual([g.cx, g.cy, g.w, g.h], [810, 768, 540, 303.75]);
  assert.ok(Math.abs(g.rotation - Math.PI / 2) < 1e-12);
});

test('wrapLines: ajusta por ancho y respeta saltos de línea', () => {
  const measure = (s) => s.length * 10;
  assert.deepEqual(wrapLines('hola mundo cruel', 100, measure), ['hola mundo', 'cruel']);
  assert.deepEqual(wrapLines('uno\ndos tres', 1000, measure), ['uno', 'dos tres']);
  assert.deepEqual(wrapLines('palabralarguísima', 50, measure), ['palabralarguísima']);
  assert.deepEqual(wrapLines('', 50, measure), ['']);
});

test('modelo: fit y fondo con validación', () => {
  const { store, video, movie, add } = setup();
  const c = add(video.id, 'video', movie.id, 0, 2);
  assert.equal(store.getProject().clips[c.id].fit, 'contain');
  assert.ok(store.dispatch({ type: 'clip/update', clipId: c.id, patch: { fit: 'cover' } }).ok);
  assert.equal(store.dispatch({ type: 'clip/update', clipId: c.id, patch: { fit: 'stretch' } }).error.code, 'invalid');
  assert.equal(store.getProject().settings.background, '#000000');
  assert.ok(store.dispatch({ type: 'project/settings', background: '#112233' }).ok);
  assert.equal(store.dispatch({ type: 'project/settings', background: 'rojo' }).error.code, 'invalid');
});
