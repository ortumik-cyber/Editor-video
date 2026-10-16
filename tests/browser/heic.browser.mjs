// Fotos HEIC del iPhone: se convierten a JPEG al importarlas si el navegador no las abre.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { launch, makeMedia } from './helpers.mjs';

const dir = makeMedia();
const heic = readFileSync(new URL('../fixtures/colores.heic', import.meta.url));
const app = await launch({ viewport: { width: 1100, height: 800 } });
const { page } = app;
try {
  await page.goto(`${app.base}/index.html`);
  await page.waitForSelector('#app[data-ready="true"]');
  await page.locator('.home__top [data-act="new"]').click();
  await page.locator('.dlg__btn--primary').click();
  await page.waitForSelector('.editor');
  const native = await page.evaluate(async (b) => { try { (await createImageBitmap(new Blob([new Uint8Array(b)], { type: 'image/heic' }))).close(); return true; } catch { return false; } }, [...heic]);
  assert.equal(native, false, 'este Chromium no abre HEIC por sí solo: se prueba la conversión');

  // Un lote mezclado: HEIC bueno, HEIC roto y un PNG.
  await page.setInputFiles('.media__file', [
    { name: 'IMG_0001.HEIC', mimeType: 'image/heic', buffer: heic },
    { name: 'roto.heic', mimeType: 'image/heic', buffer: Buffer.alloc(300, 7) },
    { name: 'foto.png', mimeType: 'image/png', buffer: readFileSync(join(dir, 'foto.png')) },
  ]);
  await page.waitForFunction(() => document.querySelectorAll('.media__grid > li').length === 2, null, { timeout: 30000 });
  await page.waitForSelector('.toast');
  assert.match(await page.locator('.toast').first().textContent(), /No se pudo convertir roto\.heic/);

  const info = await page.evaluate(async () => {
    const { store } = editorApp.editor;
    const a = Object.values(store.getProject().assets).find((x) => x.name === 'IMG_0001.jpg');
    if (!a) return { names: Object.values(store.getProject().assets).map((x) => x.name) };
    const blob = await editorApp.repo.getMedia(a.id);
    const bmp = await createImageBitmap(blob);
    const c = new OffscreenCanvas(bmp.width, bmp.height); const g = c.getContext('2d'); g.drawImage(bmp, 0, 0);
    const px = (x, y) => [...g.getImageData(x, y, 1, 1).data].slice(0, 3);
    return { kind: a.kind, mime: a.mime, w: a.width, h: a.height, hasThumb: a.hasThumb, type: blob.type, red: px(10, 10), green: px(600, 10), blue: px(320, 240) };
  });
  assert.ok(!info.names, `no se importó la foto: ${info.names}`);
  assert.equal(info.kind, 'image');
  assert.equal(info.type, 'image/jpeg');
  assert.deepEqual([info.w, info.h], [640, 480]);
  assert.ok(info.hasThumb, 'tiene miniatura');
  const near = (a, b) => a.every((v, i) => Math.abs(v - b[i]) <= 25);
  assert.ok(near(info.red, [220, 30, 30]), `rojo ${info.red}`);
  assert.ok(near(info.green, [30, 160, 60]), `verde ${info.green}`);
  assert.ok(near(info.blue, [30, 60, 220]), `azul ${info.blue}`);

  // La foto convertida se puede poner en el vídeo y se dibuja.
  await page.locator('.media__grid > li', { hasText: 'IMG_0001' }).locator('[data-act="add"]').click();
  assert.equal(Object.values(await page.evaluate(() => editorApp.editor.store.getProject().clips)).length, 1);
  // El visor puede dibujar con WebGL: se mira una captura del lienzo y se cuentan píxeles de colores vivos.
  const coloured = async () => {
    const shot = (await page.locator('.pv__canvas').screenshot()).toString('base64');
    return page.evaluate(async (b64) => {
      const bmp = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
      const c = new OffscreenCanvas(bmp.width, bmp.height); const g = c.getContext('2d'); g.drawImage(bmp, 0, 0);
      const d = g.getImageData(0, 0, bmp.width, bmp.height).data; let n = 0;
      for (let i = 0; i < d.length; i += 4) if (Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2]) > 80) n++;
      return n;
    }, shot);
  };
  const deadline = Date.now() + 15000;
  let n = 0;
  while (Date.now() < deadline && (n = await coloured()) < 2000) await page.waitForTimeout(300);
  assert.ok(n >= 2000, `el lienzo muestra la foto (píxeles de color: ${n})`);
  assert.deepEqual(app.errors.filter((e) => !/Failed to load resource/.test(e)), []);
  console.log('heic.browser: OK');
} finally {
  await app.close();
}
