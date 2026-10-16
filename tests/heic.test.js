import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import factory from '../vendor/libheif-bundle.mjs';
import { detectKind, validateFile } from '../src/library/kinds.js';
import { decodeHeic, isHeic } from '../src/library/heic.js';

const bytes = readFileSync(new URL('./fixtures/colores.heic', import.meta.url));
const heic = (name, type = '') => new File([bytes], name, { type });

test('HEIC se reconoce por tipo, por extensión y por la marca del archivo', async () => {
  assert.equal(await isHeic(heic('a.bin', 'image/heic')), true);
  assert.equal(await isHeic(heic('IMG_0001.HEIC')), true);
  assert.equal(await isHeic(heic('foto-sin-extension')), true, 'por los primeros bytes');
  assert.equal(await isHeic(heic('x.bin', 'application/octet-stream')), true);
  assert.equal(await isHeic(new File([new Uint8Array(32)], 'x.jpg', { type: 'image/jpeg' })), false);
  assert.equal(await isHeic(new File([bytes], 'x.mp4', { type: 'video/mp4' })), false, 'un vídeo no se confunde');
  assert.equal(await isHeic(new File([], 'vacio')), false);
});

test('HEIC cuenta como imagen y pasa la validación', () => {
  assert.equal(detectKind(heic('IMG_1.heic')), 'image');
  assert.equal(detectKind(heic('IMG_1.HEIF')), 'image');
  assert.equal(detectKind(heic('IMG_1.hif', 'image/heif')), 'image');
  assert.deepEqual(validateFile(heic('IMG_1.heic')), { ok: true, kind: 'image' });
});

test('decodeHeic devuelve los píxeles correctos', async () => {
  const { data, width, height } = await decodeHeic(heic('colores.heic'), () => factory());
  assert.equal(width, 640);
  assert.equal(height, 480);
  const px = (x, y) => [...data.slice((y * width + x) * 4, (y * width + x) * 4 + 3)];
  const near = (a, b) => a.every((v, i) => Math.abs(v - b[i]) <= 12);
  assert.ok(near(px(10, 10), [220, 30, 30]), `rojo: ${px(10, 10)}`);
  assert.ok(near(px(600, 10), [30, 160, 60]), `verde: ${px(600, 10)}`);
  assert.ok(near(px(320, 240), [30, 60, 220]), `azul: ${px(320, 240)}`);
});

test('un archivo que no es HEIC falla con un error, no se cuelga', async () => {
  await assert.rejects(decodeHeic(new File([new Uint8Array(200)], 'roto.heic'), () => factory()));
});
