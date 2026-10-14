import { clipEnd } from '../core/selectors.js';

const SLIDE = 0.12; // distancia del deslizamiento, como fracción del lienzo
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const easeOut = (x) => 1 - (1 - x) ** 3;
const easeOutBack = (x) => { const c1 = 1.70158; const c3 = c1 + 1; return 1 + c3 * (x - 1) ** 3 + c1 * (x - 1) ** 2; };

/**
 * Efecto de una animación con `p` = visibilidad (0 oculto, 1 visible). `dir` es 'in' o 'out':
 * en la salida, el movimiento se invierte para que el texto se aleje en la dirección indicada.
 */
function shape(kind, p, dir) {
  const e = easeOut(p);
  const sign = dir === 'in' ? 1 : -1;
  const base = { opacity: 1, dx: 0, dy: 0, scale: 1, reveal: 1 };
  switch (kind) {
    case 'fade': return { ...base, opacity: e };
    case 'slide-up': return { ...base, opacity: e, dy: sign * SLIDE * (1 - e) };
    case 'slide-down': return { ...base, opacity: e, dy: -sign * SLIDE * (1 - e) };
    case 'slide-left': return { ...base, opacity: e, dx: sign * SLIDE * (1 - e) };
    case 'slide-right': return { ...base, opacity: e, dx: -sign * SLIDE * (1 - e) };
    case 'pop': return { ...base, opacity: Math.min(1, p * 4), scale: easeOutBack(p) };
    case 'zoom': return { ...base, opacity: e, scale: 0.5 + 0.5 * e };
    case 'typewriter': return { ...base, reveal: p };
    default: return base;
  }
}

/**
 * Estado de la animación de un clip de texto en el instante t:
 * { opacity, dx, dy (fracciones del lienzo), scale (sobre el centro del texto), reveal (0-1 de letras) }.
 */
export function textAnimation(clip, t) {
  const text = clip.text;
  const inD = text.animIn === 'none' ? 0 : text.animInDuration ?? 0.5;
  const outD = text.animOut === 'none' ? 0 : text.animOutDuration ?? 0.5;
  const local = t - clip.start;
  const left = clipEnd(clip) - t;
  if (inD > 0 && local < inD) return shape(text.animIn, clamp01(local / inD), 'in');
  if (outD > 0 && left < outD) return shape(text.animOut, clamp01(left / outD), 'out');
  return shape('none', 1, 'in');
}

/** Recorta las líneas a la fracción `frac` de sus letras, conservando la estructura. */
export function revealLines(lines, frac) {
  if (frac >= 1) return lines;
  let left = Math.floor(lines.reduce((n, l) => n + l.length, 0) * clamp01(frac) + 1e-9);
  return lines.map((line) => {
    const shown = line.slice(0, left);
    left = Math.max(0, left - line.length);
    return shown;
  });
}
