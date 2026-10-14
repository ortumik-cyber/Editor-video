// Prueba del reproductor en Chromium real: píxeles del lienzo, sincronía y audio medido.
// Uso: npm run test:browser
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { launch, makeMedia } from './helpers.mjs';

const dir = makeMedia();
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} no es ${b} ±${tol}`);
const app = await launch({ viewport: { width: 1000, height: 1000 } });
const { page } = app;

const px = (fx, fy) => page.evaluate(([x, y]) => {
  const c = document.querySelector('.pv__canvas');
  return [...c.getContext('2d').getImageData(Math.floor(x * c.width), Math.floor(y * c.height), 1, 1).data].slice(0, 3);
}, [fx, fy]);
const isRed = ([r, g, b]) => r > 200 && g < 50 && b < 50;
const isGreen = ([r, g, b]) => g > 100 && r < 50 && b < 50;
const isBlack = ([r, g, b]) => r < 12 && g < 12 && b < 12;

/** Ejecuta una acción y espera a que el reproductor termine de dibujar el fotograma fijo resultante. */
async function settle(action) {
  const before = await page.evaluate(() => player.stats.stills);
  await action();
  await page.waitForFunction((n) => player.stats.stills > n, before, { timeout: 8000 });
}
const run = (fn, arg) => page.evaluate(fn, arg);
const clipOf = (name) => run((n) => { const p = store.getProject(); return Object.values(p.clips).find((c) => p.assets[c.assetId]?.name === n); }, name);
const level = () => run(() => player.getLevel());
const peakLevel = (ms) => run(async (t) => { let m = 0; const end = performance.now() + t; while (performance.now() < end) { m = Math.max(m, player.getLevel()); await new Promise((r) => setTimeout(r, 30)); } return m; }, ms);

try {
  await page.goto(`${app.base}/dev/editor.html`);
  await page.setInputFiles('#files', ['rojo.webm', 'verde.png', 'musica.wav', 'con_audio.webm'].map((n) => join(dir, n)));
  await page.waitForSelector('.asset >> nth=3');
  await page.click('.asset >> nth=0'); // rojo.webm: vídeo rojo de 3 s con tono, en la pista base
  await page.click('.asset >> nth=2'); // musica.wav: audio de 4 s
  await page.waitForSelector('.tl__clip >> nth=1');

  // --- encuadre: el lienzo conserva la proporción 9:16 del proyecto
  const box = await page.locator('.pv__canvas').boundingBox();
  near(box.width / box.height, 9 / 16, 0.01, 'proporción del lienzo');

  // --- fotograma fijo: vídeo rojo centrado, barras negras arriba (ajuste contain)
  await settle(() => run(() => store.setPlayhead(1)));
  assert.ok(isRed(await px(0.5, 0.5)), `centro rojo ${await px(0.5, 0.5)}`);
  assert.ok(isBlack(await px(0.5, 0.1)), 'barra negra arriba');
  assert.ok(isBlack(await px(0.05, 0.5)) === false, 'el vídeo llena el ancho');

  // --- ajuste cover: sin barras
  const red = await clipOf('rojo.webm');
  await settle(() => run((id) => store.dispatch({ type: 'clip/update', clipId: id, patch: { fit: 'cover' } }), red.id));
  assert.ok(isRed(await px(0.5, 0.1)), 'cover rellena arriba');
  await settle(() => run((id) => store.dispatch({ type: 'clip/update', clipId: id, patch: { fit: 'contain' } }), red.id));
  assert.ok(isBlack(await px(0.5, 0.1)));

  // --- capa superior (imagen verde), opacidad, transformación y fundido
  await run(async () => {
    store.dispatch({ type: 'track/add', kind: 'video', index: 1 });
    const upper = store.getProject().tracks[1];
    const asset = Object.values(store.getProject().assets).find((a) => a.name === 'verde.png');
    const { createClip } = await import('/src/core/index.js');
    const clip = createClip({ trackId: upper.id, kind: 'image', assetId: asset.id, start: 0, duration: 3 });
    store.dispatch({ type: 'clip/add', clip });
  });
  const green = await clipOf('verde.png');
  await settle(() => run(() => store.setPlayhead(1.5)));
  assert.ok(isGreen(await px(0.5, 0.5)), `la capa superior tapa: ${await px(0.5, 0.5)}`);

  await settle(() => run((id) => store.dispatch({ type: 'clip/update', clipId: id, patch: { transform: { opacity: 0.5 } } }), green.id));
  const mix = await px(0.5, 0.5);
  assert.ok(mix[0] > 100 && mix[0] < 150 && mix[1] > 40 && mix[1] < 90, `mezcla 50 %: ${mix}`);

  await settle(() => run((id) => store.dispatch({ type: 'clip/update', clipId: id, patch: { transform: { opacity: 1, scale: 0.25, x: 0.25 } } }), green.id));
  assert.ok(isGreen(await px(0.75, 0.5)), 'imagen reducida y desplazada a la derecha');
  assert.ok(isRed(await px(0.5, 0.5)), 'el vídeo asoma en el centro');

  await settle(() => run((id) => store.dispatch({ type: 'clip/update', clipId: id, patch: { transform: { scale: 1, x: 0 }, fadeIn: 2 } }), green.id));
  await settle(() => run(() => store.setPlayhead(1)));
  const fading = await px(0.5, 0.5);
  assert.ok(fading[0] > 100 && fading[1] > 40, `fundido a mitad: ${fading}`);
  await settle(() => run(() => store.setPlayhead(0)));
  assert.ok(isRed(await px(0.5, 0.5)), 'al inicio del fundido solo se ve el vídeo');
  await run((id) => store.dispatch({ type: 'clip/remove', clipId: id }), green.id);

  // --- texto: píxeles blancos en el centro
  await run(async () => {
    const { addTextClip } = await import('/src/timeline/index.js');
    store.setPlayhead(1);
    addTextClip(store, { text: { content: 'HOLA', size: 200, color: '#ffffff' } });
  });
  await settle(() => run(() => store.setPlayhead(1.2)));
  const whites = await run(() => {
    const c = document.querySelector('.pv__canvas');
    const d = c.getContext('2d').getImageData(0, Math.floor(c.height * 0.4), c.width, Math.floor(c.height * 0.2)).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] > 230 && d[i + 1] > 230 && d[i + 2] > 230) n++;
    return n;
  });
  assert.ok(whites > 300, `texto dibujado (${whites} píxeles blancos)`);
  const textClip = await run(() => Object.values(store.getProject().clips).find((c) => c.kind === 'text'));
  await run((id) => store.dispatch({ type: 'clip/remove', clipId: id }), textClip.id);

  // --- reproducción: avanza en tiempo real, dibuja fotogramas y pausa
  await run(() => store.setPlayhead(0));
  await page.waitForTimeout(300);
  await run(() => player.play());
  assert.equal(await run(() => player.isPlaying()), true);
  await page.waitForTimeout(1500);
  const head = await run(() => store.getState().playhead);
  assert.ok(head > 1.1 && head < 2.0, `reloj en tiempo real: ${head}`);
  const frames = await run(() => player.stats.frames);
  assert.ok(frames > 15, `fotogramas dibujados en 1,5 s: ${frames}`);
  console.log(`  reproducción: ${frames} fotogramas en 1,5 s (~${Math.round(frames / 1.5)} fps), cursor en ${head.toFixed(2)} s`);

  // --- sincronía: el elemento de vídeo sigue al reloj
  const drift = await run(() => {
    const clip = Object.values(store.getProject().clips).find((c) => c.kind === 'video');
    const entry = player.debug().find((e) => e.clipId === clip.id);
    return { diff: entry.time - (store.getState().playhead - clip.start + clip.in), paused: entry.paused };
  });
  assert.equal(drift.paused, false);
  assert.ok(Math.abs(drift.diff) < 0.3, `deriva vídeo/reloj: ${drift.diff.toFixed(3)} s`);

  // --- audio medido: suena el audio, calla al silenciar la pista y al bajar el volumen
  // (el cursor vuelve atrás para que la reproducción no termine antes de acabar las mediciones)
  await run(() => store.setPlayhead(0.2));
  assert.equal(await run(() => player.audioState()), 'running');
  const sound = await peakLevel(500);
  assert.ok(sound > 0.02, `nivel con sonido: ${sound}`);
  const trackIds = await run(() => store.getProject().tracks.map((t) => ({ id: t.id, kind: t.kind })));
  const audioTrack = trackIds.find((t) => t.kind === 'audio');
  const videoTrack = trackIds[0];
  await run(([a, v]) => { store.dispatch({ type: 'track/update', trackId: a, patch: { muted: true } }); store.dispatch({ type: 'track/update', trackId: v, patch: { muted: true } }); }, [audioTrack.id, videoTrack.id]);
  await page.waitForTimeout(250);
  const silent = await peakLevel(400);
  assert.ok(silent < 0.005, `nivel con pistas silenciadas: ${silent}`);
  await run(([a, v]) => { store.dispatch({ type: 'track/update', trackId: a, patch: { muted: false } }); store.dispatch({ type: 'track/update', trackId: v, patch: { muted: false } }); }, [audioTrack.id, videoTrack.id]);
  await page.waitForTimeout(250);
  assert.ok((await peakLevel(400)) > 0.02, 'vuelve el sonido');
  const song = await clipOf('musica.wav');
  const redNow = await clipOf('rojo.webm');
  await run(([s, r]) => { store.dispatch({ type: 'clip/update', clipId: s, patch: { volume: 0 } }); store.dispatch({ type: 'clip/update', clipId: r, patch: { volume: 0 } }); }, [song.id, redNow.id]);
  await page.waitForTimeout(250);
  assert.ok((await peakLevel(400)) < 0.005, 'volumen 0 = silencio');
  await run(([s, r]) => { store.dispatch({ type: 'clip/update', clipId: s, patch: { volume: 1 } }); store.dispatch({ type: 'clip/update', clipId: r, patch: { volume: 1 } }); }, [song.id, redNow.id]);

  // --- salto del cursor durante la reproducción
  await run(() => store.setPlayhead(2.2));
  await page.waitForTimeout(400);
  const jumped = await run(() => {
    const clip = Object.values(store.getProject().clips).find((c) => c.kind === 'video');
    const entry = player.debug().find((e) => e.clipId === clip.id);
    return { head: store.getState().playhead, diff: entry ? entry.time - (store.getState().playhead - clip.start + clip.in) : null, playing: player.isPlaying() };
  });
  assert.equal(jumped.playing, true, 'sigue reproduciendo tras el salto');
  assert.ok(jumped.head > 2.4 && jumped.head < 3.2, `continúa desde donde saltó: ${jumped.head}`);
  assert.ok(Math.abs(jumped.diff) < 0.35, `el vídeo se recoloca tras el salto: ${jumped.diff}`);

  // --- al llegar al final se detiene con el cursor al final
  const total = await run(async () => (await import('/src/core/index.js')).projectDuration(store.getProject()));
  await page.waitForFunction(() => !player.isPlaying(), null, { timeout: 8000 });
  near(await run(() => store.getState().playhead), total, 0.01, 'cursor al final');

  // --- reproducir desde el final reinicia desde el principio
  await run(() => player.play());
  await page.waitForTimeout(300);
  assert.ok((await run(() => store.getState().playhead)) < 1, 'play desde el final reinicia');
  await run(() => player.pause());
  assert.equal(await run(() => player.isPlaying()), false);

  // --- velocidad 2x: el elemento de vídeo recibe playbackRate 2 y el clip dura la mitad
  await run((id) => store.dispatch({ type: 'clip/update', clipId: id, patch: { speed: 2 } }), redNow.id);
  near((await clipOf('rojo.webm')).duration, 1.5, 0.01, 'duración con 2x');
  await run(() => { store.setPlayhead(0); player.play(); });
  await page.waitForTimeout(500);
  assert.equal(await run((id) => player.debug().find((e) => e.clipId === id)?.rate, redNow.id), 2);
  await run(() => player.pause());
  await run((id) => store.dispatch({ type: 'clip/update', clipId: id, patch: { speed: 1 } }), redNow.id);

  // --- arrastrar el cursor deprisa: gana la última petición y el fotograma es el de ese instante
  await page.click('.asset >> nth=3'); // con_audio.webm (testsrc: cada fotograma es distinto)
  const hash = () => run(() => {
    const c = document.querySelector('.pv__canvas');
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let h = 0;
    for (let i = 0; i < d.length; i += 4) h = (h * 31 + d[i] + d[i + 1] * 3 + d[i + 2] * 7) | 0;
    return h;
  });
  const testsrcStart = (await clipOf('con_audio.webm')).start;
  const target = testsrcStart + 1.5;
  await settle(() => run((t) => store.setPlayhead(t), testsrcStart + 0.2));
  const early = await hash();
  await settle(() => run((t) => store.setPlayhead(t), target));
  const direct = await hash();
  assert.notEqual(early, direct, 'los fotogramas de testsrc cambian con el tiempo');
  await settle(() => run((t) => store.setPlayhead(t), testsrcStart + 0.2));
  await settle(() => run((s) => { for (const dt of [0.4, 1.0, 0.7, 1.3, 0.9]) store.setPlayhead(s + dt); store.setPlayhead(s + 1.5); }, testsrcStart));
  assert.equal(await hash(), direct, 'tras arrastrar deprisa se dibuja el fotograma del último instante');

  // --- teclado y botones
  await run(() => store.setPlayhead(0));
  await page.waitForTimeout(200);
  await page.mouse.click(5, 500);
  await page.keyboard.press('Space');
  assert.equal(await run(() => player.isPlaying()), true, 'Espacio reproduce');
  assert.equal(await page.locator('[data-pv="play"]').getAttribute('aria-label'), 'Pausar');
  await page.keyboard.press('Space');
  assert.equal(await run(() => player.isPlaying()), false, 'Espacio pausa');
  await page.click('[data-pv="play"]');
  assert.equal(await run(() => player.isPlaying()), true, 'el botón reproduce');
  await page.click('[data-pv="play"]');
  assert.equal(await page.locator('[data-pv="play"]').getAttribute('aria-label'), 'Reproducir');
  await page.click('[data-pv="start"]');
  near(await run(() => store.getState().playhead), 0, 0.001, 'ir al inicio');
  assert.match(await page.locator('.pv__time').textContent(), /^0:00\.0 \/ \d+:\d\d\.\d$/);
  for (const b of await page.locator('.pv__btn').all()) {
    assert.ok(await b.getAttribute('aria-label'));
    const bb = await b.boundingBox();
    assert.ok(bb.width >= 44 && bb.height >= 44, `objetivo táctil ${bb.width}x${bb.height}`);
  }

  assert.deepEqual(app.errors, []);
  console.log('player.browser: OK');
} finally {
  await app.close();
}
