import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAsset, createClip, createProject, createStore } from '../src/core/index.js';
import {
  GUTTER, clampZoom, contentWidth, rulerLabel, rulerStep, rulerTicks, waveformPath, xToTime, timeToX, zoomScroll,
} from '../src/timeline/geometry.js';
import { collectSnapPoints, nearestFreeStart, resolveMove, resolveTrim, snapRange, snapValue, trimBounds } from '../src/timeline/edit.js';
import { addAssetClip, addTextClip, deleteSelected, duplicateSelected, nudgeSelected, splitAtPlayhead } from '../src/timeline/actions.js';

function setup() {
  const store = createStore(createProject());
  const [video, text, audio] = store.getProject().tracks;
  const movie = createAsset({ kind: 'video', name: 'v', duration: 10, width: 640, height: 360, hasAudio: true });
  const song = createAsset({ kind: 'audio', name: 's', duration: 20 });
  const photo = createAsset({ kind: 'image', name: 'p', width: 100, height: 100 });
  for (const asset of [movie, song, photo]) store.dispatch({ type: 'asset/add', asset });
  return { store, video, text, audio, movie, song, photo };
}
const put = (store, trackId, assetId, start, duration, kind = 'video', inPoint = 0) => {
  const clip = createClip({ trackId, kind, assetId, start, duration, in: inPoint });
  assert.ok(store.dispatch({ type: 'clip/add', clip }).ok);
  return clip;
};

test('geometría: conversiones, zoom y ancho', () => {
  assert.equal(timeToX(2, 100), GUTTER + 200);
  assert.equal(xToTime(GUTTER + 250, 100), 2.5);
  assert.equal(xToTime(0, 100), 0);
  assert.equal(clampZoom(1), 8);
  assert.equal(clampZoom(9999), 480);
  assert.equal(contentWidth(0, 80, 300), GUTTER + 5 * 80);
  assert.equal(contentWidth(0, 80, 900), 900);
  assert.equal(contentWidth(10, 100, 300), GUTTER + 15 * 100);
  assert.equal(contentWidth(100, 10, 300), GUTTER + 125 * 10);
  const scroll = zoomScroll(500, 200, 100, 200);
  assert.equal(xToTime(scroll + 200, 200), xToTime(500 + 200, 100));
});

test('regla: paso, marcas y etiquetas', () => {
  assert.equal(rulerStep(100), 1);
  assert.equal(rulerStep(8), 10);
  assert.equal(rulerStep(480), 0.2);
  const ticks = rulerTicks(100, 3);
  assert.deepEqual(ticks.filter((t) => t.major).map((t) => t.label).slice(0, 4), ['0:00', '0:01', '0:02', '0:03']);
  assert.equal(ticks.filter((t) => !t.major).length > 0, true);
  assert.equal(rulerLabel(1.5, 0.5), '0:01.5');
  assert.equal(rulerLabel(75, 5), '1:15');
  assert.equal(rulerTicks(8, 100).filter((t) => t.major).length, 12);
});

test('waveformPath: barras, normalización y casos vacíos', () => {
  const d = waveformPath([0, 255, 0, 255], { assetDuration: 4, inPoint: 0, span: 4, width: 12, height: 20 });
  assert.equal((d.match(/M/g) ?? []).length, 4);
  assert.equal(waveformPath(null, { assetDuration: 4, inPoint: 0, span: 4, width: 12, height: 20 }), '');
  assert.equal(waveformPath([1], { assetDuration: 4, inPoint: 0, span: 4, width: 1, height: 20 }), '');
  const quiet = waveformPath([10, 10], { assetDuration: 2, inPoint: 0, span: 2, width: 6, height: 20 });
  assert.match(quiet, /V/);
});

test('imán: valor, rango y puntos', () => {
  assert.deepEqual(snapValue(2.04, [0, 2, 5], 0.1), { value: 2, point: 2 });
  assert.deepEqual(snapValue(3, [0, 2, 5], 0.1), { value: 3, point: null });
  assert.equal(snapRange(1.95, 1, [0, 3], 0.1).start, 2);
  assert.deepEqual(snapRange(0.5, 1, [0, 3], 0.1), { start: 0.5, point: null });
  const { store, video, movie } = setup();
  const a = put(store, video.id, movie.id, 1, 2);
  assert.deepEqual(collectSnapPoints(store.getProject(), { playhead: 7 }), [0, 1, 3, 7]);
  assert.deepEqual(collectSnapPoints(store.getProject(), { excludeClipId: a.id, playhead: 0 }), [0]);
});

test('nearestFreeStart y resolveMove: nunca solapa y respeta tipo y bloqueo', () => {
  const { store, video, text, movie, photo } = setup();
  const a = put(store, video.id, movie.id, 0, 3);
  const b = put(store, video.id, movie.id, 3, 3);
  const p = store.getProject();
  assert.equal(nearestFreeStart(p, video.id, 2, 1), 6);
  assert.equal(nearestFreeStart(p, video.id, 2, 7), 7);
  assert.equal(resolveMove(p, a.id, { rawStart: 3.5, trackId: video.id }).start, 6);
  assert.equal(resolveMove(p, a.id, { rawStart: 0.4, trackId: video.id }).start, 0);
  const far = resolveMove(p, a.id, { rawStart: 20, trackId: video.id });
  assert.equal(far.start, 20);
  const snapped = resolveMove(p, a.id, { rawStart: 6.05, trackId: video.id }, { threshold: 0.1 });
  assert.deepEqual([snapped.start, snapped.snapped], [6, true]);
  const wrong = resolveMove(p, a.id, { rawStart: 8, trackId: text.id });
  assert.equal(wrong.trackId, video.id);
  store.dispatch({ type: 'track/add', kind: 'video' });
  const upper = store.getProject().tracks.at(-1);
  assert.equal(resolveMove(store.getProject(), b.id, { rawStart: 0, trackId: upper.id }).trackId, upper.id);
  store.dispatch({ type: 'track/update', trackId: upper.id, patch: { locked: true } });
  assert.equal(resolveMove(store.getProject(), b.id, { rawStart: 0, trackId: upper.id }).trackId, video.id);
  assert.ok(photo);
});

test('trim: límites por vecinos, medio y duración mínima; el resultado siempre es aplicable', () => {
  const { store, video, movie } = setup();
  const a = put(store, video.id, movie.id, 0, 2);
  const b = put(store, video.id, movie.id, 3, 4, 'video', 2);
  const p = store.getProject();
  assert.deepEqual(trimBounds(p, b.id, 'start'), { min: 2, max: 6.9 });
  assert.deepEqual(trimBounds(p, a.id, 'end'), { min: 0.1, max: 3 });
  assert.deepEqual(trimBounds(p, b.id, 'end'), { min: 3.1, max: 11 });
  assert.equal(resolveTrim(p, b.id, 'start', -5).time, 2);
  assert.equal(resolveTrim(p, b.id, 'end', 99).time, 11);
  const snapped = resolveTrim(p, a.id, 'end', 2.95, { threshold: 0.1 });
  assert.deepEqual([snapped.time, snapped.snapped], [3, true]);
  for (const [clip, edge, raw] of [[b, 'start', 2.5], [b, 'end', 5.5], [a, 'end', 2.7], [a, 'end', 99]]) {
    const { time } = resolveTrim(store.getProject(), clip.id, edge, raw);
    assert.ok(store.dispatch({ type: 'clip/trim', clipId: clip.id, edge, time }).ok, `${edge} ${raw}`);
  }
});

test('acciones: añadir medios en la pista correcta y sin pisar', () => {
  const { store, movie, song, photo, video, audio } = setup();
  const first = addAssetClip(store, movie.id);
  const second = addAssetClip(store, movie.id);
  const p = store.getProject();
  assert.equal(p.clips[first.clipId].start, 0);
  assert.equal(p.clips[second.clipId].start, 10);
  assert.equal(p.clips[second.clipId].trackId, video.id);
  assert.deepEqual(store.getState().selection, [second.clipId]);
  const music = addAssetClip(store, song.id);
  assert.equal(store.getProject().clips[music.clipId].trackId, audio.id);
  const image = addAssetClip(store, photo.id, { at: 30 });
  assert.equal(store.getProject().clips[image.clipId].duration, 5);
  assert.equal(addAssetClip(store, 'nope').error.code, 'no_asset');
  const title = addTextClip(store, { text: { content: 'Hola' } });
  assert.equal(store.getProject().clips[title.clipId].text.content, 'Hola');
  store.dispatch({ type: 'track/update', trackId: audio.id, patch: { locked: true } });
  assert.equal(addAssetClip(store, song.id).error.code, 'no_track');
});

test('acciones: dividir, duplicar, borrar y empujar con el teclado', () => {
  const { store, movie, video } = setup();
  const { clipId } = addAssetClip(store, movie.id);
  assert.equal(splitAtPlayhead(store).error.code, 'bounds');
  store.setPlayhead(50);
  assert.equal(splitAtPlayhead(store).error.code, 'no_clip');
  store.setPlayhead(4);
  assert.ok(splitAtPlayhead(store).ok);
  const ids = store.getProject().tracks.find((t) => t.id === video.id).clipIds;
  assert.equal(ids.length, 2);
  assert.deepEqual(store.getState().selection, [ids[1]]);
  assert.equal(store.getProject().clips[clipId].duration, 4);
  assert.ok(duplicateSelected(store).ok);
  assert.equal(store.getProject().tracks[0].clipIds.length, 3);
  const copyId = store.getState().selection[0];
  assert.ok(nudgeSelected(store, 1).ok);
  assert.ok(nudgeSelected(store, 1).ok);
  assert.equal(store.getProject().clips[copyId].start, 12);
  store.undo();
  assert.equal(store.getProject().clips[copyId].start, 10, 'los empujones seguidos son un solo paso');
  assert.equal(store.getProject().tracks[0].clipIds.length, 3);
  store.undo();
  assert.equal(store.getProject().tracks[0].clipIds.length, 2);
  store.redo();
  store.select([copyId]);
  assert.ok(deleteSelected(store).ok);
  assert.equal(store.getProject().tracks[0].clipIds.length, 2);
  store.select([]);
  assert.equal(deleteSelected(store).error.code, 'no_selection');
  assert.equal(nudgeSelected(store, 1).error.code, 'no_selection');
});

import { addEmojiClip, addOverlayAsset, addStyledText } from '../src/timeline/actions.js';
import { EMOJI, STICKERS, TEXT_STYLES } from '../src/text/stickers.js';

test('textos: dos a la vez van a pistas distintas en vez de desplazarse', () => {
  const { store } = setup();
  const a = addTextClip(store, { text: { content: 'uno' } });
  store.setPlayhead(1);
  const b = addTextClip(store, { text: { content: 'dos' } });
  const p = store.getProject();
  assert.equal(p.clips[b.clipId].start, 1, 'empieza donde está el cursor');
  assert.notEqual(p.clips[a.clipId].trackId, p.clips[b.clipId].trackId, 'solapan en el tiempo: otra pista');
  assert.equal(p.tracks.filter((t) => t.kind === 'text').length, 2);
  store.setPlayhead(10);
  const c = addTextClip(store, { text: { content: 'tres' } });
  assert.equal(store.getProject().clips[c.clipId].trackId, p.clips[a.clipId].trackId, 'si cabe, reutiliza la primera pista');
  assert.equal(store.getProject().tracks.filter((t) => t.kind === 'text').length, 2, 'sin pista de más');
});

test('textos: una pista bloqueada se salta y se crea otra', () => {
  const { store, text } = setup();
  store.dispatch({ type: 'track/update', trackId: text.id, patch: { locked: true } });
  const r = addTextClip(store, { text: { content: 'hola' } });
  assert.ok(r.ok);
  assert.notEqual(store.getProject().clips[r.clipId].trackId, text.id);
});

test('addStyledText aplica el estilo validado; un estilo inválido no deja nada a medias', () => {
  const { store } = setup();
  const ok = addStyledText(store, { font: 'Bebas Neue', weight: 400, size: 200, color: '#ff0000' }, 'HOLA');
  const t = store.getProject().clips[ok.clipId].text;
  assert.deepEqual([t.content, t.font, t.size, t.color], ['HOLA', 'Bebas Neue', 200, '#ff0000']);
  const before = Object.keys(store.getProject().clips).length;
  const bad = addStyledText(store, { font: 'Comic Sans' });
  assert.equal(bad.ok, false);
  assert.equal(Object.keys(store.getProject().clips).length, before, 'el texto a medio crear se retira');
  for (const style of TEXT_STYLES) assert.ok(addStyledText(store, style.text, style.label).ok, `estilo ${style.id} es válido`);
});

test('emoji: texto grande sin sombra con animación de entrada', () => {
  const { store } = setup();
  const r = addEmojiClip(store, '🔥');
  const t = store.getProject().clips[r.clipId].text;
  assert.deepEqual([t.content, t.size, t.shadow, t.animIn], ['🔥', 260, false, 'pop']);
  assert.equal(new Set(EMOJI).size, EMOJI.length);
});

test('capas superpuestas: encima de la base, sin mover lo existente y reutilizando pistas libres', () => {
  const { store, video, photo, movie } = setup();
  const base = addAssetClip(store, movie.id);
  const first = addOverlayAsset(store, photo.id);
  let p = store.getProject();
  assert.equal(p.clips[base.clipId].start, 0);
  assert.notEqual(p.clips[first.clipId].trackId, video.id, 'no cae en la pista base');
  assert.equal(p.clips[first.clipId].start, 0);
  assert.equal(p.clips[first.clipId].transform.scale, 0.35);
  assert.equal(p.clips[first.clipId].duration, 3);
  const second = addOverlayAsset(store, photo.id);
  p = store.getProject();
  assert.notEqual(p.clips[second.clipId].trackId, p.clips[first.clipId].trackId, 'solapa con el primero: otra capa');
  store.setPlayhead(5);
  const third = addOverlayAsset(store, photo.id);
  assert.equal(store.getProject().clips[third.clipId].trackId, p.clips[first.clipId].trackId, 'cabe en la primera capa');
  assert.equal(addOverlayAsset(store, 'nada').error.code, 'no_asset');
  const song = createAsset({ kind: 'audio', name: 's', duration: 5 });
  store.dispatch({ type: 'asset/add', asset: song });
  assert.equal(addOverlayAsset(store, song.id).error.code, 'no_asset', 'el audio no es una capa');
  const vid = addOverlayAsset(store, movie.id, { at: 20 });
  assert.equal(store.getProject().clips[vid.clipId].duration, 10, 'un vídeo superpuesto dura lo que el archivo');
});

test('stickers: catálogo bien formado y sin recursos externos', () => {
  assert.ok(STICKERS.length >= 12);
  assert.equal(new Set(STICKERS.map((s) => s.id)).size, STICKERS.length);
  for (const s of STICKERS) {
    assert.match(s.svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="200" height="200" viewBox="0 0 200 200">.*<\/svg>$/s, s.id);
    assert.doesNotMatch(s.svg, /<script|href=|<image|<foreignObject|<text|onload|javascript:/i, `${s.id} sin contenido activo ni externo`);
    assert.ok(s.label.length > 2);
    const opens = (s.svg.match(/<(?!\/|!)[a-zA-Z]/g) ?? []).length;
    const closes = (s.svg.match(/<\/[a-zA-Z]+>/g) ?? []).length + (s.svg.match(/\/>/g) ?? []).length;
    assert.equal(opens, closes, `${s.id}: etiquetas equilibradas`);
  }
});
