// Efectos, recorte, volteo y transiciones en WebGL, contrastados con fórmulas y con el compositor 2D.
// Uso: npm run test:browser
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { launch, makeMedia, pageTools } from './helpers.mjs';

const dir = makeMedia();
const app = await launch({ viewport: { width: 1000, height: 1000 } });
const { page } = app;
const { run, px, settle, clipOf } = pageTools(page);

const within = (actual, expected, tol, msg) => assert.ok(actual.every((v, i) => Math.abs(v - expected[i]) <= tol), `${msg}: obtenido [${actual}], esperado [${expected.map((v) => Math.round(v))}] ±${tol}`);
const to255 = (c) => c.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255));

// Misma fórmula que el shader, escrita aparte. Entrada y salida en 0-1.
function formula(rgb, fx) {
  let c = [...rgb];
  if (fx.hue) {
    const h = (fx.hue * Math.PI) / 180, cs = Math.cos(h), sn = Math.sin(h);
    const m = [
      [0.213 + cs * 0.787 - sn * 0.213, 0.715 - cs * 0.715 - sn * 0.715, 0.072 - cs * 0.072 + sn * 0.928],
      [0.213 - cs * 0.213 + sn * 0.143, 0.715 + cs * 0.285 + sn * 0.14, 0.072 - cs * 0.072 - sn * 0.283],
      [0.213 - cs * 0.213 - sn * 0.787, 0.715 - cs * 0.715 + sn * 0.715, 0.072 + cs * 0.928 + sn * 0.072],
    ];
    c = m.map((row) => row[0] * c[0] + row[1] * c[1] + row[2] * c[2]);
  }
  const luma = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  c = c.map((v) => luma + (v - luma) * (1 + (fx.saturation ?? 0)));
  const t = fx.temperature ?? 0;
  c = [c[0] * (1 + 0.2 * t), c[1], c[2] * (1 - 0.2 * t)];
  c = c.map((v) => v + 0.5 * (fx.brightness ?? 0));
  c = c.map((v) => Math.min(1, Math.max(0, (v - 0.5) * (1 + (fx.contrast ?? 0)) + 0.5)));
  if (fx.sepia) {
    const s = [[0.393, 0.769, 0.189], [0.349, 0.686, 0.168], [0.272, 0.534, 0.131]].map((r) => Math.min(1, r[0] * c[0] + r[1] * c[1] + r[2] * c[2]));
    c = c.map((v, i) => v + (s[i] - v) * fx.sepia);
  }
  return c;
}

const setFx = (id, effectType, value) => run(([clipId, type, v]) => store.dispatch({ type: 'effect/set', clipId, effectType: type, value: v }), [id, effectType, value]);
const update = (id, patch) => run(([clipId, p]) => store.dispatch({ type: 'clip/update', clipId, patch: p }), [id, patch]);
const clearFx = (id) => run((clipId) => store.dispatch({ type: 'effect/clear', clipId }), id);

async function addImage(name, start, duration = 3) {
  await run(async ([n, s, d]) => {
    const { createClip } = await import('/src/core/index.js');
    const asset = Object.values(store.getProject().assets).find((a) => a.name === n);
    const trackId = store.getProject().tracks.find((t) => t.kind === 'video').id;
    store.dispatch({ type: 'clip/add', clip: createClip({ trackId, kind: 'image', assetId: asset.id, start: s, duration: d }) });
  }, [name, start, duration]);
  return clipOf(name);
}
const removeClip = (id) => run((clipId) => store.dispatch({ type: 'clip/remove', clipId }), id);
const seek = (t) => settle(() => run((x) => store.setPlayhead(x), t));

try {
  await page.goto(`${app.base}/dev/editor.html`);
  await page.setInputFiles('#files', ['gris.png', 'rojo.png', 'verde.png', 'mitad.png', 'con_audio.webm'].map((n) => join(dir, n)));
  await page.waitForSelector('.asset >> nth=4');
  assert.equal(await run(() => player.rendererKind()), 'webgl', 'el renderizador activo es WebGL');

  // ---------- efectos de color contra la fórmula (imagen gris 128 que llena el encuadre) ----------
  const gris = await addImage('gris.png', 0, 10);
  await update(gris.id, { fit: 'cover' });
  await seek(1);
  const base = await px(0.5, 0.5);
  within(base, [128, 128, 128], 3, 'sin efectos la imagen no cambia');
  const g = base.map((v) => v / 255);

  const cases = [
    ['brightness', { brightness: 0.4 }],
    ['brightness', { brightness: -0.3 }],
    ['contrast', { contrast: 0.6 }],
    ['contrast', { contrast: -0.5 }],
    ['saturation', { saturation: -1 }],
    ['temperature', { temperature: 1 }],
    ['temperature', { temperature: -1 }],
    ['hue', { hue: 90 }],
    ['sepia', { sepia: 1 }],
    ['sepia', { sepia: 0.5 }],
  ];
  for (const [type, fx] of cases) {
    await settle(() => setFx(gris.id, type, fx[type]));
    within(await px(0.5, 0.5), to255(formula(g, fx)), 5, `${type} ${fx[type]} sobre gris`);
    await settle(() => clearFx(gris.id));
  }

  // saturación y tono sobre un color puro (rojo)
  await removeClip(gris.id);
  const rojo = await addImage('rojo.png', 0, 10);
  await update(rojo.id, { fit: 'cover' });
  await seek(1);
  const red = (await px(0.5, 0.5)).map((v) => v / 255);
  within(red.map((v) => v * 255), [255, 0, 0], 4, 'el rojo puro llega sin alterar');
  for (const fx of [{ saturation: -1 }, { saturation: -0.5 }, { hue: 120 }, { hue: -60 }, { brightness: 0.4 }]) {
    const [type] = Object.keys(fx);
    await settle(() => setFx(rojo.id, type, fx[type]));
    within(await px(0.5, 0.5), to255(formula(red, fx)), 6, `${type} ${fx[type]} sobre rojo`);
    await settle(() => clearFx(rojo.id));
  }

  // varios efectos a la vez
  await settle(() => run((id) => { for (const [type, value] of [['saturation', -0.4], ['contrast', 0.3], ['brightness', 0.1], ['sepia', 0.3]]) store.dispatch({ type: 'effect/set', clipId: id, effectType: type, value }); }, rojo.id));
  within(await px(0.5, 0.5), to255(formula(red, { saturation: -0.4, contrast: 0.3, brightness: 0.1, sepia: 0.3 })), 7, 'efectos combinados');
  await settle(() => clearFx(rojo.id));

  // un filtro preestablecido y su intensidad
  await settle(() => run((id) => store.dispatch({ type: 'effect/preset', clipId: id, presetId: 'mono' }), rojo.id));
  within(await px(0.5, 0.5), to255(formula(red, { saturation: -1, contrast: 0.15 })), 6, 'filtro Blanco y negro');
  await settle(() => run((id) => store.dispatch({ type: 'effect/preset', clipId: id, presetId: 'mono', intensity: 0.5 }), rojo.id));
  within(await px(0.5, 0.5), to255(formula(red, { saturation: -0.5, contrast: 0.075 })), 6, 'filtro al 50 %');
  await settle(() => clearFx(rojo.id));
  await removeClip(rojo.id);

  // ---------- viñeta: centro intacto y esquinas oscuras ----------
  const gris2 = await addImage('gris.png', 0, 10);
  await update(gris2.id, { fit: 'cover' });
  await settle(() => setFx(gris2.id, 'vignette', 1));
  within(await px(0.5, 0.5), [128, 128, 128], 4, 'la viñeta no toca el centro');
  const corner = await px(0.02, 0.01);
  assert.ok(corner[0] < 40, `esquina oscurecida: ${corner}`);
  await settle(() => clearFx(gris2.id));
  await removeClip(gris2.id);

  // ---------- desenfoque: el borde de un cuadrado verde sobre negro se difumina ----------
  const verde = await addImage('verde.png', 0, 10);
  await update(verde.id, { transform: { scale: 0.3 } });
  await seek(1);
  const edgeX = 0.5 - 0.5 * 0.3; // contain: la imagen cuadrada mide el ancho del encuadre; escala 0,3
  within(await px(0.5, 0.5), [0, 128, 0], 4, 'centro verde');
  within(await px(edgeX - 0.06, 0.5), [0, 0, 0], 4, 'fuera, negro');
  const sharpEdge = await px(edgeX + 0.01, 0.5);
  within(sharpEdge, [0, 128, 0], 6, 'sin desenfoque el borde es nítido');
  await settle(() => setFx(verde.id, 'blur', 12));
  const soft = await px(edgeX, 0.5);
  assert.ok(soft[1] > 20 && soft[1] < 110, `en el borde el verde queda a medias: ${soft}`);
  const outside = await px(edgeX - 0.012, 0.5);
  assert.ok(outside[1] > 3 && outside[1] < soft[1], `el halo sale hacia fuera: ${outside}`);
  within(await px(0.5, 0.5), [0, 128, 0], 8, 'el centro sigue verde');
  await settle(() => clearFx(verde.id));

  // ---------- recorte, volteo y giro (imagen mitad roja / mitad verde) ----------
  await removeClip(verde.id);
  const mitad = await addImage('mitad.png', 0, 10);
  await seek(1);
  const isRed = ([r, gg, b]) => r > 200 && gg < 50 && b < 50;
  const isGreen = ([r, gg, b]) => gg > 100 && r < 50 && b < 50;
  assert.ok(isRed(await px(0.25, 0.5)) && isGreen(await px(0.75, 0.5)), 'mitad izquierda roja, derecha verde');
  await settle(() => update(mitad.id, { flip: { h: true, v: false } }));
  assert.ok(isGreen(await px(0.25, 0.5)) && isRed(await px(0.75, 0.5)), 'volteo horizontal');
  await settle(() => update(mitad.id, { flip: { h: false, v: false }, crop: { x: 0.5, y: 0, w: 0.5, h: 1 } }));
  assert.ok(isGreen(await px(0.5, 0.5)) && isGreen(await px(0.2, 0.5)), 'recorte a la mitad derecha');
  await settle(() => update(mitad.id, { crop: null, transform: { rotation: 90 } }));
  assert.ok(isRed(await px(0.5, 0.4)) && isGreen(await px(0.5, 0.6)), 'girar 90° lleva la izquierda arriba');

  // WebGL y compositor 2D deben dibujar la misma geometría
  await settle(() => update(mitad.id, { crop: { x: 0.1, y: 0.2, w: 0.7, h: 0.6 }, flip: { h: true, v: true }, transform: { rotation: 33, scale: 0.8, x: 0.1, y: -0.05, opacity: 0.9 } }));
  const diff = await run(async () => {
    const { createPlayer } = await import('/src/player/index.js');
    const other = document.createElement('canvas');
    const twin = createPlayer({ store, library, canvas: other, useWebGl: false });
    await new Promise((r) => setTimeout(r, 800));
    const a = document.querySelector('.pv__canvas').getContext('2d').getImageData(0, 0, other.width, other.height).data;
    const b = other.getContext('2d').getImageData(0, 0, other.width, other.height).data;
    let bad = 0;
    for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i] - b[i]) > 40 || Math.abs(a[i + 1] - b[i + 1]) > 40 || Math.abs(a[i + 2] - b[i + 2]) > 40) bad++;
    const kind = twin.rendererKind();
    twin.destroy();
    return { bad, total: a.length / 4, kind };
  });
  assert.equal(diff.kind, '2d');
  assert.ok(diff.bad / diff.total < 0.01, `WebGL y 2D coinciden: ${diff.bad} de ${diff.total} píxeles difieren`);
  await removeClip(mitad.id);

  // ---------- transiciones: rojo (A) hacia verde (B), 3 s cada uno, ventana 2,5 a 3,5 ----------
  const a = await addImage('rojo.png', 0, 3);
  const b = await addImage('verde.png', 3, 3);
  await update(a.id, { fit: 'cover' });
  await update(b.id, { fit: 'cover' });
  await seek(1);
  assert.ok(isRed(await px(0.5, 0.5)), 'antes de la ventana solo A');
  await seek(4.5);
  assert.ok(isGreen(await px(0.5, 0.5)), 'después de la ventana solo B');

  const setTransition = (type, duration = 1) => update(b.id, { transition: { type, duration } });
  await setTransition('dissolve');
  await seek(2.4);
  assert.ok(isRed(await px(0.5, 0.5)), 'justo antes de la ventana');
  await seek(3);
  within(await px(0.5, 0.5), [127, 64, 0], 10, 'disolver al 50 %');
  await seek(2.75);
  within(await px(0.5, 0.5), [191, 32, 0], 12, 'disolver al 25 %');
  await seek(3.25);
  within(await px(0.5, 0.5), [64, 96, 0], 12, 'disolver al 75 %');

  const expectations = [
    ['dip', [[0.5, 0.5, [0, 0, 0]]]],
    ['slide-left', [[0.25, 0.5, 'red'], [0.75, 0.5, 'green']]],
    ['slide-right', [[0.25, 0.5, 'green'], [0.75, 0.5, 'red']]],
    ['slide-up', [[0.5, 0.25, 'red'], [0.5, 0.75, 'green']]],
    ['slide-down', [[0.5, 0.25, 'green'], [0.5, 0.75, 'red']]],
    ['wipe', [[0.2, 0.5, 'green'], [0.8, 0.5, 'red']]],
    ['zoom', [[0.5, 0.5, [127, 64, 0]]]],
  ];
  for (const [type, checks] of expectations) {
    await setTransition(type);
    await seek(3);
    for (const [x, y, want] of checks) {
      const got = await px(x, y);
      if (want === 'red') assert.ok(isRed(got), `${type} (${x},${y}) rojo: ${got}`);
      else if (want === 'green') assert.ok(isGreen(got), `${type} (${x},${y}) verde: ${got}`);
      else within(got, want, 12, `${type} (${x},${y})`);
    }
  }

  // la transición también existe en el compositor 2D (como disolver) y duración distinta cambia la ventana
  await setTransition('dissolve', 2);
  await seek(2.2);
  within(await px(0.5, 0.5), [0.9 * 255, 0.1 * 128, 0], 8, 'ventana de 2 s (2 a 4 s): a 2,2 s el progreso es 0,1');

  // reproducir atravesando la transición no produce errores y termina en B
  await setTransition('slide-left', 1);
  await run(() => { store.setPlayhead(2.2); player.play(); });
  await page.waitForTimeout(1500);
  await run(() => player.pause());
  assert.ok(isGreen(await px(0.5, 0.5)), 'tras reproducir a través de la transición se ve B');

  assert.deepEqual(app.errors, []);
  console.log('effects.browser: OK');
} finally {
  await app.close();
}
