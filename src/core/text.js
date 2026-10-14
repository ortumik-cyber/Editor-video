/**
 * Catálogo de tipografías y animaciones de texto, y validación del texto de un clip.
 * Son datos puros: el panel y el renderizador leen de aquí.
 */
export const FONTS = Object.freeze([
  { id: 'Inter', category: 'Sans', weights: [400, 700] },
  { id: 'Montserrat', category: 'Sans', weights: [400, 700] },
  { id: 'Oswald', category: 'Condensada', weights: [400, 700] },
  { id: 'Bebas Neue', category: 'Titulares', weights: [400] },
  { id: 'Anton', category: 'Titulares', weights: [400] },
  { id: 'Playfair Display', category: 'Serif', weights: [400, 700] },
  { id: 'Pacifico', category: 'Cursiva', weights: [400] },
  { id: 'Lobster', category: 'Cursiva', weights: [400] },
  { id: 'Caveat', category: 'Manuscrita', weights: [400, 700] },
  { id: 'Permanent Marker', category: 'Manuscrita', weights: [400] },
]);
export const FONT_IDS = Object.freeze(FONTS.map((f) => f.id));

export const fontFileName = (id, weight) => `${id.toLowerCase().replaceAll(' ', '-')}-latin-${weight}-normal.woff2`;

/** El peso disponible más cercano al pedido: evita el falso negrita del navegador. */
export function resolveWeight(fontId, weight) {
  const font = FONTS.find((f) => f.id === fontId);
  if (!font) return weight;
  return font.weights.reduce((best, w) => (Math.abs(w - weight) < Math.abs(best - weight) ? w : best), font.weights[0]);
}

/** `label` describe la entrada; `labelOut`, la salida. */
export const ANIMATIONS = Object.freeze([
  { id: 'none', label: 'Ninguna', labelOut: 'Ninguna' },
  { id: 'fade', label: 'Aparecer', labelOut: 'Desaparecer' },
  { id: 'slide-up', label: 'Subir', labelOut: 'Salir hacia arriba' },
  { id: 'slide-down', label: 'Bajar', labelOut: 'Salir hacia abajo' },
  { id: 'slide-left', label: 'Entrar por la derecha', labelOut: 'Salir por la izquierda' },
  { id: 'slide-right', label: 'Entrar por la izquierda', labelOut: 'Salir por la derecha' },
  { id: 'pop', label: 'Rebote', labelOut: 'Encoger' },
  { id: 'zoom', label: 'Zoom', labelOut: 'Zoom' },
  { id: 'typewriter', label: 'Máquina de escribir', labelOut: 'Borrar letra a letra' },
]);
export const ANIMATION_IDS = Object.freeze(ANIMATIONS.map((a) => a.id));

export const TEXT_LIMITS = Object.freeze({ size: [8, 400], duration: [0.1, 3], maxLength: 500 });
export const ALIGNMENTS = Object.freeze(['left', 'center', 'right']);
const HEX = /^#[0-9a-f]{6}$/i;

/** Devuelve el mensaje del primer error del texto, o null si es válido. */
export function textError(text, clipDuration) {
  if (typeof text.content !== 'string' || text.content.length > TEXT_LIMITS.maxLength) return `El texto admite hasta ${TEXT_LIMITS.maxLength} caracteres`;
  if (!FONT_IDS.includes(text.font)) return `Tipografía desconocida: ${text.font}`;
  if (!FONTS.find((f) => f.id === text.font).weights.includes(resolveWeight(text.font, text.weight)) || !Number.isFinite(text.weight)) return 'Peso no válido';
  const [minSize, maxSize] = TEXT_LIMITS.size;
  if (!(text.size >= minSize && text.size <= maxSize)) return `El tamaño va de ${minSize} a ${maxSize}`;
  if (!HEX.test(text.color)) return `Color inválido: ${text.color}`;
  for (const key of ['background', 'stroke']) if (text[key] !== null && !HEX.test(text[key])) return `Color inválido: ${text[key]}`;
  if (!(text.backgroundOpacity >= 0 && text.backgroundOpacity <= 1)) return 'La opacidad del fondo va de 0 a 1';
  if (!ALIGNMENTS.includes(text.align)) return `Alineación inválida: ${text.align}`;
  if (typeof text.shadow !== 'boolean') return 'La sombra es sí o no';
  for (const key of ['animIn', 'animOut']) if (!ANIMATION_IDS.includes(text[key])) return `Animación desconocida: ${text[key]}`;
  const [minDur, maxDur] = TEXT_LIMITS.duration;
  for (const key of ['animInDuration', 'animOutDuration']) if (!(text[key] >= minDur && text[key] <= maxDur)) return `La duración de la animación va de ${minDur} a ${maxDur} s`;
  const inD = text.animIn === 'none' ? 0 : text.animInDuration;
  const outD = text.animOut === 'none' ? 0 : text.animOutDuration;
  if (inD + outD > clipDuration + 1e-9) return 'Las animaciones superan la duración del clip';
  return null;
}
