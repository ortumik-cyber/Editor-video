// Panel de sonido, silencio de pista, separar audio y mezcla en transiciones, con nivel de sonido medido.
// Uso: npm run test:browser
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { launch, makeMedia, pageTools } from './helpers.mjs';

const dir = makeMedia();
const app = await launch({ viewport: { width: 1100, height: 1300 } });
const { page } = app;
const { run } = pageTools(page);
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} no es ${b} ±${tol}`);

const byName = (name) => run((n) => { const p = store.getProject(); return Object.values(p.clips).find((c) => p.assets[c.assetId]?.name === n && c.kind !== 'audio') ?? Object.values(p.clips).find((c) => p.assets[c.assetId]?.name === n); }, name);
const clipNow = (id) => run((x) => store.getProject().clips[x], id);
const trackNow = (id) => run((x) => store.getProject().tracks.find((t) => t.id === x), id);
const pick = (id) => run((x) => store.select([x]), id);
/** Nivel RMS máximo en una ventana de `ms` milisegundos (el cursor sigue avanzando si se reproduce). */
const peakLevel = (ms) => run(async (t) => { let m = 0; const end = performance.now() + t; while (performance.now() < end) { m = Math.max(m, player.getLevel()); await new Promise((r) => setTimeout(r, 25)); } return m; }, ms);
const playFrom = (t) => run((x) => { store.setPlayhead(x); player.play(); }, t);
const stop = () => run(() => player.pause());
/** Reproduce desde `t` y mide el nivel en una ventana: deja que el audio arranque antes de medir. */
async function levelAt(t, { settle = 250, window = 350 } = {}) {
  await playFrom(t);
  await page.waitForTimeout(settle);
  const level = await peakLevel(window);
  await stop();
  return level;
}

try {
  await page.goto(`${app.base}/dev/editor.html`);
  await page.setInputFiles('#files', ['rojo.webm', 'musica.wav'].map((n) => join(dir, n)));
  await page.waitForSelector('.asset >> nth=1');
  await page.click('.asset >> nth=0'); // vídeo rojo con tono de 440 Hz, 3 s
  await page.click('.asset >> nth=1'); // música de 220 Hz, 4 s
  const video = await byName('rojo.webm');
  const song = await byName('musica.wav');
  await run(() => { store.setPlayhead(0.1); });
  await page.waitForTimeout(500);

  // ---------- panel de sonido del audio ----------
  await pick(song.id);
  assert.equal(await page.locator('[data-prop="volume"]').count(), 1);
  assert.equal(await page.locator('[data-action="detach"]').count(), 0, 'un clip de audio no se separa');
  assert.equal(await page.locator('output[for="ins-p-volume"]').textContent(), '100%');
  await page.locator('#ins-p-volume').fill('1.5');
  assert.equal((await clipNow(song.id)).volume, 1.5);
  assert.equal(await page.locator('output[for="ins-p-volume"]').textContent(), '150%');
  await page.locator('output[for="ins-p-volume"]').dblclick();
  assert.equal((await clipNow(song.id)).volume, 1, 'doble toque restablece al 100 %');

  // ---------- el volumen se oye proporcional ----------
  await run((id) => store.dispatch({ type: 'clip/update', clipId: id, patch: { volume: 0 } }), video.id); // solo suena la música
  await page.locator('#ins-p-volume').fill('1');
  const at1 = await levelAt(0.3);
  assert.ok(at1 > 0.04, `la música suena (${at1.toFixed(3)})`);
  await page.locator('#ins-p-volume').fill('2');
  const at2 = await levelAt(0.3);
  near(at2 / at1, 2, 0.5, `al duplicar el volumen el nivel se duplica (${at1.toFixed(3)} → ${at2.toFixed(3)})`);
  await page.locator('#ins-p-volume').fill('0.5');
  const half = await levelAt(0.3);
  near(half / at1, 0.5, 0.15, 'y a la mitad baja a la mitad');

  // ---------- silenciar el clip ----------
  await page.locator('#ins-p-volume').fill('1');
  await page.click('[data-action="mute-clip"]');
  assert.equal((await clipNow(song.id)).volume, 0);
  assert.equal(await page.locator('[data-action="mute-clip"]').getAttribute('aria-pressed'), 'true');
  const silent = await levelAt(0.3);
  assert.ok(silent < 0.005, `clip silenciado: ${silent}`);
  await page.click('[data-action="mute-clip"]');
  assert.equal((await clipNow(song.id)).volume, 1, 'volver a pulsar lo reactiva');
  assert.ok((await levelAt(0.3)) > 0.04);

  // ---------- silenciar la pista desde la línea de tiempo (botón y tecla M) ----------
  const muteBtn = page.locator('[data-action="mute"]');
  assert.equal(await muteBtn.isDisabled(), false);
  assert.equal(await muteBtn.getAttribute('aria-pressed'), 'false');
  await muteBtn.click();
  assert.equal((await trackNow((await clipNow(song.id)).trackId)).muted, true);
  assert.equal(await muteBtn.getAttribute('aria-pressed'), 'true');
  assert.match(await muteBtn.getAttribute('aria-label'), /Activar el sonido/);
  assert.equal(await page.locator('.tl__row.is-muted').count(), 1, 'la pista silenciada se atenúa');
  assert.ok((await levelAt(0.3)) < 0.005, 'pista silenciada: no suena');
  await page.locator(`.tl__clip[data-clip-id="${song.id}"]`).focus();
  await page.keyboard.press('m');
  assert.equal((await trackNow((await clipNow(song.id)).trackId)).muted, false, 'la tecla M la reactiva');
  assert.ok((await levelAt(0.3)) > 0.04, 'y vuelve el sonido');
  await run(() => store.select([])); // sin selección el botón no actúa
  assert.equal(await muteBtn.isDisabled(), true);

  // ---------- fundido de entrada medido en el tiempo ----------
  await run((id) => store.select([id]), song.id);
  await page.locator('#ins-p-fadeIn').fill('2');
  assert.equal((await clipNow(song.id)).fadeIn, 2);
  await playFrom(0);
  await page.waitForTimeout(150);
  const early = await peakLevel(200);          // ~0,15-0,35 s: ganancia 0,07-0,17
  await page.waitForTimeout(1900);
  const late = await peakLevel(300);           // ~2,3-2,6 s: ganancia 1
  await stop();
  assert.ok(early < late * 0.45, `fundido de entrada: ${early.toFixed(3)} al principio, ${late.toFixed(3)} después`);
  assert.ok(late > 0.04);
  await page.locator('#ins-p-fadeIn').fill('3.5');
  await page.locator('#ins-p-fadeOut').fill('3.5'); // 3,5 + 3,5 > 4 s
  assert.match(await page.locator('.ins__status').textContent(), /superan/);
  assert.ok(Number(await page.locator('#ins-p-fadeOut').inputValue()) < 3.5, 'el control vuelve al valor real');
  await page.locator('#ins-p-fadeIn').fill('0');

  // ---------- velocidad del audio ----------
  await page.click('[data-speed="2"]');
  near((await clipNow(song.id)).duration, 2, 0.01, 'el audio a 2× dura la mitad');
  await page.click('[data-speed="1"]');

  // ---------- separar el audio de un vídeo ----------
  await run((id) => store.dispatch({ type: 'clip/update', clipId: id, patch: { volume: 1 } }), video.id);
  await pick(video.id);
  assert.equal(await page.locator('[data-action="detach"]').count(), 1, 'un vídeo con audio ofrece separarlo');
  const tracksBefore = await run(() => store.getProject().tracks.length);
  await page.click('[data-action="detach"]');
  assert.match(await page.locator('.ins__status').textContent(), /separado/i);
  const afterDetach = await run(() => { const p = store.getProject(); return { tracks: p.tracks.length, audios: Object.values(p.clips).filter((c) => c.kind === 'audio' && p.assets[c.assetId].name === 'rojo.webm') }; });
  assert.equal(afterDetach.audios.length, 1, 'aparece un clip de audio con el sonido del vídeo');
  assert.equal(afterDetach.tracks, tracksBefore + 1, 'en una pista nueva porque la música ocupa la otra');
  const detached = afterDetach.audios[0];
  const originalVideo = await clipNow(video.id);
  assert.deepEqual([detached.start, detached.duration, detached.in], [originalVideo.start, originalVideo.duration, originalVideo.in]);
  assert.equal(originalVideo.volume, 0, 'el vídeo queda silenciado');
  assert.equal(await page.locator('[data-action="mute-clip"]').getAttribute('aria-pressed'), 'true');
  assert.ok(await page.locator(`.tl__clip[data-clip-id="${detached.id}"] .tl__wave path`).count(), 'el clip separado muestra su onda');
  await run((id) => store.dispatch({ type: 'clip/update', clipId: id, patch: { volume: 0 } }), song.id);
  const detachedLevel = await levelAt(0.3);
  assert.ok(detachedLevel > 0.04, `el audio separado suena por sí solo (${detachedLevel.toFixed(3)})`);
  await run(() => store.undo()); // volumen de la música
  await run(() => store.undo()); // separar
  assert.equal(await run(() => Object.values(store.getProject().clips).filter((c) => c.kind === 'audio').length), 1, 'deshacer deshace la separación entera');
  assert.equal((await clipNow(video.id)).volume, 1);

  // ---------- transición: sin bache de volumen en el corte ----------
  await run(async () => {
    const { addAssetClip } = await import('/src/timeline/actions.js');
    for (const c of Object.values(store.getProject().clips)) if (c.kind === 'audio') store.dispatch({ type: 'clip/remove', clipId: c.id });
    store.setPlayhead(3);
    const asset = Object.values(store.getProject().assets).find((a) => a.name === 'rojo.webm');
    const r = addAssetClip(store, asset.id);
    store.dispatch({ type: 'clip/update', clipId: r.clipId, patch: { transition: { type: 'dissolve', duration: 1 } } });
    store.setPlayhead(0);
  });
  await page.waitForTimeout(400);
  await playFrom(1.6);
  await page.waitForTimeout(200);
  const before = await peakLevel(250);        // fuera de la ventana (2,5 a 3,5 s)
  await page.waitForTimeout(450);
  const cut = await peakLevel(450);           // ~2,7 a 3,15 s: dentro de la mezcla
  await stop();
  assert.ok(before > 0.04, `suena antes de la transición (${before.toFixed(3)})`);
  assert.ok(cut > before * 0.8, `sin bache en el corte: ${cut.toFixed(3)} frente a ${before.toFixed(3)}`);

  // ---------- accesibilidad ----------
  await pick(song.id);
  for (const el of await page.locator('.ins input, .ins button:visible').all()) {
    const id = await el.getAttribute('id');
    const named = (id && (await page.locator(`label[for="${id}"]`).count())) || (await el.getAttribute('aria-label')) || (await el.textContent()).trim();
    assert.ok(named, `control sin nombre: ${id}`);
  }
  for (const b of await page.locator('.ins .ins__chip:visible').all()) assert.ok((await b.boundingBox()).height >= 44);
  const tb = await muteBtn.boundingBox();
  assert.ok(tb.width >= 44 && tb.height >= 44);
  assert.deepEqual(app.errors, []);
  console.log('audio.browser: OK');
} finally {
  await app.close();
}
