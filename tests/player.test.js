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
  assert.deepEqual(wrapLines('palabralarguísima', 50, measure), ['palab', 'ralar', 'guísi', 'ma'], 'una palabra que no cabe se parte por caracteres');
  assert.deepEqual(wrapLines('hola palabralarga fin', 50, measure), ['hola', 'palab', 'ralar', 'ga', 'fin']);
  assert.deepEqual(wrapLines('😀😀😀😀😀😀', 40, (s) => [...s].length * 10), ['😀😀😀😀', '😀😀'], 'no parte un emoji por la mitad');
  assert.ok(wrapLines('x'.repeat(30), 1, () => 99).every((l) => l.length >= 1), 'siempre avanza aunque nada quepa');
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

import { centeredCrop, cropRatio } from '../src/effects/crop.js';

test('centeredCrop: recorte centrado a la proporción pedida', () => {
  assert.equal(centeredCrop(1600, 900, null), null);
  assert.equal(centeredCrop(1600, 900, 16 / 9), null);
  const square = centeredCrop(1600, 900, 1);
  assert.ok(Math.abs(square.w - 0.5625) < 1e-9 && square.h === 1 && Math.abs(square.x - 0.21875) < 1e-9 && square.y === 0);
  const tall = centeredCrop(1000, 1000, 9 / 16);
  assert.ok(Math.abs(tall.w - 0.5625) < 1e-9 && tall.h === 1);
  const wide = centeredCrop(1000, 1000, 2);
  assert.deepEqual([wide.w, wide.h, wide.x, wide.y], [1, 0.5, 0, 0.25]);
  assert.ok(Math.abs(cropRatio(1600, 900, square) - 1) < 1e-9);
  assert.ok(Math.abs(cropRatio(1600, 900, null) - 16 / 9) < 1e-9);
});

// ---------- texto y tipografías ----------

import { existsSync } from 'node:fs';
import { FONTS, FONT_IDS, ANIMATIONS, fontFileName, resolveWeight, textError } from '../src/core/index.js';

test('tipografías: cada peso declarado existe en assets/fonts y hay licencia', () => {
  for (const f of FONTS) {
    for (const w of f.weights) assert.ok(existsSync(new URL(`../assets/fonts/${fontFileName(f.id, w)}`, import.meta.url)), `${f.id} ${w}`);
    const slug = f.id.toLowerCase().replaceAll(' ', '-');
    assert.ok(existsSync(new URL(`../assets/fonts/licenses/${slug}.txt`, import.meta.url)), `licencia de ${f.id}`);
  }
  assert.equal(new Set(FONT_IDS).size, FONT_IDS.length);
  assert.equal(new Set(ANIMATIONS.map((a) => a.id)).size, ANIMATIONS.length);
  assert.equal(fontFileName('Bebas Neue', 400), 'bebas-neue-latin-400-normal.woff2');
});

test('resolveWeight: el peso disponible más cercano', () => {
  assert.equal(resolveWeight('Bebas Neue', 700), 400);
  assert.equal(resolveWeight('Inter', 700), 700);
  assert.equal(resolveWeight('Inter', 500), 400);
  assert.equal(resolveWeight('Inter', 600), 700);
  assert.equal(resolveWeight('Desconocida', 900), 900);
});

test('texto: validación completa desde clip/update', () => {
  const { store, text } = setup();
  const t = createClip({ trackId: text.id, kind: 'text', start: 0, duration: 2 });
  store.dispatch({ type: 'clip/add', clip: t });
  const set = (patch) => store.dispatch({ type: 'clip/update', clipId: t.id, patch: { text: patch } });
  assert.ok(set({ content: 'Ñandú ¿qué?', font: 'Bebas Neue', weight: 400, size: 120, color: '#ff00aa', align: 'left' }).ok);
  assert.equal(store.getProject().clips[t.id].text.font, 'Bebas Neue');
  for (const [patch, message] of [
    [{ font: 'Comic Sans' }, /Tipografía/], [{ size: 2 }, /tamaño/], [{ size: 9999 }, /tamaño/], [{ color: 'rojo' }, /Color/],
    [{ background: '#12' }, /Color/], [{ stroke: 5 }, /Color/], [{ align: 'justify' }, /Alineación/], [{ shadow: 'sí' }, /sombra/],
    [{ backgroundOpacity: 2 }, /opacidad/], [{ animIn: 'explotar' }, /Animación/], [{ animInDuration: 9 }, /duración/],
    [{ content: 'x'.repeat(501) }, /500/], [{ content: 42 }, /500/],
    [{ animIn: 'fade', animInDuration: 1.5, animOut: 'fade', animOutDuration: 1 }, /superan/],
  ]) {
    const r = set(patch);
    assert.equal(r.ok, false, JSON.stringify(patch));
    assert.match(r.error.message, message);
  }
  assert.ok(set({ animIn: 'fade', animInDuration: 1, animOut: 'none', animOutDuration: 3 }).ok, 'sin animación de salida su duración no cuenta');
  assert.equal(textError(store.getProject().clips[t.id].text, 2), null);
  const afterBad = store.getProject().clips[t.id].text;
  set({ size: 1 });
  assert.deepEqual(store.getProject().clips[t.id].text, afterBad, 'un parche inválido no cambia nada');
});

import { revealLines, textAnimation } from '../src/text/animation.js';

function textClip(overrides = {}) {
  const { store, text } = setup();
  const t = createClip({ trackId: text.id, kind: 'text', start: 10, duration: 4 });
  store.dispatch({ type: 'clip/add', clip: t });
  assert.ok(store.dispatch({ type: 'clip/update', clipId: t.id, patch: { text: overrides } }).ok);
  return store.getProject().clips[t.id];
}

test('textAnimation: sin animación el texto está intacto en todo el clip', () => {
  const clip = textClip();
  for (const t of [10, 10.2, 12, 13.9]) assert.deepEqual(textAnimation(clip, t), { opacity: 1, dx: 0, dy: 0, scale: 1, reveal: 1 });
});

test('textAnimation: entrada y salida con progreso, fuera de la ventana vuelve a lo normal', () => {
  const clip = textClip({ animIn: 'fade', animInDuration: 1, animOut: 'fade', animOutDuration: 1 });
  assert.equal(textAnimation(clip, 10).opacity, 0);
  const mid = textAnimation(clip, 10.5).opacity;
  assert.ok(mid > 0.5 && mid < 1, `ease-out a mitad: ${mid}`);
  assert.equal(textAnimation(clip, 11).opacity, 1);
  assert.equal(textAnimation(clip, 12).opacity, 1);
  assert.equal(textAnimation(clip, 14 - 1e-9).opacity < 1e-6, true, 'termina transparente');
  assert.ok(textAnimation(clip, 13.5).opacity > 0.5);
});

test('textAnimation: deslizamientos entran y salen en la dirección indicada', () => {
  const dirs = { 'slide-up': ['dy', 1], 'slide-down': ['dy', -1], 'slide-left': ['dx', 1], 'slide-right': ['dx', -1] };
  for (const [kind, [axis, sign]] of Object.entries(dirs)) {
    const clip = textClip({ animIn: kind, animInDuration: 1, animOut: kind, animOutDuration: 1 });
    const start = textAnimation(clip, 10);
    assert.ok(Math.abs(start[axis] - sign * 0.12) < 1e-9, `${kind} entra desde ${sign > 0 ? '+' : '-'}${axis}`);
    assert.equal(textAnimation(clip, 11)[axis], 0);
    const end = textAnimation(clip, 14 - 1e-9);
    assert.ok(Math.abs(end[axis] + sign * 0.12) < 1e-6, `${kind} sale hacia el lado contrario al de entrada`);
  }
});

test('textAnimation: rebote con sobrepaso, zoom y máquina de escribir', () => {
  const pop = textClip({ animIn: 'pop', animInDuration: 1 });
  assert.ok(Math.abs(textAnimation(pop, 10).scale) < 1e-9);
  const peak = Math.max(...Array.from({ length: 50 }, (_, i) => textAnimation(pop, 10 + i / 50).scale));
  assert.ok(peak > 1.02 && peak < 1.3, `sobrepaso: ${peak}`);
  assert.equal(textAnimation(pop, 11).scale, 1);
  const zoom = textClip({ animIn: 'zoom', animInDuration: 1 });
  assert.equal(textAnimation(zoom, 10).scale, 0.5);
  const type = textClip({ animIn: 'typewriter', animInDuration: 2 });
  assert.equal(textAnimation(type, 10).reveal, 0);
  assert.ok(Math.abs(textAnimation(type, 11).reveal - 0.5) < 1e-9, 'las letras salen a ritmo constante');
  assert.equal(textAnimation(type, 12).reveal, 1);
  assert.equal(textAnimation(type, 10).opacity, 1, 'la máquina de escribir no cambia la opacidad');
});

test('revealLines: reparte las letras por líneas y conserva la estructura', () => {
  assert.deepEqual(revealLines(['hola', 'mundo'], 1), ['hola', 'mundo']);
  assert.deepEqual(revealLines(['hola', 'mundo'], 0), ['', '']);
  assert.deepEqual(revealLines(['hola', 'mundo'], 0.5), ['hola', '']);
  assert.deepEqual(revealLines(['hola', 'mundo'], 0.7), ['hola', 'mu']);
  assert.deepEqual(revealLines([''], 0.5), ['']);
});
