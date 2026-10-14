import { newId } from '../core/ids.js';
import { createClip } from '../core/project.js';
import { clipEnd, clipsAt, firstFreeStart, getClip } from '../core/selectors.js';

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

export function addTextClip(store, { text, at } = {}) {
  const project = store.getProject();
  const track = pickTrack(project, 'text');
  if (!track) return err('no_track', 'No hay una pista de texto libre');
  const probe = createClip({ trackId: track.id, kind: 'text', text });
  const start = firstFreeStart(project, track.id, probe.duration, at ?? store.getState().playhead);
  const clip = { ...probe, start };
  const result = store.dispatch({ type: 'clip/add', clip });
  if (result.ok) store.select([clip.id]);
  return result.ok ? { ok: true, clipId: clip.id } : result;
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
