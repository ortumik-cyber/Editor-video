import { EFFECTS, EFFECT_TYPES, PRESETS, TRANSITIONS, TRANSITION_RANGE, foldEffects } from '../core/effects.js';
import { previousAdjacent } from '../core/selectors.js';
import { icon } from '../ui/icons.js';
import { centeredCrop, cropRatio } from './crop.js';

const CROPS = [['Original', null], ['1:1', 1], ['4:5', 4 / 5], ['9:16', 9 / 16], ['16:9', 16 / 9]];
const SPEEDS = [0.5, 1, 2, 4];
const SLIDERS = {
  x: { label: 'Posición horizontal', min: -1, max: 1, step: 0.01, def: 0 },
  y: { label: 'Posición vertical', min: -1, max: 1, step: 0.01, def: 0 },
  scale: { label: 'Tamaño', min: 0.1, max: 3, step: 0.01, def: 1 },
  opacity: { label: 'Opacidad', min: 0, max: 1, step: 0.01, def: 1 },
  speed: { label: 'Velocidad', min: 0.1, max: 8, step: 0.1, def: 1 },
  trdur: { label: 'Duración de la transición', min: TRANSITION_RANGE.min, max: TRANSITION_RANGE.max, step: 0.1, def: TRANSITION_RANGE.default },
};
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const fmt = (v, step) => Number(v).toFixed(step >= 1 ? 0 : step >= 0.1 ? 1 : 2);

function sliderHtml(key, def, extra = '') {
  return `<div class="ins__row"><label class="ins__label" for="ins-${key}">${def.label}</label>
    <output class="ins__out" for="ins-${key}" data-reset="${key}" title="Doble toque: restablecer"></output>
    <input id="ins-${key}" class="ins__range" type="range" min="${def.min}" max="${def.max}" step="${def.step}" ${extra}></div>`;
}
const chip = (attrs, label) => `<button type="button" class="ins__chip" ${attrs} aria-pressed="false">${label}</button>`;
const iconButton = (action, name, label) => `<button type="button" class="ins__icon" data-action="${action}" aria-label="${label}" title="${label}">${icon(name)}</button>`;

/**
 * Panel de edición del clip seleccionado: filtros, ajustes, transformación, velocidad y transición.
 * Se construye una vez por clip y después solo sincroniza valores: reconstruir un deslizador
 * mientras se arrastra rompería el gesto. Un arrastre completo es un solo paso de historial.
 */
export function createInspector(root, { store }) {
  const abort = new AbortController();
  const on = (target, type, fn) => target.addEventListener(type, fn, { signal: abort.signal });
  let clipId = null;
  let lastPreset = null;
  let intensity = 1;

  root.classList.add('ins');
  root.innerHTML = '<p class="ins__empty">Selecciona un clip para editarlo.</p><div class="ins__body" hidden></div><div class="ins__status" role="status" aria-live="polite"></div>';
  const empty = root.querySelector('.ins__empty');
  const body = root.querySelector('.ins__body');
  const status = root.querySelector('.ins__status');
  const say = (message) => { status.textContent = ''; status.textContent = message; };
  const run = (command) => { const r = store.dispatch(command); if (!r.ok) say(r.error.message); return r; };
  const clip = () => store.getProject().clips[clipId];

  function build(c) {
    const visual = ['video', 'image', 'text'].includes(c.kind);
    const media = c.kind === 'video' || c.kind === 'image';
    const parts = [];
    if (!visual && c.kind !== 'audio') return '';
    if (c.kind === 'audio') return '<p class="ins__note">El audio se edita en su propio panel (próximamente).</p>';

    parts.push(`<section class="ins__sec" aria-labelledby="ins-h-filters"><h3 id="ins-h-filters">Filtros</h3>
      <div class="ins__chips" role="group" aria-label="Filtros">${PRESETS.map((p) => chip(`data-preset="${p.id}"`, p.label)).join('')}</div>
      <div class="ins__row ins__row--intensity" hidden><label class="ins__label" for="ins-intensity">Intensidad del filtro</label><output class="ins__out" for="ins-intensity"></output>
        <input id="ins-intensity" class="ins__range" type="range" min="0" max="1" step="0.01" data-intensity></div>
      <button type="button" class="ins__text-btn" data-action="clear-fx">Quitar todos los efectos</button></section>`);
    parts.push(`<section class="ins__sec" aria-labelledby="ins-h-adjust"><h3 id="ins-h-adjust">Ajustes</h3>
      ${EFFECT_TYPES.map((t) => sliderHtml(`fx-${t}`, { label: EFFECTS[t].label, min: EFFECTS[t].min, max: EFFECTS[t].max, step: EFFECTS[t].step }, `data-fx="${t}"`)).join('')}</section>`);
    parts.push(`<section class="ins__sec" aria-labelledby="ins-h-xform"><h3 id="ins-h-xform">Transformar</h3>
      ${media ? `<div class="ins__chips" role="group" aria-label="Ajuste al encuadre">${chip('data-fit="contain"', 'Ajustar')}${chip('data-fit="cover"', 'Rellenar')}</div>
      <div class="ins__chips" role="group" aria-label="Giro y volteo">${iconButton('rotate-left', 'rotateLeft', 'Girar 90° a la izquierda')}${iconButton('rotate-right', 'rotateRight', 'Girar 90° a la derecha')}
        <button type="button" class="ins__icon" data-action="flip-h" aria-pressed="false" aria-label="Voltear horizontalmente" title="Voltear horizontalmente">${icon('flipH')}</button>
        <button type="button" class="ins__icon" data-action="flip-v" aria-pressed="false" aria-label="Voltear verticalmente" title="Voltear verticalmente">${icon('flipV')}</button></div>
      <div class="ins__chips" role="group" aria-label="Recorte">${CROPS.map(([label, ratio], i) => chip(`data-crop="${i}"`, label)).join('')}</div>` : ''}
      ${['scale', 'x', 'y', 'opacity'].map((k) => sliderHtml(`p-${k}`, SLIDERS[k], `data-prop="${k}"`)).join('')}
      <button type="button" class="ins__text-btn" data-action="reset-xform">Restablecer posición y tamaño</button></section>`);
    if (c.kind === 'video') {
      parts.push(`<section class="ins__sec" aria-labelledby="ins-h-speed"><h3 id="ins-h-speed">Velocidad</h3>
        <div class="ins__chips" role="group" aria-label="Velocidades">${SPEEDS.map((v) => chip(`data-speed="${v}"`, `${v}×`)).join('')}</div>
        ${sliderHtml('p-speed', SLIDERS.speed, 'data-prop="speed"')}</section>`);
    }
    if (media) {
      parts.push(`<section class="ins__sec" aria-labelledby="ins-h-trans"><h3 id="ins-h-trans">Transición de entrada</h3>
        <p class="ins__note" data-trans-note></p>
        <div class="ins__chips" role="group" aria-label="Transiciones">${chip('data-transition=""', 'Ninguna')}${TRANSITIONS.map((t) => chip(`data-transition="${t.id}"`, esc(t.label))).join('')}</div>
        ${sliderHtml('p-trdur', SLIDERS.trdur, 'data-prop="trdur"')}</section>`);
    }
    return parts.join('');
  }

  function setRange(input, value, step) {
    if (!input) return;
    input.value = String(value);
    const out = root.querySelector(`output[for="${input.id}"]`);
    if (out) out.textContent = fmt(value, step);
  }
  const pressed = (el, on2) => el.setAttribute('aria-pressed', String(on2));

  /** Copia el estado del clip a los controles, sin reconstruirlos. */
  function sync() {
    const project = store.getProject();
    const c = project.clips[clipId];
    if (!c) { show(null); return; }
    const folded = foldEffects(c.effects);
    for (const input of body.querySelectorAll('[data-fx]')) setRange(input, folded[input.dataset.fx], EFFECTS[input.dataset.fx].step);
    for (const el of body.querySelectorAll('[data-preset]')) pressed(el, el.dataset.preset === lastPreset);
    const row = body.querySelector('.ins__row--intensity');
    if (row) { row.hidden = !lastPreset; setRange(row.querySelector('input'), intensity, 0.01); }
    for (const input of body.querySelectorAll('[data-prop]')) {
      const k = input.dataset.prop;
      const value = k === 'speed' ? c.speed : k === 'trdur' ? (c.transition?.duration ?? TRANSITION_RANGE.default) : c.transform[k];
      setRange(input, value, SLIDERS[k].step);
    }
    for (const el of body.querySelectorAll('[data-fit]')) pressed(el, c.fit === el.dataset.fit);
    const asset = project.assets[c.assetId];
    if (asset) {
      const ratio = cropRatio(asset.width, asset.height, c.crop);
      for (const el of body.querySelectorAll('[data-crop]')) {
        const target = CROPS[Number(el.dataset.crop)][1];
        pressed(el, target === null ? c.crop === null : Math.abs(ratio - target) < 0.01);
      }
    }
    for (const [action, key] of [['flip-h', 'h'], ['flip-v', 'v']]) {
      const el = body.querySelector(`[data-action="${action}"]`);
      if (el) pressed(el, c.flip[key]);
    }
    for (const el of body.querySelectorAll('[data-speed]')) pressed(el, Number(el.dataset.speed) === c.speed);
    const hasPrev = Boolean(previousAdjacent(project, c));
    const note = body.querySelector('[data-trans-note]');
    if (note) note.textContent = hasPrev ? '' : 'Necesita un clip justo antes, en la misma pista.';
    for (const el of body.querySelectorAll('[data-transition]')) {
      el.disabled = !hasPrev && el.dataset.transition !== '';
      pressed(el, (c.transition?.type ?? '') === el.dataset.transition);
    }
    const dur = body.querySelector('[data-prop="trdur"]');
    if (dur) dur.disabled = !c.transition;
  }

  function show(id) {
    clipId = id;
    const c = id ? clip() : null;
    empty.hidden = Boolean(c);
    body.hidden = !c;
    body.innerHTML = c ? build(c) : '';
    if (c) sync();
  }

  const selection = () => store.getState().selection[0] ?? null;

  const unsubscribe = store.subscribe((_, meta) => {
    if (meta.type === 'playhead') return;
    const wanted = selection();
    if (wanted !== clipId) { lastPreset = null; show(wanted); } else if (clipId) sync();
  });

  // --- entradas de deslizador: un arrastre completo es un solo paso de historial
  on(root, 'input', (e) => {
    const input = e.target;
    if (!(input instanceof HTMLInputElement) || !clipId) return;
    const value = Number(input.value);
    const key = `ins:${clipId}:${input.id}`;
    if (input.dataset.fx) run({ type: 'effect/set', clipId, effectType: input.dataset.fx, value, coalesce: key });
    else if (input.hasAttribute('data-intensity')) { intensity = value; run({ type: 'effect/preset', clipId, presetId: lastPreset, intensity: value, coalesce: key }); }
    else if (input.dataset.prop === 'speed') run({ type: 'clip/update', clipId, patch: { speed: value }, coalesce: key });
    else if (input.dataset.prop === 'trdur') run({ type: 'clip/update', clipId, patch: { transition: { type: clip().transition.type, duration: value } }, coalesce: key });
    else if (input.dataset.prop) run({ type: 'clip/update', clipId, patch: { transform: { [input.dataset.prop]: value } }, coalesce: key });
    sync();
  });
  on(root, 'change', (e) => { if (e.target instanceof HTMLInputElement) store.endCoalesce(); });

  on(root, 'dblclick', (e) => {
    const reset = e.target.closest('[data-reset]');
    if (!reset || !clipId) return;
    const input = root.querySelector(`#${reset.getAttribute('for')}`);
    if (input.dataset.fx) run({ type: 'effect/set', clipId, effectType: input.dataset.fx, value: EFFECTS[input.dataset.fx].default });
    else if (input.dataset.prop === 'speed') run({ type: 'clip/update', clipId, patch: { speed: 1 } });
    else if (input.dataset.prop === 'trdur') run({ type: 'clip/update', clipId, patch: { transition: { type: clip().transition.type, duration: TRANSITION_RANGE.default } } });
    else if (input.dataset.prop) run({ type: 'clip/update', clipId, patch: { transform: { [input.dataset.prop]: SLIDERS[input.dataset.prop].def } } });
    sync();
  });

  on(root, 'click', (e) => {
    const btn = e.target.closest('button');
    if (!btn || btn.disabled || !clipId) return;
    const c = clip();
    const d = btn.dataset;
    if (d.preset) { lastPreset = d.preset; intensity = 1; run({ type: 'effect/preset', clipId, presetId: d.preset }); }
    else if (d.action === 'clear-fx') { lastPreset = null; run({ type: 'effect/clear', clipId }); }
    else if (d.fit) run({ type: 'clip/update', clipId, patch: { fit: d.fit } });
    else if (d.action === 'rotate-left' || d.action === 'rotate-right') {
      const turn = d.action === 'rotate-left' ? -90 : 90;
      run({ type: 'clip/update', clipId, patch: { transform: { rotation: ((c.transform.rotation + turn + 540) % 360) - 180 } } });
    } else if (d.action === 'flip-h') run({ type: 'clip/update', clipId, patch: { flip: { ...c.flip, h: !c.flip.h } } });
    else if (d.action === 'flip-v') run({ type: 'clip/update', clipId, patch: { flip: { ...c.flip, v: !c.flip.v } } });
    else if (d.crop !== undefined) {
      const asset = store.getProject().assets[c.assetId];
      run({ type: 'clip/update', clipId, patch: { crop: centeredCrop(asset.width, asset.height, CROPS[Number(d.crop)][1]) } });
    } else if (d.action === 'reset-xform') run({ type: 'clip/update', clipId, patch: { transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 } } });
    else if (d.speed) run({ type: 'clip/update', clipId, patch: { speed: Number(d.speed) } });
    else if (d.transition !== undefined) {
      run({ type: 'clip/update', clipId, patch: { transition: d.transition ? { type: d.transition, duration: c.transition?.duration ?? TRANSITION_RANGE.default } : null } });
    }
    sync();
  });

  show(selection());
  return { destroy() { abort.abort(); unsubscribe(); root.replaceChildren(); root.classList.remove('ins'); } };
}
