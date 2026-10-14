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

export function drawText(ctx, clip, canvasW, canvasH, alpha) {
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

/** Zona del origen que se muestra: todo, o el recorte del clip (fracciones 0-1). */
export function cropRect(srcW, srcH, crop) {
  const c = crop ?? { x: 0, y: 0, w: 1, h: 1 };
  return { sx: c.x * srcW, sy: c.y * srcH, sw: c.w * srcW, sh: c.h * srcH };
}

function drawLayer(ctx, layer, width, height, getSource, opacityScale = 1) {
  const { clip } = layer;
  const opacity = layer.opacity * opacityScale;
  if (opacity <= 0) return;
  if (clip.kind === 'text') { drawText(ctx, clip, width, height, opacity); return; }
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
