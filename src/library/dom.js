import { heicToJpeg, isHeic } from './heic.js';
import { bucketsFor, computePeaks, stripTimes, thumbnailTime } from './waveform.js';

const READY_TIMEOUT = 20000;

/** Espera un evento del elemento. Rechaza si dispara `error` o pasa el tiempo. */
function waitFor(el, event, ms = READY_TIMEOUT) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error(`Tiempo agotado esperando ${event}`)), ms);
    const onOk = () => finish();
    const onError = () => finish(new Error(el.error?.message || 'No se pudo leer el medio'));
    function finish(error) {
      clearTimeout(timer);
      el.removeEventListener(event, onOk);
      el.removeEventListener('error', onError);
      if (error) reject(error); else resolve();
    }
    el.addEventListener(event, onOk);
    el.addEventListener('error', onError);
  });
}

/** Mueve el cursor del elemento y espera a que haya un fotograma. */
export async function seekTo(el, time) {
  if (Math.abs(el.currentTime - time) < 0.001 && el.readyState >= 2) return;
  const done = waitFor(el, 'seeked');
  el.currentTime = time;
  await done;
}

/** Los WebM de MediaRecorder declaran duración Infinity. Un salto enorme obliga al navegador a calcularla. */
async function resolveDuration(el) {
  if (Number.isFinite(el.duration)) return el.duration;
  const done = waitFor(el, 'timeupdate');
  el.currentTime = 1e101;
  await done;
  const duration = el.duration;
  if (!Number.isFinite(duration)) throw new Error('Duración desconocida');
  await seekTo(el, 0);
  return duration;
}

async function openElement(doc, tag, file, urlApi) {
  const el = doc.createElement(tag);
  const url = urlApi.createObjectURL(file);
  el.preload = 'metadata';
  el.muted = true;
  if (tag === 'video') el.playsInline = true;
  const ready = waitFor(el, 'loadedmetadata');
  el.src = url;
  try {
    await ready;
  } catch (error) {
    urlApi.revokeObjectURL(url);
    throw error;
  }
  return { el, close() { el.removeAttribute('src'); el.load(); urlApi.revokeObjectURL(url); } };
}

function makeCanvas(doc, width, height) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
  const canvas = doc.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function canvasToBlob(canvas, type, quality) {
  if (canvas.convertToBlob) return canvas.convertToBlob({ type, quality });
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Sin miniatura'))), type, quality));
}

async function drawThumb(doc, source, width, height, maxSide) {
  const scale = Math.min(1, maxSide / Math.max(width, height));
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  const canvas = makeCanvas(doc, w, h);
  canvas.getContext('2d').drawImage(source, 0, 0, w, h);
  return canvasToBlob(canvas, 'image/webp', 0.72);
}

/** Tira horizontal con fotogramas repartidos por todo el vídeo. La altura es fija: pesa poco y se estira al ancho del clip. */
async function drawStrip(doc, el, duration, width, height, frameH = 72) {
  const times = stripTimes(duration);
  const frameW = Math.max(1, Math.round((width / height) * frameH));
  const canvas = makeCanvas(doc, frameW * times.length, frameH);
  const ctx = canvas.getContext('2d');
  for (const [i, t] of times.entries()) {
    await seekTo(el, t);
    ctx.drawImage(el, i * frameW, 0, frameW, frameH);
  }
  return canvasToBlob(canvas, 'image/webp', 0.6);
}

/** Decodifica a 8 kHz para no gastar memoria. Falla si el archivo no tiene pista de audio legible. */
async function decodePeaks(file, duration) {
  const Offline = globalThis.OfflineAudioContext ?? globalThis.webkitOfflineAudioContext;
  if (!Offline) throw new Error('Sin Web Audio');
  const ctx = new Offline(1, 1, 8000);
  const buffer = await ctx.decodeAudioData(await file.arrayBuffer());
  if (!buffer.numberOfChannels) throw new Error('Sin audio');
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
  return computePeaks(channels, bucketsFor(duration));
}

/**
 * Adaptadores de navegador para la biblioteca.
 * `hasAudio` en vídeos grandes: no se decodifica (memoria), se asume que tiene sonido.
 */
export function createDomAdapters({
  document: doc = globalThis.document,
  urlApi = globalThis.URL,
  thumbSize = 320,
  maxDecodeBytes = 150 * 1024 * 1024,
  maxDecodeSeconds = 15 * 60,
} = {}) {
  const canDecode = (file, duration) => file.size <= maxDecodeBytes && duration <= maxDecodeSeconds;

  async function inspectImage(file) {
    const bitmap = await createImageBitmap(file);
    try {
      const info = { duration: 0, width: bitmap.width, height: bitmap.height };
      return { info, thumb: await drawThumb(doc, bitmap, bitmap.width, bitmap.height, thumbSize), peaks: null, hasAudio: false };
    } finally {
      bitmap.close();
    }
  }

  async function inspectVideo(file) {
    const handle = await openElement(doc, 'video', file, urlApi);
    try {
      const { el } = handle;
      const duration = await resolveDuration(el);
      const info = { duration, width: el.videoWidth, height: el.videoHeight };
      let thumb = null;
      try {
        await seekTo(el, thumbnailTime(duration));
        thumb = await drawThumb(doc, el, info.width, info.height, thumbSize);
      } catch { /* sin miniatura: la importación sigue */ }
      let strip = null;
      try { strip = await drawStrip(doc, el, duration, info.width, info.height); } catch { /* sin tira: se usa la miniatura */ }
      let peaks = null;
      let hasAudio = true;
      if (canDecode(file, duration)) {
        try { peaks = await decodePeaks(file, duration); } catch { hasAudio = false; }
      }
      return { info, thumb, strip, peaks, hasAudio };
    } finally {
      handle.close();
    }
  }

  async function inspectAudio(file) {
    const handle = await openElement(doc, 'audio', file, urlApi);
    try {
      const duration = await resolveDuration(handle.el);
      let peaks = null;
      if (canDecode(file, duration)) {
        try { peaks = await decodePeaks(file, duration); } catch { /* sin onda */ }
      }
      return { info: { duration, width: 0, height: 0 }, thumb: null, peaks, hasAudio: true };
    } finally {
      handle.close();
    }
  }

  /** Convierte a JPEG las fotos HEIC que este navegador no sabe abrir. El resto pasa tal cual. */
  async function prepare(file) {
    if (!(await isHeic(file))) return file;
    try {
      (await createImageBitmap(file)).close();
      return file;
    } catch { /* el navegador no la abre: se convierte */ }
    return heicToJpeg(file, { doc });
  }

  return {
    prepare,
    inspect(file, kind) {
      if (kind === 'image') return inspectImage(file);
      if (kind === 'video') return inspectVideo(file);
      return inspectAudio(file);
    },
  };
}
