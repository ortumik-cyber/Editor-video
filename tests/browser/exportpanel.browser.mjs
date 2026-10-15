// Panel de exportación: ajustes, estimación, progreso, cancelar, descargar, compartir, errores y preferencias.
// Uso: npm run test:browser
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launch, makeMedia, pageTools } from './helpers.mjs';

const dir = makeMedia();
const app = await launch({ viewport: { width: 1100, height: 1500 } });
const { page } = app;
const { run } = pageTools(page);

const summary = () => page.locator('[data-summary]').textContent();
const bytesOf = (text) => { const m = text.match(/unos ([\d.]+) (KB|MB|GB)/); return Number(m[1]) * { KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3 }[m[2]]; };

try {
  await page.goto(`${app.base}/dev/editor.html`);
  await page.waitForFunction(() => window.exportPanel);
  await page.click('#export-details summary');

  // ---------- vacío ----------
  assert.match(await summary(), /vacía/);
  assert.equal(await page.locator('[data-act="start"]').isDisabled(), true, 'sin contenido no se puede exportar');

  // ---------- con contenido ----------
  await page.setInputFiles('#files', ['rojo.webm', 'musica.wav'].map((n) => join(dir, n)));
  await page.waitForSelector('.asset >> nth=1');
  await page.click('.asset >> nth=0');
  await page.click('.asset >> nth=1');
  await page.waitForFunction(() => /Duración/.test(document.querySelector('[data-summary]').textContent));
  assert.match(await summary(), /Duración 0:04\.0 · 720×1280 · unos/);
  assert.equal(await page.locator('[data-act="start"]').isDisabled(), false);
  await page.waitForFunction(() => /Formato:/.test(document.querySelector('[data-format]').textContent));
  assert.match(await page.locator('[data-format]').textContent(), /WebM \(VP9\)/, 'sin H.264 en este navegador se anuncia WebM');
  assert.deepEqual(await page.locator('[data-field="short"] option').allTextContents(), ['480p · 480×854', '720p (HD) · 720×1280', '1080p (Full HD) · 1080×1920']);

  // estimación: cambia con resolución, fps y calidad
  const base = bytesOf(await summary());
  await page.selectOption('[data-field="short"]', '1080');
  assert.match(await summary(), /1080×1920/);
  assert.ok(bytesOf(await summary()) > base * 2, 'más resolución, más tamaño');
  await page.selectOption('[data-field="short"]', '480');
  const small = bytesOf(await summary());
  assert.ok(small < base / 1.8);
  await page.selectOption('[data-field="fps"]', '60');
  assert.ok(bytesOf(await summary()) > small * 1.7, 'el doble de fotogramas, casi el doble de tamaño');
  await page.selectOption('[data-field="fps"]', '24');
  await page.selectOption('[data-field="quality"]', 'high');
  const high = bytesOf(await summary());
  await page.selectOption('[data-field="quality"]', 'small');
  assert.ok(high > bytesOf(await summary()) * 2.5, 'alta calidad pesa bastante más que la pequeña');

  // ---------- exportar y descargar ----------
  await page.selectOption('[data-field="short"]', '480');
  await page.selectOption('[data-field="fps"]', '24');
  await page.selectOption('[data-field="quality"]', 'normal');
  await page.click('[data-act="start"]');
  await page.waitForSelector('[data-progress]:not([hidden])');
  assert.equal(await page.locator('[data-field="short"]').isDisabled(), true, 'durante la exportación los ajustes se bloquean');
  assert.equal(await page.locator('[data-act="start"]').isDisabled(), true);
  assert.ok(await page.locator('[data-progress] progress').getAttribute('aria-label'));
  await page.waitForSelector('[data-result]:not([hidden])', { timeout: 60000 });
  assert.equal(await page.locator('[data-progress]').isHidden(), true, 'al terminar se oculta el progreso');
  assert.equal(await page.locator('[data-field="short"]').isDisabled(), false, 'y se desbloquean los ajustes');
  const resultText = await page.locator('[data-result]').textContent();
  assert.match(resultText, /demo\.webm · [\d.]+ (KB|MB) · 480×854/);
  assert.equal(await page.evaluate(() => document.activeElement?.hasAttribute('data-result')), true, 'el foco pasa al resultado');
  const duration = await page.locator('.exp__video').evaluate((v) => new Promise((r) => (v.readyState >= 1 ? r(v.duration) : (v.onloadedmetadata = () => r(v.duration)))));
  assert.ok(Math.abs(duration - 4) < 0.15, `el vídeo del resultado dura ${duration}`);

  const [download] = await Promise.all([page.waitForEvent('download'), page.click('[data-act="download"]')]);
  assert.equal(download.suggestedFilename(), 'demo.webm');
  const saved = join(tmpdir(), `export-test-${Date.now()}.webm`);
  await download.saveAs(saved);
  const head = readFileSync(saved).subarray(0, 4);
  assert.deepEqual([...head], [0x1a, 0x45, 0xdf, 0xa3], 'el archivo descargado es un WebM');
  assert.ok(statSync(saved).size > 3000);
  assert.match(resultText, new RegExp(`${(statSync(saved).size / 1024).toFixed(0)} KB|${(statSync(saved).size / 1024 ** 2).toFixed(1)} MB`), 'el tamaño mostrado es el del archivo descargado');

  // ---------- sin compartir en este navegador; con compartir cuando existe ----------
  assert.equal(await page.locator('[data-act="share"]').count(), 0, 'sin Web Share para archivos no hay botón');
  await run(() => {
    navigator.canShare = () => true;
    navigator.share = async (data) => { window.__shared = { names: data.files.map((f) => f.name), types: data.files.map((f) => f.type), size: data.files[0].size }; };
  });
  await page.click('[data-act="start"]');
  await page.waitForSelector('[data-act="share"]', { timeout: 60000 });
  await page.click('[data-act="share"]');
  const shared = await run(() => window.__shared);
  assert.deepEqual(shared.names, ['demo.webm']);
  assert.deepEqual(shared.types, ['video/webm']);
  assert.ok(shared.size > 3000);

  // ---------- cancelar ----------
  await page.selectOption('[data-field="short"]', '1080');
  await page.selectOption('[data-field="fps"]', '60');
  await page.click('[data-act="start"]');
  await page.waitForFunction(() => /Fotograma \d+ de \d+/.test(document.querySelector('[data-progress-text]')?.textContent ?? ''));
  const midValue = await page.locator('[data-progress] progress').evaluate((p) => p.value);
  assert.ok(midValue >= 0 && midValue < 1);
  await page.click('[data-act="cancel"]');
  await page.waitForSelector('[data-progress][hidden]', { state: 'attached', timeout: 15000 });
  assert.equal(await page.locator('[data-result]').isHidden(), true, 'cancelar no deja resultado');
  assert.equal(await page.locator('[data-error]').isHidden(), true, 'ni error');
  assert.equal(await page.locator('[data-act="start"]').isDisabled(), false, 'se puede volver a exportar');
  assert.match(await page.locator('#msg').textContent(), /cancelada/);

  // ---------- error de codificación con mensaje claro ----------
  await run(() => {
    window.__realSupported = VideoEncoder.isConfigSupported.bind(VideoEncoder);
    VideoEncoder.isConfigSupported = async () => ({ supported: false });
  });
  await page.selectOption('[data-field="short"]', '480'); // dispara el recálculo
  await page.waitForFunction(() => /no puede|Formato/.test(document.querySelector('[data-format]').textContent));
  await run(() => window.exportPanel.refresh());
  await page.waitForFunction(() => document.querySelector('[data-act="start"]').disabled);
  assert.match(await page.locator('[data-format]').textContent(), /no puede exportar/);
  await run(() => { VideoEncoder.isConfigSupported = window.__realSupported; });
  await page.selectOption('[data-field="short"]', '720');
  await page.waitForFunction(() => !document.querySelector('[data-act="start"]').disabled);

  // ---------- el proyecto se congela al empezar: seguir editando no cambia el resultado ----------
  await page.selectOption('[data-field="short"]', '480');
  await page.selectOption('[data-field="fps"]', '24');
  await page.click('[data-act="start"]');
  await page.waitForSelector('[data-progress]:not([hidden])');
  await run(() => { for (const c of Object.values(store.getProject().clips)) store.dispatch({ type: 'clip/remove', clipId: c.id }); });
  await page.waitForSelector('[data-result]:not([hidden])', { timeout: 60000 });
  assert.match(await page.locator('[data-result]').textContent(), /demo\.webm/, 'terminó con el proyecto tal como estaba al empezar');
  assert.match(await summary(), /vacía/, 'y el panel ya refleja el proyecto vacío');
  assert.equal(await page.locator('[data-act="start"]').isDisabled(), true);

  // ---------- recuerda los ajustes ----------
  await page.reload();
  await page.waitForFunction(() => window.exportPanel);
  await page.click('#export-details summary');
  assert.equal(await page.locator('[data-field="short"]').inputValue(), '480');
  assert.equal(await page.locator('[data-field="fps"]').inputValue(), '24');
  assert.equal(await page.locator('[data-field="quality"]').inputValue(), 'normal');

  // ---------- accesibilidad ----------
  for (const el of await page.locator('.exp select').all()) assert.ok(await el.evaluate((s) => s.closest('label')?.textContent.trim().length > 3), 'select con etiqueta');
  for (const b of await page.locator('.exp .exp__btn:visible').all()) assert.ok((await b.boundingBox()).height >= 44, 'botón de al menos 44 px');
  assert.deepEqual(app.errors, []);
  console.log('exportpanel.browser: OK');
} finally {
  await app.close();
}
