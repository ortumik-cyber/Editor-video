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

/** Parte el texto en líneas que caben en `maxWidth`. Respeta los saltos de línea. */
export function wrapLines(content, maxWidth, measure) {
  const lines = [];
  for (const paragraph of String(content).split('\n')) {
    let line = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word;
      if (line && measure(candidate) > maxWidth) { lines.push(line); line = word; } else line = candidate;
    }
    lines.push(line);
  }
  return lines;
}

const FONT_FALLBACK = "system-ui, -apple-system, 'Segoe UI', sans-serif";

function drawText(ctx, clip, canvasW, canvasH, alpha) {
  const text = clip.text;
  const { transform } = clip;
  ctx.font = `${text.weight} ${text.size}px "${text.font}", ${FONT_FALLBACK}`;
  const lines = wrapLines(text.content, canvasW * 0.9, (s) => ctx.measureText(s).width);
  const lineHeight = text.size * 1.2;
  const blockH = lines.length * lineHeight;
  const blockW = Math.max(...lines.map((l) => ctx.measureText(l).width));
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(canvasW / 2 + transform.x * canvasW, canvasH / 2 + transform.y * canvasH);
  ctx.rotate((transform.rotation * Math.PI) / 180);
  ctx.scale(transform.scale, transform.scale);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (text.background) {
    const pad = text.size * 0.3;
    ctx.fillStyle = text.background;
    ctx.fillRect(-blockW / 2 - pad, -blockH / 2 - pad / 2, blockW + pad * 2, blockH + pad);
  }
  if (text.shadow) { ctx.shadowColor = 'rgb(0 0 0 / 0.6)'; ctx.shadowBlur = text.size * 0.12; ctx.shadowOffsetY = text.size * 0.04; }
  lines.forEach((line, i) => {
    const y = -blockH / 2 + lineHeight * (i + 0.5);
    if (text.stroke) {
      ctx.lineJoin = 'round';
      ctx.lineWidth = text.size * 0.12;
      ctx.strokeStyle = text.stroke;
      ctx.strokeText(line, 0, y);
    }
    ctx.fillStyle = text.color;
    ctx.fillText(line, 0, y);
  });
  ctx.restore();
}

/**
 * Dibuja las capas (ya ordenadas de abajo arriba) sobre el fondo.
 * `size` es el tamaño lógico del proyecto; `scale` lo reduce para la vista previa.
 */
export function composeFrame(ctx, { width, height, background }, layers, getSource, { scale = 1 } = {}) {
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.globalAlpha = 1;
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, width, height);
  for (const layer of layers) {
    const { clip, opacity } = layer;
    if (opacity <= 0) continue;
    if (clip.kind === 'text') { drawText(ctx, clip, width, height, opacity); continue; }
    const source = getSource(clip);
    if (!source) continue;
    const g = layerGeometry({ srcW: source.width, srcH: source.height, transform: clip.transform, fit: clip.fit }, width, height);
    ctx.save();
    ctx.globalAlpha = opacity;
    ctx.translate(g.cx, g.cy);
    ctx.rotate(g.rotation);
    ctx.drawImage(source.image, -g.w / 2, -g.h / 2, g.w, g.h);
    ctx.restore();
  }
}
