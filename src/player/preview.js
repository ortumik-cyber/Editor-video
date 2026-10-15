import { projectDuration } from '../core/selectors.js';
import { formatClock } from '../library/kinds.js';
import { icon } from '../ui/icons.js';
import { levelToPercent, smoothLevel } from '../audio/level.js';
import { createVoiceRecorder } from '../audio/recorder.js';
import { createManipulator } from './manipulator.js';
import { createPlayer } from './player.js';

/** Vista previa: lienzo con la proporción del proyecto y los controles de reproducción. */
export function createPreview(root, { store, library, doc = root.ownerDocument, onEditText, onMessage }) {
  const abort = new AbortController();
  root.classList.add('pv');
  root.innerHTML = `
    <div class="pv__stage"><div class="pv__wrap"><canvas class="pv__canvas" role="img" aria-label="Vista previa del vídeo"></canvas></div></div>
    <div class="pv__bar">
      <button type="button" class="pv__btn" data-pv="start" aria-label="Ir al inicio" title="Ir al inicio (Inicio)">${icon('start')}</button>
      <button type="button" class="pv__btn pv__btn--play" data-pv="play" aria-label="Reproducir" title="Reproducir (Espacio)">${icon('play')}</button>
      <span class="pv__time" role="timer" aria-label="Posición"></span>
      <span class="pv__rec" hidden></span>
      <div class="pv__meter" aria-hidden="true"><i></i></div>
      <button type="button" class="pv__btn pv__btn--rec" data-pv="record" aria-pressed="false" aria-label="Grabar locución" title="Grabar locución con el micrófono (usa auriculares)">${icon('mic')}</button>
    </div>`;
  const canvas = root.querySelector('canvas');
  const playButton = root.querySelector('[data-pv="play"]');
  const time = root.querySelector('.pv__time');
  const player = createPlayer({ store, library, canvas, doc });
  const recorder = createVoiceRecorder({ store, library, player });
  const recordButton = root.querySelector('[data-pv="record"]');
  const recLabel = root.querySelector('.pv__rec');
  const meter = root.querySelector('.pv__meter i');
  const manipulator = createManipulator(root.querySelector('.pv__wrap'), { store, canvas, doc, onEditText, onMessage });

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

  // Medidor de nivel: del mezclador al reproducir y del micrófono al grabar.
  let shown = 0;
  let frame = 0;
  function tick() {
    const recording = recorder.getState() === 'recording';
    shown = smoothLevel(shown, levelToPercent(recording ? recorder.micLevel() : player.getLevel()));
    meter.style.width = `${shown.toFixed(1)}%`;
    if (recording) recLabel.textContent = `Grabando ${formatClock(recorder.elapsed())}`;
    frame = requestAnimationFrame(tick);
  }
  const syncMeter = () => {
    const active = player.isPlaying() || recorder.getState() === 'recording';
    if (active && !frame) frame = requestAnimationFrame(tick);
    if (!active && frame) { cancelAnimationFrame(frame); frame = 0; shown = 0; meter.style.width = '0%'; }
  };
  const unsubscribeRecorder = recorder.subscribe(({ state }) => {
    const recording = state === 'recording';
    recordButton.setAttribute('aria-pressed', String(recording));
    recordButton.setAttribute('aria-label', recording ? 'Detener la grabación' : 'Grabar locución');
    recordButton.disabled = state === 'processing';
    recLabel.hidden = !recording;
    root.classList.toggle('is-recording', recording);
    syncMeter();
  });
  player.subscribe(syncMeter);

  async function toggleRecording() {
    try {
      if (recorder.getState() === 'recording') {
        const result = await recorder.stop();
        onMessage?.(result.ok ? 'Locución añadida a la línea de tiempo' : 'No se pudo añadir la locución');
      } else {
        await recorder.start();
      }
    } catch (error) {
      onMessage?.(error.message);
    }
  }

  root.addEventListener('click', (e) => {
    const button = e.target.closest('[data-pv]');
    if (!button) return;
    if (button.dataset.pv === 'play') player.toggle();
    else if (button.dataset.pv === 'record') toggleRecording();
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
    manipulator,
    recorder,
    destroy() { cancelAnimationFrame(frame); unsubscribeRecorder(); recorder.destroy(); manipulator.destroy(); abort.abort(); unsubscribeStore(); unsubscribePlayer(); player.destroy(); root.replaceChildren(); root.classList.remove('pv'); },
  };
}
