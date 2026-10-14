export const MAX_FILE_BYTES = 2 * 1024 ** 3;

const EXTENSIONS = {
  video: ['mp4', 'mov', 'm4v', 'webm', 'mkv', 'avi', '3gp'],
  image: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif', 'bmp'],
  audio: ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'oga', 'opus', 'flac', 'weba'],
};

/** Tipo de medio por MIME y, si el MIME falta o es genérico, por extensión. */
export function detectKind(file) {
  const type = (file.type || '').toLowerCase();
  for (const kind of Object.keys(EXTENSIONS)) if (type.startsWith(`${kind}/`)) return kind;
  const ext = (file.name || '').split('.').pop().toLowerCase();
  return Object.keys(EXTENSIONS).find((kind) => EXTENSIONS[kind].includes(ext)) ?? null;
}

export function validateFile(file, { maxBytes = MAX_FILE_BYTES } = {}) {
  const kind = detectKind(file);
  if (!kind) return { ok: false, code: 'unsupported', message: `Formato no admitido: ${file.name}` };
  if (!file.size) return { ok: false, code: 'empty', message: `El archivo está vacío: ${file.name}` };
  if (file.size > maxBytes) return { ok: false, code: 'too_big', message: `Supera el límite de ${Math.round(maxBytes / 1024 ** 3)} GB: ${file.name}` };
  return { ok: true, kind };
}

export function formatDuration(seconds) {
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}
