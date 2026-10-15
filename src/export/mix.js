import { projectDuration } from '../core/selectors.js';
import { timeStretch } from '../audio/stretch.js';
import { mediaPlan } from '../player/plan.js';
import { AUDIO_SAMPLE_RATE } from './settings.js';

/** Paso con el que se muestrean las ganancias (5 ms: los fundidos y las mezclas son suaves a esa escala). */
export const GAIN_STEP = 0.005;
const SILENT = 1e-4;
/** Tope de tamaño de un archivo cuyo audio se decodifica entero en memoria. */
export const MAX_DECODE_BYTES = 400 * 1024 * 1024;

/**
 * Qué clips suenan, cuándo y con qué ganancia. La ganancia sale de `mediaPlan`, la misma función que usa la
 * vista previa (volumen, fundidos, silencio de pista y mezcla de transición): así lo exportado suena como lo que se oyó.
 * Cada entrada es un tramo continuo: `offset` es el punto del audio ya estirado por la velocidad donde empieza.
 */
export function buildAudioSchedule(project, { step = GAIN_STEP } = {}) {
  const duration = projectDuration(project);
  const runs = new Map();
  const ticks = Math.ceil(duration / step);
  for (let i = 0; i <= ticks; i++) {
    const t = Math.round(i * step * 1e6) / 1e6;
    for (const item of mediaPlan(project, t)) {
      if (!item.hasAudio) continue;
      let run = runs.get(item.clip.id);
      if (!run) { run = { clip: item.clip, t0: t, srcTime0: item.srcTime, gains: [] }; runs.set(item.clip.id, run); }
      run.gains.push(item.gain);
    }
  }
  return [...runs.values()]
    .filter((r) => Math.max(...r.gains) > SILENT)
    .map((r) => ({
      clipId: r.clip.id,
      assetId: r.clip.assetId,
      speed: r.clip.speed,
      t0: r.t0,
      t1: Math.min(duration, r.t0 + r.gains.length * step),
      srcTime0: r.srcTime0,
      offset: r.srcTime0 / r.clip.speed,
      gains: Float32Array.from(r.gains),
      step,
    }));
}

/**
 * Mezcla fuera de línea. `decode(assetId)` devuelve los canales del audio ya a `sampleRate`.
 * Los clips con velocidad distinta de 1 se estiran sin cambiar el tono (una vez por medio y velocidad).
 */
export async function renderMix(schedule, { decode, duration, sampleRate = AUDIO_SAMPLE_RATE, channels = 2, OfflineContext = globalThis.OfflineAudioContext, signal }) {
  const ctx = new OfflineContext(channels, Math.max(1, Math.ceil(duration * sampleRate)), sampleRate);
  const stretched = new Map();
  for (const entry of schedule) {
    if (signal?.aborted) throw new DOMException('Exportación cancelada', 'AbortError');
    const key = `${entry.assetId}@${entry.speed}`;
    if (!stretched.has(key)) {
      const data = await decode(entry.assetId);
      stretched.set(key, entry.speed === 1 ? data : timeStretch(data, sampleRate, entry.speed));
    }
    const data = stretched.get(key);
    const buffer = ctx.createBuffer(data.length, data[0].length, sampleRate);
    data.forEach((channel, i) => buffer.copyToChannel(channel, i));
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const gain = ctx.createGain();
    const length = entry.t1 - entry.t0;
    if (length <= 0 || entry.gains.length < 2) continue;
    gain.gain.setValueCurveAtTime(entry.gains, entry.t0, entry.gains.length * entry.step);
    source.connect(gain).connect(ctx.destination);
    source.start(entry.t0, Math.min(entry.offset, Math.max(0, buffer.duration - 0.001)), length);
  }
  return ctx.startRendering();
}
