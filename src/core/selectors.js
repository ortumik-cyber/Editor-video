import { EPS, snap } from './project.js';

export const clipEnd = (clip) => snap(clip.start + clip.duration);

export const getClip = (project, id) => project.clips[id];
export const getTrack = (project, id) => project.tracks.find((t) => t.id === id);

export const trackClips = (project, trackId) => {
  const track = getTrack(project, trackId);
  return track ? track.clipIds.map((id) => project.clips[id]) : [];
};

export function projectDuration(project) {
  let end = 0;
  for (const clip of Object.values(project.clips)) end = Math.max(end, clipEnd(clip));
  return end;
}

/** Clips activos en el instante t, ordenados de pista inferior a superior. */
export function clipsAt(project, t) {
  const out = [];
  for (const track of project.tracks) {
    for (const id of track.clipIds) {
      const c = project.clips[id];
      if (t >= c.start - EPS && t < clipEnd(c) - EPS) out.push(c);
    }
  }
  return out;
}

/** Primer hueco libre de la pista con espacio para `duration`, a partir de `from`. */
export function firstFreeStart(project, trackId, duration, from = 0) {
  let cursor = from;
  for (const clip of trackClips(project, trackId)) {
    if (clipEnd(clip) <= cursor + EPS) continue;
    if (clip.start >= cursor + duration - EPS) break;
    cursor = clipEnd(clip);
  }
  return snap(cursor);
}

const VISUAL_KINDS = ['video', 'image'];

/** Clip visual que termina justo donde empieza `clip`, en la misma pista. Base de las transiciones. */
export function previousAdjacent(project, clip) {
  if (!VISUAL_KINDS.includes(clip.kind)) return null;
  const prev = trackClips(project, clip.trackId).find((c) => c.id !== clip.id && Math.abs(clipEnd(c) - clip.start) < 0.002);
  return prev && VISUAL_KINDS.includes(prev.kind) ? prev : null;
}
