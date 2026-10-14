/**
 * Stickers vectoriales propios (arte original, sin derechos de terceros). Cada uno es un SVG de 200x200
 * que se rasteriza a PNG y se importa como un medio más: hereda transformación, efectos y fundidos.
 * Sin texto dentro del SVG: las fuentes no se cargan en imágenes vectoriales.
 */
const svg = (body) => `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200">${body}</svg>`;
const W = 'stroke="#ffffff" stroke-width="8" stroke-linejoin="round"';

const rays = (() => {
  let out = '';
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    const x1 = (100 + Math.cos(a) * 62).toFixed(1), y1 = (100 + Math.sin(a) * 62).toFixed(1);
    const x2 = (100 + Math.cos(a) * 88).toFixed(1), y2 = (100 + Math.sin(a) * 88).toFixed(1);
    out += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`;
  }
  return out;
})();

export const STICKERS = Object.freeze([
  { id: 'heart', label: 'Corazón', svg: svg(`<path d="M100 175C20 120 10 70 45 45c25-17 50-5 55 17 5-22 30-34 55-17 35 25 25 75-55 130z" fill="#ff4d6d" ${W}/>`) },
  { id: 'star', label: 'Estrella', svg: svg(`<polygon points="100,15 124,72 186,76 138,115 154,176 100,142 46,176 62,115 14,76 76,72" fill="#ffd23f" ${W}/>`) },
  { id: 'sparkle', label: 'Destello', svg: svg(`<path d="M100 10C108 70 130 92 190 100 130 108 108 130 100 190 92 130 70 108 10 100 70 92 92 70 100 10z" fill="#7df9ff" ${W}/>`) },
  { id: 'bolt', label: 'Rayo', svg: svg(`<polygon points="118,10 45,110 95,110 80,190 160,80 108,80" fill="#ffe14d" ${W}/>`) },
  { id: 'arrow', label: 'Flecha', svg: svg(`<path d="M20 85H120V45L185 100 120 155V115H20z" fill="#22d3ee" ${W}/>`) },
  { id: 'bubble', label: 'Bocadillo', svg: svg('<path d="M30 30H170a15 15 0 0 1 15 15V115a15 15 0 0 1-15 15H100L60 170V130H30a15 15 0 0 1-15-15V45a15 15 0 0 1 15-15z" fill="#ffffff" stroke="#1f2937" stroke-width="8" stroke-linejoin="round"/>') },
  { id: 'flame', label: 'Llama', svg: svg('<path d="M100 10C110 50 150 70 150 120 150 160 125 190 100 190 75 190 50 160 50 120 50 90 70 75 78 50 88 65 92 75 95 80 100 55 98 35 100 10z" fill="#ff7a18"/><path d="M100 190C85 190 70 175 72 150 74 130 92 120 100 100 108 120 128 130 128 150 130 175 115 190 100 190z" fill="#ffd23f"/>') },
  { id: 'sun', label: 'Sol', svg: svg(`<circle cx="100" cy="100" r="40" fill="#ffd23f"/><g stroke="#ffd23f" stroke-width="12" stroke-linecap="round">${rays}</g>`) },
  { id: 'cloud', label: 'Nube', svg: svg('<g fill="#f8fafc"><circle cx="65" cy="120" r="32"/><circle cx="105" cy="95" r="45"/><circle cx="145" cy="120" r="30"/><rect x="65" y="120" width="80" height="32"/></g>') },
  { id: 'check', label: 'Visto', svg: svg('<circle cx="100" cy="100" r="88" fill="#22c55e"/><path d="M55 105L88 138 148 70" fill="none" stroke="#ffffff" stroke-width="18" stroke-linecap="round" stroke-linejoin="round"/>') },
  { id: 'crown', label: 'Corona', svg: svg(`<path d="M25 150L15 60 65 100 100 40 135 100 185 60 175 150z" fill="#ffc107" ${W}/><rect x="25" y="150" width="150" height="24" rx="6" fill="#ffa000" ${W}/>`) },
  { id: 'frame', label: 'Marco', svg: svg('<rect x="15" y="15" width="170" height="170" rx="28" fill="none" stroke="#ffffff" stroke-width="10"/>') },
  { id: 'note', label: 'Nota musical', svg: svg('<ellipse cx="65" cy="150" rx="26" ry="20" fill="#a78bfa"/><ellipse cx="140" cy="130" rx="26" ry="20" fill="#a78bfa"/><path d="M88 150V50L162 32V130" fill="none" stroke="#a78bfa" stroke-width="12" stroke-linejoin="round"/>') },
]);

export const EMOJI = Object.freeze([
  '😀', '😂', '😍', '😎', '🥳', '😭', '😡', '🤔', '👍', '👏', '🙌', '💪',
  '❤️', '🔥', '✨', '⭐', '🎉', '🎵', '💯', '✅', '👀', '🌈', '☀️', '🌙',
  '🍕', '☕', '🐶', '🐱', '🚀', '🎬', '📷', '💡',
]);

/** Estilos de partida para un texto nuevo. */
export const TEXT_STYLES = Object.freeze([
  { id: 'plain', label: 'Sencillo', text: { font: 'Inter', weight: 700, size: 96, color: '#ffffff', shadow: true } },
  { id: 'title', label: 'Título', text: { font: 'Bebas Neue', weight: 400, size: 220, color: '#ffffff', stroke: '#000000', shadow: false, animIn: 'pop' } },
  { id: 'caption', label: 'Subtítulo', text: { font: 'Montserrat', weight: 700, size: 64, color: '#ffffff', background: '#000000', backgroundOpacity: 0.65, shadow: false } },
  { id: 'script', label: 'Manuscrito', text: { font: 'Caveat', weight: 700, size: 150, color: '#ffe066', shadow: true, animIn: 'typewriter', animInDuration: 1.2 } },
  { id: 'retro', label: 'Retro', text: { font: 'Lobster', weight: 400, size: 140, color: '#ff5d8f', stroke: '#ffffff', shadow: true } },
  { id: 'marker', label: 'Rotulador', text: { font: 'Permanent Marker', weight: 400, size: 120, color: '#00e5ff', shadow: false, animIn: 'slide-up' } },
]);

/** Rasteriza un sticker a PNG. Solo en navegador. */
export async function rasterizeSticker(sticker, size = 512, doc = globalThis.document) {
  const url = URL.createObjectURL(new Blob([sticker.svg], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const canvas = doc.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    canvas.getContext('2d').drawImage(img, 0, 0, size, size);
    return await new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Sin imagen'))), 'image/png'));
  } finally {
    URL.revokeObjectURL(url);
  }
}
