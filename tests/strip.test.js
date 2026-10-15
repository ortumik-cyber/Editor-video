import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stripLayout } from '../src/timeline/geometry.js';
import { stripFrames, stripTimes } from '../src/library/waveform.js';

test('la tira cubre el medio entero cuando el clip lo muestra completo', () => {
  assert.deepEqual(stripLayout({ assetDuration: 10, inPoint: 0, span: 10, width: 800 }), { size: 800, x: 0 });
});

test('un clip recortado ve solo su tramo: la tira se ensancha y se desplaza', () => {
  // Tramo de 2 s a 8 s (span 4) de un medio de 10 s en 400 px: el medio entero mediría 1000 px.
  const { size, x } = stripLayout({ assetDuration: 10, inPoint: 2, span: 4, width: 400 });
  assert.equal(size, 1000);
  assert.equal(x, -200);
  // El instante 2 s cae en el borde izquierdo del clip y el 6 s en el derecho.
  assert.equal(x + (2 / 10) * size, 0);
  assert.equal(x + (6 / 10) * size, 400);
});

test('con velocidad el tramo de origen es mayor que la duración del clip', () => {
  // Clip de 2 s a 2x consume 4 s de origen.
  const { size } = stripLayout({ assetDuration: 8, inPoint: 0, span: 4, width: 200 });
  assert.equal(size, 400);
});

test('datos degenerados no producen NaN', () => {
  assert.deepEqual(stripLayout({ assetDuration: 0, inPoint: 0, span: 3, width: 90 }), { size: 90, x: 0 });
  assert.deepEqual(stripLayout({ assetDuration: 5, inPoint: 0, span: 0, width: 90 }), { size: 90, x: 0 });
});

test('fotogramas de la tira: entre 4 y 16, repartidos por el centro de cada tramo', () => {
  assert.equal(stripFrames(1), 4);
  assert.equal(stripFrames(20), 10);
  assert.equal(stripFrames(600), 16);
  assert.deepEqual(stripTimes(8, 4), [1, 3, 5, 7]);
  const t = stripTimes(0.5);
  assert.ok(t.every((x) => x > 0 && x < 0.5) && t.length === 4);
});
