// Panel de edición del clip: deslizadores, filtros, transformación, velocidad y transición.
// Uso: npm run test:browser
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { launch, makeMedia, pageTools } from './helpers.mjs';

const dir = makeMedia();
const app = await launch({ viewport: { width: 1100, height: 1100 } });
const { page } = app;
const { run, px, settle, clipOf } = pageTools(page);
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} no es ${b} ±${tol}`);
const within = (actual, expected, tol, msg) => assert.ok(actual.every((v, i) => Math.abs(v - expected[i]) <= tol), `${msg}: [${actual}] vs [${expected}]`);

const pick = (id) => run((x) => store.select([x]), id);
const clipNow = (id) => run((x) => store.getProject().clips[x], id);
const fxOf = async (id) => Object.fromEntries((await clipNow(id)).effects.map((e) => [e.type, e.params.value]));
const out = (key) => page.locator(`output[for="ins-${key}"]`).textContent();
/** Simula arrastrar un deslizador: varios `input` seguidos y un solo `change` al soltar. */
const dragRange = (selector, values) => page.evaluate(([sel, vals]) => {
  const el = document.querySelector(sel);
  for (const v of vals) { el.value = String(v); el.dispatchEvent(new Event('input', { bubbles: true })); }
  el.dispatchEvent(new Event('change', { bubbles: true }));
}, [selector, values]);

try {
  await page.goto(`${app.base}/dev/editor.html`);
  await page.setInputFiles('#files', ['rojo.webm', 'verde.png', 'musica.wav'].map((n) => join(dir, n)));
  await page.waitForSelector('.asset >> nth=2');
  await page.click('.asset >> nth=0');
  await page.click('.asset >> nth=1');
  await page.click('.asset >> nth=2');
  const video = await clipOf('rojo.webm');
  const image = await clipOf('verde.png');
  const audio = await clipOf('musica.wav');
  near(image.start, video.start + video.duration, 0.01, 'la imagen queda pegada al vídeo');

  // --- sin selección
  await run(() => store.select([]));
  assert.equal(await page.locator('.ins__empty').isVisible(), true, 'mensaje sin selección');
  assert.equal(await page.locator('.ins__body').isVisible(), false);

  // --- estructura al seleccionar un vídeo
  await pick(video.id);
  assert.equal(await page.locator('.ins__empty').isVisible(), false);
  assert.equal(await page.locator('[data-fx]').count(), 10, 'un deslizador por efecto');
  assert.equal(await page.locator('[data-preset]').count(), 7);
  assert.equal(await page.locator('[data-transition]').count(), 9, 'Ninguna + 8 transiciones');
  for (const input of await page.locator('.ins__range').all()) {
    const id = await input.getAttribute('id');
    assert.ok(await page.locator(`label[for="${id}"]`).count(), `el deslizador ${id} tiene etiqueta`);
  }

  // --- un deslizador de efecto: cambia el modelo, el texto y el lienzo
  await run(() => store.setPlayhead(1));
  await settle(() => page.locator('#ins-fx-brightness').fill('0.4'));
  assert.equal((await fxOf(video.id)).brightness, 0.4);
  assert.equal(await out('fx-brightness'), '0.40');
  within(await px(0.5, 0.5), [255, 51, 51], 8, 'el brillo del panel llega al lienzo');

  // un arrastre completo es un solo paso de historial
  await dragRange('#ins-fx-contrast', [0.1, 0.2, 0.3, 0.4, 0.5]);
  assert.equal((await fxOf(video.id)).contrast, 0.5);
  await run(() => store.undo());
  const afterUndo = await fxOf(video.id);
  assert.equal(afterUndo.contrast, undefined, 'deshacer quita todo el arrastre de una vez');
  assert.equal(afterUndo.brightness, 0.4, 'y deja el ajuste anterior');
  assert.equal(await page.locator('#ins-fx-contrast').inputValue(), '0', 'el deslizador se sincroniza al deshacer');
  assert.equal(await out('fx-contrast'), '0.00');

  // doble toque sobre el valor restablece
  await page.locator('output[for="ins-fx-brightness"]').dblclick();
  assert.deepEqual(await fxOf(video.id), {});

  // --- filtros e intensidad
  await page.click('[data-preset="mono"]');
  assert.equal(await page.locator('[data-preset="mono"]').getAttribute('aria-pressed'), 'true');
  assert.equal((await fxOf(video.id)).saturation, -1);
  assert.equal(await page.locator('.ins__row--intensity').isVisible(), true);
  await dragRange('#ins-intensity', [0.8, 0.5]);
  assert.equal((await fxOf(video.id)).saturation, -0.5);
  assert.equal(await out('fx-saturation'), '-0.50');
  await page.click('[data-preset="vintage"]');
  assert.equal(await page.locator('[data-preset="mono"]').getAttribute('aria-pressed'), 'false');
  assert.equal(await page.locator('#ins-fx-sepia').inputValue(), '0.5');
  await page.click('[data-action="clear-fx"]');
  assert.deepEqual(await fxOf(video.id), {});
  assert.equal(await page.locator('.ins__row--intensity').isVisible(), false);

  // --- transformar
  await page.locator('#ins-p-scale').fill('0.5');
  near((await clipNow(video.id)).transform.scale, 0.5, 1e-9, 'tamaño');
  await page.locator('#ins-p-x').fill('0.25');
  near((await clipNow(video.id)).transform.x, 0.25, 1e-9, 'posición horizontal');
  await page.click('[data-action="reset-xform"]');
  assert.deepEqual((await clipNow(video.id)).transform, { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 });
  await page.click('[data-fit="cover"]');
  assert.equal((await clipNow(video.id)).fit, 'cover');
  assert.equal(await page.locator('[data-fit="cover"]').getAttribute('aria-pressed'), 'true');
  await page.click('[data-fit="contain"]');
  await page.click('[data-action="rotate-right"]');
  assert.equal((await clipNow(video.id)).transform.rotation, 90);
  await page.click('[data-action="rotate-left"]');
  await page.click('[data-action="rotate-left"]');
  assert.equal((await clipNow(video.id)).transform.rotation, -90);
  await page.click('[data-action="reset-xform"]');
  await page.click('[data-action="flip-h"]');
  assert.equal((await clipNow(video.id)).flip.h, true);
  assert.equal(await page.locator('[data-action="flip-h"]').getAttribute('aria-pressed'), 'true');
  await page.click('[data-action="flip-h"]');
  assert.equal((await clipNow(video.id)).flip.h, false);
  await page.click('[data-crop="1"]'); // 1:1
  const crop = (await clipNow(video.id)).crop;
  near(crop.w, 0.5625, 1e-6, 'recorte 1:1 de un vídeo 16:9');
  assert.equal(await page.locator('[data-crop="1"]').getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('[data-crop="0"]').getAttribute('aria-pressed'), 'false');
  await page.click('[data-crop="0"]');
  assert.equal((await clipNow(video.id)).crop, null);

  // --- transición: la imagen está pegada al vídeo, el vídeo no tiene nada antes
  assert.equal(await page.locator('[data-transition="dissolve"]').isDisabled(), true, 'el primer clip no admite transición');
  assert.match(await page.locator('[data-trans-note]').textContent(), /clip justo antes/);
  await pick(image.id);
  assert.equal(await page.locator('[data-transition="dissolve"]').isDisabled(), false);
  assert.equal(await page.locator('[data-trans-note]').textContent(), '');
  assert.equal(await page.locator('#ins-p-trdur').isDisabled(), true, 'sin transición no hay duración');
  await page.click('[data-transition="slide-left"]');
  assert.deepEqual((await clipNow(image.id)).transition, { type: 'slide-left', duration: 0.6 });
  assert.equal(await page.locator('[data-transition="slide-left"]').getAttribute('aria-pressed'), 'true');
  await page.locator('#ins-p-trdur').fill('1.4');
  assert.equal((await clipNow(image.id)).transition.duration, 1.4);
  await page.click('[data-transition="dissolve"]');
  assert.deepEqual((await clipNow(image.id)).transition, { type: 'dissolve', duration: 1.4 }, 'cambiar de tipo conserva la duración');
  await page.click('[data-transition=""]');
  assert.equal((await clipNow(image.id)).transition, null);

  // --- una imagen no tiene velocidad; sí fit y recorte
  assert.equal(await page.locator('[data-speed]').count(), 0);
  assert.ok(await page.locator('[data-crop]').count());

  // --- velocidad, y el error de solape se comunica y el control vuelve a su valor
  await pick(video.id);
  await page.click('[data-speed="2"]');
  near((await clipNow(video.id)).duration, 1.5, 0.01, 'a 2× dura la mitad');
  assert.equal(await page.locator('[data-speed="2"]').getAttribute('aria-pressed'), 'true');
  await page.click('[data-speed="1"]');
  near((await clipNow(video.id)).duration, 3, 0.01, 'a 1× dura lo original');
  await page.click('[data-speed="0.5"]'); // 6 s: pisaría a la imagen
  assert.match(await page.locator('.ins__status').textContent(), /solapa/);
  assert.equal((await clipNow(video.id)).speed, 1, 'el clip no cambia');
  assert.equal(await page.locator('[data-speed="1"]').getAttribute('aria-pressed'), 'true', 'el panel refleja el valor real');
  assert.equal(await page.locator('#ins-p-speed').inputValue(), '1');

  // --- el panel se adapta al tipo de clip
  await pick(audio.id);
  assert.equal(await page.locator('[data-prop="volume"]').count(), 1, 'el audio tiene volumen');
  assert.equal(await page.locator('[data-fx]').count(), 0, 'pero no efectos de imagen');
  assert.equal(await page.locator('[data-fit], [data-crop]').count(), 0);
  assert.ok(await page.locator('[data-speed]').count(), 'y velocidad');
  await run(async () => {
    const { addTextClip } = await import('/src/timeline/index.js');
    addTextClip(store, { text: { content: 'Hola' } });
  });
  assert.ok(await page.locator('[data-fx]').count(), 'el texto admite efectos');
  assert.equal(await page.locator('[data-fit]').count(), 0, 'pero no ajuste de encuadre');
  assert.equal(await page.locator('[data-speed]').count(), 0);

  // --- accesibilidad: objetivos táctiles y errores
  await pick(video.id);
  for (const b of await page.locator('.ins button:visible').all()) {
    const box = await b.boundingBox();
    assert.ok(box.height >= 44, `objetivo táctil del panel: ${await b.textContent()} ${box.width}x${box.height}`);
  }
  for (const r of await page.locator('.ins__range:visible').all()) assert.ok((await r.boundingBox()).height >= 44);
  for (const b of await page.locator('.ins__icon').all()) assert.ok(await b.getAttribute('aria-label'));

  assert.deepEqual(app.errors, []);
  console.log('inspector.browser: OK');
} finally {
  await app.close();
}
