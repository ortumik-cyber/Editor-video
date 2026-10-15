// Exportación: el archivo resultante se decodifica y se compara con la vista previa, fotograma a fotograma y en audio.
// Uso: npm run test:browser
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { launch, makeMedia, pageTools } from './helpers.mjs';

const dir = makeMedia();
const app = await launch({ viewport: { width: 1100, height: 1300 } });
const { page } = app;
const { run } = pageTools(page);
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} no es ${b} ±${tol}`);

/** Construye la escena de prueba: rojo -> (transición) -> verde, texto animado, sticker, y dos fuentes de audio. */
const buildScene = () => run(async () => {
  const { createClip } = await import('/src/core/index.js');
  const { addStyledText } = await import('/src/timeline/actions.js');
  for (const c of Object.values(store.getProject().clips)) store.dispatch({ type: 'clip/remove', clipId: c.id });
  const assets = Object.fromEntries(Object.values(store.getProject().assets).map((a) => [a.name, a]));
  const p0 = store.getProject();
  const base = p0.tracks.find((t) => t.kind === 'video');
  const audio = p0.tracks.find((t) => t.kind === 'audio');
  const add = (clip) => { const r = store.dispatch({ type: 'clip/add', clip }); if (!r.ok) throw new Error(r.error.message); return clip; };
  const red = add(createClip({ trackId: base.id, kind: 'video', assetId: assets['rojo.webm'].id, start: 0, duration: 1.5 }));
  const green = add(createClip({ trackId: base.id, kind: 'image', assetId: assets['verde.png'].id, start: 1.5, duration: 1.5 }));
  for (const c of [red, green]) store.dispatch({ type: 'clip/update', clipId: c.id, patch: { fit: 'cover' } });
  store.dispatch({ type: 'clip/update', clipId: green.id, patch: { transition: { type: 'dissolve', duration: 0.6 } } });
  store.dispatch({ type: 'effect/set', clipId: red.id, effectType: 'saturation', value: -0.2 });
  const song = add(createClip({ trackId: audio.id, kind: 'audio', assetId: assets['musica.wav'].id, start: 0, duration: 3 }));
  store.dispatch({ type: 'clip/update', clipId: song.id, patch: { volume: 0.5 } });
  const text = addStyledText(store, { font: 'Inter', weight: 700, size: 220, color: '#ffffff', shadow: false, animIn: 'fade', animInDuration: 0.5 }, 'HOLA');
  store.dispatch({ type: 'clip/update', clipId: text.clipId, patch: { text: { animIn: 'fade' } } });
  // sticker de dos mitades como superposición de 1 a 2,5 s
  const { addOverlayAsset } = await import('/src/timeline/actions.js');
  const sticker = addOverlayAsset(store, assets['mitad.png'].id, { at: 1, duration: 1.5, scale: 0.3 });
  store.dispatch({ type: 'clip/update', clipId: sticker.clipId, patch: { transform: { x: 0.2, y: 0.25, rotation: 15 } } });
  store.select([]);
  return true;
});

/** Exporta en la página y devuelve el resultado serializable más el archivo guardado para analizarlo. */
const exportScene = (settings, prefer = null) => run(async ([s, pref]) => {
  const { exportProject } = await import('/src/export/exporter.js');
  const events = [];
  const result = await exportProject({ project: store.getProject(), library, settings: s, prefer: pref, onProgress: (e) => events.push(e) });
  window.__export = result;
  const { blob, ...meta } = result;
  return { ...meta, events };
}, [settings, prefer]);

try {
  await page.goto(`${app.base}/dev/editor.html`);
  await page.waitForFunction(() => window.player);
  await page.setInputFiles('#files', ['rojo.webm', 'verde.png', 'musica.wav', 'mitad.png'].map((n) => join(dir, n)));
  await page.waitForSelector('.asset >> nth=3');
  await page.waitForTimeout(500);
  await buildScene();
  await run(() => store.setPlayhead(0));

  // ---------- exportar ----------
  const settings = { short: 240, fps: 15, quality: 'high' };
  const out = await exportScene(settings);
  console.log(`  exportación: ${out.frames} fotogramas en ${out.seconds.toFixed(1)} s (${(out.frames / out.seconds).toFixed(1)} fps), ${(out.bytes / 1024).toFixed(0)} KB, ${out.container}/${out.videoCodec}/${out.audioCodec}`);
  assert.equal(out.container, 'webm', 'sin H.264 en este navegador, WebM');
  assert.match(out.videoCodec, /^vp09/);
  assert.equal(out.audioCodec, 'opus');
  assert.deepEqual([out.width, out.height, out.fps, out.frames], [240, 426, 15, 45]);
  assert.equal(out.mime, 'video/webm');
  assert.equal(out.filename, 'demo.webm');
  assert.ok(out.bytes > 5000);
  assert.deepEqual(out.warnings, []);

  // progreso: fases en orden, monótono y completo
  const phases = [...new Set(out.events.map((e) => e.phase))];
  assert.deepEqual(phases, ['video', 'audio', 'finalizing']);
  for (const phase of phases) {
    const done = out.events.filter((e) => e.phase === phase).map((e) => e.done);
    assert.deepEqual(done, [...done].sort((a, b) => a - b), `${phase}: progreso no decreciente`);
  }
  const lastVideo = out.events.filter((e) => e.phase === 'video').at(-1);
  assert.deepEqual([lastVideo.done, lastVideo.total], [45, 45]);

  // ---------- el archivo se reproduce y mide lo que debe ----------
  const media = await run(async () => {
    const blob = window.__export.blob;
    const video = document.createElement('video');
    video.muted = true;
    video.src = URL.createObjectURL(blob);
    await new Promise((resolve, reject) => { video.onloadedmetadata = resolve; video.onerror = () => reject(new Error('no se puede reproducir el archivo exportado')); });
    return { duration: video.duration, width: video.videoWidth, height: video.videoHeight, head: Array.from(new Uint8Array(await blob.slice(0, 4).arrayBuffer())) };
  });
  near(media.duration, 3, 0.15, 'duración del archivo');
  assert.deepEqual([media.width, media.height], [240, 426]);
  assert.deepEqual(media.head, [0x1a, 0x45, 0xdf, 0xa3], 'cabecera EBML de WebM');

  // ---------- comparación fotograma a fotograma con la vista previa ----------
  const frames = [3, 14, 21, 22, 33, 43]; // 0,2 s · 0,93 s · 1,4 s · 1,47 s (en la transición) · 2,2 s · 2,87 s
  const diffs = await run(async (list) => {
    const { createPlayer } = await import('/src/player/index.js');
    const w = 240, h = 426, fps = 15;
    const twinCanvas = document.createElement('canvas');
    const twin = createPlayer({ store, library, canvas: twinCanvas, maxPreviewSide: h });
    const video = document.createElement('video');
    video.muted = true;
    video.src = URL.createObjectURL(window.__export.blob);
    await new Promise((r) => (video.onloadeddata = r));
    const scratch = Object.assign(document.createElement('canvas'), { width: w, height: h });
    const sctx = scratch.getContext('2d', { willReadFrequently: true });
    const seekVideo = (t) => new Promise((resolve) => { video.onseeked = resolve; video.currentTime = t; });
    const results = [];
    for (const i of list) {
      const before = twin.stats.stills;
      store.setPlayhead(i / fps);
      while (twin.stats.stills <= before) await new Promise((r) => setTimeout(r, 15));
      await new Promise((r) => setTimeout(r, 60));
      const a = twinCanvas.getContext('2d').getImageData(0, 0, w, h).data;
      await seekVideo((i + 0.5) / fps);
      sctx.drawImage(video, 0, 0, w, h);
      const b = sctx.getImageData(0, 0, w, h).data;
      let sum = 0, bad = 0, n = 0;
      for (let p = 0; p < a.length; p += 4) {
        let worst = 0;
        for (let c = 0; c < 3; c++) { const d = Math.abs(a[p + c] - b[p + c]); sum += d; worst = Math.max(worst, d); }
        if (worst > 48) bad++;
        n++;
      }
      results.push({ i, size: [twinCanvas.width, twinCanvas.height], mean: sum / (n * 3), badShare: bad / n, center: [a[((h >> 1) * w + (w >> 1)) * 4], b[((h >> 1) * w + (w >> 1)) * 4]] });
    }
    twin.destroy();
    return results;
  }, frames);
  for (const d of diffs) {
    assert.deepEqual(d.size, [240, 426], 'la vista previa de comparación tiene el mismo tamaño que la exportación');
    console.log(`  fotograma ${String(d.i).padStart(2)}: diferencia media ${d.mean.toFixed(2)}/255, ${(d.badShare * 100).toFixed(2)} % de píxeles con diferencia > 48`);
    assert.ok(d.mean < 6, `fotograma ${d.i}: diferencia media ${d.mean.toFixed(2)}`);
    assert.ok(d.badShare < 0.03, `fotograma ${d.i}: ${(d.badShare * 100).toFixed(1)} % de píxeles muy distintos`);
  }
  // el contenido es el esperado y no solo "parecido": rojo al principio, verde al final
  assert.ok(diffs[0].center[1] > 120, 'el centro del primer fotograma exportado es rojizo');

  // ---------- audio exportado ----------
  const audio = await run(async () => {
    const ctx = new OfflineAudioContext(2, 1, 48000);
    const buffer = await ctx.decodeAudioData(await window.__export.blob.arrayBuffer());
    const data = buffer.getChannelData(0);
    const sr = buffer.sampleRate;
    const rms = (a, b) => { let s = 0; const i0 = Math.round(a * sr), i1 = Math.round(b * sr); for (let i = i0; i < i1; i++) s += data[i] * data[i]; return Math.sqrt(s / (i1 - i0)); };
    const freq = (a, b) => { const i0 = Math.round(a * sr), i1 = Math.round(b * sr); let n = 0; for (let i = i0 + 1; i < i1; i++) if ((data[i - 1] < 0) !== (data[i] < 0)) n++; return (n / (b - a)) / 2; };
    return { duration: buffer.duration, channels: buffer.numberOfChannels, sampleRate: sr, early: rms(0.2, 1.0), late: rms(2.0, 2.8), lateFreq: freq(2.0, 2.8), earlyFreq: freq(0.2, 1.0) };
  });
  near(audio.duration, 3, 0.15, 'duración del audio');
  assert.equal(audio.sampleRate, 48000);
  assert.ok(audio.late > 0.02 && audio.late < 0.07, `tras la transición solo suena la música a la mitad: RMS ${audio.late.toFixed(4)} (esperado ~0,044)`);
  assert.ok(audio.early > audio.late * 1.3, `al principio suenan los dos tonos (${audio.early.toFixed(3)} > ${audio.late.toFixed(3)})`);
  near(audio.lateFreq, 220, 6, 'el tono de la música es de 220 Hz');

  // ---------- el MP4 (contenedor) con VP9 y Opus ----------
  const mp4 = await exportScene({ short: 240, fps: 15, quality: 'normal' }, 'mp4-vp9');
  assert.equal(mp4.container, 'mp4');
  assert.equal(mp4.formatId, 'mp4-vp9');
  assert.equal(mp4.filename, 'demo.mp4');
  const mp4info = await run(async () => {
    const blob = window.__export.blob;
    const bytes = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
    const video = document.createElement('video');
    video.muted = true;
    video.src = URL.createObjectURL(blob);
    await new Promise((resolve, reject) => { video.onloadedmetadata = resolve; video.onerror = () => reject(new Error('el MP4 exportado no se reproduce')); });
    return { ftyp: String.fromCharCode(...bytes.slice(4, 8)), duration: video.duration, size: [video.videoWidth, video.videoHeight] };
  });
  assert.equal(mp4info.ftyp, 'ftyp');
  near(mp4info.duration, 3, 0.15, 'duración del MP4');
  assert.deepEqual(mp4info.size, [240, 426]);

  // ---------- el tono se conserva con velocidad 2× ----------
  await run(async () => {
    const { createClip } = await import('/src/core/index.js');
    for (const c of Object.values(store.getProject().clips)) store.dispatch({ type: 'clip/remove', clipId: c.id });
    const song = Object.values(store.getProject().assets).find((a) => a.name === 'musica.wav');
    const track = store.getProject().tracks.find((t) => t.kind === 'audio');
    const clip = createClip({ trackId: track.id, kind: 'audio', assetId: song.id, start: 0, duration: 4 });
    store.dispatch({ type: 'clip/add', clip });
    store.dispatch({ type: 'clip/update', clipId: clip.id, patch: { speed: 2 } });
  });
  const fast = await exportScene({ short: 120, fps: 10, quality: 'small' });
  near(fast.duration, 2, 0.01, 'a 2× el proyecto dura 2 s');
  const fastAudio = await run(async () => {
    const ctx = new OfflineAudioContext(2, 1, 48000);
    const buffer = await ctx.decodeAudioData(await window.__export.blob.arrayBuffer());
    const d = buffer.getChannelData(0);
    let n = 0; const i0 = 12000, i1 = 84000;
    for (let i = i0 + 1; i < i1; i++) if ((d[i - 1] < 0) !== (d[i] < 0)) n++;
    return { duration: buffer.duration, freq: (n / ((i1 - i0) / 48000)) / 2 };
  });
  near(fastAudio.duration, 2, 0.1, 'duración del audio a 2×');
  near(fastAudio.freq, 220, 8, 'a 2× el tono sigue en 220 Hz (no sube a 440)');

  // ---------- sin audio no hay pista de audio ----------
  await run(async () => {
    const { createClip } = await import('/src/core/index.js');
    for (const c of Object.values(store.getProject().clips)) store.dispatch({ type: 'clip/remove', clipId: c.id });
    const img = Object.values(store.getProject().assets).find((a) => a.name === 'verde.png');
    const track = store.getProject().tracks.find((t) => t.kind === 'video');
    store.dispatch({ type: 'clip/add', clip: createClip({ trackId: track.id, kind: 'image', assetId: img.id, start: 0, duration: 1 }) });
  });
  const silent = await exportScene({ short: 120, fps: 10, quality: 'small' });
  assert.equal(silent.audioCodec, null, 'un proyecto sin sonido se exporta sin pista de audio');
  assert.deepEqual(silent.events.map((e) => e.phase).filter((p, i, a) => a.indexOf(p) === i), ['video', 'finalizing']);

  // ---------- errores con mensaje claro ----------
  const failures = await run(async () => {
    const { exportProject } = await import('/src/export/exporter.js');
    const out = {};
    const attempt = async (key, args) => { try { await exportProject({ library, ...args }); out[key] = 'sin error'; } catch (e) { out[key] = { name: e.name, code: e.code, message: e.message }; } };
    const empty = { ...store.getProject(), clips: {}, tracks: store.getProject().tracks.map((t) => ({ ...t, clipIds: [] })) };
    await attempt('vacío', { project: empty, settings: { short: 240, fps: 15, quality: 'normal' } });
    await attempt('h264', { project: store.getProject(), settings: { short: 240, fps: 15, quality: 'normal' }, prefer: 'mp4-h264' });
    return out;
  });
  assert.equal(failures['vacío'].code, 'invalid');
  assert.match(failures['vacío'].message, /vacía/);
  assert.equal(failures.h264.code, 'unsupported', 'H.264 no está en este Chromium: error claro, no un archivo roto');
  assert.match(failures.h264.message, /formatos admitidos/);

  // ---------- cancelar ----------
  await buildScene();
  const cancel = await run(async () => {
    const { exportProject } = await import('/src/export/exporter.js');
    const controller = new AbortController();
    let after = 0, aborted = false;
    const started = performance.now();
    let abortedAt = 0;
    try {
      await exportProject({ project: store.getProject(), library, settings: { short: 240, fps: 15, quality: 'normal' }, signal: controller.signal, onProgress: (e) => {
        if (aborted) after++;
        if (e.phase === 'video' && e.done === 12) { aborted = true; abortedAt = performance.now(); controller.abort(); }
      } });
      return { error: 'sin error' };
    } catch (e) {
      return { name: e.name, message: e.message, after, ms: performance.now() - abortedAt, total: performance.now() - started };
    }
  });
  assert.equal(cancel.name, 'AbortError');
  assert.ok(cancel.after <= 2, `tras cancelar apenas hay más progreso (${cancel.after})`);
  assert.ok(cancel.ms < 3000, `cancela en ${cancel.ms.toFixed(0)} ms`);

  assert.deepEqual(app.errors, []);
  console.log('export.browser: OK');
} finally {
  await app.close();
}
