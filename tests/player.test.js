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

// ---------- efectos, recorte y transiciones ----------

import { EFFECTS, foldEffects, presetEffects, PRESETS, TRANSITIONS } from '../src/core/index.js';
import { flattenLayers, transitionWindow } from '../src/player/plan.js';
import { cropRect } from '../src/player/compose.js';

function twoClips() {
  const env = setup();
  const a = env.add(env.video.id, 'video', env.movie.id, 0, 4, 2);
  const b = env.add(env.video.id, 'video', env.movie.id, 4, 4, 5);
  return { ...env, a, b };
}

test('catálogo: efectos, filtros y transiciones coherentes', () => {
  for (const [type, e] of Object.entries(EFFECTS)) assert.ok(e.min < e.max && e.default >= e.min && e.default <= e.max, type);
  for (const p of PRESETS) for (const type of Object.keys(p.values)) assert.ok(EFFECTS[type], `${p.id}.${type}`);
  assert.equal(new Set(TRANSITIONS.map((t) => t.id)).size, TRANSITIONS.length);
  assert.deepEqual(presetEffects('mono', 0.5).find((e) => e.type === 'saturation'), { type: 'saturation', value: -0.5 });
  assert.equal(presetEffects('nada'), null);
  assert.equal(presetEffects('vivid', 0).every((e) => e.value === EFFECTS[e.type].default), true);
});

test('foldEffects: gana el último activo, ignora desactivados y desconocidos, recorta al rango', () => {
  const folded = foldEffects([
    { type: 'brightness', enabled: true, params: { value: 0.2 } },
    { type: 'brightness', enabled: true, params: { value: 0.4 } },
    { type: 'contrast', enabled: false, params: { value: 0.9 } },
    { type: 'blur', enabled: true, params: { value: 999 } },
    { type: 'inventado', enabled: true, params: { value: 1 } },
  ]);
  assert.equal(folded.brightness, 0.4);
  assert.equal(folded.contrast, 0);
  assert.equal(folded.blur, 30);
  assert.equal(folded.inventado, undefined);
  assert.equal(foldEffects().saturation, 0);
});

test('effect/set crea, actualiza y quita al volver al neutro; recorta valores', () => {
  const { store, video, movie, add } = setup();
  const c = add(video.id, 'video', movie.id, 0, 3);
  const fx = () => store.getProject().clips[c.id].effects;
  store.dispatch({ type: 'effect/set', clipId: c.id, effectType: 'saturation', value: 0.5 });
  store.dispatch({ type: 'effect/set', clipId: c.id, effectType: 'saturation', value: 0.7 });
  assert.equal(fx().length, 1);
  assert.equal(fx()[0].params.value, 0.7);
  store.dispatch({ type: 'effect/set', clipId: c.id, effectType: 'blur', value: 500 });
  assert.equal(fx().find((e) => e.type === 'blur').params.value, 30);
  store.dispatch({ type: 'effect/set', clipId: c.id, effectType: 'saturation', value: 0 });
  assert.deepEqual(fx().map((e) => e.type), ['blur']);
  assert.equal(store.dispatch({ type: 'effect/set', clipId: c.id, effectType: 'magia', value: 1 }).error.code, 'invalid');
  assert.equal(store.dispatch({ type: 'effect/set', clipId: c.id, effectType: 'blur', value: NaN }).error.code, 'invalid');
  assert.equal(store.dispatch({ type: 'effect/add', clipId: c.id, effect: { type: 'magia' } }).error.code, 'invalid');
});

test('effect/preset reemplaza los efectos y effect/clear los quita; deshacer los devuelve', () => {
  const { store, video, movie, add } = setup();
  const c = add(video.id, 'video', movie.id, 0, 3);
  store.dispatch({ type: 'effect/set', clipId: c.id, effectType: 'blur', value: 5 });
  store.dispatch({ type: 'effect/preset', clipId: c.id, presetId: 'vintage', intensity: 0.5 });
  const fx = store.getProject().clips[c.id].effects;
  assert.deepEqual(fx.map((e) => e.type).sort(), ['contrast', 'sepia', 'temperature', 'vignette']);
  assert.equal(fx.find((e) => e.type === 'sepia').params.value, 0.25);
  assert.equal(store.dispatch({ type: 'effect/preset', clipId: c.id, presetId: 'nada' }).error.code, 'invalid');
  store.dispatch({ type: 'effect/clear', clipId: c.id });
  assert.equal(store.getProject().clips[c.id].effects.length, 0);
  store.undo();
  assert.equal(store.getProject().clips[c.id].effects.length, 4);
});

test('recorte y volteo: validación y valores por defecto', () => {
  const { store, video, text, movie, add } = setup();
  const c = add(video.id, 'video', movie.id, 0, 3);
  assert.equal(store.getProject().clips[c.id].crop, null);
  assert.deepEqual(store.getProject().clips[c.id].flip, { h: false, v: false });
  assert.ok(store.dispatch({ type: 'clip/update', clipId: c.id, patch: { crop: { x: 0.25, y: 0, w: 0.5, h: 1 }, flip: { h: true, v: false } } }).ok);
  assert.equal(store.getProject().clips[c.id].flip.h, true);
  for (const crop of [{ x: 0.6, y: 0, w: 0.5, h: 1 }, { x: 0, y: 0, w: 0.01, h: 1 }, { x: -0.1, y: 0, w: 0.5, h: 0.5 }, { x: 0, y: 0, w: NaN, h: 1 }]) {
    assert.equal(store.dispatch({ type: 'clip/update', clipId: c.id, patch: { crop } }).error.code, 'invalid');
  }
  assert.ok(store.dispatch({ type: 'clip/update', clipId: c.id, patch: { crop: null } }).ok);
  const t = createClip({ trackId: text.id, kind: 'text', start: 0 });
  store.dispatch({ type: 'clip/add', clip: t });
  assert.equal(store.dispatch({ type: 'clip/update', clipId: t.id, patch: { crop: { x: 0, y: 0, w: 1, h: 1 } } }).error.code, 'kind');
  assert.deepEqual(cropRect(200, 100, { x: 0.25, y: 0.5, w: 0.5, h: 0.5 }), { sx: 50, sy: 50, sw: 100, sh: 50 });
  assert.deepEqual(cropRect(200, 100, null), { sx: 0, sy: 0, sw: 200, sh: 100 });
});

test('transición: validación de tipo, duración y vecino', () => {
  const { store, a, b } = twoClips();
  const set = (clipId, transition) => store.dispatch({ type: 'clip/update', clipId, patch: { transition } });
  assert.equal(set(a.id, { type: 'dissolve', duration: 0.6 }).error.code, 'no_neighbor');
  assert.equal(set(b.id, { type: 'magia', duration: 0.6 }).error.code, 'invalid');
  assert.equal(set(b.id, { type: 'dissolve', duration: 5 }).error.code, 'invalid');
  assert.equal(set(b.id, { type: 'dissolve', duration: 0.05 }).error.code, 'invalid');
  assert.ok(set(b.id, { type: 'slide-left', duration: 1 }).ok);
  assert.deepEqual(store.getProject().clips[b.id].transition, { type: 'slide-left', duration: 1 });
  assert.ok(set(b.id, null).ok);
  assert.equal(store.getProject().clips[b.id].transition, null);
});

test('transitionWindow: centrada en el corte y limitada por la duración de los clips', () => {
  const { store, a, b } = twoClips();
  store.dispatch({ type: 'clip/update', clipId: b.id, patch: { transition: { type: 'dissolve', duration: 1 } } });
  let win = transitionWindow(store.getProject(), store.getProject().clips[b.id]);
  assert.deepEqual([win.start, win.end, win.d, win.prev.id], [3.5, 4.5, 1, a.id]);
  store.dispatch({ type: 'clip/trim', clipId: b.id, edge: 'end', time: 4.4 });
  win = transitionWindow(store.getProject(), store.getProject().clips[b.id]);
  assert.equal(win.d, 0.4);
  assert.equal(transitionWindow(store.getProject(), store.getProject().clips[a.id]), null);
  store.dispatch({ type: 'clip/move', clipId: b.id, start: 6 });
  assert.equal(transitionWindow(store.getProject(), store.getProject().clips[b.id]), null, 'sin vecino pegado no hay transición');
});

test('visualPlan con transición: un solo elemento con las dos capas y progreso 0-1', () => {
  const { store, a, b } = twoClips();
  store.dispatch({ type: 'clip/update', clipId: b.id, patch: { transition: { type: 'dissolve', duration: 1 } } });
  const p = store.getProject();
  assert.deepEqual(visualPlan(p, 3.2).map((i) => i.kind), ['layer']);
  const before = visualPlan(p, 3.75);
  assert.deepEqual(before.map((i) => i.kind), ['transition']);
  assert.equal(before[0].progress, 0.25);
  assert.equal(before[0].outgoing.clip.id, a.id);
  assert.equal(before[0].incoming.clip.id, b.id);
  assert.equal(before[0].incoming.srcTime, 5 - 0.25, 'el clip entrante usa fotogramas anteriores a su entrada');
  const after = visualPlan(p, 4.25)[0];
  assert.equal(after.progress, 0.75);
  assert.equal(after.outgoing.srcTime, 2 + 4.25, 'el saliente sigue más allá de su final');
  assert.deepEqual(visualPlan(p, 4.5).map((i) => i.kind), ['layer']);
  assert.deepEqual(flattenLayers(before).map((l) => l.clip.id), [a.id, b.id]);
});

test('transición congela el primer o último fotograma si no hay material extra', () => {
  const env = setup();
  const a = env.add(env.video.id, 'video', env.movie.id, 0, 4, 16);
  const b = env.add(env.video.id, 'video', env.movie.id, 4, 4, 0);
  env.store.dispatch({ type: 'clip/update', clipId: b.id, patch: { transition: { type: 'wipe', duration: 1 } } });
  const p = env.store.getProject();
  const first = visualPlan(p, 3.6)[0];
  assert.equal(first.incoming.srcTime, 0, 'antes de la entrada, primer fotograma');
  const last = visualPlan(p, 4.4)[0];
  assert.ok(last.outgoing.srcTime <= 19.999 && last.outgoing.srcTime >= 19.99, 'tras el final, último fotograma del archivo');
  assert.ok(a);
});

test('mediaPlan y upcomingMedia incluyen los dos clips durante la ventana de transición', () => {
  const { store, a, b } = twoClips();
  store.dispatch({ type: 'clip/update', clipId: b.id, patch: { transition: { type: 'dissolve', duration: 1 } } });
  const p = store.getProject();
  assert.deepEqual(mediaPlan(p, 3.8).map((i) => i.clip.id).sort(), [a.id, b.id].sort());
  assert.equal(mediaPlan(p, 3.8).find((i) => i.clip.id === b.id).gain, 0, 'el entrante aún no suena');
  assert.equal(mediaPlan(p, 4.2).find((i) => i.clip.id === a.id).gain, 0, 'el saliente ya no suena');
  assert.equal(mediaPlan(p, 3.2).length, 1);
  assert.deepEqual(upcomingMedia(p, 2.6, 1).map((c) => c.id), [b.id], 'se precarga desde el inicio de la ventana');
  assert.deepEqual(upcomingMedia(p, 2.4, 1), []);
});
