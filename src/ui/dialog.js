import { icon } from './icons.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/**
 * Diálogo modal nativo (<dialog>): el navegador atrapa el foco, Esc cierra y el foco vuelve al botón que lo abrió.
 * `build` rellena el cuerpo y recibe `finish(valor)`; cerrar sin elegir devuelve null.
 */
function openDialog({ title, build, doc = document }) {
  return new Promise((resolve) => {
    const opener = doc.activeElement;
    const dialog = doc.createElement('dialog');
    dialog.className = 'dlg';
    dialog.setAttribute('aria-labelledby', 'dlg-title');
    dialog.innerHTML = `<form method="dialog" class="dlg__form"><h2 id="dlg-title" class="dlg__title">${esc(title)}</h2><div class="dlg__body"></div></form>`;
    const body = dialog.querySelector('.dlg__body');
    let result = null;
    const finish = (value) => { result = value; dialog.close(); };
    build(body, finish, dialog);
    dialog.addEventListener('close', () => { dialog.remove(); opener?.focus?.(); resolve(result); });
    dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });
    doc.body.append(dialog);
    dialog.showModal();
  });
}

const actions = (buttons) => `<div class="dlg__actions">${buttons}</div>`;

/** Pide un texto. Devuelve la cadena o null si se cancela. */
export function askText({ title, label, value = '', confirm = 'Aceptar', maxLength = 80, doc }) {
  return openDialog({ title, doc, build(body, finish) {
    body.innerHTML = `<label class="dlg__label" for="dlg-input">${esc(label)}</label><input id="dlg-input" class="dlg__input" type="text" maxlength="${maxLength}" value="${esc(value)}" autocomplete="off">
      ${actions(`<button type="button" class="dlg__btn" data-r="cancel">Cancelar</button><button type="submit" class="dlg__btn dlg__btn--primary" data-r="ok">${esc(confirm)}</button>`)}`;
    const input = body.querySelector('input');
    queueMicrotask(() => { input.focus(); input.select(); });
    body.querySelector('[data-r="cancel"]').addEventListener('click', () => finish(null));
    body.closest('form').addEventListener('submit', (e) => { e.preventDefault(); finish(input.value); });
  } });
}

/** Pide confirmación. Devuelve true o false. */
export function askConfirm({ title, message, confirm = 'Aceptar', danger = false, doc }) {
  return openDialog({ title, doc, build(body, finish) {
    body.innerHTML = `<p class="dlg__text">${esc(message)}</p>${actions(`<button type="button" class="dlg__btn" data-r="cancel" autofocus>Cancelar</button><button type="button" class="dlg__btn ${danger ? 'dlg__btn--danger' : 'dlg__btn--primary'}" data-r="ok">${esc(confirm)}</button>`)}`;
    body.querySelector('[data-r="cancel"]').addEventListener('click', () => finish(false));
    body.querySelector('[data-r="ok"]').addEventListener('click', () => finish(true));
  } }).then((v) => v === true);
}

/** Elige entre varias opciones. Devuelve el id o null. */
export function askChoice({ title, options, doc }) {
  return openDialog({ title, doc, build(body, finish) {
    body.innerHTML = `<div class="dlg__choices">${options.map((o) => `<button type="button" class="dlg__choice${o.danger ? ' dlg__choice--danger' : ''}" data-id="${esc(o.id)}">${o.icon ? icon(o.icon) : ''}<span>${esc(o.label)}</span></button>`).join('')}</div>
      ${actions('<button type="button" class="dlg__btn" data-r="cancel">Cancelar</button>')}`;
    body.querySelectorAll('[data-id]').forEach((b) => b.addEventListener('click', () => finish(b.dataset.id)));
    body.querySelector('[data-r="cancel"]').addEventListener('click', () => finish(null));
  } });
}

/** Nuevo proyecto: nombre y proporción. Devuelve { name, aspect } o null. */
export function askNewProject({ aspects, defaultName = 'Mi proyecto', doc }) {
  return openDialog({ title: 'Nuevo proyecto', doc, build(body, finish) {
    body.innerHTML = `<label class="dlg__label" for="dlg-name">Nombre</label><input id="dlg-name" class="dlg__input" type="text" maxlength="80" value="${esc(defaultName)}" autocomplete="off">
      <fieldset class="dlg__fieldset"><legend>Formato</legend><div class="dlg__aspects">${aspects.map((a, i) => `<label class="dlg__aspect"><input type="radio" name="aspect" value="${esc(a.id)}"${i === 0 ? ' checked' : ''}><span class="dlg__aspect-box" style="--w:${a.w};--h:${a.h}"></span><span>${esc(a.label)}</span></label>`).join('')}</div></fieldset>
      ${actions('<button type="button" class="dlg__btn" data-r="cancel">Cancelar</button><button type="submit" class="dlg__btn dlg__btn--primary">Crear</button>')}`;
    const input = body.querySelector('#dlg-name');
    queueMicrotask(() => { input.focus(); input.select(); });
    body.querySelector('[data-r="cancel"]').addEventListener('click', () => finish(null));
    body.closest('form').addEventListener('submit', (e) => { e.preventDefault(); finish({ name: input.value, aspect: body.querySelector('input[name="aspect"]:checked').value }); });
  } });
}

/** Mensaje breve no modal, anunciado a lectores de pantalla. */
export function createToaster(doc = document) {
  const region = doc.createElement('div');
  region.className = 'toasts';
  region.setAttribute('role', 'status');
  region.setAttribute('aria-live', 'polite');
  doc.body.append(region);
  return {
    show(message, { ms = 4500 } = {}) {
      const el = doc.createElement('div');
      el.className = 'toast';
      el.textContent = message;
      region.append(el);
      setTimeout(() => el.remove(), ms);
    },
    destroy() { region.remove(); },
  };
}
