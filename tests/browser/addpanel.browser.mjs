// Música propia, emoji por categorías y cortar un clip desde la app completa.
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { launch, makeMedia } from './helpers.mjs';

const dir = makeMedia();
const app = await launch({ viewport: { width: 390, height: 780 }, hasTouch: true });
const { page } = app;
const proj = () => page.evaluate(() => editorApp.editor.store.getProject());
try {
  await page.goto(`${app.base}/index.html`);
  await page.waitForSelector('#app[data-ready="true"]');
  await page.locator('.home__top [data-act="new"]').click();
  await page.locator('.dlg__btn--primary').click();
  await page.waitForSelector('.editor');

  // ---------- música propia ----------
  await page.click('#tab-add');
  assert.equal(await page.locator('.add__track').count(), 0, 'sin música aún');
  await page.setInputFiles('.add__file', [join(dir, 'musica.wav')]);
  await page.waitForFunction(() => document.querySelectorAll('.add__track').length === 1, null, { timeout: 15000 });
  let p = await proj();
  const clips = () => Object.values(p.clips);
  const audioTrack = p.tracks.find((t) => t.kind === 'audio');
  assert.equal(clips().length, 1);
  assert.equal(clips()[0].kind, 'audio');
  assert.equal(clips()[0].trackId, audioTrack.id);
  assert.equal(clips()[0].start, 0);
  assert.equal(clips()[0].duration, 4, 'musica.wav dura 4 s');
  assert.match(await page.locator('.add__track-name').textContent(), /musica\.wav/);
  assert.match(await page.locator('.add__track-time').textContent(), /0:04/);
  // Un efecto de sonido no cuenta como música.
  await page.locator('[data-sfx="ding"]').click();
  await page.waitForFunction(() => Object.keys(editorApp.editor.store.getProject().clips).length === 2, null, { timeout: 10000 });
  assert.equal(await page.locator('.add__track').count(), 1, 'los efectos no aparecen en la lista de música');
  // Añadirla otra vez desde la lista crea otro clip sin pisar el anterior.
  await page.locator('.add__track-add').click();
  p = await proj();
  assert.equal(clips().filter((c) => c.kind === 'audio').length, 3);
  const musicClips = clips().filter((c) => p.assets[c.assetId].name === 'musica.wav').sort((a, b) => a.start - b.start);
  assert.equal(musicClips.length, 2);
  for (const c of clips()) for (const d of clips()) if (c !== d && c.trackId === d.trackId) assert.ok(c.start + c.duration <= d.start + 1e-6 || d.start + d.duration <= c.start + 1e-6, 'sin solapes');

  // ---------- emoji por categorías ----------
  const first = await page.locator('.add__emoji .add__tile').count();
  assert.ok(first >= 20);
  const firstEmoji = await page.locator('.add__emoji .add__tile').first().textContent();
  await page.locator('[data-group="comida"]').click();
  assert.equal(await page.locator('[data-group="comida"]').getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('[data-group="caras"]').getAttribute('aria-pressed'), 'false');
  const foods = await page.locator('.add__emoji .add__tile').allTextContents();
  assert.ok(foods.includes('🍕') && !foods.includes(firstEmoji), 'cambia el contenido de la rejilla');
  const before = Object.keys((await proj()).clips).length;
  await page.locator('.add__emoji [data-emoji="🍕"]').click();
  p = await proj();
  assert.equal(Object.keys(p.clips).length, before + 1);
  assert.ok(clips().some((c) => c.kind === 'text' && c.text.content === '🍕'), 'el emoji se añade como clip de texto');
  let total = 0;
  for (const g of await page.locator('[data-group]').all()) { await g.click(); total += await page.locator('.add__emoji .add__tile').count(); }
  assert.ok(total >= 250, `emoji disponibles: ${total}`);

  // ---------- cortar un vídeo ----------
  await page.click('#tab-media');
  await page.setInputFiles('.media__file', [join(dir, 'con_audio.webm')]);
  const card = page.locator('.media__grid > li', { hasText: 'con_audio' });
  await card.waitFor({ timeout: 15000 });
  await card.locator('[data-act="add"]').click();
  await page.click('#tab-media');
  p = await proj();
  const video = clips().find((c) => c.kind === 'video');
  // Cursor fuera de todo clip: las tijeras siguen activas y explican qué hacer.
  await page.evaluate((t) => editorApp.editor.store.setPlayhead(t), video.start + video.duration + 10);
  await page.evaluate(() => editorApp.editor.store.select([]));
  assert.equal(await page.locator('[data-action="split"]').isDisabled(), false, 'tijeras activas con clips');
  await page.locator('[data-action="split"]').click();
  assert.match(await page.locator('.tl__status').textContent(), /cursor no está sobre ningún clip/);
  // Cursor dentro del clip: corta en dos.
  await page.evaluate(([t, id]) => { const { store } = editorApp.editor; store.setPlayhead(t); store.select([id]); }, [video.start + 1, video.id]);
  await page.locator('[data-action="split"]').click();
  p = await proj();
  const parts = clips().filter((c) => c.kind === 'video').sort((a, b) => a.start - b.start);
  assert.equal(parts.length, 2);
  near(parts[0].duration, 1, 0.01, 'la primera parte dura 1 s');
  near(parts[1].start, parts[0].start + parts[0].duration, 0.01, 'las partes son contiguas');
  near(parts[0].duration + parts[1].duration, video.duration, 0.01, 'no se pierde nada');
  // La ayuda explica cómo cortar.
  await page.click('[data-act="help"]');
  assert.match(await page.locator('dialog.dlg').textContent(), /Cortar y recortar/);
  await page.keyboard.press('Escape');
  assert.deepEqual(app.errors, []);
  console.log('addpanel.browser: OK');
} finally {
  await app.close();
}
function near(a, b, tol, msg) { assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} no es ${b} ±${tol}`); }
