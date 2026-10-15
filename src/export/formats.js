/**
 * Formatos de salida por orden de preferencia: MP4 con H.264 y AAC (lo que aceptan las redes sociales y
 * casi todos los móviles) y, si el navegador no los codifica, WebM con VP9 u VP8 y Opus.
 * `mp4-vp9` es un MP4 válido pero menos compatible: no se elige solo, hay que pedirlo.
 */
const h264Level = (w, h) => (w * h <= 1280 * 720 ? 'avc1.64001f' : w * h <= 1920 * 1088 ? 'avc1.640028' : 'avc1.640033');

export const FORMATS = Object.freeze([
  { id: 'mp4-h264', container: 'mp4', mime: 'video/mp4', ext: 'mp4', label: 'MP4 (H.264)', auto: true, videoCodec: (w, h) => h264Level(w, h), muxerVideo: 'avc', audioCodec: 'mp4a.40.2', muxerAudio: 'aac' },
  { id: 'webm-vp9', container: 'webm', mime: 'video/webm', ext: 'webm', label: 'WebM (VP9)', auto: true, videoCodec: () => 'vp09.00.10.08', muxerVideo: 'V_VP9', audioCodec: 'opus', muxerAudio: 'A_OPUS' },
  { id: 'webm-vp8', container: 'webm', mime: 'video/webm', ext: 'webm', label: 'WebM (VP8)', auto: true, videoCodec: () => 'vp8', muxerVideo: 'V_VP8', audioCodec: 'opus', muxerAudio: 'A_OPUS' },
  { id: 'mp4-vp9', container: 'mp4', mime: 'video/mp4', ext: 'mp4', label: 'MP4 (VP9)', auto: false, videoCodec: () => 'vp09.00.10.08', muxerVideo: 'vp9', audioCodec: 'opus', muxerAudio: 'opus' },
]);

/**
 * Primer formato que el navegador sabe codificar. `probe.video(config)` y `probe.audio(config)` devuelven
 * si la configuración es compatible (en el navegador: `VideoEncoder.isConfigSupported`).
 */
export async function pickFormat({ probe, width, height, fps, bitrate, withAudio = true, prefer = null }) {
  const candidates = prefer ? FORMATS.filter((f) => f.id === prefer) : FORMATS.filter((f) => f.auto);
  for (const format of candidates) {
    const video = { codec: format.videoCodec(width, height), width, height, framerate: fps, bitrate };
    if (!(await probe.video(video))) continue;
    if (withAudio && !(await probe.audio({ codec: format.audioCodec, sampleRate: 48000, numberOfChannels: 2, bitrate: 128000 }))) continue;
    return { format, video };
  }
  return null;
}
