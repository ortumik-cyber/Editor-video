/**
 * Catálogo de efectos, filtros y transiciones. Son datos puros: el renderizador (WebGL) y el panel
 * leen de aquí. Cada efecto es un único valor numérico y un clip tiene a lo sumo uno de cada tipo.
 */
export const EFFECTS = Object.freeze({
  brightness: { label: 'Brillo', min: -1, max: 1, step: 0.01, default: 0 },
  contrast: { label: 'Contraste', min: -1, max: 1, step: 0.01, default: 0 },
  saturation: { label: 'Saturación', min: -1, max: 1, step: 0.01, default: 0 },
  temperature: { label: 'Temperatura', min: -1, max: 1, step: 0.01, default: 0 },
  hue: { label: 'Tono', min: -180, max: 180, step: 1, default: 0 },
  sepia: { label: 'Sepia', min: 0, max: 1, step: 0.01, default: 0 },
  vignette: { label: 'Viñeta', min: 0, max: 1, step: 0.01, default: 0 },
  blur: { label: 'Desenfoque', min: 0, max: 30, step: 0.5, default: 0 },
  sharpen: { label: 'Nitidez', min: 0, max: 1, step: 0.01, default: 0 },
  pixelate: { label: 'Mosaico', min: 0, max: 1, step: 0.01, default: 0 },
});
export const EFFECT_TYPES = Object.freeze(Object.keys(EFFECTS));

export const clampEffectValue = (type, value) => Math.min(EFFECTS[type].max, Math.max(EFFECTS[type].min, value));

export const PRESETS = Object.freeze([
  { id: 'vivid', label: 'Vívido', values: { saturation: 0.35, contrast: 0.15 } },
  { id: 'cinema', label: 'Cine', values: { contrast: 0.2, saturation: -0.15, temperature: -0.15, vignette: 0.35 } },
  { id: 'mono', label: 'Blanco y negro', values: { saturation: -1, contrast: 0.15 } },
  { id: 'vintage', label: 'Vintage', values: { sepia: 0.5, vignette: 0.4, contrast: -0.1, temperature: 0.2 } },
  { id: 'warm', label: 'Cálido', values: { temperature: 0.4, saturation: 0.1 } },
  { id: 'cool', label: 'Frío', values: { temperature: -0.4 } },
  { id: 'faded', label: 'Desvaído', values: { contrast: -0.25, brightness: 0.1, saturation: -0.2 } },
]);

/** Efectos de un filtro a la intensidad dada (0-1): cada valor se escala desde el neutro. */
export function presetEffects(presetId, intensity = 1) {
  const preset = PRESETS.find((p) => p.id === presetId);
  if (!preset) return null;
  return Object.entries(preset.values).map(([type, value]) => ({
    type,
    value: clampEffectValue(type, EFFECTS[type].default + (value - EFFECTS[type].default) * intensity),
  }));
}

/** Valores finales para el renderizador. Gana el último efecto activo de cada tipo. */
export function foldEffects(effects = []) {
  const out = Object.fromEntries(EFFECT_TYPES.map((t) => [t, EFFECTS[t].default]));
  for (const fx of effects) {
    if (fx.enabled !== false && EFFECTS[fx.type]) out[fx.type] = clampEffectValue(fx.type, Number(fx.params?.value ?? EFFECTS[fx.type].default));
  }
  return out;
}

export const TRANSITIONS = Object.freeze([
  { id: 'dissolve', label: 'Disolver' },
  { id: 'dip', label: 'Fundido a negro' },
  { id: 'slide-left', label: 'Deslizar a la izquierda' },
  { id: 'slide-right', label: 'Deslizar a la derecha' },
  { id: 'slide-up', label: 'Deslizar hacia arriba' },
  { id: 'slide-down', label: 'Deslizar hacia abajo' },
  { id: 'wipe', label: 'Barrido' },
  { id: 'zoom', label: 'Zoom' },
]);
export const TRANSITION_IDS = Object.freeze(TRANSITIONS.map((t) => t.id));
export const TRANSITION_RANGE = Object.freeze({ min: 0.2, max: 2, default: 0.6 });
