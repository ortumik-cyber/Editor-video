// PWA: instalación, funcionamiento sin conexión y aviso de actualización.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { launch } from './helpers.mjs';

const app = await launch({ viewport: { width: 390, height: 780 }, serviceWorkers: 'allow' });
const { page } = app;
const root = join(import.meta.dirname, '..', '..');
const swPath = join(root, 'sw.js');
const swOriginal = readFileSync(swPath, 'utf8');
const precachePath = join(root, 'precache.json');
const precacheOriginal = readFileSync(precachePath, 'utf8');
try {
  // Sin ?sw en localhost no se registra nada.
  await page.goto(`${app.base}/index.html`);
  await page.waitForSelector('#app[data-ready="true"]');
  assert.equal(await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length), 0);

  // Manifiesto e iconos.
  const manifest = await (await page.request.get(`${app.base}/manifest.webmanifest`)).json();
  assert.equal(manifest.display, 'standalone');
  assert.ok(manifest.icons.some((i) => i.purpose === 'maskable'));
  for (const icon of manifest.icons) assert.equal((await page.request.get(`${app.base}/${icon.src}`)).status(), 200, icon.src);
  assert.equal(await page.locator('link[rel="manifest"]').count(), 1);

  // Instalación.
  await page.goto(`${app.base}/index.html?sw`);
  await page.waitForSelector('#app[data-ready="true"]');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await page.waitForFunction(() => navigator.serviceWorker.controller);
  const precache = JSON.parse(precacheOriginal);
  const cached = await page.evaluate(async () => { const c = await caches.open((await caches.keys())[0]); return (await c.keys()).map((r) => new URL(r.url).pathname.slice(1)); });
  for (const f of precache.files) assert.ok(cached.includes(f), `${f} no está en la caché`);

  // Sin conexión: la app arranca y crea un proyecto.
  // Sin servidor de verdad: setOffline no afecta a las peticiones del propio service worker.
  app.server.closeAllConnections();
  await new Promise((done) => app.server.close(done));
  await page.goto(`${app.base}/index.html?sw`);
  await page.waitForSelector('#app[data-ready="true"]');
  await page.locator('.home__top [data-act="new"]').click();
  await page.fill('#dlg-name', 'Sin red');
  await page.locator('.dlg__btn--primary').click();
  await page.waitForSelector('.editor');
  assert.equal(await page.locator('.ed__title').textContent(), 'Sin red');
  // Un archivo de la app que nunca se pidió con red también llega desde la caché (renderizador WebGL, muxer).
  const ok = await page.evaluate(async () => (await fetch('vendor/mp4-muxer.mjs')).ok && (await fetch('src/render/gl.js')).ok);
  assert.ok(ok);

  // Versión nueva (el servidor vuelve): sw.js cambia, queda esperando y el aviso la activa.
  await new Promise((done) => app.server.listen(Number(new URL(app.base).port), done));
  await page.goto(`${app.base}/index.html?sw`);
  await page.waitForSelector('#app[data-ready="true"]');
  const v1 = (await page.evaluate(async () => (await caches.keys())[0]));
  writeFileSync(swPath, swOriginal.replace(/const BUILD = '[^']*';/, "const BUILD = 'prueba-nueva';"));
  writeFileSync(precachePath, JSON.stringify({ ...precache, version: 'prueba-nueva' }));
  await page.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => r.update()));
  await page.waitForSelector('.toast__action', { timeout: 10000 });
  assert.match(await page.locator('.toast').textContent(), /versión nueva/);
  await Promise.all([page.waitForEvent('load'), page.locator('.toast__action').click()]);
  await page.waitForSelector('#app[data-ready="true"]');
  await page.waitForFunction(async () => (await caches.keys()).length === 1);
  const v2 = await page.evaluate(async () => (await caches.keys())[0]);
  assert.notEqual(v1, v2);
  assert.equal(v2, 'editor-video-prueba-nueva');
  assert.deepEqual(app.errors, []);
  console.log('pwa.browser: OK');
} finally {
  writeFileSync(swPath, swOriginal);
  writeFileSync(precachePath, precacheOriginal);
  await app.close();
}
