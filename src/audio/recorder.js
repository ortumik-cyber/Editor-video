import { addAudioClip } from '../timeline/actions.js';

const MIME_CANDIDATES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
const MIN_SECONDS = 0.1;

const ERRORS = {
  NotAllowedError: 'Permiso del micrófono denegado. Actívalo en los ajustes del navegador.',
  SecurityError: 'El navegador no permite usar el micrófono en esta página.',
  NotFoundError: 'No se encontró ningún micrófono.',
  NotReadableError: 'El micrófono está en uso por otra aplicación.',
};

export const extensionFor = (mime) => (mime.includes('mp4') ? 'm4a' : mime.includes('ogg') ? 'ogg' : 'webm');

/**
 * Locución con micrófono. Graba mientras el reproductor avanza desde el cursor, para poder
 * sincronizar con lo que se ve, y al parar importa la grabación y la coloca donde empezó.
 * Con altavoces la grabación recoge también el sonido del proyecto: lo mejor es usar auriculares.
 */
export function createVoiceRecorder({ store, library, player, mediaDevices = globalThis.navigator?.mediaDevices, MediaRecorderCtor = globalThis.MediaRecorder, AudioContextCtor = globalThis.AudioContext ?? globalThis.webkitAudioContext }) {
  const listeners = new Set();
  let state = 'idle';
  let session = null;
  let counter = 0;

  const emit = () => listeners.forEach((fn) => fn({ state }));
  const set = (next) => { state = next; emit(); };
  const fail = (message, code) => Object.assign(new Error(message), { code });

  function teardown() {
    if (!session) return;
    session.stream.getTracks().forEach((t) => t.stop());
    session.ctx?.close().catch(() => {});
    session = null;
  }

  async function start({ withPlayback = true } = {}) {
    if (state !== 'idle') throw fail('Ya se está grabando', 'busy');
    if (!mediaDevices?.getUserMedia || !MediaRecorderCtor) throw fail('Este navegador no puede grabar audio.', 'unsupported');
    let stream;
    try {
      stream = await mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch (error) {
      throw fail(ERRORS[error?.name] ?? 'No se pudo abrir el micrófono.', error?.name ?? 'unknown');
    }
    const mime = MIME_CANDIDATES.find((m) => MediaRecorderCtor.isTypeSupported?.(m)) ?? '';
    const recorder = new MediaRecorderCtor(stream, mime ? { mimeType: mime } : undefined);
    const chunks = [];
    recorder.addEventListener('dataavailable', (e) => { if (e.data?.size) chunks.push(e.data); });
    let analyser = null;
    let samples = null;
    let ctx = null;
    if (AudioContextCtor) {
      ctx = new AudioContextCtor();
      analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      samples = new Float32Array(analyser.fftSize);
      ctx.createMediaStreamSource(stream).connect(analyser); // sin conectar a la salida: no hay eco
    }
    session = { stream, recorder, chunks, ctx, analyser, samples, mime: recorder.mimeType || mime || 'audio/webm', startedAt: performance.now(), at: store.getState().playhead, withPlayback };
    recorder.start(250);
    set('recording');
    if (withPlayback) player?.play();
  }

  /** Para, importa la grabación y la coloca en una pista de audio libre, donde empezó. */
  async function stop() {
    if (state !== 'recording') throw fail('No se está grabando', 'idle');
    const s = session;
    set('processing');
    if (s.withPlayback) player?.pause();
    const seconds = (performance.now() - s.startedAt) / 1000;
    const stopped = new Promise((resolve) => s.recorder.addEventListener('stop', resolve, { once: true }));
    s.recorder.stop();
    await stopped;
    teardown();
    try {
      if (seconds < MIN_SECONDS || !s.chunks.length) throw fail('La grabación es demasiado corta.', 'too_short');
      const blob = new Blob(s.chunks, { type: s.mime });
      const file = new File([blob], `locucion-${++counter}.${extensionFor(s.mime)}`, { type: s.mime.split(';')[0] });
      const { added, rejected } = await library.importFiles([file]);
      if (!added.length) throw fail(rejected[0]?.message ?? 'No se pudo importar la grabación.', 'import');
      const placed = addAudioClip(store, added[0].id, { at: s.at });
      if (!placed.ok) throw fail(placed.error.message, placed.error.code);
      return placed;
    } finally {
      set('idle');
    }
  }

  /** Descarta la grabación en curso. */
  async function cancel() {
    if (state !== 'recording') return;
    const s = session;
    if (s.withPlayback) player?.pause();
    const stopped = new Promise((resolve) => s.recorder.addEventListener('stop', resolve, { once: true }));
    s.recorder.stop();
    await stopped;
    teardown();
    set('idle');
  }

  return {
    start,
    stop,
    cancel,
    getState: () => state,
    elapsed: () => (state === 'recording' ? (performance.now() - session.startedAt) / 1000 : 0),
    /** Nivel RMS (0-1) del micrófono. */
    micLevel() {
      if (!session?.analyser) return 0;
      session.analyser.getFloatTimeDomainData(session.samples);
      let sum = 0;
      for (const v of session.samples) sum += v * v;
      return Math.sqrt(sum / session.samples.length);
    },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    destroy() { cancel(); },
  };
}
