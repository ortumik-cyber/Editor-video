import { projectDuration } from '../core/selectors.js';
import { formatClock } from '../library/kinds.js';
import { icon } from '../ui/icons.js';
import { createPlayer } from './player.js';

/** Vista previa: lienzo con la proporción del proyecto y los controles de reproducción. */
export function createPreview(root, { store, library, doc = root.ownerDocument }) {
  const abort = new AbortController();
  root.classList.add('pv');
  root.innerHTML = `
    <div class="pv__stage"><canvas class="pv__canvas" role="img" aria-label="Vista previa del vídeo"></canvas></div>
    <div class="pv__bar">
      <button type="button" class="pv__btn" data-pv="start" aria-label="Ir al inicio" title="Ir al inicio (Inicio)">${icon('start')}</button>
      <button type="button" class="pv__btn pv__btn--play" data-pv="play" aria-label="Reproducir" title="Reproducir (Espacio)">${icon('play')}</button>
      <span class="pv__time" role="timer" aria-label="Posición"></span>
    </div>`;
  const canvas = root.querySelector('canvas');
  const playButton = root.querySelector('[data-pv="play"]');
  const time = root.querySelector('.pv__time');
  const player = createPlayer({ store, library, canvas, doc });

  function update() {
    const { settings } = store.getProject();
    root.style.setProperty('--pv-aspect', `${settings.width} / ${settings.height}`);
    root.style.setProperty('--pv-ratio', String(settings.width / settings.height));
    time.textContent = `${formatClock(store.getState().playhead)} / ${formatClock(projectDuration(store.getProject()))}`;
  }

  const unsubscribeStore = store.subscribe((_, meta) => { if (meta.type !== 'select') update(); });
  const unsubscribePlayer = player.subscribe(({ playing }) => {
    playButton.innerHTML = icon(playing ? 'pause' : 'play');
    playButton.setAttribute('aria-label', playing ? 'Pausar' : 'Reproducir');
    playButton.title = playing ? 'Pausar (Espacio)' : 'Reproducir (Espacio)';
  });

  root.addEventListener('click', (e) => {
    const button = e.target.closest('[data-pv]');
    if (!button) return;
    if (button.dataset.pv === 'play') player.toggle();
    else store.setPlayhead(0);
  }, { signal: abort.signal });

  doc.addEventListener('keydown', (e) => {
    if (e.code !== 'Space' || e.target.closest('button, input, textarea, select, a, [contenteditable="true"]')) return;
    e.preventDefault();
    player.toggle();
  }, { signal: abort.signal });

  update();
  return {
    player,
    destroy() { abort.abort(); unsubscribeStore(); unsubscribePlayer(); player.destroy(); root.replaceChildren(); root.classList.remove('pv'); },
  };
}
