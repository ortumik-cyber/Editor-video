import { newId } from './ids.js';
import {
  ASPECTS, CLIP_KINDS_BY_TRACK, EPS, FPS_OPTIONS, MEDIA_CLIP_KINDS, MIN_CLIP_DURATION,
  TRACK_KINDS, createTrack, snap,
} from './project.js';
import { clipEnd, firstFreeStart, getClip, getTrack } from './selectors.js';

export class CommandError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'CommandError';
    this.code = code;
  }
}
const fail = (code, message) => { throw new CommandError(code, message); };

const SPEED_RANGE = [0.1, 16];
const VOLUME_RANGE = [0, 4];
const clamp = (v, [lo, hi]) => Math.min(hi, Math.max(lo, v));

// ---------- utilidades internas ----------

const needClip = (p, id) => getClip(p, id) ?? fail('no_clip', `Clip inexistente: ${id}`);
const needTrack = (p, id) => getTrack(p, id) ?? fail('no_track', `Pista inexistente: ${id}`);
const needUnlocked = (track) => { if (track.locked) fail('locked', `Pista bloqueada: ${track.name}`); };

function sortIds(clips, ids) {
  return [...ids].sort((a, b) => clips[a].start - clips[b].start);
}

function dropClip(p, id) {
  const { [id]: _removed, ...clips } = p.clips;
  const tracks = p.tracks.map((t) => (t.clipIds.includes(id) ? { ...t, clipIds: t.clipIds.filter((c) => c !== id) } : t));
  return { ...p, clips, tracks };
}

function putClip(p, clip) {
  const clips = { ...p.clips, [clip.id]: clip };
  const tracks = p.tracks.map((t) => {
    if (t.id !== clip.trackId) return t;
    const ids = t.clipIds.includes(clip.id) ? t.clipIds : [...t.clipIds, clip.id];
    return { ...t, clipIds: sortIds(clips, ids) };
  });
  return { ...p, clips, tracks };
}

function assertFree(p, trackId, start, end, ignoreId) {
  for (const id of needTrack(p, trackId).clipIds) {
    if (id === ignoreId) continue;
    const c = p.clips[id];
    if (start < clipEnd(c) - EPS && end > c.start + EPS) fail('overlap', 'El clip se solapa con otro en la pista');
  }
}

function assertSourceBounds(p, clip) {
  if (!MEDIA_CLIP_KINDS.includes(clip.kind)) return;
  const asset = p.assets[clip.assetId] ?? fail('no_asset', `Medio inexistente: ${clip.assetId}`);
  if (clip.in < -EPS) fail('bounds', 'El punto de entrada no puede ser negativo');
  if (clip.in + clip.duration * clip.speed > asset.duration + 0.002) fail('bounds', 'El clip supera la duración del medio');
}

function assertClipShape(p, clip) {
  const track = needTrack(p, clip.trackId);
  if (!CLIP_KINDS_BY_TRACK[track.kind].includes(clip.kind)) fail('kind', `Un clip ${clip.kind} no cabe en una pista ${track.kind}`);
  if (clip.start < -EPS) fail('bounds', 'El inicio no puede ser negativo');
  if (clip.duration < MIN_CLIP_DURATION - EPS) fail('bounds', `Duración mínima ${MIN_CLIP_DURATION}s`);
  if (clip.kind !== 'text' && !p.assets[clip.assetId]) fail('no_asset', `Medio inexistente: ${clip.assetId}`);
  assertSourceBounds(p, clip);
  assertFree(p, clip.trackId, clip.start, clipEnd(clip), clip.id);
}

const cloneEffects = (effects) => effects.map((e) => ({ ...e, id: newId('fx'), params: { ...e.params } }));

// ---------- manejadores ----------

const handlers = {
  'project/rename': (p, { name }) => {
    if (!name?.trim()) fail('invalid', 'Nombre vacío');
    return { ...p, name: name.trim() };
  },

  'project/settings': (p, { aspect, fps }) => {
    let settings = p.settings;
    if (aspect !== undefined) {
      const size = ASPECTS[aspect] ?? fail('invalid', `Formato inválido: ${aspect}`);
      settings = { ...settings, aspect, ...size };
    }
    if (fps !== undefined) {
      if (!FPS_OPTIONS.includes(fps)) fail('invalid', `fps inválido: ${fps}`);
      settings = { ...settings, fps };
    }
    return { ...p, settings };
  },

  'asset/add': (p, { asset }) => {
    if (p.assets[asset.id]) fail('duplicate', `Medio duplicado: ${asset.id}`);
    return { ...p, assets: { ...p.assets, [asset.id]: asset } };
  },

  'asset/remove': (p, { assetId }) => {
    if (!p.assets[assetId]) fail('no_asset', `Medio inexistente: ${assetId}`);
    let next = p;
    for (const clip of Object.values(p.clips)) if (clip.assetId === assetId) next = dropClip(next, clip.id);
    const { [assetId]: _gone, ...assets } = next.assets;
    return { ...next, assets };
  },

  'track/add': (p, { kind, name, index }) => {
    if (!TRACK_KINDS.includes(kind)) fail('invalid', `Tipo de pista inválido: ${kind}`);
    const track = createTrack({ kind, name });
    const tracks = [...p.tracks];
    tracks.splice(index ?? tracks.length, 0, track);
    return { ...p, tracks };
  },

  'track/update': (p, { trackId, patch }) => {
    needTrack(p, trackId);
    const allowed = {};
    for (const key of ['name', 'muted', 'locked']) if (key in patch) allowed[key] = patch[key];
    return { ...p, tracks: p.tracks.map((t) => (t.id === trackId ? { ...t, ...allowed } : t)) };
  },

  'track/reorder': (p, { trackId, index }) => {
    const track = needTrack(p, trackId);
    const tracks = p.tracks.filter((t) => t.id !== trackId);
    tracks.splice(Math.min(Math.max(index, 0), tracks.length), 0, track);
    return { ...p, tracks };
  },

  'track/remove': (p, { trackId }) => {
    const track = needTrack(p, trackId);
    if (track.kind === 'video' && p.tracks.filter((t) => t.kind === 'video').length === 1) {
      fail('last_video_track', 'Debe quedar al menos una pista de vídeo');
    }
    let next = p;
    for (const id of track.clipIds) next = dropClip(next, id);
    return { ...next, tracks: next.tracks.filter((t) => t.id !== trackId) };
  },

  'clip/add': (p, { clip }) => {
    if (p.clips[clip.id]) fail('duplicate', `Clip duplicado: ${clip.id}`);
    needUnlocked(needTrack(p, clip.trackId));
    assertClipShape(p, clip);
    return putClip(p, clip);
  },

  'clip/move': (p, { clipId, start, trackId }) => {
    const clip = needClip(p, clipId);
    needUnlocked(needTrack(p, clip.trackId));
    const moved = { ...clip, start: snap(start), trackId: trackId ?? clip.trackId };
    if (moved.trackId !== clip.trackId) needUnlocked(needTrack(p, moved.trackId));
    assertClipShape(p, moved);
    return putClip(dropClip(p, clipId), moved);
  },

  'clip/trim': (p, { clipId, edge, time }) => {
    const clip = needClip(p, clipId);
    needUnlocked(needTrack(p, clip.trackId));
    const t = snap(time);
    let trimmed;
    if (edge === 'start') {
      const delta = snap(t - clip.start);
      trimmed = {
        ...clip,
        start: t,
        duration: snap(clip.duration - delta),
        in: MEDIA_CLIP_KINDS.includes(clip.kind) ? snap(clip.in + delta * clip.speed) : clip.in,
      };
    } else if (edge === 'end') {
      trimmed = { ...clip, duration: snap(t - clip.start) };
    } else {
      fail('invalid', `Borde inválido: ${edge}`);
    }
    trimmed.fadeIn = Math.min(trimmed.fadeIn, trimmed.duration);
    trimmed.fadeOut = Math.min(trimmed.fadeOut, Math.max(0, trimmed.duration - trimmed.fadeIn));
    assertClipShape(p, trimmed);
    return putClip(p, trimmed);
  },

  'clip/split': (p, { clipId, at, newId: rightId }) => {
    const clip = needClip(p, clipId);
    needUnlocked(needTrack(p, clip.trackId));
    const t = snap(at);
    if (t < clip.start + MIN_CLIP_DURATION - EPS || t > clipEnd(clip) - MIN_CLIP_DURATION + EPS) {
      fail('bounds', 'El corte debe quedar dentro del clip, con margen mínimo a cada lado');
    }
    const leftDuration = snap(t - clip.start);
    const left = { ...clip, duration: leftDuration, fadeOut: 0 };
    const right = {
      ...clip,
      id: rightId ?? newId('clp'),
      start: t,
      duration: snap(clipEnd(clip) - t),
      in: MEDIA_CLIP_KINDS.includes(clip.kind) ? snap(clip.in + leftDuration * clip.speed) : clip.in,
      fadeIn: 0,
      transition: null,
      effects: cloneEffects(clip.effects),
      transform: { ...clip.transform },
      text: clip.text ? { ...clip.text } : null,
    };
    left.fadeIn = Math.min(left.fadeIn, left.duration);
    return putClip(putClip(p, left), right);
  },

  'clip/duplicate': (p, { clipId, newId: copyId }) => {
    const clip = needClip(p, clipId);
    needUnlocked(needTrack(p, clip.trackId));
    const start = firstFreeStart(p, clip.trackId, clip.duration, clipEnd(clip));
    const copy = {
      ...clip,
      id: copyId ?? newId('clp'),
      start,
      effects: cloneEffects(clip.effects),
      transform: { ...clip.transform },
      text: clip.text ? { ...clip.text } : null,
    };
    return putClip(p, copy);
  },

  'clip/remove': (p, { clipId, ripple = false }) => {
    const clip = needClip(p, clipId);
    needUnlocked(needTrack(p, clip.trackId));
    let next = dropClip(p, clipId);
    if (ripple) {
      const end = clipEnd(clip);
      for (const id of needTrack(next, clip.trackId).clipIds) {
        const c = next.clips[id];
        if (c.start >= end - EPS) next = putClip(next, { ...c, start: snap(c.start - clip.duration) });
      }
    }
    return next;
  },

  'clip/update': (p, { clipId, patch }) => {
    const clip = needClip(p, clipId);
    needUnlocked(needTrack(p, clip.trackId));
    let next = { ...clip };
    if ('speed' in patch) {
      if (!MEDIA_CLIP_KINDS.includes(clip.kind)) fail('kind', 'Solo vídeo y audio admiten velocidad');
      const speed = clamp(patch.speed, SPEED_RANGE);
      next.duration = snap((clip.duration * clip.speed) / speed);
      next.speed = speed;
    }
    if ('volume' in patch) next.volume = clamp(patch.volume, VOLUME_RANGE);
    if ('fadeIn' in patch) next.fadeIn = Math.max(0, snap(patch.fadeIn));
    if ('fadeOut' in patch) next.fadeOut = Math.max(0, snap(patch.fadeOut));
    if (next.fadeIn + next.fadeOut > next.duration + EPS) fail('bounds', 'Los fundidos superan la duración del clip');
    if ('transform' in patch) next.transform = { ...clip.transform, ...patch.transform };
    if ('transition' in patch) next.transition = patch.transition;
    if ('text' in patch) {
      if (clip.kind !== 'text') fail('kind', 'Solo los clips de texto tienen texto');
      next.text = { ...clip.text, ...patch.text };
    }
    assertClipShape(p, next);
    return putClip(p, next);
  },

  'effect/add': (p, { clipId, effect }) => {
    const clip = needClip(p, clipId);
    if (!effect?.type) fail('invalid', 'Efecto sin tipo');
    const fx = { id: effect.id ?? newId('fx'), type: effect.type, enabled: true, params: { ...effect.params } };
    return putClip(p, { ...clip, effects: [...clip.effects, fx] });
  },

  'effect/update': (p, { clipId, effectId, params, enabled }) => {
    const clip = needClip(p, clipId);
    if (!clip.effects.some((e) => e.id === effectId)) fail('no_effect', `Efecto inexistente: ${effectId}`);
    const effects = clip.effects.map((e) => (e.id !== effectId ? e : {
      ...e,
      enabled: enabled ?? e.enabled,
      params: params ? { ...e.params, ...params } : e.params,
    }));
    return putClip(p, { ...clip, effects });
  },

  'effect/remove': (p, { clipId, effectId }) => {
    const clip = needClip(p, clipId);
    if (!clip.effects.some((e) => e.id === effectId)) fail('no_effect', `Efecto inexistente: ${effectId}`);
    return putClip(p, { ...clip, effects: clip.effects.filter((e) => e.id !== effectId) });
  },

  'effect/reorder': (p, { clipId, from, to }) => {
    const clip = needClip(p, clipId);
    if (!clip.effects[from] || to < 0 || to >= clip.effects.length) fail('bounds', 'Índice de efecto fuera de rango');
    const effects = [...clip.effects];
    const [moved] = effects.splice(from, 1);
    effects.splice(to, 0, moved);
    return putClip(p, { ...clip, effects });
  },
};

export function reduce(project, command) {
  const handler = handlers[command?.type] ?? fail('unknown', `Comando desconocido: ${command?.type}`);
  return handler(project, command);
}

export const COMMAND_TYPES = Object.freeze(Object.keys(handlers));
