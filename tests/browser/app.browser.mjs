// Aplicación completa: proyectos, editor, persistencia y maquetación móvil/escritorio.
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { launch, makeMedia } from './helpers.mjs';

const dir = makeMedia();
const app = await launch({ viewport: { width: 390, height: 780 }, hasTouch: true });
const { page } = app;

// Contraste WCAG entre el color del texto y el fondo efectivo de un elemento.
const contrast = (locator) => locator.evaluate((el) => {
  const parse = (c) => c.match(/[\d.]+/g).map(Number);
  const lum = ([r, g, b]) => [r, g, b].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }).reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i], 0);
  let bg = el;
  let back = [0, 0, 0, 0];
  for (; bg && back[3] === 0; bg = bg.parentElement) back = parse(getComputedStyle(bg).backgroundColor).concat(1).slice(0, 4).map((v, i) => (i === 3 ? (parse(getComputedStyle(bg).backgroundColor)[3] ?? 1) : v));
  const [a, b] = [lum(parse(getComputedStyle(el).color)), lum(back)].sort((x, y) => y - x);
  return (a + 0.05) / (b + 0.05);
});
const proj = () => page.evaluate(() => editorApp.editor.store.getProject());
try {
  await page.goto(`${app.base}/index.html`);
  await page.waitForSelector('#app[data-ready="true"]');

  // ---------- inicio vacío ----------
  assert.equal(await page.locator('.home__empty').isVisible(), true);
  assert.equal(await page.locator('.card').count(), 0);

  // ---------- nuevo proyecto ----------
  await page.locator('.home__top [data-act="new"]').click();
  await page.fill('#dlg-name', 'Viaje');
  for (const sel of ['.dlg__btn--primary', '.dlg__btn:not(.dlg__btn--primary)']) assert.ok(await contrast(page.locator(sel).first()) >= 4.5, `contraste de ${sel}`);
  await page.locator('.dlg__aspect', { hasText: '9:16' }).click();
  await page.locator('.dlg__btn--primary').click();
  await page.waitForSelector('.editor');
  assert.match(page.url(), /#\/p\//);
  assert.equal(await page.locator('.ed__title').textContent(), 'Viaje');

  for (const sel of ['.ed__export', '.ed__title', '.ed__tab']) assert.ok(await contrast(page.locator(sel).first()) >= 4.5, `contraste de ${sel}`);
  // ---------- maquetación móvil ----------
  const noScroll = () => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
  assert.ok(await noScroll(), 'sin scroll horizontal');
  assert.equal(await page.locator('#ed-timeline').isVisible(), true);
  assert.equal(await page.locator('.ed__drawer').isVisible(), false);
  const previewBox = await page.locator('#ed-preview').boundingBox();
  await page.click('#tab-media');
  assert.equal(await page.locator('#ed-timeline').isVisible(), false, 'el cajón sustituye a la línea de tiempo');
  assert.equal(await page.locator('.ed__drawer').isVisible(), true);
  const after = await page.locator('#ed-preview').boundingBox();
  assert.equal(Math.round(after.height), Math.round(previewBox.height), 'la vista previa no cambia de tamaño');
  assert.ok(await noScroll());

  // ---------- importar ----------
  await page.setInputFiles('.media__file', [join(dir, 'foto.png'), join(dir, 'con_audio.webm'), join(dir, 'musica.wav')]);
  await page.waitForFunction(() => document.querySelectorAll('.media__grid > li').length === 3, null, { timeout: 15000 });
  await page.locator('.media__grid > li').first().locator('[data-act="add"]').click();
  assert.equal(Object.keys((await proj()).clips).length, 1);

  // ---------- autosave y reapertura ----------
  await page.click('#tab-media'); // cierra el cajón
  await page.waitForTimeout(900);
  await page.reload();
  await page.waitForSelector('.editor');
  assert.equal(Object.keys((await proj()).clips).length, 1, 'el clip sobrevive a la recarga');
  assert.equal(Object.keys((await proj()).assets).length, 3);

  // ---------- cambio de formato y fondo ----------
  await page.click('#tab-project');
  await page.locator('.proj__chip[data-aspect="1:1"]').click();
  assert.equal((await proj()).settings.aspect, '1:1');
  const bg0 = (await proj()).settings.background;
  await page.locator('.proj__swatch').nth(2).click();
  assert.notEqual((await proj()).settings.background, bg0);

  // ---------- deshacer con botón ----------
  await page.click('[data-act="undo"]');
  assert.equal(await page.locator('[data-act="redo"]').isDisabled(), false);

  // ---------- exportar abre su panel ----------
  await page.click('[data-act="export"]');
  assert.equal(await page.locator('[data-panel="export"]').isVisible(), true);

  // ---------- volver y lista con portada ----------
  await page.click('[data-act="back"]');
  await page.waitForSelector('.home');
  await page.waitForSelector('.card');
  assert.equal(await page.locator('.card').count(), 1);
  await page.waitForSelector('.card__cover img', { timeout: 5000 });
  assert.ok(await page.locator('.home__storage').textContent());

  // ---------- duplicar, renombrar, borrar ----------
  const options = async (card, choice) => { await card.locator('[data-act="more"]').click(); await page.locator('.dlg__choice', { hasText: choice }).click(); };
  await options(page.locator('.card').first(), 'Duplicar');
  await page.waitForFunction(() => document.querySelectorAll('.card').length === 2);
  const copy = page.locator('.card', { hasText: 'Copia de' });
  await options(copy, 'Cambiar nombre');
  await page.fill('#dlg-input', 'Renombrado');
  await page.locator('.dlg__btn--primary').click();
  await page.waitForFunction(() => [...document.querySelectorAll('.card__name')].some((n) => n.textContent === 'Renombrado'));
  await options(page.locator('.card', { hasText: 'Viaje' }).first(), 'Eliminar');
  await page.locator('.dlg__btn--danger').click();
  await page.waitForFunction(() => document.querySelectorAll('.card').length === 1);
  // La copia sigue abriéndose con sus medios.
  await page.locator('.card__open').click();
  await page.waitForSelector('.editor');
  assert.equal(Object.keys((await proj()).assets).length, 3);
  const media = await page.evaluate(async () => {
    const ids = Object.keys(editorApp.editor.store.getProject().assets);
    return Promise.all(ids.map(async (id) => (await editorApp.repo.getMedia(id)) != null));
  });
  assert.deepEqual(media, [true, true, true], 'los medios siguen tras borrar el proyecto de origen');

  // ---------- ruta inexistente ----------
  await page.goto(`${app.base}/index.html#/p/no-existe`);
  await page.waitForSelector('.home');
  await page.waitForSelector('.toast');
  assert.ok((await page.locator('.toast').allTextContents()).some((t) => /ya no existe/.test(t)));

  // ---------- escritorio ----------
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`${app.base}/index.html#/`);
  await page.waitForSelector('.card');
  await page.locator('.card__open').click();
  await page.waitForSelector('.editor');
  assert.equal(await page.locator('#ed-timeline').isVisible(), true);
  assert.equal(await page.locator('.ed__drawer').isVisible(), true);
  const side = await page.locator('.ed__side').boundingBox();
  const prev = await page.locator('#ed-preview').boundingBox();
  assert.ok(side.x >= prev.x + prev.width - 1, 'panel lateral a la derecha de la vista previa');
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));

  // ---------- atajos ----------
  await page.click('#tab-project');
  const aspect0 = (await proj()).settings.aspect;
  await page.locator(`.proj__chip[data-aspect="${aspect0 === '16:9' ? '4:5' : '16:9'}"]`).click();
  assert.notEqual((await proj()).settings.aspect, aspect0);
  await page.locator('.ed__preview').click({ position: { x: 5, y: 5 }, force: true });
  await page.keyboard.press('Control+z');
  assert.equal((await proj()).settings.aspect, aspect0);

  // ---------- accesibilidad ----------
  for (const b of await page.locator('.ed__top button:visible, .ed__tab:visible').all()) assert.ok((await b.boundingBox()).height >= 44, 'objetivo táctil de 44 px');
  assert.deepEqual(app.errors, []);
  console.log('app.browser: OK');
} finally {
  await app.close();
}
