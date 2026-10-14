import { layerGeometry } from './compose.js';
import { visualPlan } from './plan.js';
import { cropRect } from './compose.js';

/**
 * Geometría de la manipulación directa sobre la vista previa. Todo en píxeles lógicos del proyecto
 * (y hacia abajo), sin DOM: el DOM solo traduce el puntero a estas coordenadas.
 */

export const SCALE_RANGE = [0.05, 8];

/** Marco del clip: centro, tamaño y giro (radianes). `textSize(clip)` da el tamaño del bloque de texto. */
export function selectionFrame(project, clip, { textSize } = {}) {
  const { width: W, height: H } = project.settings;
  const t = clip.transform;
  if (clip.kind === 'text') {
    const size = textSize?.(clip) ?? { w: 0, h: 0 };
    return { cx: W / 2 + t.x * W, cy: H / 2 + t.y * H, w: size.w * t.scale, h: size.h * t.scale, rotation: (t.rotation * Math.PI) / 180 };
  }
  const asset = project.assets[clip.assetId];
  if (!asset) return null;
  const { sw, sh } = cropRect(asset.width, asset.height, clip.crop);
  return layerGeometry({ srcW: sw, srcH: sh, transform: t, fit: clip.fit }, W, H);
}

/** Esquinas del marco, en orden arriba-izquierda, arriba-derecha, abajo-derecha, abajo-izquierda. */
export function frameCorners({ cx, cy, w, h, rotation }) {
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => {
    const x = (sx * w) / 2;
    const y = (sy * h) / 2;
    return { x: cx + x * cos - y * sin, y: cy + x * sin + y * cos };
  });
}

/** ¿Está el punto dentro del marco (con giro)? `pad` lo agranda en píxeles lógicos. */
export function pointInFrame({ cx, cy, w, h, rotation }, p, pad = 0) {
  const cos = Math.cos(-rotation);
  const sin = Math.sin(-rotation);
  const dx = p.x - cx;
  const dy = p.y - cy;
  const lx = dx * cos - dy * sin;
  const ly = dx * sin + dy * cos;
  return Math.abs(lx) <= w / 2 + pad && Math.abs(ly) <= h / 2 + pad;
}

/** Clip visible más alto bajo el punto en el instante t (en una transición, el entrante antes que el saliente). */
export function pickTopClip(project, t, p, opts = {}) {
  const plan = visualPlan(project, t);
  for (let i = plan.length - 1; i >= 0; i--) {
    const item = plan[i];
    const layers = item.kind === 'transition' ? [item.incoming, item.outgoing] : [item];
    for (const layer of layers) {
      const frame = selectionFrame(project, layer.clip, opts);
      if (frame && pointInFrame(frame, p)) return layer.clip.id;
    }
  }
  return null;
}

/** Mover: la posición del clip cambia lo mismo que el puntero. Con imán al centro del encuadre. */
export function dragMove(transform0, from, to, { width, height }, { snapDistance = 0 } = {}) {
  let x = transform0.x + (to.x - from.x) / width;
  let y = transform0.y + (to.y - from.y) / height;
  const snapX = snapDistance > 0 && Math.abs(x * width) <= snapDistance;
  const snapY = snapDistance > 0 && Math.abs(y * height) <= snapDistance;
  if (snapX) x = 0;
  if (snapY) y = 0;
  return { x, y, snapX, snapY };
}

const clamp = (v, [lo, hi]) => Math.min(hi, Math.max(lo, v));
const toDegrees = (rad) => (rad * 180) / Math.PI;
export const normalizeDegrees = (deg) => ((((deg + 180) % 360) + 360) % 360) - 180;

/** Giro con imán a múltiplos de 90° (4°) o, con `step`, a pasos fijos. */
export function snapRotation(deg, step = 0) {
  const n = normalizeDegrees(deg);
  if (step > 0) return normalizeDegrees(Math.round(n / step) * step);
  const nearest = Math.round(n / 90) * 90;
  return Math.abs(n - nearest) <= 4 ? normalizeDegrees(nearest) : n;
}

/** Tirador de esquina: la distancia al centro escala y el ángulo gira, a la vez. */
export function dragHandle(center, transform0, from, to, { step = 0 } = {}) {
  const r0 = Math.hypot(from.x - center.x, from.y - center.y) || 1;
  const r = Math.hypot(to.x - center.x, to.y - center.y);
  const turn = Math.atan2(to.y - center.y, to.x - center.x) - Math.atan2(from.y - center.y, from.x - center.x);
  return {
    scale: clamp(transform0.scale * (r / r0), SCALE_RANGE),
    rotation: snapRotation(transform0.rotation + toDegrees(turn), step),
  };
}

/** Dos dedos: la distancia entre ellos escala, el ángulo gira y su punto medio mueve. */
export function dragPinch(transform0, [a0, b0], [a, b], { width, height }) {
  const d0 = Math.hypot(b0.x - a0.x, b0.y - a0.y) || 1;
  const d = Math.hypot(b.x - a.x, b.y - a.y);
  const turn = Math.atan2(b.y - a.y, b.x - a.x) - Math.atan2(b0.y - a0.y, b0.x - a0.x);
  const mid0 = { x: (a0.x + b0.x) / 2, y: (a0.y + b0.y) / 2 };
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  return {
    scale: clamp(transform0.scale * (d / d0), SCALE_RANGE),
    rotation: normalizeDegrees(transform0.rotation + toDegrees(turn)),
    x: transform0.x + (mid.x - mid0.x) / width,
    y: transform0.y + (mid.y - mid0.y) / height,
  };
}
