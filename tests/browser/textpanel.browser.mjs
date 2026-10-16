// Panel «Añadir» (estilos de texto, stickers, emoji) y panel de edición de texto.
// Uso: npm run test:browser
import assert from 'node:assert/strict';
import { launch, pageTools } from './helpers.mjs';

const app = await launch({ viewport: { width: 1100, height: 1300 } });
const { page } = app;
const { run, px, settle } = pageTools(page);
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} no es ${b} ±${tol}`);

const selectedId = () => run(() => store.getState().selection[0]);
const clipNow = (id) => run((x) => store.getProject().clips[x], id);
const textOf = async () => (await clipNow(await selectedId())).text;
const countPx = (pick) => run((src) => {
  const test = eval(src);
  const c = document.querySelector('.pv__canvas');
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let n = 0;
  for (let i = 0; i < d.length; i += 4) if (test([d[i], d[i + 1], d[i + 2]])) n++;
  return n;
}, pick);

try {
  await page.goto(`${app.base}/dev/editor.html`);
  await page.waitForFunction(() => window.player);
  await page.click('.adder summary');

  // ---------- añadir texto con un estilo ----------
  await page.click('[data-style="title"]');
  let id = await selectedId();
  let clip = await clipNow(id);
  assert.equal(clip.kind, 'text');
  assert.deepEqual([clip.text.font, clip.text.size, clip.text.stroke, clip.text.animIn], ['Bebas Neue', 220, '#000000', 'pop']);
  assert.equal(clip.start, 0);
  assert.equal(await page.locator('#ins-t-content').inputValue(), 'Texto', 'el panel de edición muestra el contenido');
  assert.equal(await page.locator('#ins-t-font').inputValue(), 'Bebas Neue');

  // ---------- teclear es un solo paso de historial ----------
  await page.locator('#ins-t-content').fill('');
  await page.locator('#ins-t-content').pressSequentially('Hola mundo', { delay: 5 });
  assert.equal((await textOf()).content, 'Hola mundo');
  await page.locator('#ins-t-content').blur();
  await page.locator('#ins-t-content').focus();
  await page.locator('#ins-t-content').pressSequentially('!!', { delay: 5 });
  assert.equal((await textOf()).content, 'Hola mundo!!');
  await run(() => store.undo());
  assert.equal((await textOf()).content, 'Hola mundo', 'deshacer quita solo la última tanda de teclas');
  assert.equal(await page.locator('#ins-t-content').inputValue(), 'Hola mundo', 'la caja se sincroniza al deshacer');
  await run(() => store.undo());
  assert.equal((await textOf()).content, 'Texto', 'y la tanda anterior (borrar y teclear sin perder el foco) de una vez');
  await page.locator('#ins-t-content').fill('Hola');
  assert.equal((await textOf()).content, 'Hola');

  // ---------- tipografía y negrita ----------
  await page.selectOption('#ins-t-font', 'Pacifico');
  let t = await textOf();
  assert.deepEqual([t.font, t.weight], ['Pacifico', 400]);
  assert.equal(await page.locator('[data-text-toggle="bold"]').isDisabled(), true, 'Pacifico no tiene negrita');
  await page.selectOption('#ins-t-font', 'Oswald');
  assert.equal(await page.locator('[data-text-toggle="bold"]').isDisabled(), false);
  await page.click('[data-text-toggle="bold"]');
  assert.equal((await textOf()).weight, 700);
  assert.equal(await page.locator('[data-text-toggle="bold"]').getAttribute('aria-pressed'), 'true');
  await page.selectOption('#ins-t-font', 'Montserrat');
  assert.equal((await textOf()).weight, 700, 'al cambiar de fuente se conserva la intención de negrita');
  await page.selectOption('#ins-t-font', 'Anton');
  assert.equal((await textOf()).weight, 400);
  await page.selectOption('#ins-t-font', 'Inter');
  assert.equal((await textOf()).weight, 400, 'pasar por una fuente sin negrita guarda el peso 400');
  await page.click('[data-text-toggle="bold"]');
  assert.equal((await textOf()).weight, 700, 'poner la negrita');
  await page.click('[data-text-toggle="bold"]');
  assert.equal((await textOf()).weight, 400, 'quitar la negrita');

  // ---------- tamaño, alineación, sombra ----------
  await page.locator('#ins-t-size').fill('200');
  assert.equal((await textOf()).size, 200);
  assert.equal(await page.locator('output[for="ins-t-size"]').textContent(), '200');
  for (const align of ['left', 'right', 'center']) {
    await page.click(`[data-align="${align}"]`);
    assert.equal((await textOf()).align, align);
    assert.equal(await page.locator(`[data-align="${align}"]`).getAttribute('aria-pressed'), 'true');
  }
  const shadow0 = (await textOf()).shadow;
  await page.click('[data-text-toggle="shadow"]');
  assert.equal((await textOf()).shadow, !shadow0);

  // ---------- colores: paleta, color personalizado, sin fondo ni contorno ----------
  await page.click('button[data-ctarget="color"][data-cvalue="#ff3b30"]');
  assert.equal((await textOf()).color, '#ff3b30');
  assert.equal(await page.locator('button[data-ctarget="color"][data-cvalue="#ff3b30"]').getAttribute('aria-pressed'), 'true');
  await page.locator('input[data-ctarget="color"]').fill('#123456');
  assert.equal((await textOf()).color, '#123456');
  assert.equal(await page.locator('button[data-ctarget="color"][aria-pressed="true"]').count(), 0, 'un color fuera de la paleta no marca ninguna muestra');
  assert.equal(await page.locator('button[data-ctarget="background"][data-cvalue="none"]').getAttribute('aria-pressed'), 'true', 'sin fondo al principio');
  assert.equal(await page.locator('#ins-t-backgroundOpacity').isDisabled(), true, 'sin fondo no hay opacidad');
  await page.click('button[data-ctarget="background"][data-cvalue="#007aff"]');
  assert.equal((await textOf()).background, '#007aff');
  assert.equal(await page.locator('#ins-t-backgroundOpacity').isDisabled(), false);
  await page.locator('#ins-t-backgroundOpacity').fill('0.9');
  assert.equal((await textOf()).backgroundOpacity, 0.9);
  await page.click('button[data-ctarget="background"][data-cvalue="none"]');
  assert.equal((await textOf()).background, null);
  await page.click('button[data-ctarget="stroke"][data-cvalue="#ffcc00"]');
  assert.equal((await textOf()).stroke, '#ffcc00');
  await page.click('button[data-ctarget="stroke"][data-cvalue="none"]');
  assert.equal((await textOf()).stroke, null);

  // ---------- animaciones y su validación ----------
  assert.equal(await page.locator('#ins-t-animInDuration').isDisabled(), false, 'con «Rebote» la duración se puede editar');
  await page.selectOption('#ins-t-animIn', 'none');
  assert.equal(await page.locator('#ins-t-animInDuration').isDisabled(), true);
  await page.selectOption('#ins-t-animIn', 'typewriter');
  await page.selectOption('#ins-t-animOut', 'fade');
  assert.deepEqual([(await textOf()).animIn, (await textOf()).animOut], ['typewriter', 'fade']);
  assert.match(await page.locator('#ins-t-animOut option:checked').textContent(), /Desaparecer/, 'la salida usa su propio rótulo');
  assert.match(await page.locator('#ins-t-animIn option[value="slide-up"]').textContent(), /Subir/);
  await page.locator('#ins-t-animInDuration').fill('2.8'); // 2,8 + 0,5 > 3 s del clip
  assert.match(await page.locator('.ins__status').textContent(), /superan/);
  assert.notEqual((await textOf()).animInDuration, 2.8, 'el valor rechazado no se guarda');
  assert.notEqual(await page.locator('#ins-t-animInDuration').inputValue(), '2.8', 'el control vuelve al valor real');

  // ---------- el texto elegido llega al lienzo ----------
  await page.selectOption('#ins-t-animIn', 'none');
  await page.selectOption('#ins-t-animOut', 'none');
  await page.click('button[data-ctarget="color"][data-cvalue="#ff3b30"]');
  await page.selectOption('#ins-t-font', 'Anton');
  await settle(() => page.locator('#ins-t-size').fill('260'));
  await settle(() => run(() => store.setPlayhead(1)));
  assert.ok((await countPx('([r, g, b]) => r > 200 && g < 90 && b < 80')) > 1500, 'el texto rojo se dibuja en la vista previa');

  // ---------- stickers: se importan una vez y se reutilizan ----------
  const assetsBefore = await run(() => Object.keys(store.getProject().assets).length);
  await page.click('[data-sticker="heart"]');
  await page.waitForFunction((n) => Object.keys(store.getProject().assets).length > n, assetsBefore);
  const heartClip = await clipNow(await selectedId());
  assert.equal(heartClip.kind, 'image');
  assert.equal(heartClip.transform.scale, 0.35);
  const project = await run(() => store.getProject());
  assert.equal(project.assets[heartClip.assetId].name, 'sticker-heart.png');
  assert.equal(project.assets[heartClip.assetId].width, 512);
  const heartTrack = project.tracks.findIndex((x) => x.id === heartClip.trackId);
  assert.ok(heartTrack > 0 && project.tracks[heartTrack].kind === 'video', 'va a una capa de vídeo superior a la base');
  assert.equal(heartClip.start, 1, 'en el cursor');
  await settle(() => run(() => store.setPlayhead(1.5)));
  assert.ok((await countPx('([r, g, b]) => r > 220 && g < 110 && b > 80 && b < 160')) > 800, 'el corazón rosa se ve en la vista previa');
  const assetsAfter = await run(() => Object.keys(store.getProject().assets).length);
  await page.click('[data-sticker="heart"]');
  await page.waitForFunction((n) => Object.keys(store.getProject().clips).length > n, await run(() => Object.keys(store.getProject().clips).length) - 1);
  assert.equal(await run(() => Object.keys(store.getProject().assets).length), assetsAfter, 'el segundo corazón reutiliza el medio');
  const second = await clipNow(await selectedId());
  assert.equal(second.assetId, heartClip.assetId);
  assert.notEqual(second.trackId, heartClip.trackId, 'solapa con el primero: otra capa');
  assert.ok((await page.locator('.tl__row').count()) >= 5, 'la línea de tiempo muestra las capas nuevas');
  await page.click('[data-sticker="heart"]', { clickCount: 2, delay: 5 }); // doble clic rápido: un solo medio
  assert.equal(await run(() => Object.keys(store.getProject().assets).length), assetsAfter);

  // los 12 stickers se rasterizan con contenido real
  const raster = await run(async () => {
    const { STICKERS, rasterizeSticker } = await import('/src/text/stickers.js');
    const out = [];
    for (const sticker of STICKERS) {
      const blob = await rasterizeSticker(sticker, 128);
      const bmp = await createImageBitmap(blob);
      const c = Object.assign(document.createElement('canvas'), { width: 128, height: 128 });
      const ctx = c.getContext('2d');
      ctx.drawImage(bmp, 0, 0);
      const d = ctx.getImageData(0, 0, 128, 128).data;
      let opaque = 0;
      for (let i = 3; i < d.length; i += 4) if (d[i] > 200) opaque++;
      out.push([sticker.id, blob.type, opaque / (128 * 128)]);
    }
    return out;
  });
  for (const [sid, type, share] of raster) {
    assert.equal(type, 'image/png');
    assert.ok(share > 0.04 && share < 0.95, `${sid}: ${(share * 100).toFixed(0)} % de píxeles opacos`);
  }

  // ---------- emoji ----------
  await run(() => store.setPlayhead(5));
  await page.click('[data-group="amor"]'); // 🔥 está en «Amor y brillos»
  await page.click('[data-emoji="🔥"]');
  const emojiClip = await clipNow(await selectedId());
  assert.equal(emojiClip.text.content, '🔥');
  assert.equal(emojiClip.start, 5);
  await settle(() => run(() => store.setPlayhead(6)));
  assert.ok((await countPx('([r, g, b]) => r > 220 && g > 80 && g < 190 && b < 60')) > 500, 'el emoji se dibuja a color');

  // ---------- accesibilidad ----------
  for (const b of await page.locator('.add button').all()) assert.ok(await b.getAttribute('aria-label') || (await b.textContent()).trim(), 'botón sin nombre');
  await run((x) => store.select([x]), id);
  for (const el of await page.locator('.ins textarea, .ins select, .ins input').all()) {
    const elId = await el.getAttribute('id');
    const hasLabel = elId && (await page.locator(`label[for="${elId}"]`).count()) > 0;
    assert.ok(hasLabel || (await el.getAttribute('aria-label')), `campo sin nombre: ${elId}`);
  }
  for (const b of await page.locator('.ins button:visible, .ins .ins__swatch:visible').all()) {
    const box = await b.boundingBox();
    assert.ok(box.height >= 44 - 0.5 && box.width >= 44 - 0.5 || (await b.textContent()).trim().length > 0 && box.height >= 44 - 0.5, `objetivo táctil ${box.width}x${box.height}`);
  }
  assert.deepEqual(app.errors, []);
  console.log('textpanel.browser: OK');
} finally {
  await app.close();
}
