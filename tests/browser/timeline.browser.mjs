// Prueba de la línea de tiempo en Chromium real, con ratón, teclado y táctil.
// Uso: npm run test:browser
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { launch, makeMedia } from './helpers.mjs';

const dir = makeMedia();
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} no es ${b} ±${tol}`);
const FILES = ['con_audio.webm', 'musica.wav', 'foto.png', 'sin_audio.webm'];

async function boot(page, base) {
  await page.goto(`${base}/dev/timeline.html`);
  await page.setInputFiles('#files', FILES.map((n) => join(dir, n)));
  await page.waitForSelector('.asset >> nth=3');
  for (let i = 0; i < 4; i++) await page.click(`.asset >> nth=${i}`);
  await page.waitForSelector('.tl__clip >> nth=3');
}
const clips = (page) => page.evaluate(() => {
  const p = store.getProject();
  return Object.values(p.clips).map((c) => ({ id: c.id, kind: c.kind, start: c.start, duration: c.duration, in: c.in, trackId: c.trackId, name: p.assets[c.assetId]?.name }));
});
const named = async (page, name) => (await clips(page)).find((c) => c.name === name);
const center = async (locator) => { await locator.scrollIntoViewIfNeeded(); const b = await locator.boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
const clipLoc = (page, id) => page.locator(`.tl__clip[data-clip-id="${id}"]`);

async function drag(page, from, dx, dy = 0, { hold } = {}) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx / 2, from.y + dy / 2, { steps: 4 });
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 4 });
  if (hold) await hold();
  await page.mouse.up();
}
function assertNoOverlap(list) {
  for (const a of list) for (const b of list) {
    if (a.id < b.id && a.trackId === b.trackId) assert.ok(a.start + a.duration <= b.start + 1e-6 || b.start + b.duration <= a.start + 1e-6, `solape ${a.name} / ${b.name}`);
  }
}

const app = await launch({ viewport: { width: 1000, height: 640 } });
try {
  const { page } = app;
  await boot(page, app.base);
  let c = await clips(page);
  assert.equal(c.length, 4);
  near((await named(page, 'sin_audio.webm')).start, 8.008, 0.01, 'colocación secuencial');

  // --- mover en espacio libre (160 px = 2 s a 80 px/s)
  let sin = await named(page, 'sin_audio.webm');
  await drag(page, await center(clipLoc(page, sin.id)), 160);
  sin = await named(page, 'sin_audio.webm');
  near(sin.start, 10.008, 0.02, 'mover libre');

  // --- soltar sobre otro clip: va al hueco libre más cercano y nunca solapa
  await drag(page, await center(clipLoc(page, sin.id)), -480);
  sin = await named(page, 'sin_audio.webm');
  near(sin.start, 8.008, 0.02, 'hueco más cercano');
  assertNoOverlap(await clips(page));

  // --- imán: se ve la guía durante el arrastre y el clip se pega al borde
  await drag(page, await center(clipLoc(page, sin.id)), 6, 0, {
    hold: async () => assert.equal(await page.locator('.tl__guide').isVisible(), true, 'guía de imán visible'),
  });
  near((await named(page, 'sin_audio.webm')).start, 8.008, 0.001, 'imán');
  assert.equal(await page.locator('.tl__guide').isVisible(), false, 'guía oculta al soltar');

  // --- un clip de vídeo no se deja caer en la pista de texto
  const con = await named(page, 'con_audio.webm');
  const textRow = await center(page.locator('.tl__row--text .tl__lane'));
  const conC = await center(clipLoc(page, con.id));
  await drag(page, conC, 0, textRow.y - conC.y);
  assert.equal((await named(page, 'con_audio.webm')).trackId, con.trackId, 'tipo incompatible');

  // --- capa nueva: sí admite el clip
  await page.click('[data-action="layer"]');
  assert.equal(await page.locator('.tl__row').count(), 4);
  const layerRow = await center(page.locator('.tl__row--video >> nth=0').locator('.tl__lane'));
  const conC2 = await center(clipLoc(page, con.id));
  await drag(page, conC2, 0, layerRow.y - conC2.y);
  const moved = await named(page, 'con_audio.webm');
  assert.notEqual(moved.trackId, con.trackId, 'cambio de pista');
  near(moved.start, 0, 0.001, 'al cambiar de pista conserva el tiempo');
  assertNoOverlap(await clips(page));

  // --- recortar por los tiradores del clip seleccionado
  sin = await named(page, 'sin_audio.webm');
  await clipLoc(page, sin.id).click();
  assert.ok(await page.locator('.tl__clip.is-selected .tl__handle--end').count());
  const endHandle = await center(page.locator('.tl__clip.is-selected .tl__handle--end i'));
  await drag(page, endHandle, -40);
  near((await named(page, 'sin_audio.webm')).duration, 1.5, 0.02, 'recorte por el final');
  const startHandle = await center(page.locator('.tl__clip.is-selected .tl__handle--start i'));
  await drag(page, startHandle, 20);
  const trimmed = await named(page, 'sin_audio.webm');
  near(trimmed.start, 8.258, 0.02, 'recorte por el inicio');
  near(trimmed.in, 0.25, 0.02, 'el punto de entrada avanza con el recorte');

  // --- cursor: clic en la regla, y dividir con S
  const ruler = await page.locator('.tl__ruler').boundingBox();
  await page.mouse.click(ruler.x + 68 + 4 * 80, ruler.y + 20);
  near(await page.evaluate(() => store.getState().playhead), 4, 0.02, 'cursor en la regla');
  const foto = await named(page, 'foto.png');
  await clipLoc(page, foto.id).click();
  await page.keyboard.press('s');
  const images = (await clips(page)).filter((x) => x.kind === 'image').sort((a, b) => a.start - b.start);
  assert.equal(images.length, 2, 'dividir');
  near(images[0].duration, 4 - 3.008, 0.02, 'parte izquierda');
  near(images[1].start, 4, 0.02, 'parte derecha');
  assert.deepEqual(await page.evaluate(() => store.getState().selection), [images[1].id]);

  // --- eliminar y deshacer con teclado; mover con flechas
  const before = (await clips(page)).length;
  await page.keyboard.press('Delete');
  assert.equal((await clips(page)).length, before - 1, 'eliminar');
  await page.keyboard.press('Control+z');
  assert.equal((await clips(page)).length, before, 'deshacer');
  await clipLoc(page, (await named(page, 'sin_audio.webm')).id).click();
  const s0 = (await named(page, 'sin_audio.webm')).start;
  await page.keyboard.press('ArrowRight');
  near((await named(page, 'sin_audio.webm')).start, s0 + 1 / 30, 0.002, 'flecha = 1 fotograma');

  // --- zoom con botón y con Ctrl+rueda
  await page.click('[data-action="zoomIn"]');
  near(await page.evaluate(() => timeline.getZoom()), 100, 0.01, 'zoom +25 %');
  await page.mouse.move(500, 400);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -100);
  await page.keyboard.up('Control');
  assert.ok(await page.evaluate(() => timeline.getZoom()) > 100, 'zoom con rueda');

  // --- bloquear pista: el clip ya no se mueve y se avisa
  const baseLock = page.locator('.tl__row--video >> nth=1').locator('.tl__lock');
  await baseLock.click();
  assert.equal(await baseLock.getAttribute('aria-pressed'), 'true');
  const target = (await clips(page)).find((x) => x.kind === 'image');
  await drag(page, await center(clipLoc(page, target.id)), 90);
  near((await clips(page)).find((x) => x.id === target.id).start, target.start, 0.001, 'pista bloqueada');
  assert.match(await page.locator('.tl__status').textContent(), /bloqueada/);

  // --- accesibilidad: nombres accesibles y tamaño táctil
  for (const b of await page.locator('.tl__btn').all()) {
    assert.ok(await b.getAttribute('aria-label'), 'botón sin aria-label');
    const box = await b.boundingBox();
    assert.ok(box.width >= 44 && box.height >= 44, `objetivo táctil ${box.width}x${box.height}`);
  }
  for (const el of await page.locator('.tl__clip').all()) assert.match(await el.getAttribute('aria-label'), /inicio .*duración/);

  assertNoOverlap(await clips(page));
  assert.deepEqual(app.errors, []);
} finally {
  await app.close();
}

// --- táctil: tocar selecciona; los tiradores solo aparecen en el seleccionado
const touch = await launch({ viewport: { width: 390, height: 780 }, hasTouch: true, isMobile: true });
try {
  const { page } = touch;
  await boot(page, touch.base);
  const foto = await named(page, 'foto.png');
  assert.equal(await page.locator('.tl__handle').count(), 2, 'solo el último añadido está seleccionado');
  await clipLoc(page, foto.id).tap();
  assert.deepEqual(await page.evaluate(() => store.getState().selection), [foto.id], 'tocar selecciona');
  assert.equal(await page.locator('.tl__handle').count(), 2);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'sin scroll horizontal de página');
  assert.deepEqual(touch.errors, []);
} finally {
  await touch.close();
}
console.log('timeline.browser: OK');
