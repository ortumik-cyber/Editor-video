import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SAMPLE_RATE, SFX, encodeWav } from '../src/audio/sfx.js';

const rms = (a, from, to) => { let s = 0; for (let i = from; i < to; i++) s += a[i] * a[i]; return Math.sqrt(s / (to - from)); };
/** Cruces por cero por segundo en un tramo: estima la frecuencia dominante. */
const zeroCrossRate = (a, from, to) => { let n = 0; for (let i = from + 1; i < to; i++) if ((a[i - 1] < 0) !== (a[i] < 0)) n++; return (n / (to - from)) * SAMPLE_RATE / 2; };
const byId = Object.fromEntries(SFX.map((s) => [s.id, s]));

test('catálogo: ids únicos, etiquetas y duraciones razonables', () => {
  assert.equal(new Set(SFX.map((s) => s.id)).size, SFX.length);
  assert.ok(SFX.length >= 9);
  for (const s of SFX) { assert.ok(s.label.length > 2); assert.ok(s.duration > 0.03 && s.duration <= 1.5, s.id); }
});

test('cada efecto: longitud, pico 0,8, sin NaN, sin chasquidos al empezar ni al acabar, con energía', () => {
  for (const sfx of SFX) {
    const a = sfx.render();
    assert.equal(a.length, Math.round(sfx.duration * SAMPLE_RATE), `${sfx.id}: longitud`);
    let peak = 0;
    for (const v of a) { assert.ok(Number.isFinite(v), `${sfx.id}: NaN`); peak = Math.max(peak, Math.abs(v)); }
    assert.ok(Math.abs(peak - 0.8) < 1e-6, `${sfx.id}: pico ${peak}`);
    assert.ok(Math.abs(a[0]) < 0.01 && Math.abs(a.at(-1)) < 0.01, `${sfx.id}: arranca y termina en silencio`);
    assert.ok(rms(a, 0, a.length) > 0.03, `${sfx.id}: no es silencio`);
  }
});

test('determinismo: dos llamadas dan exactamente las mismas muestras', () => {
  for (const sfx of SFX) assert.deepEqual(sfx.render(), sfx.render(), sfx.id);
});

test('forma sonora: la campanilla decae, la subida sube y la bajada baja', () => {
  const ding = byId.ding.render();
  const n = ding.length;
  assert.ok(rms(ding, 0, 4410) > rms(ding, n - 4410, n) * 8, 'la campanilla se apaga');
  const rise = byId.rise.render();
  const q = Math.floor(rise.length / 4);
  assert.ok(zeroCrossRate(rise, rise.length - q, rise.length) > zeroCrossRate(rise, 0, q) * 3, 'la subida gana frecuencia');
  assert.ok(rms(rise, rise.length - q, rise.length) > rms(rise, 0, q) * 3, 'y volumen');
  const drop = byId.drop.render();
  const d = Math.floor(drop.length / 4);
  assert.ok(zeroCrossRate(drop, 0, d) > zeroCrossRate(drop, drop.length - d, drop.length) * 3, 'la bajada pierde frecuencia');
  const beat = byId.heartbeat.render();
  assert.ok(rms(beat, Math.round(0.22 * SAMPLE_RATE), Math.round(0.3 * SAMPLE_RATE)) > rms(beat, Math.round(0.12 * SAMPLE_RATE), Math.round(0.2 * SAMPLE_RATE)) * 2, 'dos golpes del latido');
  const pop = byId.pop.render();
  assert.ok(rms(pop, 0, 441) > rms(pop, pop.length - 441, pop.length) * 10, 'el pop es un golpe corto');
});

test('moneda: dos tonos, el segundo más agudo', () => {
  const coin = byId.coin.render();
  const first = zeroCrossRate(coin, 100, Math.round(0.07 * SAMPLE_RATE));
  const second = zeroCrossRate(coin, Math.round(0.1 * SAMPLE_RATE), Math.round(0.2 * SAMPLE_RATE));
  assert.ok(second > first * 1.2, `${first.toFixed(0)} Hz → ${second.toFixed(0)} Hz`);
  assert.ok(Math.abs(first - 988) < 60 && Math.abs(second - 1319) < 80);
});

test('encodeWav: cabecera RIFF correcta y datos recuperables', () => {
  const samples = new Float32Array([0, 0.5, -0.5, 1, -1, 2, -2]);
  const wav = encodeWav(samples, 22050);
  const v = new DataView(wav.buffer);
  const ascii = (o, n) => String.fromCharCode(...wav.slice(o, o + n));
  assert.equal(wav.length, 44 + samples.length * 2);
  assert.deepEqual([ascii(0, 4), ascii(8, 4), ascii(12, 4), ascii(36, 4)], ['RIFF', 'WAVE', 'fmt ', 'data']);
  assert.equal(v.getUint32(4, true), wav.length - 8);
  assert.deepEqual([v.getUint16(20, true), v.getUint16(22, true), v.getUint32(24, true), v.getUint32(28, true), v.getUint16(32, true), v.getUint16(34, true), v.getUint32(40, true)], [1, 1, 22050, 44100, 2, 16, 14]);
  const decoded = Array.from({ length: samples.length }, (_, i) => v.getInt16(44 + i * 2, true) / 32767);
  for (const [i, x] of [0, 0.5, -0.5, 1, -1, 1, -1].entries()) assert.ok(Math.abs(decoded[i] - x) < 2e-5, `muestra ${i}: ${decoded[i]} vs ${x}`);
});
