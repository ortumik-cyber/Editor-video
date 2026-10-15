// Locución con micrófono (dispositivo falso de Chromium) y medidor de nivel.
// Uso: npm run test:browser
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { launch, makeMedia, pageTools } from './helpers.mjs';

const dir = makeMedia();
const app = await launch({ viewport: { width: 1100, height: 1300 }, args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'], permissions: ['microphone'] });
const { page } = app;
const { run } = pageTools(page);
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} no es ${b} ±${tol}`);
const audioClips = () => run(() => { const p = store.getProject(); return Object.values(p.clips).filter((c) => c.kind === 'audio').map((c) => ({ ...c, asset: p.assets[c.assetId] })); });
const state = () => run(() => player.constructor && document.querySelector('[data-pv="record"]').getAttribute('aria-pressed'));
/** Nivel máximo del micrófono durante `ms`. */
const micPeak = (ms) => run(async (t) => { let m = 0; const end = performance.now() + t; while (performance.now() < end) { m = Math.max(m, window.recorder.micLevel()); await new Promise((r) => setTimeout(r, 25)); } return m; }, ms);

try {
  await page.goto(`${app.base}/dev/editor.html`);
  await page.waitForFunction(() => window.player && window.recorder);
  await page.setInputFiles('#files', [join(dir, 'rojo.webm')]);
  await page.waitForSelector('.asset');
  await page.click('.asset');
  await run(() => store.setPlayhead(0.5));

  // ---------- grabar: empieza, reproduce el vídeo, mide el micrófono y se muestra ----------
  assert.equal(await page.locator('[data-pv="record"]').getAttribute('aria-label'), 'Grabar locución');
  await page.click('[data-pv="record"]');
  await page.waitForFunction(() => window.recorder.getState() === 'recording');
  assert.equal(await page.locator('[data-pv="record"]').getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('[data-pv="record"]').getAttribute('aria-label'), 'Detener la grabación');
  assert.equal(await page.locator('.pv__rec').isVisible(), true);
  assert.equal(await run(() => player.isPlaying()), true, 'el vídeo avanza mientras se graba');
  const peak = await micPeak(2200); // el micrófono falso emite un pitido cada segundo
  assert.ok(peak > 0.01, `el micrófono tiene señal (${peak.toFixed(3)})`);
  assert.match(await page.locator('.pv__rec').textContent(), /Grabando 0:0\d\.\d/);
  const meterWidth = await page.locator('.pv__meter i').evaluate((el) => parseFloat(el.style.width));
  assert.ok(meterWidth >= 0, 'el medidor se actualiza');

  // ---------- parar: se importa y se coloca donde empezó ----------
  await page.click('[data-pv="record"]');
  await page.waitForFunction(() => Object.values(store.getProject().clips).filter((c) => c.kind === 'audio').length === 1, null, { timeout: 15000 });
  assert.equal(await run(() => player.isPlaying()), false, 'al parar el vídeo se detiene');
  assert.equal(await page.locator('[data-pv="record"]').getAttribute('aria-pressed'), 'false');
  assert.equal(await page.locator('.pv__rec').isHidden(), true);
  let [voice] = await audioClips();
  assert.match(voice.asset.name, /^locucion-1\.(webm|m4a|ogg)$/);
  near(voice.start, 0.5, 1e-9, 'donde estaba el cursor al empezar');
  assert.ok(voice.duration > 1.5 && voice.duration < 4, `duración de la grabación: ${voice.duration}`);
  assert.equal(voice.asset.kind, 'audio');
  assert.ok(voice.asset.peaks?.length >= 50 && Math.max(...voice.asset.peaks) > 5, 'tiene onda con contenido (el pitido)');
  assert.deepEqual(await run(() => store.getState().selection), [voice.id], 'queda seleccionada');
  assert.ok(await page.locator('.tl__clip--audio .tl__wave path').count());

  // ---------- una segunda grabación que solapa va a otra pista ----------
  await run(() => store.setPlayhead(1));
  await page.click('[data-pv="record"]');
  await page.waitForFunction(() => window.recorder.getState() === 'recording');
  await page.waitForTimeout(1300);
  await page.click('[data-pv="record"]');
  await page.waitForFunction(() => Object.values(store.getProject().clips).filter((c) => c.kind === 'audio').length === 2, null, { timeout: 15000 });
  const clips = await audioClips();
  assert.equal(clips.length, 2);
  assert.notEqual(clips[0].trackId, clips[1].trackId, 'solapan: pistas de audio distintas');
  assert.match(clips[1].asset.name, /locucion-2/);

  // ---------- grabación demasiado corta ----------
  const before = await run(() => Object.keys(store.getProject().assets).length);
  await page.evaluate(async () => { await window.recorder.start(); try { await window.recorder.stop(); } catch (e) { window.__err = e.code; } });
  assert.equal(await run(() => window.__err), 'too_short');
  assert.equal(await run(() => Object.keys(store.getProject().assets).length), before, 'no se importa nada');
  assert.equal(await run(() => window.recorder.getState()), 'idle');

  // ---------- cancelar descarta la grabación ----------
  await run(async () => { await window.recorder.start(); });
  await page.waitForTimeout(600);
  await run(async () => { await window.recorder.cancel(); });
  assert.equal(await run(() => window.recorder.getState()), 'idle');
  assert.equal(await run(() => Object.keys(store.getProject().assets).length), before, 'cancelar no deja medios');
  assert.equal(await run(() => player.isPlaying()), false);

  // ---------- errores de permiso y de dispositivo, con mensaje claro ----------
  for (const [name, expected] of [['NotAllowedError', /Permiso del micrófono denegado/], ['NotFoundError', /ningún micrófono/], ['NotReadableError', /en uso/]]) {
    await run((n) => {
      const real = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      window.__realGum ??= real;
      navigator.mediaDevices.getUserMedia = () => Promise.reject(Object.assign(new Error('x'), { name: n }));
    }, name);
    await page.click('[data-pv="record"]');
    await page.waitForFunction((re) => new RegExp(re).test(document.getElementById('msg').textContent), expected.source);
    assert.match(await page.locator('#msg').textContent(), expected, name);
    assert.equal(await run(() => window.recorder.getState()), 'idle', `${name}: no queda grabando`);
    assert.equal(await page.locator('[data-pv="record"]').getAttribute('aria-pressed'), 'false');
  }
  await run(() => { navigator.mediaDevices.getUserMedia = window.__realGum; });

  // ---------- el medidor de nivel sigue al sonido al reproducir ----------
  await run(async () => {
    for (const c of Object.values(store.getProject().clips)) store.dispatch({ type: 'clip/remove', clipId: c.id });
    const { addAudioClip } = await import('/src/timeline/actions.js');
    const { SFX, sfxFile } = await import('/src/audio/sfx.js');
    const { added } = await library.importFiles([sfxFile(SFX.find((s) => s.id === 'rise'))]);
    addAudioClip(store, added[0].id, { at: 0 });
    store.setPlayhead(0);
    player.play();
  });
  await page.waitForTimeout(900);
  const width = await page.locator('.pv__meter i').evaluate((el) => parseFloat(el.style.width));
  await run(() => player.pause());
  assert.ok(width > 5, `el medidor sube con el sonido (${width}%)`);
  await page.waitForTimeout(100);
  assert.equal(await page.locator('.pv__meter i').evaluate((el) => el.style.width), '0%', 'y vuelve a cero al parar');

  // ---------- accesibilidad ----------
  const rb = await page.locator('[data-pv="record"]').boundingBox();
  assert.ok(rb.width >= 44 && rb.height >= 44);
  assert.equal(await page.locator('.pv__meter').getAttribute('aria-hidden'), 'true');
  assert.deepEqual(app.errors, []);
  console.log('voice.browser: OK');
} finally {
  await app.close();
}
