import { formatDuration } from '../library/kinds.js';
import { snap } from '../core/project.js';

/** Columna fija de controles (56) más 12 de margen: el instante 0 queda a esta distancia del borde. */
export const GUTTER = 68;
export const ZOOM_MIN = 8;
export const ZOOM_MAX = 480;
export const ZOOM_DEFAULT = 80;

export const clampZoom = (pps) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, pps));
export const timeToX = (time, pps) => GUTTER + time * pps;
export const xToTime = (x, pps) => Math.max(0, (x - GUTTER) / pps);

/** Ancho del contenido: cubre la duración más un margen para seguir añadiendo. */
export function contentWidth(duration, pps, viewport) {
  const tail = Math.max(5, duration * 0.25);
  return Math.max(viewport, Math.ceil(GUTTER + (duration + tail) * pps));
}

/** Nuevo scrollLeft para que el instante bajo `anchorX` (px del visor) no se mueva al cambiar el zoom. */
export function zoomScroll(scrollLeft, anchorX, oldPps, newPps) {
  const time = (scrollLeft + anchorX - GUTTER) / oldPps;
  return Math.max(0, GUTTER + time * newPps - anchorX);
}

const STEPS = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800];
export const rulerStep = (pps, minPx = 64) => STEPS.find((s) => s * pps >= minPx) ?? STEPS.at(-1);

/** Marcas de la regla: una principal cada `step` y 4 intermedias entre cada par (siempre caben: step * pps >= 64). */
export function rulerTicks(pps, endTime) {
  const step = rulerStep(pps);
  const minor = step / 5;
  const ticks = [];
  for (let i = 0; i * minor <= endTime + step; i++) {
    const major = i % 5 === 0;
    const time = snap(i * minor);
    ticks.push({ time, major, label: major ? rulerLabel(time, step) : '' });
  }
  return ticks;
}

export function rulerLabel(time, step) {
  if (step >= 1) return formatDuration(time);
  const whole = Math.floor(time);
  const tenth = Math.round((time - whole) * 10);
  return `${formatDuration(whole)}.${tenth}`;
}

/**
 * Barras de la onda como un solo path SVG. Muestra el tramo [inPoint, inPoint + span] del medio.
 * `peaks` va de 0 a 255; se normaliza al pico máximo para que el audio bajo también se vea.
 */
export function waveformPath(peaks, { assetDuration, inPoint, span, width, height, barWidth = 3 }) {
  if (!peaks?.length || !(assetDuration > 0) || width < barWidth) return '';
  const bars = Math.min(600, Math.floor(width / barWidth));
  const top = Math.max(...peaks, 1);
  const mid = height / 2;
  let d = '';
  for (let i = 0; i < bars; i++) {
    const time = inPoint + ((i + 0.5) / bars) * span;
    const index = Math.min(peaks.length - 1, Math.max(0, Math.floor((time / assetDuration) * peaks.length)));
    const amp = Math.max(1, (peaks[index] / top) * (mid - 2));
    const x = ((i + 0.5) / bars) * width;
    d += `M${x.toFixed(1)} ${(mid - amp).toFixed(1)}V${(mid + amp).toFixed(1)}`;
  }
  return d;
}
