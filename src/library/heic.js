/**
 * Fotos HEIC/HEIF (las del iPhone). Safari las abre, Chrome y Firefox no: si el navegador no puede,
 * se decodifican con libheif (WebAssembly, se descarga solo cuando hace falta) y se guardan como JPEG.
 */
const HEIC_EXT = /\.(heic|heif|hif)$/i;
const HEIC_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'hevm', 'hevs', 'mif1', 'msf1']);
const MAX_SIDE = 4096;

/** Por MIME, por extensión o por la marca `ftyp` de los primeros bytes (un iPhone a veces no declara el tipo). */
export async function isHeic(file) {
  const type = (file.type || '').toLowerCase();
  if (type === 'image/heic' || type === 'image/heif' || type === 'image/heic-sequence' || type === 'image/heif-sequence') return true;
  if (HEIC_EXT.test(file.name || '')) return true;
  if (type && !type.startsWith('image/') && type !== 'application/octet-stream') return false;
  const head = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const text = (a, b) => String.fromCharCode(...head.slice(a, b));
  return head.length >= 12 && text(4, 8) === 'ftyp' && HEIC_BRANDS.has(text(8, 12));
}

let loading = null;
const defaultLoader = () => (loading ??= import('../../vendor/libheif-bundle.mjs').then((m) => m.default()));

/** Decodifica a píxeles RGBA. La orientación de la cámara ya viene aplicada. */
export async function decodeHeic(file, loader = defaultLoader) {
  const lib = await loader();
  const images = new lib.HeifDecoder().decode(new Uint8Array(await file.arrayBuffer()));
  if (!images.length) throw new Error('Sin imágenes');
  const image = images[0];
  const width = image.get_width();
  const height = image.get_height();
  const out = { data: new Uint8ClampedArray(width * height * 4), width, height };
  await new Promise((resolve, reject) => image.display(out, (result) => (result ? resolve(result) : reject(new Error('No se pudo decodificar')))));
  for (const img of images) img.free?.();
  return out;
}

/** HEIC → File JPEG (lado mayor de 4096 como máximo). */
export async function heicToJpeg(file, { doc = globalThis.document, loader } = {}) {
  const { data, width, height } = await decodeHeic(file, loader);
  const scale = Math.min(1, MAX_SIDE / Math.max(width, height));
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  const full = doc.createElement('canvas');
  full.width = width;
  full.height = height;
  full.getContext('2d').putImageData(new ImageData(data, width, height), 0, 0);
  let canvas = full;
  if (scale < 1) {
    canvas = doc.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d').drawImage(full, 0, 0, w, h);
  }
  const blob = await new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Sin JPEG'))), 'image/jpeg', 0.92));
  return new File([blob], (file.name || 'foto').replace(HEIC_EXT, '') + '.jpg', { type: 'image/jpeg', lastModified: file.lastModified });
}
