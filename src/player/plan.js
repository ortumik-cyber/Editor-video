import { snap } from '../core/project.js';
import { clipEnd } from '../core/selectors.js';

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

/** Capas visibles en t, de la pista inferior a la superior. */
export function visualPlan(project, t) {
  const layers = [];
  project.tracks.forEach((track, trackIndex) => {
    for (const id of track.clipIds) {
      const clip = project.clips[id];
      if (!VISUAL.has(clip.kind) || !active(clip, t)) continue;
      layers.push({ clip, trackIndex, srcTime: sourceTime(clip, t), opacity: clip.transform.opacity * fadeFactor(clip, t) });
    }
  });
  return layers;
}

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
  return items;
}

/** Clips de vídeo y audio que empiezan en los próximos `horizon` segundos: se precargan. */
export function upcomingMedia(project, t, horizon) {
  const out = [];
  for (const clip of Object.values(project.clips)) {
    if (MEDIA.has(clip.kind) && clip.start > t && clip.start <= t + horizon) out.push(clip);
  }
  return out;
}
