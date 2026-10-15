// Pulido: tira de fotogramas en clips de vídeo, pellizco para el zoom y ayuda de atajos.
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { launch, makeMedia } from './helpers.mjs';

const dir = makeMedia();
const app = await launch({ viewport: { width: 390, height: 780 }, hasTouch: true });
const { page } = app;
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} no es ${b} ±${tol}`);
try {
  await page.goto(`${app.base}/index.html`);
  await page.waitForSelector('#app[data-ready="true"]');
  await page.locator('.home__top [data-act="new"]').click();
  await page.locator('.dlg__btn--primary').click();
  await page.waitForSelector('.editor');
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'barra superior sin desbordar');

  // ---------- tira de fotogramas ----------
  await page.click('#tab-media');
  await page.setInputFiles('.media__file', [join(dir, 'con_audio.webm'), join(dir, 'foto.png')]);
  await page.waitForFunction(() => document.querySelectorAll('.media__grid > li').length === 2, null, { timeout: 15000 });
  const info = await page.evaluate(async () => {
    const p = editorApp.editor.store.getProject();
    const video = Object.values(p.assets).find((a) => a.kind === 'video');
    const image = Object.values(p.assets).find((a) => a.kind === 'image');
    const blob = await editorApp.repo.getMedia(`${video.id}:strip`);
    const bmp = await createImageBitmap(blob);
    const read = (x) => { const c = new OffscreenCanvas(8, 8); const g = c.getContext('2d'); g.drawImage(bmp, x, 0, 8, 8, 0, 0, 8, 8); return [...g.getImageData(0, 0, 8, 8).data].join(); };
    return { w: bmp.width, h: bmp.height, first: read(10), last: read(bmp.width - 20), imageStrip: await editorApp.repo.getMedia(`${image.id}:strip`) };
  });
  assert.equal(info.h, 72);
  assert.equal(info.w, 4 * 128, '4 fotogramas de 128 px para 3 s a 16:9');
  assert.notEqual(info.first, info.last, 'los fotogramas cambian a lo largo del vídeo');
  assert.equal(info.imageStrip ?? null, null, 'las imágenes no llevan tira');

  await page.locator('.media__grid > li', { hasText: 'con_audio' }).locator('[data-act="add"]').click();
  await page.click('#tab-media');
  const bg = page.locator('.tl__clip--video .tl__clip-bg');
  await page.waitForFunction(() => /blob:/.test(document.querySelector('.tl__clip--video .tl__clip-bg')?.style.backgroundImage ?? '') && /px 100%/.test(document.querySelector('.tl__clip--video .tl__clip-bg').style.backgroundSize));
  const width = await page.locator('.tl__clip--video').evaluate((el) => el.getBoundingClientRect().width);
  const css = () => bg.evaluate((el) => ({ size: parseFloat(el.style.backgroundSize), x: parseFloat(el.style.backgroundPosition) }));
  near((await css()).size, width, 1.5, 'clip completo: la tira mide lo mismo que el clip');

  // Recortar a 1 s desde el segundo 1: la tira mide 3x el clip y se desplaza un tercio hacia la izquierda.
  await page.evaluate(() => {
    const { store } = editorApp.editor;
    const clip = Object.values(store.getProject().clips)[0];
    const r = store.dispatch({ type: 'clip/trim', clipId: clip.id, edge: 'start', time: 1 });
    if (!r.ok) throw new Error(r.error.message);
    const r2 = store.dispatch({ type: 'clip/trim', clipId: clip.id, edge: 'end', time: 2 });
    if (!r2.ok) throw new Error(r2.error.message);
  });
  await page.waitForFunction(() => Math.round(document.querySelector('.tl__clip--video').getBoundingClientRect().width) < 90);
  const trimmed = await page.locator('.tl__clip--video').evaluate((el) => el.getBoundingClientRect().width);
  const t = await css();
  near(t.size, trimmed * 3, 2, 'tramo de 1 s de 3 s');
  near(t.x, -t.size / 3, 2, 'la tira empieza en el segundo 1');

  // ---------- pellizco ----------
  const cdp = await page.context().newCDPSession(page);
  const zoom0 = await page.evaluate(() => editorApp.editor.timeline.getZoom());
  const box = await page.locator('.tl__scroll').boundingBox();
  const cy = box.y + 90; // pista de vídeo, a la derecha del clip (los avisos flotantes ocupan la parte baja)
  const pts = (d) => [{ x: 195 - d / 2, y: cy, id: 1 }, { x: 195 + d / 2, y: cy, id: 2 }];
  const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points });
  await touch('touchStart', pts(80));
  for (const d of [100, 120, 140, 160]) await touch('touchMove', pts(d));
  const during = await page.evaluate(() => editorApp.editor.timeline.pinching);
  await touch('touchEnd', []);
  const zoom1 = await page.evaluate(() => editorApp.editor.timeline.getZoom());
  assert.ok(during, 'el pellizco queda activo mientras hay dos dedos');
  near(zoom1 / zoom0, 2, 0.1, 'separar los dedos de 80 a 160 px duplica el zoom');
  assert.equal(await page.evaluate(() => editorApp.editor.timeline.pinching), false, 'termina al levantar los dedos');
  await touch('touchStart', pts(200));
  for (const d of [160, 120, 80, 40]) await touch('touchMove', pts(d));
  await touch('touchEnd', []);
  const zoom2 = await page.evaluate(() => editorApp.editor.timeline.getZoom());
  assert.ok(zoom2 < zoom1 / 3, `juntar los dedos aleja: ${zoom1} -> ${zoom2}`);
  assert.ok(zoom2 >= 8, 'respeta el zoom mínimo');

  // ---------- ayuda de atajos ----------
  await page.locator('.ed__preview').click({ position: { x: 5, y: 5 }, force: true });
  await page.keyboard.press('Shift+Slash');
  await page.waitForSelector('dialog.dlg kbd');
  const text = await page.locator('dialog.dlg').textContent();
  for (const word of ['Dividir', 'Deshacer', 'Reproducir']) assert.match(text, new RegExp(word));
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('dialog.dlg'));
  await page.click('[data-act="help"]');
  await page.waitForSelector('dialog.dlg');
  await page.locator('dialog.dlg .dlg__btn--primary').click();
  await page.waitForFunction(() => !document.querySelector('dialog.dlg'));
  assert.deepEqual(app.errors, []);
  console.log('polish.browser: OK');
} finally {
  await app.close();
}
