/**
 * Ajustes de exportación (datos y cálculos puros).
 * Tamaño: el lado corto manda y ambos lados son pares (los codificadores de vídeo lo exigen).
 */
export const RESOLUTIONS = Object.freeze([
  { id: '480p', short: 480, label: '480p' },
  { id: '720p', short: 720, label: '720p (HD)' },
  { id: '1080p', short: 1080, label: '1080p (Full HD)' },
]);
export const FPS_OPTIONS = Object.freeze([24, 30, 60]);
export const QUALITIES = Object.freeze([
  { id: 'small', label: 'Archivo pequeño', bitsPerPixel: 0.05 },
  { id: 'normal', label: 'Normal', bitsPerPixel: 0.09 },
  { id: 'high', label: 'Alta', bitsPerPixel: 0.16 },
]);

export const AUDIO_BITRATE = 128_000;
export const AUDIO_SAMPLE_RATE = 48_000;
export const LIMITS = Object.freeze({ maxSide: 4096, maxFrames: 60 * 60 * 30, maxSeconds: 60 * 60 });

const even = (n) => Math.max(2, Math.round(n / 2) * 2);

/** Tamaño de salida con la proporción del proyecto y `short` píxeles en el lado corto. */
export function exportSize(projectWidth, projectHeight, short) {
  const scale = short / Math.min(projectWidth, projectHeight);
  return { width: Math.min(LIMITS.maxSide, even(projectWidth * scale)), height: Math.min(LIMITS.maxSide, even(projectHeight * scale)) };
}

/** Tasa de bits de vídeo en bits por segundo, entre 300 kbps y 40 Mbps. */
export function suggestBitrate(width, height, fps, qualityId = 'normal') {
  const q = QUALITIES.find((x) => x.id === qualityId) ?? QUALITIES[1];
  return Math.round(Math.min(40_000_000, Math.max(300_000, width * height * fps * q.bitsPerPixel)));
}

export const estimateBytes = (videoBitrate, seconds, withAudio = true) => Math.round(((videoBitrate + (withAudio ? AUDIO_BITRATE : 0)) * seconds) / 8);

export const frameCount = (seconds, fps) => Math.max(1, Math.ceil(seconds * fps - 1e-9));
export const frameTimestamp = (index, fps) => Math.round((index * 1_000_000) / fps);

export function formatBytes(bytes) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(bytes < 10 * 1024 ** 2 ? 1 : 0)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

/** Nombre de archivo seguro a partir del nombre del proyecto. */
export function fileName(projectName, ext) {
  const base = projectName.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase().slice(0, 60);
  return `${base || 'video'}.${ext}`;
}

/** Devuelve el primer motivo por el que no se puede exportar, o null. */
export function exportProblem(project, seconds, settings) {
  if (!(seconds > 0)) return 'No hay nada que exportar: la línea de tiempo está vacía.';
  if (seconds > LIMITS.maxSeconds) return 'El proyecto dura más de una hora: divídelo en partes.';
  if (frameCount(seconds, settings.fps) > LIMITS.maxFrames) return 'Demasiados fotogramas para exportar de una vez.';
  const { width, height } = exportSize(project.settings.width, project.settings.height, settings.short);
  if (width > LIMITS.maxSide || height > LIMITS.maxSide) return 'La resolución elegida es demasiado grande.';
  return null;
}
