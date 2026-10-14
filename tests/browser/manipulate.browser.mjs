// Manipulación directa en la vista previa: seleccionar, mover, escalar, girar, pellizcar.
// Uso: npm run test:browser
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { launch, makeMedia, pageTools } from './helpers.mjs';

const dir = makeMedia();
const app = await launch({ viewport: { width: 1100, height: 1300 } });
const { page } = app;
const { run } = pageTools(page);
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} no es ${b} ±${tol}`);

const canvasBox = () => page.locator('.pv__canvas').boundingBox();
const at = async (fx, fy) => { const b = await canvasBox(); return { x: b.x + fx * b.width, y: b.y + fy * b.height }; };
const sel = () => run(() => store.getState().selection[0] ?? null);
const clipNow = (id) => run((x) => store.getProject().clips[x], id);
const byName = (name) => run((n) => { const p = store.getProject(); return Object.values(p.clips).find((c) => p.assets[c.assetId]?.name === n); }, name);
const settleDraw = () => page.waitForTimeout(350);
const green = (pick = '([r, g, b]) => g > 100 && r < 60 && b < 60') => run((src) => {
  const test = eval(src);
  const c = document.querySelector('.pv__canvas');
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let n = 0, sx = 0, sy = 0, minX = 1e9, maxX = -1, minY = 1e9, maxY = -1;
  for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
    const i = (y * c.width + x) * 4;
    if (!test([d[i], d[i + 1], d[i + 2]])) continue;
    n++; sx += x; sy += y; minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  return { n, cx: n ? sx / n / c.width : 0, cy: n ? sy / n / c.height : 0, w: n ? (maxX - minX + 1) / c.width : 0, h: n ? (maxY - minY + 1) / c.height : 0 };
}, pick);
async function drag(from, to, { steps = 8, hold } = {}) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps });
  await page.mouse.move(to.x, to.y, { steps });
  if (hold) await hold();
  await page.mouse.up();
}
const handleCenter = async () => { const b = await page.locator('.pv__handle').boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
const frameCenter = async () => { const b = await page.locator('.pv__sel').boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
/** Eventos de puntero sintéticos para simular dos dedos. */
const touch = (type, id, x, y) => page.evaluate(([t, i, px, py]) => {
  document.querySelector('.pv__overlay').dispatchEvent(new PointerEvent(t, { pointerId: i, pointerType: 'touch', isPrimary: i === 1, clientX: px, clientY: py, bubbles: true, cancelable: true }));
}, [type, id, x, y]);

try {
  await page.goto(`${app.base}/dev/editor.html`);
  await page.setInputFiles('#files', ['rojo.png', 'verde.png'].map((n) => join(dir, n)));
  await page.waitForSelector('.asset >> nth=1');
  await page.click('.asset >> nth=0'); // rojo.png: base, 5 s
  await run(() => { store.setPlayhead(1); });
  await run(async () => {
    const { addOverlayAsset } = await import('/src/timeline/actions.js');
    const asset = Object.values(store.getProject().assets).find((a) => a.name === 'verde.png');
    addOverlayAsset(store, asset.id, { duration: 4 });
    store.select([]);
  });
  await settleDraw();
  const base = await byName('rojo.png');
  const sticker = await byName('verde.png');
  assert.equal(await page.locator('.pv__sel').isHidden(), true, 'sin selección no hay marco');
  const box = await canvasBox();

  // ---------- seleccionar con un clic: el de arriba, el de abajo y ninguno ----------
  await page.mouse.click((await at(0.5, 0.5)).x, (await at(0.5, 0.5)).y);
  assert.equal(await sel(), sticker.id, 'clic sobre el sticker lo selecciona');
  assert.equal(await page.locator('.pv__sel').isVisible(), true);
  const fb = await page.locator('.pv__sel').boundingBox();
  near(fb.width / box.width, 0.35, 0.01, 'el marco mide lo mismo que el sticker (35 % del ancho)');
  const fc = await frameCenter();
  near(fc.x, box.x + box.width / 2, 2, 'marco centrado en x');
  near(fc.y, box.y + box.height / 2, 2, 'marco centrado en y');
  await page.mouse.click((await at(0.5, 0.25)).x, (await at(0.5, 0.25)).y);
  assert.equal(await sel(), base.id, 'clic fuera del sticker pero dentro del fondo selecciona el fondo');
  await page.mouse.click((await at(0.5, 0.04)).x, (await at(0.5, 0.04)).y);
  assert.equal(await sel(), null, 'clic fuera de todo quita la selección');
  assert.equal(await page.locator('.pv__sel').isHidden(), true);

  // ---------- mover: el contenido acaba donde se arrastra ----------
  await page.mouse.click((await at(0.5, 0.5)).x, (await at(0.5, 0.5)).y);
  const startG = await green();
  const dxPx = 100, dyPx = 60;
  await drag(await at(0.5, 0.5), { x: (await at(0.5, 0.5)).x + dxPx, y: (await at(0.5, 0.5)).y + dyPx });
  await settleDraw();
  let c = await clipNow(sticker.id);
  near(c.transform.x, dxPx / box.width, 0.01, 'x en fracciones del lienzo');
  near(c.transform.y, dyPx / box.height, 0.01, 'y en fracciones del lienzo');
  const movedG = await green();
  near(movedG.cx - startG.cx, dxPx / box.width, 0.012, 'el verde se movió en el lienzo lo mismo que el puntero (x)');
  near(movedG.cy - startG.cy, dyPx / box.height, 0.012, 'el verde se movió en el lienzo lo mismo que el puntero (y)');
  await run(() => store.undo());
  await settleDraw();
  c = await clipNow(sticker.id);
  assert.deepEqual([c.transform.x, c.transform.y], [0, 0], 'un arrastre es un solo paso de deshacer');

  // ---------- imán al centro, con guía ----------
  const center = await at(0.5, 0.5);
  await drag(center, { x: center.x + 3, y: center.y + 2 }, {
    hold: async () => { assert.equal(await page.locator('.pv__guide--v').isVisible(), true, 'guía vertical durante el imán'); assert.equal(await page.locator('.pv__guide--h').isVisible(), true); },
  });
  c = await clipNow(sticker.id);
  assert.deepEqual([c.transform.x, c.transform.y], [0, 0], 'se pega al centro');
  assert.equal(await page.locator('.pv__guide--v').isHidden(), true, 'la guía desaparece al soltar');
  await drag(center, { x: center.x + 50, y: center.y }, { hold: async () => assert.equal(await page.locator('.pv__guide--v').isHidden(), true, 'lejos del centro no hay guía') });
  assert.ok((await clipNow(sticker.id)).transform.x > 0.05);
  await run(() => store.undo());

  // ---------- tirador de esquina: escalar ----------
  await settleDraw();
  const h0 = await handleCenter();
  const c0 = await frameCenter();
  const r0 = Math.hypot(h0.x - c0.x, h0.y - c0.y);
  const unit = { x: (h0.x - c0.x) / r0, y: (h0.y - c0.y) / r0 };
  await drag(h0, { x: c0.x + unit.x * r0 * 2, y: c0.y + unit.y * r0 * 2 });
  await settleDraw();
  c = await clipNow(sticker.id);
  near(c.transform.scale, 0.7, 0.02, 'al doblar la distancia el tamaño se dobla');
  near(c.transform.rotation, 0, 0.5, 'sin cambio de ángulo no gira');
  const bigG = await green();
  near(bigG.w, 0.7, 0.02, 'el verde ocupa el doble de ancho en el lienzo');
  await run(() => store.undo());
  await settleDraw();
  near((await clipNow(sticker.id)).transform.scale, 0.35, 1e-9, 'deshacer devuelve el tamaño');

  // ---------- tirador de esquina: girar 90° (con imán) ----------
  const h1 = await handleCenter();
  const c1 = await frameCenter();
  const ang0 = Math.atan2(h1.y - c1.y, h1.x - c1.x);
  const rad = Math.hypot(h1.x - c1.x, h1.y - c1.y);
  await drag(h1, { x: c1.x + Math.cos(ang0 + Math.PI / 2 + 0.03) * rad, y: c1.y + Math.sin(ang0 + Math.PI / 2 + 0.03) * rad });
  await settleDraw();
  c = await clipNow(sticker.id);
  assert.equal(c.transform.rotation, 90, 'gira 90° y se pega al múltiplo');
  near(c.transform.scale, 0.35, 0.02, 'girar a distancia constante no escala');
  await run(() => store.undo());

  // ---------- pellizco con dos dedos ----------
  await settleDraw();
  const pc = await frameCenter();
  await touch('pointerdown', 1, pc.x - 50, pc.y);
  await touch('pointerdown', 2, pc.x + 50, pc.y);
  await touch('pointermove', 2, pc.x + 100, pc.y); // distancia 100 → 150
  await settleDraw();
  near((await clipNow(sticker.id)).transform.scale, 0.525, 0.01, 'el pellizco escala ×1,5');
  await touch('pointermove', 1, pc.x + 50, pc.y - 50);
  await touch('pointermove', 2, pc.x + 50, pc.y + 50); // ahora el eje es vertical: +90°
  await touch('pointerup', 1, pc.x + 50, pc.y - 50);
  await touch('pointerup', 2, pc.x + 50, pc.y + 50);
  c = await clipNow(sticker.id);
  near(c.transform.rotation, 90, 1, 'el pellizco gira con el ángulo entre los dedos');
  await run(() => store.undo());
  assert.equal((await clipNow(sticker.id)).transform.scale, 0.35, 'el pellizco entero es un solo paso de historial');
  assert.equal((await clipNow(sticker.id)).transform.rotation, 0);

  // ---------- pista bloqueada: no se mueve y se avisa ----------
  await run((id) => store.dispatch({ type: 'track/update', trackId: store.getProject().clips[id].trackId, patch: { locked: true } }), sticker.id);
  assert.equal(await page.locator('.pv__sel.is-locked').count(), 1, 'el marco se muestra bloqueado');
  assert.equal(await page.locator('.pv__handle').isHidden(), true, 'sin tirador cuando está bloqueado');
  await drag(await at(0.5, 0.5), { x: (await at(0.5, 0.5)).x + 80, y: (await at(0.5, 0.5)).y });
  assert.equal((await clipNow(sticker.id)).transform.x, 0);
  assert.match(await page.locator('#msg').textContent(), /bloqueada/);
  await run((id) => store.dispatch({ type: 'track/update', trackId: store.getProject().clips[id].trackId, patch: { locked: false } }), sticker.id);

  // ---------- texto: el marco abraza el texto y se mueve con él ----------
  await run(async () => {
    const { addStyledText } = await import('/src/timeline/actions.js');
    addStyledText(store, { font: 'Inter', weight: 700, size: 200, color: '#ffffff', shadow: false }, 'HOLA');
  });
  await settleDraw();
  const textClip = await clipNow(await sel());
  assert.equal(textClip.kind, 'text');
  const ink = await green('([r, g, b]) => r > 230 && g > 230 && b > 230');
  const tf = await page.locator('.pv__sel').boundingBox();
  const cb = await canvasBox();
  near((tf.x + tf.width / 2 - cb.x) / cb.width, ink.cx, 0.03, 'el marco del texto está centrado sobre el texto');
  assert.ok(tf.width / cb.width >= ink.w * 0.98 && tf.width / cb.width < ink.w * 1.5, `el marco cubre el texto sin pasarse (${(tf.width / cb.width).toFixed(2)} vs ${ink.w.toFixed(2)})`);
  assert.ok(tf.height / cb.height >= ink.h * 0.98 && tf.height / cb.height < ink.h * 2.2, 'y también en alto');
  const t0 = await green('([r, g, b]) => r > 230 && g > 230 && b > 230');
  const tc = await frameCenter();
  await drag(tc, { x: tc.x, y: tc.y - 200 });
  await settleDraw();
  const tAfter = await green('([r, g, b]) => r > 230 && g > 230 && b > 230');
  near(tAfter.cy - t0.cy, -200 / cb.height, 0.012, 'el texto sube lo que se arrastra');
  near((await clipNow(textClip.id)).transform.y, -200 / cb.height, 0.012, 'y en el modelo');

  // doble clic en el texto: edita
  const tc2 = await frameCenter();
  await page.mouse.dblclick(tc2.x, tc2.y);
  assert.equal(await run(() => document.activeElement?.id), 'ins-t-content', 'doble clic enfoca la caja de texto');

  // ---------- accesibilidad y errores ----------
  assert.match(await page.locator('.pv__overlay').getAttribute('aria-label'), /Colocar/);
  const hb = await page.locator('.pv__handle').boundingBox();
  assert.ok(hb.width >= 44 && hb.height >= 44, `tirador táctil ${hb.width}x${hb.height}`);
  assert.deepEqual(app.errors, []);
  console.log('manipulate.browser: OK');
} finally {
  await app.close();
}
