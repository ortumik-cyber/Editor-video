import { ASPECTS, FPS_OPTIONS } from '../core/project.js';

const SWATCHES = [['#000000', 'negro'], ['#ffffff', 'blanco'], ['#0f172a', 'azul noche'], ['#1f2937', 'gris oscuro'], ['#ff3b30', 'rojo'], ['#ff9500', 'naranja'], ['#ffcc00', 'amarillo'], ['#34c759', 'verde'], ['#007aff', 'azul'], ['#af52de', 'violeta']];
export const ASPECT_LABELS = { '9:16': 'Vertical', '1:1': 'Cuadrado', '16:9': 'Horizontal', '4:5': 'Retrato' };

/** Pestaña «Proyecto»: formato, fondo, fotogramas por segundo y borrar. */
export function createProjectPanel(root, { store, onDelete, onMessage }) {
  const abort = new AbortController();
  root.classList.add('proj');
  root.innerHTML = `
    <section class="proj__sec" aria-labelledby="proj-h-aspect"><h3 id="proj-h-aspect">Formato</h3>
      <div class="proj__chips" role="group" aria-label="Formato del vídeo">${Object.keys(ASPECTS).map((a) => `<button type="button" class="proj__chip" data-aspect="${a}" aria-pressed="false"><span class="proj__shape" style="--w:${ASPECTS[a].width};--h:${ASPECTS[a].height}"></span><span>${a}</span><small>${ASPECT_LABELS[a]}</small></button>`).join('')}</div></section>
    <section class="proj__sec" aria-labelledby="proj-h-bg"><h3 id="proj-h-bg">Color de fondo</h3>
      <div class="proj__colors" role="group" aria-label="Color de fondo">${SWATCHES.map(([hex, name]) => `<button type="button" class="proj__swatch" data-bg="${hex}" aria-label="Fondo ${name}" aria-pressed="false" style="--sw:${hex}"></button>`).join('')}<input type="color" class="proj__color" aria-label="Fondo: color personalizado" value="#000000"></div></section>
    <section class="proj__sec" aria-labelledby="proj-h-fps"><h3 id="proj-h-fps">Fotogramas por segundo</h3>
      <select class="proj__select" aria-label="Fotogramas por segundo del proyecto">${FPS_OPTIONS.map((f) => `<option value="${f}">${f} fps</option>`).join('')}</select></section>
    <section class="proj__sec"><button type="button" class="proj__danger" data-act="delete">Eliminar proyecto</button></section>`;
  const select = root.querySelector('select');
  const color = root.querySelector('.proj__color');

  function sync() {
    const { settings } = store.getProject();
    for (const el of root.querySelectorAll('[data-aspect]')) el.setAttribute('aria-pressed', String(el.dataset.aspect === settings.aspect));
    for (const el of root.querySelectorAll('[data-bg]')) el.setAttribute('aria-pressed', String(el.dataset.bg === settings.background.toLowerCase()));
    color.value = settings.background;
    select.value = String(settings.fps);
  }
  const run = (command) => { const r = store.dispatch(command); if (!r.ok) onMessage?.(r.error.message); sync(); };

  root.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.aspect) run({ type: 'project/settings', aspect: b.dataset.aspect });
    else if (b.dataset.bg) run({ type: 'project/settings', background: b.dataset.bg });
    else if (b.dataset.act === 'delete') onDelete?.();
  }, { signal: abort.signal });
  color.addEventListener('input', () => run({ type: 'project/settings', background: color.value, coalesce: 'bg' }), { signal: abort.signal });
  color.addEventListener('change', () => store.endCoalesce(), { signal: abort.signal });
  select.addEventListener('change', () => run({ type: 'project/settings', fps: Number(select.value) }), { signal: abort.signal });

  const unsubscribe = store.subscribe((_, meta) => { if (meta.type !== 'playhead' && meta.type !== 'select') sync(); });
  sync();
  return { destroy() { abort.abort(); unsubscribe(); root.replaceChildren(); root.classList.remove('proj'); } };
}
