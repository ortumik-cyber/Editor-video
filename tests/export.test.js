import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  AUDIO_BITRATE, QUALITIES, RESOLUTIONS, estimateBytes, exportProblem, exportSize, fileName, formatBytes, frameCount, frameTimestamp, suggestBitrate,
} from '../src/export/settings.js';
import { FORMATS, pickFormat } from '../src/export/formats.js';
import { timeStretch } from '../src/audio/stretch.js';

const SR = 44100;
const sine = (freq, seconds, amp = 0.5) => Float32Array.from({ length: Math.round(seconds * SR) }, (_, i) => amp * Math.sin((2 * Math.PI * freq * i) / SR));
const rms = (a, from, to) => { let s = 0; for (let i = from; i < to; i++) s += a[i] * a[i]; return Math.sqrt(s / (to - from)); };
const freqOf = (a, from, to) => { let n = 0; for (let i = from + 1; i < to; i++) if ((a[i - 1] < 0) !== (a[i] < 0)) n++; return (n / (to - from)) * SR / 2; };

test('exportSize: lado corto exacto, proporción del proyecto y lados pares', () => {
  assert.deepEqual(exportSize(1080, 1920, 720), { width: 720, height: 1280 });
  assert.deepEqual(exportSize(1920, 1080, 720), { width: 1280, height: 720 });
  assert.deepEqual(exportSize(1080, 1080, 480), { width: 480, height: 480 });
  assert.deepEqual(exportSize(1080, 1350, 1080), { width: 1080, height: 1350 });
  const odd = exportSize(1080, 1920, 481);
  assert.ok(odd.width % 2 === 0 && odd.height % 2 === 0);
  assert.equal(exportSize(1080, 1920, 99999).height, 4096, 'tope de 4096');
  for (const r of RESOLUTIONS) { const s = exportSize(1080, 1920, r.short); assert.equal(Math.min(s.width, s.height), r.short); }
});

test('bitrate, tamaño estimado, fotogramas y nombre de archivo', () => {
  assert.equal(suggestBitrate(1080, 1920, 30, 'normal'), Math.round(1080 * 1920 * 30 * 0.09));
  assert.ok(suggestBitrate(1080, 1920, 30, 'high') > suggestBitrate(1080, 1920, 30, 'normal'));
  assert.ok(suggestBitrate(1080, 1920, 30, 'small') < suggestBitrate(1080, 1920, 30, 'normal'));
  assert.equal(suggestBitrate(64, 64, 24), 300_000, 'mínimo');
  assert.equal(suggestBitrate(4096, 4096, 60, 'high'), 40_000_000, 'máximo');
  assert.equal(suggestBitrate(10, 10, 10, 'inexistente'), suggestBitrate(10, 10, 10, 'normal'));
  assert.equal(estimateBytes(8_000_000, 10, false), 10_000_000);
  assert.equal(estimateBytes(8_000_000, 10), Math.round(((8_000_000 + AUDIO_BITRATE) * 10) / 8));
  assert.equal(frameCount(3, 30), 90);
  assert.equal(frameCount(3.01, 30), 91);
  assert.equal(frameCount(0.001, 30), 1);
  assert.equal(frameTimestamp(1, 30), 33333);
  assert.equal(frameTimestamp(30, 30), 1_000_000);
  assert.equal(fileName('Mi vídeo: ¡Año Nuevo!', 'mp4'), 'mi-video-ano-nuevo.mp4');
  assert.equal(fileName('???', 'webm'), 'video.webm');
  assert.equal(formatBytes(500), '1 KB');
  assert.equal(formatBytes(2.5 * 1024 * 1024), '2.5 MB');
  assert.equal(formatBytes(50 * 1024 * 1024), '50 MB');
  assert.equal(formatBytes(3 * 1024 ** 3), '3.0 GB');
  assert.ok(QUALITIES.length === 3);
});

test('exportProblem: vacío, demasiado largo, demasiados fotogramas', () => {
  const project = { settings: { width: 1080, height: 1920 } };
  assert.match(exportProblem(project, 0, { fps: 30, short: 720 }), /vacía/);
  assert.equal(exportProblem(project, 10, { fps: 30, short: 720 }), null);
  assert.match(exportProblem(project, 3601, { fps: 30, short: 720 }), /una hora/);
  assert.match(exportProblem(project, 3600, { fps: 60, short: 720 }), /fotogramas/);
});

test('pickFormat: el primero compatible; sin audio no exige códec de audio; prefer fuerza uno', async () => {
  const supports = (videoCodecs, audioCodecs) => ({ video: async (c) => videoCodecs.some((v) => c.codec.startsWith(v)), audio: async (c) => audioCodecs.includes(c.codec) });
  const base = { width: 720, height: 1280, fps: 30, bitrate: 4_000_000 };
  let r = await pickFormat({ ...base, probe: supports(['avc1', 'vp09'], ['mp4a.40.2', 'opus']) });
  assert.equal(r.format.id, 'mp4-h264');
  assert.equal(r.video.codec, 'avc1.64001f');
  r = await pickFormat({ ...base, probe: supports(['vp09', 'vp8'], ['opus']) });
  assert.equal(r.format.id, 'webm-vp9', 'sin H.264 cae a WebM');
  r = await pickFormat({ ...base, probe: supports(['avc1', 'vp09'], ['opus']) });
  assert.equal(r.format.id, 'webm-vp9', 'H.264 sin AAC no sirve si hay audio');
  r = await pickFormat({ ...base, withAudio: false, probe: supports(['avc1'], []) });
  assert.equal(r.format.id, 'mp4-h264', 'sin audio no se exige AAC');
  r = await pickFormat({ ...base, probe: supports(['vp8'], ['opus']) });
  assert.equal(r.format.id, 'webm-vp8');
  assert.equal(await pickFormat({ ...base, probe: supports([], []) }), null);
  r = await pickFormat({ ...base, prefer: 'mp4-vp9', probe: supports(['avc1', 'vp09'], ['mp4a.40.2', 'opus']) });
  assert.equal(r.format.id, 'mp4-vp9', 'un formato no automático solo sale si se pide');
  assert.equal((await pickFormat({ ...base, probe: supports(['vp09'], ['opus']) })).format.id === 'mp4-vp9', false);
  assert.equal((await pickFormat({ width: 1920, height: 1080, fps: 30, bitrate: 1, probe: supports(['avc1'], ['mp4a.40.2']) })).video.codec, 'avc1.640028');
  assert.equal((await pickFormat({ width: 3840, height: 2160, fps: 30, bitrate: 1, probe: supports(['avc1'], ['mp4a.40.2']) })).video.codec, 'avc1.640033');
  assert.equal(new Set(FORMATS.map((f) => f.id)).size, FORMATS.length);
});

test('timeStretch: duración escalada y tono conservado (2×, 0,5×, 4×, 0,25×)', () => {
  const input = sine(440, 1.5);
  for (const speed of [2, 0.5, 4, 0.25, 1.5, 0.8]) {
    const [out] = timeStretch([input], SR, speed);
    near(out.length, Math.floor(input.length / speed), 1, `duración a ${speed}×`);
    const mid = Math.floor(out.length * 0.2);
    const end = Math.floor(out.length * 0.8);
    const f = freqOf(out, mid, end);
    assert.ok(Math.abs(f - 440) < 440 * 0.02, `a ${speed}× el tono sigue en ${f.toFixed(1)} Hz`);
    const level = rms(out, mid, end);
    assert.ok(Math.abs(level - rms(input, 0, input.length)) < 0.12 * rms(input, 0, input.length), `a ${speed}× el nivel se conserva (${level.toFixed(3)})`);
    for (const v of out) assert.ok(Number.isFinite(v) && Math.abs(v) < 0.8);
  }
});

function near(a, b, tol, msg) { assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} no es ${b} ±${tol}`); }

test('timeStretch: velocidad 1 devuelve una copia, estéreo conserva los canales y entradas cortas no fallan', () => {
  const a = sine(300, 0.3);
  const [same] = timeStretch([a], SR, 1);
  assert.deepEqual(same, a);
  assert.notEqual(same, a, 'es una copia');
  const left = sine(440, 1);
  const right = sine(880, 1);
  const [l, r] = timeStretch([left, right], SR, 2);
  assert.equal(l.length, r.length);
  assert.ok(Math.abs(freqOf(l, 3000, 18000) - 440) < 12);
  assert.ok(Math.abs(freqOf(r, 3000, 18000) - 880) < 20, 'cada canal conserva su tono');
  const tiny = timeStretch([new Float32Array(10).fill(0.3)], SR, 2)[0];
  assert.equal(tiny.length, 5);
  assert.equal(timeStretch([new Float32Array(1)], SR, 3)[0].length, 1, 'nunca devuelve vacío');
  assert.throws(() => timeStretch([a], SR, 0), RangeError);
});

test('timeStretch: sigue una subida de frecuencia (el contenido temporal se conserva)', () => {
  const T = 2;
  const chirp = Float32Array.from({ length: T * SR }, (_, i) => { const t = i / SR; return 0.5 * Math.sin(2 * Math.PI * (200 * t + (300 * t * t) / T)); });
  const [out] = timeStretch([chirp], SR, 2);
  const early = freqOf(out, Math.floor(out.length * 0.1), Math.floor(out.length * 0.25));
  const late = freqOf(out, Math.floor(out.length * 0.75), Math.floor(out.length * 0.9));
  assert.ok(late > early * 1.8, `la subida se conserva: ${early.toFixed(0)} → ${late.toFixed(0)} Hz`);
});

test('los muxers vendorizados existen, son los fijados y no tocan la red', () => {
  for (const name of ['mp4-muxer', 'webm-muxer']) {
    const code = readFileSync(new URL(`../vendor/${name}.mjs`, import.meta.url), 'utf8');
    assert.match(code, /export\s*\{[^}]*Muxer/);
    assert.doesNotMatch(code, /\bfetch\(|XMLHttpRequest|\beval\(|new Function|WebSocket|sendBeacon/);
    assert.ok(readFileSync(new URL(`../vendor/${name}.LICENSE`, import.meta.url), 'utf8').includes('MIT License'));
  }
  assert.match(readFileSync(new URL('../vendor/README.md', import.meta.url), 'utf8'), /5\.2\.2[\s\S]*5\.1\.4/);
});

import { createAsset, createClip, createProject, createStore } from '../src/core/index.js';
import { buildAudioSchedule } from '../src/export/mix.js';
import { mediaPlan } from '../src/player/plan.js';

function scene() {
  const store = createStore(createProject());
  const [video, , audio] = store.getProject().tracks;
  const movie = createAsset({ kind: 'video', name: 'v', duration: 20, width: 100, height: 100, hasAudio: true });
  const silent = createAsset({ kind: 'video', name: 's', duration: 20, width: 100, height: 100, hasAudio: false });
  const song = createAsset({ kind: 'audio', name: 'm', duration: 60 });
  for (const asset of [movie, silent, song]) store.dispatch({ type: 'asset/add', asset });
  const add = (trackId, kind, assetId, start, duration, inPoint = 0) => {
    const clip = createClip({ trackId, kind, assetId, start, duration, in: inPoint });
    assert.ok(store.dispatch({ type: 'clip/add', clip }).ok);
    return clip;
  };
  return { store, video, audio, movie, silent, song, add };
}

test('calendario de mezcla: una entrada por clip con sonido, con su ganancia exacta en el tiempo', () => {
  const { store, video, audio, movie, silent, song, add } = scene();
  const v = add(video.id, 'video', movie.id, 0, 4, 2);
  add(video.id, 'video', silent.id, 4, 2);
  const a = add(audio.id, 'audio', song.id, 1, 3);
  store.dispatch({ type: 'clip/update', clipId: a.id, patch: { volume: 0.5, fadeIn: 1, fadeOut: 1 } });
  const p = store.getProject();
  const schedule = buildAudioSchedule(p);
  assert.deepEqual(schedule.map((e) => e.clipId).sort(), [a.id, v.id].sort(), 'el vídeo sin audio no aparece');
  const music = schedule.find((e) => e.clipId === a.id);
  assert.deepEqual([music.t0, music.srcTime0, music.offset], [1, 0, 0]);
  assert.ok(Math.abs(music.t1 - 4) < 0.006);
  for (const t of [1.0, 1.5, 2, 2.5, 3, 3.5, 3.99]) {
    const k = Math.round((t - music.t0) / music.step);
    const expected = mediaPlan(p, t).find((i) => i.clip.id === a.id).gain;
    assert.ok(Math.abs(music.gains[k] - expected) < 1e-6, `ganancia en ${t}: ${music.gains[k]} vs ${expected}`);
  }
  assert.ok(Math.abs(music.gains[Math.round(0.5 / music.step)] - 0.25) < 1e-6, 'fundido de entrada a la mitad: 0,5 x 0,5');
  const video0 = schedule.find((e) => e.clipId === v.id);
  assert.equal(video0.srcTime0, 2, 'el punto de entrada del vídeo');
});

test('calendario de mezcla: pista silenciada o volumen 0 no generan entradas; la velocidad escala el desplazamiento', () => {
  const { store, video, audio, movie, song, add } = scene();
  const v = add(video.id, 'video', movie.id, 0, 3, 4);
  const a = add(audio.id, 'audio', song.id, 0, 3, 6);
  store.dispatch({ type: 'clip/update', clipId: a.id, patch: { speed: 2 } });
  const fast = buildAudioSchedule(store.getProject()).find((e) => e.clipId === a.id);
  assert.deepEqual([fast.speed, fast.srcTime0, fast.offset], [2, 6, 3], 'el audio estirado empieza en 6 / 2 = 3 s');
  store.dispatch({ type: 'track/update', trackId: audio.id, patch: { muted: true } });
  assert.equal(buildAudioSchedule(store.getProject()).some((e) => e.clipId === a.id), false, 'pista silenciada');
  store.dispatch({ type: 'clip/update', clipId: v.id, patch: { volume: 0 } });
  assert.deepEqual(buildAudioSchedule(store.getProject()), [], 'todo en silencio: nada que mezclar');
});

test('calendario de mezcla: la transición extiende los dos clips y suma potencia constante', () => {
  const { store, video, movie, add } = scene();
  const a = add(video.id, 'video', movie.id, 0, 4);
  const b = add(video.id, 'video', movie.id, 4, 4, 6);
  store.dispatch({ type: 'clip/update', clipId: b.id, patch: { transition: { type: 'dissolve', duration: 1 } } });
  const schedule = buildAudioSchedule(store.getProject());
  const sa = schedule.find((e) => e.clipId === a.id);
  const sb = schedule.find((e) => e.clipId === b.id);
  assert.ok(sa.t1 > 4.4, `A suena hasta ${sa.t1} (pasa de su final en 4)`);
  assert.ok(sb.t0 < 3.6, `B empieza a sonar en ${sb.t0} (antes de su inicio en 4)`);
  assert.ok(sb.srcTime0 < 6, 'con material anterior al punto de entrada');
  const at = (entry, t) => entry.gains[Math.round((t - entry.t0) / entry.step)];
  for (const t of [3.6, 3.8, 4.0, 4.2, 4.4]) assert.ok(Math.abs(at(sa, t) ** 2 + at(sb, t) ** 2 - 1) < 1e-6, `potencia constante en ${t}`);
});
