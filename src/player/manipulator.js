import { textBounds } from './compose.js';
import { dragHandle, dragMove, dragPinch, pickTopClip, pointInFrame, selectionFrame } from './manipulate.js';

const SNAP_PX = 6;
const HIT_PAD_PX = 8;

/**
 * Manipulación directa sobre la vista previa: mover, escalar y girar el clip seleccionado, y
 * seleccionar el que haya bajo el puntero. Cada movimiento envía el comando al momento (el lienzo
 * se redibuja en vivo) con una clave de fusión: el gesto entero es un solo paso de historial.
 * Es una alternativa por puntero; el equivalente accesible son los deslizadores del panel.
 */
export function createManipulator(wrap, { store, canvas, doc = wrap.ownerDocument, onEditText, onMessage }) {
  const abort = new AbortController();
  const on = (target, type, fn, options) => target.addEventListener(type, fn, { ...options, signal: abort.signal });
  wrap.insertAdjacentHTML('beforeend', `
    <div class="pv__overlay" role="group" aria-label="Colocar el elemento seleccionado: arrastra para mover, usa la esquina para escalar y girar">
      <div class="pv__guide pv__guide--v" hidden></div><div class="pv__guide pv__guide--h" hidden></div>
      <div class="pv__sel" hidden><div class="pv__handle" title="Arrastra para escalar y girar (Mayús: giro en pasos de 15°)"><i></i></div></div>
    </div>`);
  const overlay = wrap.querySelector('.pv__overlay');
  const frameEl = wrap.querySelector('.pv__sel');
  const guideV = wrap.querySelector('.pv__guide--v');
  const guideH = wrap.querySelector('.pv__guide--h');
  const pointers = new Map();
  let gesture = null;

  const logicalSize = () => store.getProject().settings;
  const textSize = (clip) => textBounds(clip, logicalSize().width, doc);
  const displayScale = () => canvas.getBoundingClientRect().width / logicalSize().width;
  const toLogical = (e) => {
    const r = canvas.getBoundingClientRect();
    const { width, height } = logicalSize();
    return { x: ((e.clientX - r.left) / r.width) * width, y: ((e.clientY - r.top) / r.height) * height };
  };

  function current() {
    const project = store.getProject();
    const clip = project.clips[store.getState().selection[0]];
    if (!clip || clip.kind === 'audio') return null;
    const t = store.getState().playhead;
    if (t < clip.start - 1e-6 || t >= clip.start + clip.duration - 1e-6) return null;
    const frame = selectionFrame(project, clip, { textSize });
    if (!frame) return null;
    return { clip, frame, locked: project.tracks.find((tr) => tr.id === clip.trackId).locked };
  }

  function update() {
    const cur = current();
    frameEl.hidden = !cur;
    if (!cur) return;
    const k = displayScale();
    const { cx, cy, w, h, rotation } = cur.frame;
    Object.assign(frameEl.style, {
      left: `${(cx - w / 2) * k}px`, top: `${(cy - h / 2) * k}px`, width: `${w * k}px`, height: `${h * k}px`, transform: `rotate(${rotation}rad)`,
    });
    frameEl.classList.toggle('is-locked', cur.locked);
  }

  const hideGuides = () => { guideV.hidden = true; guideH.hidden = true; };
  const showGuides = (snapX, snapY) => {
    const r = canvas.getBoundingClientRect();
    guideV.hidden = !snapX;
    guideH.hidden = !snapY;
    guideV.style.left = `${r.width / 2}px`;
    guideH.style.top = `${r.height / 2}px`;
  };

  function send(clipId, transform) {
    const result = store.dispatch({ type: 'clip/update', clipId, patch: { transform }, coalesce: `mx:${clipId}` });
    if (!result.ok) onMessage?.(result.error.message);
  }

  function startMove(cur, point) {
    if (cur.locked) { onMessage?.('La pista está bloqueada'); return; }
    gesture = { type: 'move', clipId: cur.clip.id, t0: { ...cur.clip.transform }, from: point };
  }

  on(overlay, 'pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const point = toLogical(e);
    pointers.set(e.pointerId, point);
    try { overlay.setPointerCapture(e.pointerId); } catch { /* puntero sintético */ }
    let cur = current();
    if (pointers.size === 2 && cur && !cur.locked) {
      const [a, b] = [...pointers.values()];
      gesture = { type: 'pinch', clipId: cur.clip.id, t0: { ...cur.clip.transform }, start: [a, b] };
      return;
    }
    if (pointers.size > 1) return;
    if (cur && !cur.locked && e.target.closest('.pv__handle')) {
      gesture = { type: 'handle', clipId: cur.clip.id, t0: { ...cur.clip.transform }, center: { x: cur.frame.cx, y: cur.frame.cy }, from: point };
      return;
    }
    if (cur && pointInFrame(cur.frame, point, HIT_PAD_PX / displayScale())) { startMove(cur, point); return; }
    const id = pickTopClip(store.getProject(), store.getState().playhead, point, { textSize });
    if (!id) { store.select([]); return; }
    store.select([id]);
    cur = current();
    if (cur) startMove(cur, point);
  });

  on(overlay, 'pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    const point = toLogical(e);
    pointers.set(e.pointerId, point);
    if (!gesture) return;
    const size = logicalSize();
    if (gesture.type === 'move') {
      const r = dragMove(gesture.t0, gesture.from, point, size, { snapDistance: SNAP_PX / displayScale() });
      send(gesture.clipId, { x: r.x, y: r.y });
      showGuides(r.snapX, r.snapY);
    } else if (gesture.type === 'handle') {
      send(gesture.clipId, dragHandle(gesture.center, gesture.t0, gesture.from, point, { step: e.shiftKey ? 15 : 0 }));
    } else if (gesture.type === 'pinch' && pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      send(gesture.clipId, dragPinch(gesture.t0, gesture.start, [a, b], size));
    }
  });

  const release = (e) => {
    pointers.delete(e.pointerId);
    if (pointers.size === 0) { gesture = null; store.endCoalesce(); hideGuides(); } else if (gesture?.type === 'pinch') { gesture = null; store.endCoalesce(); }
  };
  on(overlay, 'pointerup', release);
  on(overlay, 'pointercancel', release);

  on(overlay, 'dblclick', (e) => {
    const cur = current();
    if (cur?.clip.kind === 'text' && pointInFrame(cur.frame, toLogical(e), HIT_PAD_PX / displayScale())) onEditText?.(cur.clip);
  });

  const unsubscribe = store.subscribe(update);
  const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
  observer?.observe(canvas);
  doc.fonts?.addEventListener?.('loadingdone', update);
  update();

  return {
    update,
    destroy() { abort.abort(); unsubscribe(); observer?.disconnect(); overlay.remove(); },
  };
}
