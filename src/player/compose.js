import { resolveWeight } from '../core/text.js';
import { revealLines, textAnimation } from '../text/animation.js';

/**
 * Dibujo de un fotograma. Es independiente del origen de las imágenes: `getSource(clip)` devuelve
 * { image, width, height } (un <video>, un ImageBitmap o un VideoFrame) o null. La vista previa
 * y la exportación usan este mismo código, así se ven igual.
 *
 * Unidades de la transformación: x e y son fracciones del ancho y alto del lienzo desde el centro;
 * scale multiplica el tamaño tras el ajuste; rotation va en grados; opacity de 0 a 1.
 */

export function fitSize(srcW, srcH, dstW, dstH, mode = 'contain') {
  const k = mode === 'cover' ? Math.max(dstW / srcW, dstH / srcH) : Math.min(dstW / srcW, dstH / srcH);
  return { w: srcW * k, h: srcH * k };
}

export function layerGeometry({ srcW, srcH, transform, fit }, canvasW, canvasH) {
  const base = fitSize(srcW, srcH, canvasW, canvasH, fit);
  return {
    cx: canvasW / 2 + transform.x * canvasW,
    cy: canvasH / 2 + transform.y * canvasH,
    w: base.w * transform.scale,
    h: base.h * transform.scale,
    rotation: (transform.rotation * Math.PI) / 180,
  };
}

/** Parte una palabra que no cabe en trozos que sí caben (al menos un carácter por trozo). */
function breakWord(word, maxWidth, measure) {
  const chunks = [];
  let chunk = '';
  for (const char of word) {
    if (chunk && measure(chunk + char) > maxWidth) { chunks.push(chunk); chunk = char; } else chunk += char;
  }
  if (chunk) chunks.push(chunk);
  return chunks;
}

/** Parte el texto en líneas que caben en `maxWidth`. Respeta los saltos de línea y parte las palabras demasiado largas. */
export function wrapLines(content, maxWidth, measure) {
  const lines = [];
  for (const paragraph of String(content).split('\n')) {
    let line = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word;
      if (measure(candidate) <= maxWidth) { line = candidate; continue; }
      if (line) lines.push(line);
      if (measure(word) <= maxWidth) { line = word; continue; }
      const chunks = breakWord(word, maxWidth, measure);
      lines.push(...chunks.slice(0, -1));
      line = chunks.at(-1);
    }
    lines.push(line);
  }
  return lines;
}

const FONT_FALLBACK = "system-ui, -apple-system, 'Segoe UI', 'Noto Color Emoji', sans-serif";

export const fontString = (text) => `${resolveWeight(text.font, text.weight)} ${text.size}px "${text.font}", ${FONT_FALLBACK}`;

function withAlpha(hex, alpha) {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

let scratch = null;
function measureContext(doc = globalThis.document) {
  scratch ??= doc.createElement('canvas').getContext('2d');
  return scratch;
}

/** Líneas y medidas del bloque de texto, en píxeles lógicos y sin transformar. */
export function textLayout(ctx, clip, canvasW) {
  const { text } = clip;
  ctx.font = fontString(text);
  const lines = wrapLines(text.content, canvasW * 0.9, (s) => ctx.measureText(s).width);
  const lineHeight = text.size * 1.2;
  const blockW = Math.max(1, ...lines.map((l) => ctx.measureText(l).width));
  return { lines, lineHeight, blockW, blockH: lines.length * lineHeight };
}

/** Caja del texto con su relleno, en píxeles lógicos, para colocar los tiradores de la vista previa. */
export function textBounds(clip, canvasW, doc) {
  const { blockW, blockH } = textLayout(measureContext(doc), clip, canvasW);
  const pad = clip.text.background ? clip.text.size * 0.3 : clip.text.size * 0.1;
  return { w: blockW + pad * 2, h: blockH + pad };
}

/**
 * Dibuja un bloque de texto. `reveal` (0-1) muestra solo esa parte de las letras, sin mover el resto.
 * `motion` ({ dx, dy, scale }) mueve y escala el bloque sobre su centro: lo usa el compositor 2D;
 * el renderizador WebGL lo aplica con la matriz y pasa `motion: null`.
 */
export function drawText(ctx, clip, canvasW, canvasH, alpha, { reveal = 1, motion = null } = {}) {
  const { text, transform } = clip;
  const { lines, lineHeight, blockW, blockH } = textLayout(ctx, clip, canvasW);
  const shown = revealLines(lines, reveal);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(canvasW / 2 + (transform.x + (motion?.dx ?? 0)) * canvasW, canvasH / 2 + (transform.y + (motion?.dy ?? 0)) * canvasH);
  ctx.rotate((transform.rotation * Math.PI) / 180);
  const k = transform.scale * (motion?.scale ?? 1);
  ctx.scale(k, k);
  ctx.textBaseline = 'middle';
  const x = text.align === 'left' ? -blockW / 2 : text.align === 'right' ? blockW / 2 : 0;
  ctx.textAlign = text.align;
  if (text.background) {
    const pad = text.size * 0.3;
    ctx.fillStyle = withAlpha(text.background, text.backgroundOpacity ?? 0.6);
    ctx.fillRect(-blockW / 2 - pad, -blockH / 2 - pad / 2, blockW + pad * 2, blockH + pad);
  }
  if (text.shadow) { ctx.shadowColor = 'rgb(0 0 0 / 0.6)'; ctx.shadowBlur = text.size * 0.12; ctx.shadowOffsetY = text.size * 0.04; }
  shown.forEach((line, i) => {
    const y = -blockH / 2 + lineHeight * (i + 0.5);
    if (text.stroke) {
      ctx.lineJoin = 'round';
      ctx.lineWidth = text.size * 0.12;
      ctx.strokeStyle = text.stroke;
      ctx.strokeText(line, x, y);
    }
    ctx.fillStyle = text.color;
    ctx.fillText(line, x, y);
  });
  ctx.restore();
}

/** Zona del origen que se muestra: todo, o el recorte del clip (fracciones 0-1). */
export function cropRect(srcW, srcH, crop) {
  const c = crop ?? { x: 0, y: 0, w: 1, h: 1 };
  return { sx: c.x * srcW, sy: c.y * srcH, sw: c.w * srcW, sh: c.h * srcH };
}

function drawLayer(ctx, layer, width, height, getSource, opacityScale = 1) {
  const { clip } = layer;
  const opacity = layer.opacity * opacityScale;
  if (opacity <= 0) return;
  if (clip.kind === 'text') {
    const anim = textAnimation(clip, layer.time ?? clip.start);
    drawText(ctx, clip, width, height, opacity * anim.opacity, { reveal: anim.reveal, motion: anim });
    return;
  }
  const source = getSource(clip);
  if (!source) return;
  const { sx, sy, sw, sh } = cropRect(source.width, source.height, clip.crop);
  const g = layerGeometry({ srcW: sw, srcH: sh, transform: clip.transform, fit: clip.fit }, width, height);
  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.translate(g.cx, g.cy);
  ctx.rotate(g.rotation);
  ctx.scale(clip.flip?.h ? -1 : 1, clip.flip?.v ? -1 : 1);
  ctx.drawImage(source.image, sx, sy, sw, sh, -g.w / 2, -g.h / 2, g.w, g.h);
  ctx.restore();
}

/**
 * Compositor 2D (respaldo sin WebGL): capas, recorte y volteo. No aplica efectos de color y
 * resuelve toda transición como un disolver.
 * `size` es el tamaño lógico del proyecto; `scale` lo reduce para la vista previa.
 */
export function composeFrame(ctx, { width, height, background }, plan, getSource, { scale = 1 } = {}) {
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.globalAlpha = 1;
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, width, height);
  for (const item of plan) {
    if (item.kind === 'transition') {
      drawLayer(ctx, item.outgoing, width, height, getSource, 1 - item.progress);
      drawLayer(ctx, item.incoming, width, height, getSource, item.progress);
    } else {
      drawLayer(ctx, item, width, height, getSource);
    }
  }
}
