import { FONTS, fontFileName, resolveWeight } from '../core/text.js';

const DEFAULT_BASE = new URL('../../assets/fonts/', import.meta.url);

/**
 * Carga de tipografías con la API FontFace. `version()` sube con cada fuente cargada: el
 * renderizador lo usa para rehacer las texturas de texto que se dibujaron con la fuente de repuesto.
 */
export function createFontLoader({ doc = globalThis.document, base = DEFAULT_BASE } = {}) {
  const jobs = new Map();
  const ready = new Set();
  let version = 0;

  function load(id, weight = 400) {
    const w = resolveWeight(id, weight);
    const key = `${id}:${w}`;
    if (!jobs.has(key)) {
      if (!FONTS.some((f) => f.id === id)) return Promise.resolve(false);
      const url = new URL(fontFileName(id, w), base);
      const face = new FontFace(id, `url("${url}")`, { weight: String(w) });
      jobs.set(key, face.load().then(() => {
        doc.fonts.add(face);
        ready.add(key);
        version++;
        return true;
      }).catch(() => false));
    }
    return jobs.get(key);
  }

  return {
    load,
    isLoaded: (id, weight = 400) => ready.has(`${id}:${resolveWeight(id, weight)}`),
    version: () => version,
    /** Carga las fuentes de los clips de texto indicados. */
    loadFor: (clips) => Promise.all(clips.filter((c) => c.kind === 'text').map((c) => load(c.text.font, c.text.weight))),
  };
}

export const fonts = createFontLoader();
