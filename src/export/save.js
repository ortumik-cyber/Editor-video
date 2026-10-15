/** Descarga un archivo con su nombre. */
export function saveBlob(blob, filename, doc = globalThis.document) {
  const url = URL.createObjectURL(blob);
  const link = Object.assign(doc.createElement('a'), { href: url, download: filename });
  doc.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export const toFile = (blob, filename) => new File([blob], filename, { type: blob.type });

/** ¿Puede el navegador compartir este archivo con el menú del sistema (móviles sobre todo)? */
export function canShareFile(file, nav = globalThis.navigator) {
  try { return Boolean(nav?.share && nav.canShare?.({ files: [file] })); } catch { return false; }
}

export const shareFile = (file, title, nav = globalThis.navigator) => nav.share({ files: [file], title });
