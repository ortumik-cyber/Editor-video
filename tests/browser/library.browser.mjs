// Prueba de la biblioteca en Chromium real. Requiere ffmpeg y Playwright global.
// Uso: npm run test:browser
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { launch, makeMedia } from './helpers.mjs';

const dir = makeMedia();

const app = await launch();
try {
  const { page } = app;
  await page.goto(`${app.base}/package.json`);
  await page.evaluate(() => { const i = document.createElement('input'); i.type = 'file'; i.multiple = true; i.id = 'f'; document.body.append(i); });
  await page.setInputFiles('#f', ['con_audio.webm', 'sin_audio.webm', 'musica.wav', 'foto.png', 'roto.mp4', 'vacio.mp4', 'notas.txt'].map((n) => join(dir, n)));

  const r = await page.evaluate(async () => {
    const core = await import('/src/core/index.js');
    const lib = await import('/src/library/index.js');
    const store = core.createStore(core.createProject());
    const repo = core.createRepo(core.createIndexedDbBackend(`t-${Date.now()}`));
    const library = lib.createLibrary({ store, repo, adapters: lib.createDomAdapters() });

    // WebM de MediaRecorder: declara duración Infinity
    const canvas = Object.assign(document.createElement('canvas'), { width: 160, height: 90 });
    const ctx = canvas.getContext('2d');
    const rec = new MediaRecorder(canvas.captureStream(15), { mimeType: 'video/webm' });
    const chunks = [];
    rec.ondataavailable = (e) => chunks.push(e.data);
    const stopped = new Promise((done) => (rec.onstop = done));
    rec.start();
    for (let i = 0; i < 50; i++) { ctx.fillStyle = `hsl(${i * 7} 80% 50%)`; ctx.fillRect(0, 0, 160, 90); await new Promise((d) => setTimeout(d, 30)); }
    rec.stop(); await stopped;
    const recorded = new File([new Blob(chunks, { type: 'video/webm' })], 'grabacion.webm', { type: 'video/webm' });

    const { added, rejected } = await library.importFiles([...document.getElementById('f').files, recorded]);
    const byName = Object.fromEntries(added.map((a) => [a.name, a]));
    const thumbs = {};
    for (const a of added) {
      const url = await library.getThumbUrl(a.id);
      if (url) { const img = new Image(); img.src = url; await img.decode(); thumbs[a.name] = [img.naturalWidth, img.naturalHeight]; }
    }
    await repo.save(store.getProject());
    const back = await repo.load(store.getProject().id);
    const stored = await repo.getMedia(byName['con_audio.webm'].id);
    store.undo();
    return {
      assets: added.map((a) => ({ name: a.name, kind: a.kind, duration: a.duration, w: a.width, h: a.height, hasAudio: a.hasAudio, peaks: a.peaks?.length ?? 0, peakMax: a.peaks ? Math.max(...a.peaks) : 0 })),
      rejected: rejected.map((x) => `${x.name}:${x.code}`), thumbs,
      persisted: Object.keys(back.assets).length, storedSize: stored.size, afterUndo: Object.keys(store.getProject().assets).length,
    };
  });

  const get = (name) => r.assets.find((a) => a.name === name);
  assert.equal(r.assets.length, 5);
  assert.deepEqual(r.rejected.sort(), ['notas.txt:unsupported', 'roto.mp4:unreadable', 'vacio.mp4:empty']);
  assert.ok(Math.abs(get('con_audio.webm').duration - 3) < 0.05);
  assert.deepEqual([get('con_audio.webm').w, get('con_audio.webm').h], [640, 360]);
  assert.equal(get('con_audio.webm').hasAudio, true);
  assert.ok(get('con_audio.webm').peakMax > 20);
  assert.equal(get('sin_audio.webm').hasAudio, false);
  assert.ok(Number.isFinite(get('grabacion.webm').duration) && get('grabacion.webm').duration > 1);
  assert.equal(get('musica.wav').kind, 'audio');
  assert.equal(get('musica.wav').peaks, 50);
  assert.deepEqual([get('foto.png').w, get('foto.png').h], [1200, 800]);
  assert.deepEqual(r.thumbs['foto.png'], [320, 213]);
  assert.equal(r.thumbs['musica.wav'], undefined);
  assert.equal(r.persisted, 5);
  assert.ok(r.storedSize > 10_000, "el archivo original se guardó en IndexedDB");
  assert.equal(r.afterUndo, 0);
  assert.deepEqual(app.errors, []);
  console.log('library.browser: OK');
} finally {
  await app.close();
}
