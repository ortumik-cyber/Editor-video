// Tipografías y texto animado: carga, forma, alineación, fondo, contorno, animaciones y emoji.
// Uso: npm run test:browser
import assert from 'node:assert/strict';
import { launch, pageTools } from './helpers.mjs';

const app = await launch({ viewport: { width: 1000, height: 1000 } });
const { page } = app;
const { run, settle } = pageTools(page);

/** Estadísticas de los píxeles casi blancos (o los que cumplan `pick`) del lienzo de la vista previa. */
const ink = (pick = '([r, g, b]) => r > 230 && g > 230 && b > 230') => run((src) => {
  const test = eval(src);
  const c = document.querySelector('.pv__canvas');
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let n = 0, minX = 1e9, maxX = -1, minY = 1e9, maxY = -1, sx = 0, sy = 0;
  for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
    const i = (y * c.width + x) * 4;
    if (!test([d[i], d[i + 1], d[i + 2]])) continue;
    n++; sx += x; sy += y;
    if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  return { n, minX, maxX, minY, maxY, w: n ? maxX - minX + 1 : 0, h: n ? maxY - minY + 1 : 0, cx: n ? sx / n : 0, cy: n ? sy / n : 0, W: c.width, H: c.height };
}, pick);

let current = null;
async function showText(content, props = {}, { start = 0, duration = 4 } = {}) {
  if (current) await run((id) => store.dispatch({ type: 'clip/remove', clipId: id }), current);
  current = await run(async ([c, p, s, d]) => {
    const { createClip } = await import('/src/core/index.js');
    const track = store.getProject().tracks.find((t) => t.kind === 'text');
    const clip = createClip({ trackId: track.id, kind: 'text', start: s, duration: d });
    store.dispatch({ type: 'clip/add', clip });
    const r = store.dispatch({ type: 'clip/update', clipId: clip.id, patch: { text: { content: c, color: '#ffffff', shadow: false, size: 160, ...p } } });
    if (!r.ok) throw new Error(r.error.message);
    return clip.id;
  }, [content, props, start, duration]);
  return current;
}
/** Cualquier píxel visible (no solo el casi blanco): sirve para texto semitransparente. */
const visible = (min = 30) => ink(`([r, g, b]) => r > ${min} && g > ${min} && b > ${min}`);
const at = (t) => settle(() => run((x) => store.setPlayhead(x), t));
const patch = (text) => run(([id, t]) => store.dispatch({ type: 'clip/update', clipId: id, patch: { text: t } }), [current, text]);
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} no es ${b} ±${tol}`);

try {
  await page.goto(`${app.base}/dev/editor.html`);
  await page.waitForFunction(() => window.player);
  assert.equal(await run(() => player.rendererKind()), 'webgl');

  // ---------- carga de tipografías ----------
  const loader = await run(async () => {
    const { createFontLoader } = await import('/src/text/fonts.js');
    const f = createFontLoader();
    const v0 = f.version();
    const first = await f.load('Bebas Neue', 400);
    const again = await f.load('Bebas Neue', 400);
    return {
      first, again, versionDelta: f.version() - v0, loaded: f.isLoaded('Bebas Neue', 400), check: document.fonts.check('400 20px "Bebas Neue"'),
      weightResolved: f.isLoaded('Bebas Neue', 700), unknown: await f.load('Comic Sans', 400), notLoaded: f.isLoaded('Anton', 400),
    };
  });
  assert.deepEqual(loader, { first: true, again: true, versionDelta: 1, loaded: true, check: true, weightResolved: true, unknown: false, notLoaded: false });

  // ---------- la fuente cargada es la que se dibuja, desde el primer fotograma ----------
  await showText('HOLA MUNDO', { font: 'Anton', weight: 400 });
  await at(1);
  const first = await ink();
  const measured = await run(() => {
    const c = document.querySelector('.pv__canvas');
    const ctx = c.getContext('2d');
    ctx.font = '400 80px "Anton"'; // 160 px lógicos a escala 0,5
    return ctx.measureText('HOLA MUNDO').width;
  });
  near(first.w, measured, measured * 0.08, 'el ancho dibujado es el de Anton, no el de la fuente de repuesto');
  await page.waitForTimeout(400);
  await at(1.1);
  near((await ink()).w, first.w, 1, 'no hay salto de fuente tras cargar');

  // ---------- cada tipografía tiene su propia forma ----------
  const widths = {};
  for (const [font, weight] of [['Inter', 700], ['Bebas Neue', 400], ['Pacifico', 400], ['Playfair Display', 700], ['Oswald', 400]]) {
    await showText('HOLA', { font, weight });
    await at(1);
    widths[font] = (await ink()).w;
    assert.ok((await ink()).h < 160, `${font}: cabe en una línea`);
    assert.ok(widths[font] > 50, `${font} dibuja texto`);
  }
  assert.ok(widths['Bebas Neue'] < widths.Inter * 0.8, `Bebas Neue es más condensada que Inter: ${JSON.stringify(widths)}`);
  assert.equal(new Set(Object.values(widths)).size, 5, 'las cinco tipografías miden distinto');

  // pesos: Inter negrita es más ancha que normal; Bebas Neue no tiene negrita y no se falsea
  await showText('HOLA', { font: 'Inter', weight: 400 }); await at(1);
  const regular = (await ink()).w;
  await patch({ weight: 700 }); await at(1.05);
  assert.ok((await ink()).w > regular, 'Inter 700 es más ancha que Inter 400');
  await showText('HOLA', { font: 'Bebas Neue', weight: 400 }); await at(1);
  const bebas400 = await ink();
  await patch({ weight: 700 }); await at(1.05);
  near((await ink()).w, bebas400.w, 1, 'Bebas Neue 700 se resuelve a 400 (sin negrita falsa)');

  // ---------- ajuste de línea ----------
  await showText('M'.repeat(40), { font: 'Inter', weight: 700, size: 100 });
  await at(1);
  const wrapped = await ink();
  assert.ok(wrapped.w <= wrapped.W * 0.92, `el texto largo se parte dentro del 90 % del ancho (${wrapped.w}/${wrapped.W})`);
  assert.ok(wrapped.h > 100 * 0.5 * 1.5, 'ocupa varias líneas');

  // ---------- alineación en bloques de varias líneas ----------
  await showText('AAAAAAAA\nBB', { font: 'Inter', weight: 700, size: 140, align: 'left' });
  const rows = async () => {
    const all = await ink();
    const mid = Math.round((all.minY + all.maxY) / 2);
    const part = (lo, hi) => run(([a, b]) => {
      const c = document.querySelector('.pv__canvas');
      const d = c.getContext('2d').getImageData(0, a, c.width, b - a).data;
      let minX = 1e9, maxX = -1;
      for (let y = 0; y < b - a; y++) for (let x = 0; x < c.width; x++) { const i = (y * c.width + x) * 4; if (d[i] > 230 && d[i + 1] > 230) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); } }
      return { minX, maxX };
    }, [lo, hi]);
    return { top: await part(all.minY, mid - 2), bottom: await part(mid + 2, all.maxY + 1) };
  };
  await at(1);
  let r = await rows();
  near(r.bottom.minX, r.top.minX, 3, 'izquierda: las dos líneas empiezan igual');
  await patch({ align: 'right' }); await at(1.05);
  r = await rows();
  near(r.bottom.maxX, r.top.maxX, 3, 'derecha: las dos líneas acaban igual');
  await patch({ align: 'center' }); await at(1.1);
  r = await rows();
  near((r.bottom.minX + r.bottom.maxX) / 2, (r.top.minX + r.top.maxX) / 2, 3, 'centro: mismo centro');

  // ---------- fondo, opacidad del fondo y contorno ----------
  await showText('HOLA', { font: 'Inter', weight: 700, size: 160, background: '#ff0000', backgroundOpacity: 1 });
  await at(1);
  const reds = await ink('([r, g, b]) => r > 240 && g < 20 && b < 20');
  assert.ok(reds.n > 2000 && reds.w > 200, `fondo rojo sólido (${reds.n} px)`);
  await patch({ backgroundOpacity: 0.5 }); await at(1.05);
  const half = await ink('([r, g, b]) => r > 110 && r < 145 && g < 20 && b < 20');
  assert.ok(half.n > 2000, `fondo al 50 % sobre negro da rojo ~127 (${half.n} px)`);
  await patch({ background: null }); await at(1.1);
  assert.equal((await ink('([r, g, b]) => r > 60 && g < 20 && b < 20')).n, 0, 'sin fondo no hay rojo');
  assert.equal((await ink('([r, g, b]) => g > 150 && r < 60 && b < 60')).n, 0, 'sin contorno no hay verde');
  await patch({ stroke: '#00ff00' }); await at(1.15);
  assert.ok((await ink('([r, g, b]) => g > 200 && r < 60 && b < 60')).n > 200, 'contorno verde');

  // ---------- animaciones, píxel a píxel ----------
  await showText('HOLA', { font: 'Inter', weight: 700, size: 200, animIn: 'fade', animInDuration: 1, animOut: 'fade', animOutDuration: 1 });
  await at(0.0);
  assert.equal((await visible(8)).n, 0, 'aparecer: al inicio no se ve nada');
  await at(2);
  const full = await visible();
  assert.ok(full.n > 1500, `aparecer: a pleno tiene tinta (${full.n})`);
  await at(0.4); // opacidad ease-out(0,4) = 0,78
  const partial = await visible();
  assert.ok(partial.n > 1500, `aparecer: a medias el texto ya está (${partial.n})`);
  const brightness = () => run(() => {
    const c = document.querySelector('.pv__canvas');
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let max = 0;
    for (let i = 0; i < d.length; i += 4) max = Math.max(max, d[i]);
    return max;
  });
  const midBright = await brightness();
  await at(2);
  const fullBright = await brightness();
  assert.ok(fullBright > 240, `a pleno el blanco es blanco (${fullBright})`);
  assert.ok(midBright > 150 && midBright < 225, `a 0,4 s el blanco está al ~78 % (${midBright})`);
  await at(3.9); // left = 0,1 → opacidad ease-out(0,1) = 0,27
  const fading = await brightness();
  assert.ok(fading > 40 && fading < 100, `desaparecer: casi transparente (${fading})`);

  const motion = async (kind, axis, sign) => {
    await showText('HOLA', { font: 'Inter', weight: 700, size: 200, animIn: kind, animInDuration: 1, animOut: kind, animOutDuration: 1 });
    await at(0.02);
    const entering = await visible(6);
    await at(2);
    const rest = await visible(200);
    assert.ok(entering.n > 500 && rest.n > 1500, `${kind}: hay tinta al entrar (${entering.n}) y en reposo (${rest.n})`);
    const shift = (entering[axis] - rest[axis]) * sign;
    assert.ok(shift > 0.05 * (axis === 'cy' ? rest.H : rest.W), `${kind} entra desplazado ${sign > 0 ? 'hacia' : 'desde'} ${axis}: ${shift.toFixed(1)} px`);
    await at(3.98); // sale en la misma dirección en la que se mueve
    const leaving = await visible(6);
    if (leaving.n > 100) assert.ok((leaving[axis] - rest[axis]) * sign < 0, `${kind} sale hacia el lado contrario`);
  };
  await motion('slide-up', 'cy', 1);      // entra desde abajo: su centro está más abajo (y mayor)
  await motion('slide-down', 'cy', -1);   // entra desde arriba
  await motion('slide-left', 'cx', 1);    // entra por la derecha
  await motion('slide-right', 'cx', -1);  // entra por la izquierda

  await showText('HOLA', { font: 'Inter', weight: 700, size: 200, animIn: 'pop', animInDuration: 1 });
  await at(3);
  const restW = (await visible()).w;
  assert.ok(restW > 100, `rebote: en reposo mide ${restW}`);
  await at(0.5);
  const overshoot = await visible();
  assert.ok(overshoot.n > 0 && overshoot.w > restW * 1.05, `rebote: pasa de su tamaño final (${overshoot.w} vs ${restW})`);
  await at(0.1);
  const small = await visible();
  assert.ok(small.n > 0 && small.w < restW * 0.7, `rebote: empieza pequeño (${small.w} vs ${restW})`);

  await showText('HOLA', { font: 'Inter', weight: 700, size: 200, animIn: 'zoom', animInDuration: 1 });
  await at(3);
  const zoomRest = (await visible()).w;
  await at(0.25);
  const zoomStart = await visible();
  assert.ok(zoomStart.n > 0 && zoomStart.w < zoomRest * 0.85, `zoom: empieza más pequeño (${zoomStart.w} vs ${zoomRest})`);

  await showText('HOLA MUNDO', { font: 'Inter', weight: 700, size: 160, animIn: 'typewriter', animInDuration: 2 });
  await at(3);
  const typed = await visible();
  const counts = [];
  for (const t of [0.4, 0.8, 1.2, 1.6]) { await at(t); counts.push((await visible()).n); }
  assert.ok(counts[0] > 0, 'máquina de escribir: ya hay alguna letra a los 0,4 s');
  assert.ok(counts[0] < counts[1] && counts[1] < counts[2] && counts[2] < counts[3] && counts[3] < typed.n * 1.02, `la máquina de escribir revela letras: ${counts} → ${typed.n}`);
  await at(0.0);
  assert.equal((await visible(8)).n, 0, 'máquina de escribir: al inicio no hay letras');

  // WebGL (matriz) y compositor 2D deben dibujar la misma animación
  await showText('HOLA', { font: 'Inter', weight: 700, size: 200, animIn: 'slide-up', animInDuration: 1, background: '#3355ff', backgroundOpacity: 0.7, stroke: '#ffaa00', align: 'left' });
  await at(0.45);
  const diff = await run(async () => {
    const { createPlayer } = await import('/src/player/index.js');
    const other = document.createElement('canvas');
    const twin = createPlayer({ store, library, canvas: other, useWebGl: false });
    await new Promise((r) => setTimeout(r, 900));
    const a = document.querySelector('.pv__canvas').getContext('2d').getImageData(0, 0, other.width, other.height).data;
    const b = other.getContext('2d').getImageData(0, 0, other.width, other.height).data;
    let bad = 0;
    for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i] - b[i]) > 48 || Math.abs(a[i + 1] - b[i + 1]) > 48 || Math.abs(a[i + 2] - b[i + 2]) > 48) bad++;
    twin.destroy();
    return { bad, total: a.length / 4 };
  });
  assert.ok(diff.bad / diff.total < 0.01, `texto animado: WebGL y 2D coinciden (${diff.bad} de ${diff.total} difieren)`);

  // ---------- emoji y acentos ----------
  await showText('😀', { font: 'Inter', weight: 700, size: 300 });
  await at(1);
  const yellow = await ink('([r, g, b]) => r > 200 && g > 140 && b < 110');
  assert.ok(yellow.n > 500, `el emoji se dibuja a color (${yellow.n} px amarillos)`);
  for (const font of ['Inter', 'Bebas Neue', 'Pacifico']) {
    await showText('Ñandú ¿qué? ¡Sí! — café', { font, weight: 400, size: 120 });
    await at(1);
    assert.ok((await ink()).n > 300, `${font}: texto con acentos`);
  }

  assert.deepEqual(app.errors, []);
  console.log('text.browser: OK');
} finally {
  await app.close();
}
