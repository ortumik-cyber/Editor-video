import { CLIP_KINDS_BY_TRACK, EPS, MEDIA_CLIP_KINDS, MIN_CLIP_DURATION, snap } from '../core/project.js';
import { clipEnd, getClip, getTrack, trackClips } from '../core/selectors.js';

/** Instantes a los que se pega el arrastre: inicio, cursor y bordes de los demás clips. */
export function collectSnapPoints(project, { excludeClipId, playhead = 0 } = {}) {
  const points = new Set([0, snap(playhead)]);
  for (const clip of Object.values(project.clips)) {
    if (clip.id === excludeClipId) continue;
    points.add(clip.start);
    points.add(clipEnd(clip));
  }
  return [...points].sort((a, b) => a - b);
}

export function snapValue(value, points, threshold) {
  let best = null;
  let bestDistance = threshold;
  for (const point of points) {
    const distance = Math.abs(point - value);
    if (distance <= bestDistance + EPS) { best = point; bestDistance = distance; }
  }
  return best === null ? { value, point: null } : { value: best, point: best };
}

/** Pega el inicio o el final del clip al punto más cercano. Gana el borde que quede más cerca. */
export function snapRange(start, duration, points, threshold) {
  const a = snapValue(start, points, threshold);
  const b = snapValue(start + duration, points, threshold);
  if (a.point === null && b.point === null) return { start, point: null };
  const da = a.point === null ? Infinity : Math.abs(a.value - start);
  const db = b.point === null ? Infinity : Math.abs(b.value - (start + duration));
  return da <= db ? { start: a.value, point: a.point } : { start: b.value - duration, point: b.point };
}

const isFree = (project, trackId, start, end, ignoreId) =>
  getTrack(project, trackId).clipIds.every((id) => {
    if (id === ignoreId) return true;
    const c = project.clips[id];
    return !(start < clipEnd(c) - EPS && end > c.start + EPS);
  });

/** Posición libre más cercana a `rawStart`: la misma si cabe, si no pegada a un vecino. */
export function nearestFreeStart(project, trackId, duration, rawStart, ignoreId) {
  const wanted = Math.max(0, snap(rawStart));
  const candidates = [wanted];
  for (const c of trackClips(project, trackId)) {
    if (c.id === ignoreId) continue;
    candidates.push(clipEnd(c), snap(c.start - duration));
  }
  let best = null;
  for (const start of candidates) {
    if (start < -EPS || !isFree(project, trackId, start, snap(start + duration), ignoreId)) continue;
    if (best === null || Math.abs(start - wanted) < Math.abs(best - wanted)) best = start;
  }
  return best;
}

/**
 * Resuelve dónde queda un clip arrastrado. Si la pista de destino no admite su tipo, o está
 * bloqueada, el clip se queda en su pista. Nunca devuelve una posición que solape.
 */
export function resolveMove(project, clipId, { rawStart, trackId }, { playhead = 0, threshold = 0 } = {}) {
  const clip = getClip(project, clipId);
  const wanted = getTrack(project, trackId);
  const target = wanted && !wanted.locked && CLIP_KINDS_BY_TRACK[wanted.kind].includes(clip.kind) ? wanted : getTrack(project, clip.trackId);
  const points = collectSnapPoints(project, { excludeClipId: clipId, playhead });
  const snapped = snapRange(Math.max(0, rawStart), clip.duration, points, threshold);
  const start = nearestFreeStart(project, target.id, clip.duration, snapped.start, clipId);
  const final = start ?? clip.start;
  const point = points.find((p) => Math.abs(p - final) < EPS) ?? points.find((p) => Math.abs(p - (final + clip.duration)) < EPS) ?? null;
  return { start: final, trackId: start === null ? clip.trackId : target.id, snapped: point !== null, point };
}

/** Límites en los que se puede mover un borde: vecinos, duración mínima y duración del medio. */
export function trimBounds(project, clipId, edge) {
  const clip = getClip(project, clipId);
  const end = clipEnd(clip);
  const others = trackClips(project, clip.trackId).filter((c) => c.id !== clipId);
  const media = MEDIA_CLIP_KINDS.includes(clip.kind);
  if (edge === 'start') {
    const prevEnd = Math.max(0, ...others.filter((c) => clipEnd(c) <= clip.start + EPS).map(clipEnd));
    const sourceLimit = media ? clip.start - clip.in / clip.speed : 0;
    return { min: Math.max(prevEnd, sourceLimit), max: snap(end - MIN_CLIP_DURATION) };
  }
  const next = Math.min(Infinity, ...others.filter((c) => c.start >= end - EPS).map((c) => c.start));
  const sourceLimit = media ? clip.start + (project.assets[clip.assetId].duration - clip.in) / clip.speed : Infinity;
  return { min: snap(clip.start + MIN_CLIP_DURATION), max: Math.min(next, sourceLimit) };
}

/** Tiempo final del borde: pegado al imán y recortado a los límites. */
export function resolveTrim(project, clipId, edge, rawTime, { playhead = 0, threshold = 0 } = {}) {
  const { min, max } = trimBounds(project, clipId, edge);
  const points = collectSnapPoints(project, { excludeClipId: clipId, playhead });
  const snapped = snapValue(rawTime, points, threshold);
  const time = snap(Math.min(max, Math.max(min, snapped.value)));
  const hit = snapped.point !== null && Math.abs(time - snapped.point) < EPS;
  return { time, snapped: hit, point: hit ? snapped.point : null };
}
