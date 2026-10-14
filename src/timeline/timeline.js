import { clipEnd, clipsAt, projectDuration } from '../core/selectors.js';
import { snap } from '../core/project.js';
import { formatDuration } from '../library/kinds.js';
import { addAssetClip, deleteSelected, duplicateSelected, nudgeSelected, splitAtPlayhead } from './actions.js';
import { resolveMove, resolveTrim } from './edit.js';
import {
  GUTTER, ZOOM_DEFAULT, clampZoom, contentWidth, rulerTicks, timeToX, waveformPath, xToTime, zoomScroll,
} from './geometry.js';
import { icon } from '../ui/icons.js';

const TRACK_H = 64;
const CLIP_H = 56;
const DRAG_THRESHOLD_PX = 4;
const SNAP_PX = 8;
const KIND_LABEL = { video: 'vídeo', image: 'imagen', audio: 'audio', text: 'texto' };

const BUTTONS = [
  ['split', 'split', 'Dividir en el cursor (S)'],
  ['duplicate', 'copy', 'Duplicar (D)'],
  ['delete', 'trash', 'Eliminar (Supr)'],
  ['undo', 'undo', 'Deshacer (Ctrl+Z)'],
  ['redo', 'redo', 'Rehacer (Ctrl+Mayús+Z)'],
  ['layer', 'layer', 'Añadir capa de vídeo'],
  ['zoomOut', 'zoomOut', 'Alejar (-)'],
  ['zoomIn', 'zoomIn', 'Acercar (+)'],
];

/**
 * Línea de tiempo. Lee el store y escribe solo con comandos.
 * Durante un gesto el clip se mueve con transform y solo al soltar se envía un comando:
 * un gesto es un paso de historial y la vista no se reconstruye a mitad de arrastre.
 * Con táctil, un clip no seleccionado deja que el dedo desplace la línea; se arrastra solo tras seleccionarlo.
 */
export function createTimeline(root, { store, library = null, doc = root.ownerDocument } = {}) {
  const abort = new AbortController();
  const on = (target, type, fn, options) => target.addEventListener(type, fn, { ...options, signal: abort.signal });
  const ui = { pps: ZOOM_DEFAULT, follow: false };
  const thumbs = new Map();
  let rows = [];
  let gesture = null;

  root.classList.add('tl');
  root.style.setProperty('--tl-gutter', `${GUTTER}px`);
  root.style.setProperty('--tl-track-h', `${TRACK_H}px`);
  root.style.setProperty('--tl-clip-h', `${CLIP_H}px`);
  root.innerHTML = `
    <div class="tl__toolbar" role="toolbar" aria-label="Edición de la línea de tiempo">
      ${BUTTONS.map(([action, name, label]) => `<button type="button" class="tl__btn" data-action="${action}" aria-label="${label}" title="${label}">${icon(name)}</button>`).join('')}
    </div>
    <div class="tl__scroll">
      <div class="tl__content">
        <div class="tl__ruler" aria-hidden="true"></div>
        <div class="tl__tracks"></div>
        <div class="tl__playhead" aria-hidden="true"><div class="tl__playhead-head"></div></div>
        <div class="tl__guide" hidden></div>
      </div>
    </div>
    <div class="tl__status" role="status" aria-live="polite"></div>`;
  const $ = (sel) => root.querySelector(sel);
  const scroll = $('.tl__scroll');
  scroll.tabIndex = -1;
  const content = $('.tl__content');
  const ruler = $('.tl__ruler');
  const tracksEl = $('.tl__tracks');
  const playhead = $('.tl__playhead');
  const guide = $('.tl__guide');
  const statusEl = $('.tl__status');

  const say = (message) => { statusEl.textContent = ''; statusEl.textContent = message; };
  const run = (result) => { if (!result.ok) say(result.error.message); return result; };
  const thresholdSeconds = () => SNAP_PX / ui.pps;

  // ---------- render ----------

  function clipLabel(clip, project) {
    if (clip.kind === 'text') return clip.text.content;
    return project.assets[clip.assetId]?.name ?? '';
  }

  function ensureThumb(assetId) {
    if (!library || thumbs.has(assetId)) return;
    thumbs.set(assetId, null);
    library.getThumbUrl(assetId).then((url) => {
      if (!url) return;
      thumbs.set(assetId, url);
      for (const el of root.querySelectorAll(`[data-asset-id="${assetId}"] .tl__clip-bg`)) el.style.backgroundImage = `url("${url}")`;
    }).catch(() => {});
  }

  function buildClip(clip, project) {
    const asset = project.assets[clip.assetId];
    const width = Math.max(clip.duration * ui.pps, 2);
    const el = doc.createElement('div');
    el.className = `tl__clip tl__clip--${clip.kind}`;
    el.dataset.clipId = clip.id;
    if (asset) el.dataset.assetId = asset.id;
    el.tabIndex = 0;
    el.setAttribute('role', 'button');
    el.setAttribute('aria-pressed', 'false');
    el.setAttribute('aria-label', `${clipLabel(clip, project)}, ${KIND_LABEL[clip.kind]}, inicio ${formatDuration(clip.start)}, duración ${clip.duration.toFixed(1)} segundos`);
    el.style.left = `${clip.start * ui.pps}px`;
    el.style.width = `${width}px`;

    if (clip.kind === 'video' || clip.kind === 'image') {
      const bg = doc.createElement('div');
      bg.className = 'tl__clip-bg';
      if (thumbs.get(asset.id)) bg.style.backgroundImage = `url("${thumbs.get(asset.id)}")`;
      el.append(bg);
      ensureThumb(asset.id);
    } else if (clip.kind === 'audio') {
      const d = waveformPath(asset.peaks, { assetDuration: asset.duration, inPoint: clip.in, span: clip.duration * clip.speed, width, height: CLIP_H });
      if (d) el.insertAdjacentHTML('beforeend', `<svg class="tl__wave" viewBox="0 0 ${width} ${CLIP_H}" preserveAspectRatio="none" aria-hidden="true"><path d="${d}"/></svg>`);
    }
    const label = doc.createElement('span');
    label.className = 'tl__clip-label';
    label.textContent = clipLabel(clip, project) + (clip.speed !== 1 ? `  ${clip.speed}×` : '');
    el.append(label);
    return el;
  }

  function renderRuler(endTime) {
    const frag = doc.createDocumentFragment();
    for (const tick of rulerTicks(ui.pps, endTime)) {
      const el = doc.createElement('span');
      el.className = tick.major ? 'tl__tick tl__tick--major' : 'tl__tick';
      el.style.left = `${timeToX(tick.time, ui.pps)}px`;
      if (tick.label) el.textContent = tick.label;
      frag.append(el);
    }
    ruler.replaceChildren(frag);
  }

  function render() {
    const project = store.getProject();
    const focusedId = doc.activeElement?.closest?.('[data-clip-id]')?.dataset.clipId;
    const duration = projectDuration(project);
    const width = contentWidth(duration, ui.pps, 0);
    content.style.width = `${width}px`;
    renderRuler((width - GUTTER) / ui.pps);

    rows = [...project.tracks].reverse().map((track) => {
      const row = doc.createElement('div');
      row.className = `tl__row tl__row--${track.kind}${track.locked ? ' is-locked' : ''}`;
      row.dataset.trackId = track.id;
      row.innerHTML = `<div class="tl__head"><button type="button" class="tl__btn tl__lock" data-track-action="lock" aria-pressed="${track.locked}" aria-label="${track.locked ? 'Desbloquear' : 'Bloquear'} pista ${track.name}" title="${track.locked ? 'Desbloquear' : 'Bloquear'} pista">${icon(track.locked ? 'lock' : 'unlock')}</button></div><div class="tl__lane"></div>`;
      const lane = row.querySelector('.tl__lane');
      for (const id of track.clipIds) lane.append(buildClip(project.clips[id], project));
      return { track, el: row };
    });
    tracksEl.replaceChildren(...rows.map((r) => r.el));
    updateSelection();
    updatePlayhead();
    if (focusedId) root.querySelector(`[data-clip-id="${focusedId}"]`)?.focus({ preventScroll: true });
  }

  function updateSelection() {
    const selected = new Set(store.getState().selection);
    for (const el of root.querySelectorAll('.tl__clip')) {
      const on = selected.has(el.dataset.clipId);
      el.classList.toggle('is-selected', on);
      el.setAttribute('aria-pressed', String(on));
      const has = el.querySelector('.tl__handle');
      if (on && !has) {
        el.insertAdjacentHTML('beforeend', '<div class="tl__handle tl__handle--start" data-edge="start" aria-hidden="true"><i></i></div><div class="tl__handle tl__handle--end" data-edge="end" aria-hidden="true"><i></i></div>');
      } else if (!on && has) {
        el.querySelectorAll('.tl__handle').forEach((h) => h.remove());
      }
    }
    updateToolbar();
  }

  function updatePlayhead() {
    const { playhead: t } = store.getState();
    const x = timeToX(t, ui.pps);
    playhead.style.transform = `translateX(${x}px)`;
    if (ui.follow) {
      const left = scroll.scrollLeft;
      if (x < left + GUTTER || x > left + scroll.clientWidth - 24) scroll.scrollLeft = Math.max(0, x - scroll.clientWidth * 0.3);
    }
    updateToolbar();
  }

  function updateToolbar() {
    const state = store.getState();
    const set = (action, enabled) => { $(`[data-action="${action}"]`).disabled = !enabled; };
    set('undo', store.canUndo());
    set('redo', store.canRedo());
    set('duplicate', state.selection.length > 0);
    set('delete', state.selection.length > 0);
    set('split', state.selection.length > 0 || clipsAt(store.getProject(), state.playhead).length > 0);
    set('zoomIn', ui.pps < 480);
    set('zoomOut', ui.pps > 8);
  }

  function setZoom(next, anchorX = scroll.clientWidth / 2) {
    const old = ui.pps;
    ui.pps = clampZoom(next);
    if (ui.pps === old) return;
    const left = scroll.scrollLeft;
    render();
    scroll.scrollLeft = zoomScroll(left, anchorX, old, ui.pps);
  }

  // ---------- gestos ----------

  const contentX = (e) => e.clientX - content.getBoundingClientRect().left;
  const seek = (e) => store.setPlayhead(snap(xToTime(contentX(e), ui.pps)));

  function rowAt(clientY) {
    const rect = tracksEl.getBoundingClientRect();
    const index = Math.min(rows.length - 1, Math.max(0, Math.floor((clientY - rect.top) / TRACK_H)));
    return { index, row: rows[index] };
  }

  function autoScroll(e) {
    const rect = scroll.getBoundingClientRect();
    if (e.clientX < rect.left + GUTTER + 24) scroll.scrollLeft -= 14;
    else if (e.clientX > rect.right - 32) scroll.scrollLeft += 14;
  }

  function endGesture(apply, e) {
    const g = gesture;
    gesture = null;
    if (!g) return;
    guide.hidden = true;
    g.el?.classList.remove('is-dragging');
    if (g.el) { g.el.style.transform = ''; g.el.style.zIndex = ''; }
    if (apply && g.type !== 'scrub' && g.moved) g.commit();
    else if (g.moved && (g.type === 'trim' || g.type === 'move')) render();
    if (g.pointerId !== undefined && g.captureEl?.hasPointerCapture?.(g.pointerId)) g.captureEl.releasePointerCapture(g.pointerId);
    if (e) e.preventDefault?.();
  }

  on(content, 'pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const project = store.getProject();
    const handle = e.target.closest('.tl__handle');
    const clipEl = e.target.closest('.tl__clip');
    if (e.target.closest('.tl__ruler, .tl__playhead-head')) {
      gesture = { type: 'scrub', pointerId: e.pointerId, captureEl: content };
      content.setPointerCapture(e.pointerId);
      scroll.focus({ preventScroll: true });
      seek(e);
      return;
    }
    if (!clipEl) {
      if (e.target.closest('.tl__lane')) { store.select([]); scroll.focus({ preventScroll: true }); }
      return;
    }
    const clip = project.clips[clipEl.dataset.clipId];
    const locked = project.tracks.find((t) => t.id === clip.trackId).locked;
    const wasSelected = store.getState().selection.includes(clip.id);
    if (e.pointerType !== 'touch') {
      if (!wasSelected) store.select([clip.id]);
    } else if (!wasSelected) {
      return; // el dedo desplaza la línea; click selecciona
    }
    if (locked) { say('La pista está bloqueada'); return; }
    gesture = {
      type: handle ? 'trim' : 'move', edge: handle?.dataset.edge, clip, el: clipEl, captureEl: clipEl, pointerId: e.pointerId,
      startX: e.clientX, startY: e.clientY, startScroll: scroll.scrollLeft, moved: false,
      origIndex: rows.findIndex((r) => r.track.id === clip.trackId), commit: () => {},
    };
    clipEl.setPointerCapture(e.pointerId);
    clipEl.focus({ preventScroll: true });
    e.preventDefault();
  });

  on(content, 'pointermove', (e) => {
    const g = gesture;
    if (!g || e.pointerId !== g.pointerId) return;
    if (g.type === 'scrub') { seek(e); autoScroll(e); return; }
    const dx = e.clientX - g.startX + (scroll.scrollLeft - g.startScroll);
    if (!g.moved && Math.hypot(dx, e.clientY - g.startY) < DRAG_THRESHOLD_PX) return;
    g.moved = true;
    autoScroll(e);
    const project = store.getProject();
    const { playhead: head } = store.getState();
    const threshold = thresholdSeconds();
    g.el.classList.add('is-dragging');

    if (g.type === 'move') {
      const { row } = rowAt(e.clientY);
      const r = resolveMove(project, g.clip.id, { rawStart: g.clip.start + dx / ui.pps, trackId: row.track.id }, { playhead: head, threshold });
      const newIndex = rows.findIndex((x) => x.track.id === r.trackId);
      g.el.style.zIndex = '6';
      g.el.style.transform = `translate(${(r.start - g.clip.start) * ui.pps}px, ${(newIndex - g.origIndex) * TRACK_H}px)`;
      showGuide(r.point);
      g.commit = () => run(store.dispatch({ type: 'clip/move', clipId: g.clip.id, start: r.start, trackId: r.trackId !== g.clip.trackId ? r.trackId : undefined }));
    } else {
      const edgeTime = g.edge === 'start' ? g.clip.start : clipEnd(g.clip);
      const r = resolveTrim(project, g.clip.id, g.edge, edgeTime + dx / ui.pps, { playhead: head, threshold });
      const start = g.edge === 'start' ? r.time : g.clip.start;
      const end = g.edge === 'start' ? clipEnd(g.clip) : r.time;
      g.el.style.left = `${start * ui.pps}px`;
      g.el.style.width = `${Math.max((end - start) * ui.pps, 2)}px`;
      showGuide(r.point);
      g.commit = () => run(store.dispatch({ type: 'clip/trim', clipId: g.clip.id, edge: g.edge, time: r.time }));
    }
  });

  function showGuide(point) {
    guide.hidden = point === null;
    if (point !== null) guide.style.transform = `translateX(${timeToX(point, ui.pps)}px)`;
  }

  on(content, 'pointerup', (e) => { if (gesture && e.pointerId === gesture.pointerId) endGesture(true, e); });
  on(content, 'pointercancel', (e) => { if (gesture && e.pointerId === gesture.pointerId) endGesture(false, e); });

  on(content, 'click', (e) => {
    const clipEl = e.target.closest('.tl__clip');
    if (clipEl && !e.target.closest('.tl__handle')) store.select([clipEl.dataset.clipId]);
    const lock = e.target.closest('[data-track-action="lock"]');
    if (lock) {
      const trackId = lock.closest('.tl__row').dataset.trackId;
      const track = store.getProject().tracks.find((t) => t.id === trackId);
      run(store.dispatch({ type: 'track/update', trackId, patch: { locked: !track.locked } }));
    }
  });

  on(root, 'click', (e) => {
    const button = e.target.closest('[data-action]');
    if (!button || button.disabled) return;
    const actions = {
      split: () => run(splitAtPlayhead(store)),
      duplicate: () => run(duplicateSelected(store)),
      delete: () => run(deleteSelected(store)),
      undo: () => store.undo(),
      redo: () => store.redo(),
      layer: () => run(store.dispatch({ type: 'track/add', kind: 'video', index: store.getProject().tracks.findLastIndex((t) => t.kind === 'video') + 1 })),
      zoomIn: () => setZoom(ui.pps * 1.25),
      zoomOut: () => setZoom(ui.pps / 1.25),
    };
    actions[button.dataset.action]();
  });

  on(scroll, 'wheel', (e) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    setZoom(ui.pps * Math.exp(-e.deltaY * 0.01), e.clientX - scroll.getBoundingClientRect().left);
  }, { passive: false });

  on(root, 'keydown', (e) => {
    if (gesture && e.key === 'Escape') { endGesture(false); return; }
    if (e.target.closest('input, textarea, select, [contenteditable="true"]')) return;
    const key = e.key.toLowerCase();
    const mod = e.ctrlKey || e.metaKey;
    const fps = store.getProject().settings.fps;
    if (mod && key === 'z') { e.preventDefault(); if (e.shiftKey) store.redo(); else store.undo(); return; }
    if (mod && key === 'y') { e.preventDefault(); store.redo(); return; }
    if (mod) return;
    const handlers = {
      s: () => run(splitAtPlayhead(store)),
      d: () => run(duplicateSelected(store)),
      delete: () => run(deleteSelected(store, { ripple: e.shiftKey })),
      backspace: () => run(deleteSelected(store, { ripple: e.shiftKey })),
      arrowleft: () => run(nudgeSelected(store, e.shiftKey ? -1 : -1 / fps)),
      arrowright: () => run(nudgeSelected(store, e.shiftKey ? 1 : 1 / fps)),
      '+': () => setZoom(ui.pps * 1.25),
      '=': () => setZoom(ui.pps * 1.25),
      '-': () => setZoom(ui.pps / 1.25),
      home: () => store.setPlayhead(0),
      end: () => store.setPlayhead(projectDuration(store.getProject())),
    };
    if (handlers[key]) { e.preventDefault(); handlers[key](); }
  });

  const unsubscribe = store.subscribe((_, meta) => {
    if (meta.type === 'select') updateSelection();
    else if (meta.type === 'playhead') updatePlayhead();
    else render();
  });

  render();

  return {
    render,
    setZoom,
    getZoom: () => ui.pps,
    addAsset: (assetId) => run(addAssetClip(store, assetId)),
    scrollToTime: (t) => { scroll.scrollLeft = Math.max(0, timeToX(t, ui.pps) - scroll.clientWidth * 0.3); },
    set follow(value) { ui.follow = Boolean(value); },
    destroy() { abort.abort(); unsubscribe(); root.replaceChildren(); root.classList.remove('tl'); },
  };
}
