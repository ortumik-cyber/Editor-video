import { snap } from '../core/project.js';
import { clipEnd, previousAdjacent } from '../core/selectors.js';

const VISUAL = new Set(['video', 'image', 'text']);
const MEDIA = new Set(['video', 'audio']);
const active = (clip, t) => t >= clip.start - 1e-6 && t < clipEnd(clip) - 1e-6;

/** Factor 0-1 de los fundidos de entrada y salida en el instante t. */
export function fadeFactor(clip, t) {
  const local = t - clip.start;
  const left = clipEnd(clip) - t;
  let factor = 1;
  if (clip.fadeIn > 0 && local < clip.fadeIn) factor = Math.min(factor, local / clip.fadeIn);
  if (clip.fadeOut > 0 && left < clip.fadeOut) factor = Math.min(factor, left / clip.fadeOut);
  return Math.min(1, Math.max(0, factor));
}

/** Tiempo dentro del archivo de origen. Imágenes y texto no tienen. */
export const sourceTime = (clip, t) => (MEDIA.has(clip.kind) ? snap(clip.in + (t - clip.start) * clip.speed) : 0);

/**
 * Ventana de una transición: centrada en el corte entre el clip anterior y `clip`.
 * La duración se limita a la de ambos clips, así dos transiciones seguidas nunca se pisan.
 */
export function transitionWindow(project, clip) {
  if (!clip.transition) return null;
  const prev = previousAdjacent(project, clip);
  if (!prev) return null;
  const d = Math.min(clip.transition.duration, prev.duration, clip.duration);
  return { prev, type: clip.transition.type, d, half: d / 2, start: snap(clip.start - d / 2), end: snap(clip.start + d / 2) };
}

const inWindow = (win, t) => win && t >= win.start - 1e-6 && t < win.end - 1e-6;

/** Tiempo de origen limitado al archivo: fuera del clip se congela el primer o el último fotograma. */
function clampedSource(project, clip, t) {
  if (!MEDIA.has(clip.kind)) return 0;
  const limit = Math.max(0, (project.assets[clip.assetId]?.duration ?? Infinity) - 0.001);
  return snap(Math.min(limit, Math.max(0, clip.in + (t - clip.start) * clip.speed)));
}

function layerAt(project, clip, t, trackIndex) {
  const inside = Math.min(Math.max(t, clip.start), clipEnd(clip) - 0.001);
  return { kind: 'layer', clip, trackIndex, time: t, srcTime: clampedSource(project, clip, t), opacity: clip.transform.opacity * fadeFactor(clip, inside) };
}

/**
 * Elementos visibles en t, de la pista inferior a la superior. Un elemento es una capa
 * ({ kind: 'layer', clip, srcTime, opacity }) o una transición entre dos capas
 * ({ kind: 'transition', type, progress, outgoing, incoming, clip }).
 */
export function visualPlan(project, t) {
  const items = [];
  project.tracks.forEach((track, trackIndex) => {
    const clips = track.clipIds.map((id) => project.clips[id]).filter((c) => VISUAL.has(c.kind));
    const covered = new Set();
    const transitions = [];
    for (const clip of clips) {
      const win = transitionWindow(project, clip);
      if (!inWindow(win, t)) continue;
      covered.add(clip.id).add(win.prev.id);
      transitions.push({
        kind: 'transition', type: win.type, progress: (t - win.start) / win.d, trackIndex, clip,
        outgoing: layerAt(project, win.prev, t, trackIndex), incoming: layerAt(project, clip, t, trackIndex),
      });
    }
    for (const clip of clips) {
      if (!covered.has(clip.id) && active(clip, t)) items.push({ ...layerAt(project, clip, t, trackIndex), srcTime: sourceTime(clip, t) });
    }
    items.push(...transitions);
  });
  return items;
}

/** Las capas sueltas de un plan visual, incluidas las dos de cada transición. */
export const flattenLayers = (plan) => plan.flatMap((item) => (item.kind === 'transition' ? [item.outgoing, item.incoming] : [item]));

/** Clips de vídeo y audio activos en t, con su ganancia (volumen x fundido x silencio de pista). */
export function mediaPlan(project, t) {
  const items = [];
  for (const track of project.tracks) {
    for (const id of track.clipIds) {
      const clip = project.clips[id];
      if (!MEDIA.has(clip.kind) || !active(clip, t)) continue;
      const asset = project.assets[clip.assetId];
      const audible = clip.kind === 'audio' || asset?.hasAudio;
      items.push({
        clip,
        srcTime: sourceTime(clip, t),
        speed: clip.speed,
        hasAudio: Boolean(audible),
        gain: audible && !track.muted ? clip.volume * fadeFactor(clip, t) : 0,
      });
    }
  }
  // Durante una transición también hay que reproducir el clip anterior (tras su final) y el siguiente (antes de empezar).
  for (const track of project.tracks) {
    for (const id of track.clipIds) {
      const clip = project.clips[id];
      const win = transitionWindow(project, clip);
      if (!inWindow(win, t) || !MEDIA.has(clip.kind)) continue;
      for (const c of [win.prev, clip]) {
        if (MEDIA.has(c.kind) && !items.some((i) => i.clip.id === c.id)) {
          items.push({ clip: c, srcTime: clampedSource(project, c, t), speed: c.speed, hasAudio: false, gain: 0 });
        }
      }
    }
  }
  return items;
}

/** Clips de vídeo y audio que empiezan en los próximos `horizon` segundos: se precargan. */
export function upcomingMedia(project, t, horizon) {
  const out = [];
  for (const clip of Object.values(project.clips)) {
    if (!MEDIA.has(clip.kind)) continue;
    const lead = transitionWindow(project, clip)?.half ?? 0;
    const from = clip.start - lead;
    if (from > t && from <= t + horizon) out.push(clip);
  }
  return out;
}
