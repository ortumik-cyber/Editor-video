// Efectos de sonido sintetizados: importación real, duración, onda, reutilización y sonido medido.
// Uso: npm run test:browser
import assert from 'node:assert/strict';
import { launch, pageTools } from './helpers.mjs';

const app = await launch({ viewport: { width: 1100, height: 1300 } });
const { page } = app;
const { run } = pageTools(page);
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} no es ${b} ±${tol}`);
const peakLevel = (ms) => run(async (t) => { let m = 0; const end = performance.now() + t; while (performance.now() < end) { m = Math.max(m, player.getLevel()); await new Promise((r) => setTimeout(r, 20)); } return m; }, ms);

try {
  await page.goto(`${app.base}/dev/editor.html`);
  await page.waitForFunction(() => window.player);
  await page.click('.adder summary');
  const sfx = await run(async () => (await import('/src/audio/sfx.js')).SFX.map((s) => ({ id: s.id, duration: s.duration, label: s.label })));
  assert.ok(sfx.length >= 9);
  assert.equal(await page.locator('[data-sfx]').count(), sfx.length);

  // ---------- cada sonido se importa como un audio real ----------
  for (const [i, s] of sfx.entries()) {
    await run((t) => store.setPlayhead(t), i * 2); // separados en el tiempo: caben en la misma pista
    await page.click(`[data-sfx="${s.id}"]`);
    await page.waitForFunction((n) => Object.values(store.getProject().clips).filter((c) => c.kind === 'audio').length === n, i + 1);
    const clip = await run(() => store.getProject().clips[store.getState().selection[0]]);
    const asset = await run((id) => store.getProject().assets[id], clip.assetId);
    assert.equal(asset.name, `sfx-${s.id}.wav`);
    assert.equal(asset.kind, 'audio');
    near(asset.duration, s.duration, 0.02, `${s.id}: duración del WAV decodificado por el navegador`);
    assert.ok(asset.peaks?.length >= 50 && Math.max(...asset.peaks) > 20, `${s.id}: tiene onda con contenido`);
    near(clip.start, i * 2, 1e-9, `${s.id}: en el cursor`);
    assert.equal(clip.duration, asset.duration);
  }
  const state = await run(() => { const p = store.getProject(); return { audioTracks: p.tracks.filter((t) => t.kind === 'audio').length, assets: Object.keys(p.assets).length, audios: Object.values(p.clips).filter((c) => c.kind === 'audio').length }; });
  assert.equal(state.audioTracks, 1, 'separados en el tiempo, todos en una sola pista de audio');
  assert.equal(state.assets, sfx.length);
  assert.equal(state.audios, sfx.length);

  // ---------- reutilizar el medio y solapar ----------
  await run(() => store.setPlayhead(0.1)); // dentro del primer sonido
  await page.click('[data-sfx="ding"]');
  await page.waitForFunction(() => Object.values(store.getProject().clips).filter((c) => c.kind === 'audio').length > 9);
  const after = await run(() => { const p = store.getProject(); return { assets: Object.keys(p.assets).length, tracks: p.tracks.filter((t) => t.kind === 'audio').length }; });
  assert.equal(after.assets, sfx.length, 'el segundo ding reutiliza el medio');
  assert.equal(after.tracks, 2, 'al solapar con otro sonido va a una pista de audio nueva');
  await page.click('[data-sfx="ding"]', { clickCount: 2, delay: 5 });
  await page.waitForTimeout(300);
  assert.equal(await run(() => Object.keys(store.getProject().assets).length), sfx.length, 'doble clic rápido: un solo medio');

  // ---------- suenan de verdad ----------
  await run(() => { for (const c of Object.values(store.getProject().clips)) store.dispatch({ type: 'clip/remove', clipId: c.id }); store.setPlayhead(0); });
  await page.click('[data-sfx="ding"]');
  await page.waitForFunction(() => Object.values(store.getProject().clips).length === 1);
  await run(() => { store.setPlayhead(0); player.play(); });
  await page.waitForTimeout(120);
  const level = await peakLevel(250);
  await run(() => player.pause());
  assert.ok(level > 0.05, `la campanilla suena (nivel ${level.toFixed(3)})`);

  // la onda del timeline se dibuja
  assert.ok(await page.locator('.tl__clip--audio .tl__wave path').count());

  // ---------- accesibilidad ----------
  for (const b of await page.locator('[data-sfx]').all()) {
    assert.ok((await b.textContent()).trim().length > 2);
    assert.ok((await b.boundingBox()).height >= 44);
  }
  assert.deepEqual(app.errors, []);
  console.log('sfx.browser: OK');
} finally {
  await app.close();
}
