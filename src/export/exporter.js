import { projectDuration } from '../core/selectors.js';
import { ArrayBufferTarget as Mp4Target, Muxer as Mp4Muxer } from '../../vendor/mp4-muxer.mjs';
import { ArrayBufferTarget as WebmTarget, Muxer as WebmMuxer } from '../../vendor/webm-muxer.mjs';
import { createImageCache } from '../player/images.js';
import { flattenLayers, visualPlan } from '../player/plan.js';
import { createMediaPool } from '../player/pool.js';
import { createGlRenderer } from '../render/gl.js';
import { fonts as sharedFonts } from '../text/fonts.js';
import { pickFormat } from './formats.js';
import { MAX_DECODE_BYTES, buildAudioSchedule, renderMix } from './mix.js';
import {
  AUDIO_BITRATE, AUDIO_SAMPLE_RATE, exportProblem, exportSize, fileName, frameCount, frameTimestamp, suggestBitrate,
} from './settings.js';

export class ExportError extends Error {
  constructor(message, code) { super(message); this.name = 'ExportError'; this.code = code; }
}

const KEY_FRAME_SECONDS = 2;
const MAX_QUEUE = 6;
const sleep = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));
const abortError = () => new DOMException('Exportación cancelada', 'AbortError');

async function defaultProbe() {
  return {
    video: async (config) => { try { return Boolean((await VideoEncoder.isConfigSupported(config)).supported); } catch { return false; } },
    audio: async (config) => { try { return Boolean((await AudioEncoder.isConfigSupported(config)).supported); } catch { return false; } },
  };
}

/** Formatos que este navegador sabría producir para el proyecto y los ajustes dados (para mostrarlo antes de exportar). */
export async function describeSupport(project, settings, { withAudio = true, prefer = null } = {}) {
  if (typeof VideoEncoder === 'undefined') return null;
  const { width, height } = exportSize(project.settings.width, project.settings.height, settings.short);
  const bitrate = settings.bitrate ?? suggestBitrate(width, height, settings.fps, settings.quality);
  const picked = await pickFormat({ probe: await defaultProbe(), width, height, fps: settings.fps, bitrate, withAudio: withAudio && typeof AudioEncoder !== 'undefined', prefer });
  return picked && { format: picked.format, width, height, bitrate };
}

/**
 * Exporta el proyecto a un archivo de vídeo.
 *
 * Cada fotograma se dibuja con el mismo plan y el mismo renderizador WebGL que la vista previa, y el audio
 * se mezcla fuera de línea con las mismas ganancias; por eso el resultado se ve y suena como lo que se editó.
 * Los vídeos de origen se leen buscando el instante exacto de cada fotograma en un elemento <video>: es más
 * lento que el tiempo real, pero usa el mismo decodificador que la vista previa.
 *
 * @param settings { short, fps, quality, bitrate? }
 * @returns { blob, filename, mime, container, videoCodec, audioCodec, width, height, fps, frames, duration, bytes, seconds, warnings }
 */
export async function exportProject({ project, library, settings, onProgress = () => {}, signal, prefer = null, doc = globalThis.document, fonts = sharedFonts }) {
  const started = performance.now();
  const duration = projectDuration(project);
  const problem = exportProblem(project, duration, settings);
  if (problem) throw new ExportError(problem, 'invalid');
  if (typeof VideoEncoder === 'undefined' || typeof VideoFrame === 'undefined') throw new ExportError('Este navegador no puede exportar vídeo (falta WebCodecs).', 'unsupported');

  const { width, height } = exportSize(project.settings.width, project.settings.height, settings.short);
  const fps = settings.fps;
  const bitrate = settings.bitrate ?? suggestBitrate(width, height, fps, settings.quality);
  const warnings = [];
  const schedule = buildAudioSchedule(project);
  let withAudio = schedule.length > 0;
  if (withAudio && typeof AudioEncoder === 'undefined') {
    withAudio = false;
    warnings.push('Este navegador no puede codificar audio: el vídeo se exporta sin sonido.');
  }

  const picked = await pickFormat({ probe: await defaultProbe(), width, height, fps, bitrate, withAudio, prefer });
  if (!picked) throw new ExportError('Este navegador no sabe codificar vídeo en ninguno de los formatos admitidos.', 'unsupported');
  const { format } = picked;

  const mp4 = format.container === 'mp4';
  const target = mp4 ? new Mp4Target() : new WebmTarget();
  const muxer = new (mp4 ? Mp4Muxer : WebmMuxer)({
    target,
    video: { codec: format.muxerVideo, width, height, frameRate: fps },
    ...(withAudio ? { audio: { codec: format.muxerAudio, numberOfChannels: 2, sampleRate: AUDIO_SAMPLE_RATE } } : {}),
    ...(mp4 ? { fastStart: 'in-memory' } : {}),
    firstTimestampBehavior: 'offset',
  });

  let failure = null;
  const onError = (error) => { failure ??= error; };
  const videoEncoder = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: onError });
  videoEncoder.configure({ ...picked.video, ...(format.id === 'mp4-h264' ? { avc: { format: 'avc' } } : {}), latencyMode: 'quality' });
  let audioEncoder = null;

  const renderer = createGlRenderer({ doc });
  const images = createImageCache(library);
  const pool = createMediaPool({ library: { ...library, getAsset: (id) => project.assets[id] }, audio: { attach: () => null }, doc, idleMs: 1500 });
  const check = () => {
    if (signal?.aborted) throw abortError();
    if (failure) throw new ExportError(`El codificador falló: ${failure.message ?? failure}`, 'encoder');
  };
  const drain = async (encoder) => { while (encoder.encodeQueueSize > MAX_QUEUE) { check(); await sleep(2); } };

  try {
    // ---------- vídeo ----------
    const total = frameCount(duration, fps);
    const keyEvery = Math.max(1, Math.round(fps * KEY_FRAME_SECONDS));
    const scale = width / project.settings.width;
    const sourceFor = (clip) => (clip.kind === 'image' ? images.source(clip.assetId) : pool.sourceFor(clip));
    onProgress({ phase: 'video', done: 0, total });
    for (let i = 0; i < total; i++) {
      check();
      const t = Math.min(i / fps, duration - 0.0005);
      const plan = visualPlan(project, t);
      const layers = flattenLayers(plan);
      await fonts.loadFor(layers.map((l) => l.clip));
      const keep = new Set();
      await Promise.all(layers.map(async ({ clip, srcTime }) => {
        if (clip.kind === 'image') { await images.load(clip.assetId); return; }
        if (clip.kind !== 'video') return;
        keep.add(clip.id);
        const entry = pool.acquire(clip);
        entry.el.muted = true;
        await entry.whenReady;
        if (!entry.ready) throw new ExportError(`No se pudo leer el vídeo «${project.assets[clip.assetId]?.name}».`, 'source');
        await pool.seekTo(entry, srcTime);
      }));
      check();
      const canvas = renderer.render(plan, project.settings, sourceFor, { scale, fontVersion: fonts.version() });
      const frame = new VideoFrame(canvas, { timestamp: frameTimestamp(i, fps), duration: frameTimestamp(1, fps) });
      videoEncoder.encode(frame, { keyFrame: i % keyEvery === 0 });
      frame.close();
      pool.trim(keep);
      await drain(videoEncoder);
      if (i % 4 === 3) await sleep(0);
      onProgress({ phase: 'video', done: i + 1, total });
    }
    await videoEncoder.flush();
    check();

    // ---------- audio ----------
    if (withAudio) {
      onProgress({ phase: 'audio', done: 0, total: 1 });
      const decodeContext = new OfflineAudioContext(2, 1, AUDIO_SAMPLE_RATE);
      const decode = async (assetId) => {
        const file = await library.getFile(assetId);
        if (!file) throw new ExportError('Falta un archivo de audio del proyecto.', 'source');
        if (file.size > MAX_DECODE_BYTES) throw new ExportError(`El audio de «${project.assets[assetId]?.name}» es demasiado grande para exportarlo.`, 'source');
        const buffer = await decodeContext.decodeAudioData(await file.arrayBuffer());
        return Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c).slice());
      };
      const mixed = await renderMix(schedule, { decode, duration, signal });
      check();
      audioEncoder = new AudioEncoder({ output: (chunk, meta) => muxer.addAudioChunk(chunk, meta), error: onError });
      audioEncoder.configure({ codec: format.audioCodec, sampleRate: AUDIO_SAMPLE_RATE, numberOfChannels: 2, bitrate: AUDIO_BITRATE });
      const left = mixed.getChannelData(0);
      const right = mixed.numberOfChannels > 1 ? mixed.getChannelData(1) : left;
      const BLOCK = 4096;
      for (let offset = 0; offset < mixed.length; offset += BLOCK) {
        check();
        const n = Math.min(BLOCK, mixed.length - offset);
        const planar = new Float32Array(n * 2);
        planar.set(left.subarray(offset, offset + n), 0);
        planar.set(right.subarray(offset, offset + n), n);
        const data = new AudioData({ format: 'f32-planar', sampleRate: AUDIO_SAMPLE_RATE, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round((offset / AUDIO_SAMPLE_RATE) * 1e6), data: planar });
        audioEncoder.encode(data);
        data.close();
        await drain(audioEncoder);
        onProgress({ phase: 'audio', done: Math.min(mixed.length, offset + n), total: mixed.length });
      }
      await audioEncoder.flush();
      check();
    }

    // ---------- cierre ----------
    onProgress({ phase: 'finalizing', done: 0, total: 1 });
    muxer.finalize();
    const blob = new Blob([target.buffer], { type: format.mime });
    onProgress({ phase: 'finalizing', done: 1, total: 1 });
    return {
      blob, filename: fileName(project.name, format.ext), mime: format.mime, container: format.container, formatId: format.id,
      videoCodec: picked.video.codec, audioCodec: withAudio ? format.audioCodec : null, width, height, fps, frames: total, duration, bytes: blob.size,
      seconds: (performance.now() - started) / 1000, warnings,
    };
  } finally {
    for (const encoder of [videoEncoder, audioEncoder]) if (encoder && encoder.state !== 'closed') { try { encoder.close(); } catch { /* ya cerrado */ } }
    renderer.dispose();
    pool.disposeAll();
    images.dispose();
  }
}
