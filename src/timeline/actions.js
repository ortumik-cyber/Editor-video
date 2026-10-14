import { newId } from '../core/ids.js';
import { createClip } from '../core/project.js';
import { clipEnd, clipsAt, firstFreeStart, getClip, trackClips } from '../core/selectors.js';

const err = (code, message) => ({ ok: false, error: { code, message } });

function pickTrack(project, kind) {
  return project.tracks.find((t) => t.kind === kind && !t.locked);
}

/** Pone un medio de la biblioteca en la primera pista libre de su tipo, a partir del cursor. */
export function addAssetClip(store, assetId, { at } = {}) {
  const project = store.getProject();
  const asset = project.assets[assetId];
  if (!asset) return err('no_asset', 'Medio inexistente');
  const track = pickTrack(project, asset.kind === 'audio' ? 'audio' : 'video');
  if (!track) return err('no_track', 'No hay una pista libre para este medio');
  const probe = createClip({ trackId: track.id, kind: asset.kind, assetId, duration: asset.kind === 'image' ? undefined : asset.duration });
  const start = firstFreeStart(project, track.id, probe.duration, at ?? store.getState().playhead);
  const clip = { ...probe, start };
  const result = store.dispatch({ type: 'clip/add', clip });
  if (result.ok) store.select([clip.id]);
  return result.ok ? { ok: true, clipId: clip.id } : result;
}

const EPS = 1e-6;
const isFreeAt = (project, trackId, start, end) => trackClips(project, trackId).every((c) => end <= c.start + EPS || start >= clipEnd(c) - EPS);

/**
 * Primera pista del tipo dado, sin bloquear y libre entre start y end. Con `skipBase`, la primera pista
 * de vídeo (la base) no cuenta: los superpuestos van encima. Si no hay ninguna, la crea.
 */
function freeTrackFor(store, kind, start, end, { skipBase = false } = {}) {
  const project = store.getProject();
  const candidates = project.tracks.filter((t) => t.kind === kind).slice(skipBase ? 1 : 0);
  const found = candidates.find((t) => !t.locked && isFreeAt(project, t.id, start, end));
  if (found) return found.id;
  const added = store.dispatch({ type: 'track/add', kind });
  if (!added.ok) return null;
  return store.getProject().tracks.filter((t) => t.kind === kind).at(-1).id;
}

/** Texto nuevo en el cursor. Si ya hay otro texto en ese instante, va a una pista nueva en lugar de desplazarse. */
export function addTextClip(store, { text, at, duration } = {}) {
  const start = Math.max(0, at ?? store.getState().playhead);
  const clip0 = createClip({ trackId: 'x', kind: 'text', text, duration, start });
  const trackId = freeTrackFor(store, 'text', start, start + clip0.duration);
  if (!trackId) return err('no_track', 'No se pudo crear una pista de texto');
  const clip = { ...clip0, trackId };
  const result = store.dispatch({ type: 'clip/add', clip });
  if (result.ok) store.select([clip.id]);
  return result.ok ? { ok: true, clipId: clip.id } : result;
}

/** Texto con la fuente y el estilo indicados; el estilo se valida con el resto del texto. */
export function addStyledText(store, style, content = 'Texto') {
  const made = addTextClip(store, { text: { content } });
  if (!made.ok) return made;
  const result = store.dispatch({ type: 'clip/update', clipId: made.clipId, patch: { text: style } });
  if (!result.ok) { store.dispatch({ type: 'clip/remove', clipId: made.clipId }); return result; }
  return made;
}

/** Un emoji es un texto grande y sin sombra. */
export const addEmojiClip = (store, emoji) => addStyledText(store, { font: 'Inter', weight: 400, size: 260, shadow: false, animIn: 'pop', animInDuration: 0.4 }, emoji);

/** Imagen o vídeo como capa superpuesta: en el cursor, encima de la pista base, sin mover lo que ya hay. */
export function addOverlayAsset(store, assetId, { at, scale = 0.35, duration = 3 } = {}) {
  const asset = store.getProject().assets[assetId];
  if (!asset || asset.kind === 'audio') return err('no_asset', 'Medio inexistente o no visual');
  const start = Math.max(0, at ?? store.getState().playhead);
  const length = asset.kind === 'image' ? duration : asset.duration;
  const trackId = freeTrackFor(store, 'video', start, start + length, { skipBase: true });
  if (!trackId) return err('no_track', 'No se pudo crear una capa');
  const clip = createClip({ trackId, kind: asset.kind, assetId, start, duration: length });
  const added = store.dispatch({ type: 'clip/add', clip });
  if (!added.ok) return added;
  store.dispatch({ type: 'clip/update', clipId: clip.id, patch: { transform: { scale } } });
  store.select([clip.id]);
  return { ok: true, clipId: clip.id };
}

const selectedId = (store) => store.getState().selection[0];

/** Divide el clip seleccionado, o el de arriba que cruce el cursor. Deja seleccionada la parte derecha. */
export function splitAtPlayhead(store) {
  const { playhead } = store.getState();
  const project = store.getProject();
  const selected = getClip(project, selectedId(store));
  const target = selected && playhead > selected.start && playhead < clipEnd(selected)
    ? selected
    : clipsAt(project, playhead).filter((c) => !project.tracks.find((t) => t.id === c.trackId).locked).at(-1);
  if (!target) return err('no_clip', 'No hay ningún clip bajo el cursor');
  const rightId = newId('clp');
  const result = store.dispatch({ type: 'clip/split', clipId: target.id, at: playhead, newId: rightId });
  if (result.ok) store.select([rightId]);
  return result;
}

export function deleteSelected(store, { ripple = false } = {}) {
  const id = selectedId(store);
  if (!id) return err('no_selection', 'No hay ningún clip seleccionado');
  return store.dispatch({ type: 'clip/remove', clipId: id, ripple });
}

export function duplicateSelected(store) {
  const id = selectedId(store);
  if (!id) return err('no_selection', 'No hay ningún clip seleccionado');
  const copyId = newId('clp');
  const result = store.dispatch({ type: 'clip/duplicate', clipId: id, newId: copyId });
  if (result.ok) store.select([copyId]);
  return result;
}

/** Mueve el clip seleccionado `delta` segundos. Alternativa de teclado al arrastre. */
export function nudgeSelected(store, delta) {
  const id = selectedId(store);
  if (!id) return err('no_selection', 'No hay ningún clip seleccionado');
  const clip = getClip(store.getProject(), id);
  return store.dispatch({ type: 'clip/move', clipId: id, start: Math.max(0, clip.start + delta), coalesce: `nudge:${id}` });
}
