import { projectDuration } from '../core/selectors.js';
import { formatClock } from '../library/kinds.js';
import { ExportError, describeSupport, exportProject } from './exporter.js';
import { FPS_OPTIONS, QUALITIES, RESOLUTIONS, estimateBytes, exportProblem, exportSize, formatBytes, suggestBitrate } from './settings.js';
import { canShareFile, saveBlob, shareFile, toFile } from './save.js';

const STORAGE_KEY = 'editor-video:export';
const PHASE_TEXT = { audio: 'Mezclando y codificando el audio…', finalizing: 'Preparando el archivo…' };

function loadPrefs() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) ?? {}; } catch { return {}; }
}
function savePrefs(prefs) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs)); } catch { /* sin almacenamiento: no pasa nada */ }
}

/**
 * Panel de exportación: ajustes, estimación, progreso con cancelar y resultado (vista previa, descargar, compartir).
 * El proyecto se congela al empezar: se puede seguir editando mientras exporta sin afectar al archivo.
 */
export function createExportPanel(root, { store, library, player, onMessage, doc = root.ownerDocument }) {
  const abort = new AbortController();
  const on = (target, type, fn) => target.addEventListener(type, fn, { signal: abort.signal });
  const prefs = loadPrefs();
  const projectFps = store.getProject().settings.fps;
  const state = {
    short: RESOLUTIONS.some((r) => r.short === prefs.short) ? prefs.short : 720,
    fps: FPS_OPTIONS.includes(prefs.fps) ? prefs.fps : (FPS_OPTIONS.includes(projectFps) ? projectFps : 30),
    quality: QUALITIES.some((q) => q.id === prefs.quality) ? prefs.quality : 'normal',
  };
  let running = null;
  let resultUrl = null;
  let supportToken = 0;

  root.classList.add('exp');
  root.innerHTML = `
    <h3 class="exp__title">Exportar vídeo</h3>
    <div class="exp__fields">
      <label class="exp__field"><span>Resolución</span><select data-field="short"></select></label>
      <label class="exp__field"><span>Fotogramas por segundo</span><select data-field="fps">${FPS_OPTIONS.map((f) => `<option value="${f}">${f} fps</option>`).join('')}</select></label>
      <label class="exp__field"><span>Calidad</span><select data-field="quality">${QUALITIES.map((q) => `<option value="${q.id}">${q.label}</option>`).join('')}</select></label>
    </div>
    <p class="exp__summary" data-summary></p>
    <p class="exp__format" data-format></p>
    <div class="exp__actions"><button type="button" class="exp__btn exp__btn--primary" data-act="start">Exportar</button></div>
    <div class="exp__progress" data-progress hidden>
      <progress max="1" value="0" aria-label="Progreso de la exportación"></progress>
      <p data-progress-text></p>
      <button type="button" class="exp__btn" data-act="cancel">Cancelar</button>
    </div>
    <div class="exp__result" data-result tabindex="-1" hidden></div>
    <p class="exp__error" data-error role="alert" hidden></p>
    <div class="exp__sr" role="status" aria-live="polite" data-sr></div>`;
  const $ = (sel) => root.querySelector(sel);
  const fields = { short: $('[data-field="short"]'), fps: $('[data-field="fps"]'), quality: $('[data-field="quality"]') };
  const summary = $('[data-summary]');
  const formatLine = $('[data-format]');
  const startBtn = $('[data-act="start"]');
  const progressBox = $('[data-progress]');
  const progressBar = progressBox.querySelector('progress');
  const progressText = $('[data-progress-text]');
  const resultBox = $('[data-result]');
  const errorBox = $('[data-error]');
  const sr = $('[data-sr]');
  const announce = (text) => { sr.textContent = ''; sr.textContent = text; };

  const settings = () => ({ short: state.short, fps: state.fps, quality: state.quality });

  function fillResolutions() {
    const { width, height } = store.getProject().settings;
    fields.short.innerHTML = RESOLUTIONS.map((r) => {
      const size = exportSize(width, height, r.short);
      return `<option value="${r.short}">${r.label} · ${size.width}×${size.height}</option>`;
    }).join('');
  }

  async function refresh() {
    const project = store.getProject();
    const seconds = projectDuration(project);
    const problem = exportProblem(project, seconds, settings());
    const size = exportSize(project.settings.width, project.settings.height, state.short);
    const bitrate = suggestBitrate(size.width, size.height, state.fps, state.quality);
    fillResolutions();
    for (const [key, el] of Object.entries(fields)) el.value = String(state[key]);
    summary.textContent = problem ?? `Duración ${formatClock(seconds)} · ${size.width}×${size.height} · unos ${formatBytes(estimateBytes(bitrate, seconds))}`;
    startBtn.disabled = Boolean(problem) || Boolean(running);
    if (problem) { formatLine.textContent = ''; return; }
    const token = ++supportToken;
    const support = await describeSupport(project, settings());
    if (token !== supportToken) return;
    if (!support) { formatLine.textContent = 'Este navegador no puede exportar vídeo.'; startBtn.disabled = true; return; }
    formatLine.textContent = `Formato: ${support.format.label}`;
  }

  function showError(message) {
    errorBox.hidden = false;
    errorBox.textContent = message;
    onMessage?.(message);
  }

  function clearResult() {
    if (resultUrl) { URL.revokeObjectURL(resultUrl); resultUrl = null; }
    resultBox.hidden = true;
    resultBox.replaceChildren();
    errorBox.hidden = true;
  }

  function setRunning(value) {
    running = value;
    progressBox.hidden = !value;
    for (const el of Object.values(fields)) el.disabled = Boolean(value);
    startBtn.disabled = Boolean(value);
    root.classList.toggle('is-exporting', Boolean(value));
  }

  function showResult(result) {
    resultUrl = URL.createObjectURL(result.blob);
    const file = toFile(result.blob, result.filename);
    resultBox.innerHTML = `
      <h4>Listo</h4>
      <p>${result.filename} · ${formatBytes(result.bytes)} · ${result.width}×${result.height} · ${result.seconds.toFixed(1)} s en exportar</p>
      ${result.warnings.map((w) => `<p class="exp__warn">${w}</p>`).join('')}
      <video class="exp__video" controls playsinline src="${resultUrl}" aria-label="Vista previa del vídeo exportado"></video>
      <div class="exp__actions"><button type="button" class="exp__btn exp__btn--primary" data-act="download">Descargar</button>
      ${canShareFile(file) ? '<button type="button" class="exp__btn" data-act="share">Compartir</button>' : ''}</div>`;
    resultBox.hidden = false;
    resultBox.querySelector('[data-act="download"]').addEventListener('click', () => saveBlob(result.blob, result.filename, doc));
    resultBox.querySelector('[data-act="share"]')?.addEventListener('click', async () => {
      try { await shareFile(file, result.filename); } catch (error) { if (error.name !== 'AbortError') showError('No se pudo compartir el archivo.'); }
    });
    resultBox.focus();
    announce(`Exportación terminada: ${result.filename}, ${formatBytes(result.bytes)}`);
  }

  async function start() {
    if (running) return;
    clearResult();
    player?.pause();
    const controller = new AbortController();
    setRunning({ controller });
    progressBar.value = 0;
    progressText.textContent = 'Preparando…';
    let lastBucket = -1;
    try {
      const result = await exportProject({
        project: store.getProject(), library, settings: settings(), signal: controller.signal, doc,
        onProgress: ({ phase, done, total }) => {
          progressBar.value = total ? done / total : 0;
          progressBar.max = 1;
          progressText.textContent = phase === 'video' ? `Fotograma ${done} de ${total}` : PHASE_TEXT[phase] ?? '';
          const bucket = phase === 'video' ? Math.floor((done / total) * 4) : phase;
          if (bucket !== lastBucket) { lastBucket = bucket; announce(phase === 'video' ? `Exportando, ${Math.round((done / total) * 100)} %` : PHASE_TEXT[phase]); }
        },
      });
      setRunning(null);
      showResult(result);
    } catch (error) {
      setRunning(null);
      if (error.name === 'AbortError') { announce('Exportación cancelada'); onMessage?.('Exportación cancelada'); }
      else showError(error instanceof ExportError ? error.message : `No se pudo exportar: ${error.message}`);
    } finally {
      refresh();
    }
  }

  on(root, 'change', (e) => {
    const key = e.target.dataset?.field;
    if (!key) return;
    state[key] = key === 'quality' ? e.target.value : Number(e.target.value);
    savePrefs(state);
    refresh();
  });
  on(root, 'click', (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'start') start();
    else if (act === 'cancel') running?.controller.abort();
  });
  const unsubscribe = store.subscribe((_, meta) => { if (meta.type !== 'playhead' && meta.type !== 'select') refresh(); });
  refresh();

  return {
    refresh,
    destroy() { abort.abort(); unsubscribe(); running?.controller.abort(); clearResult(); root.replaceChildren(); root.classList.remove('exp'); },
  };
}
