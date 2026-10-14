/** Recorte centrado con la proporción `ratio` (ancho/alto) sobre un origen de srcW x srcH. null si ya coincide. */
export function centeredCrop(srcW, srcH, ratio) {
  if (!ratio || !(srcW > 0) || !(srcH > 0)) return null;
  const srcRatio = srcW / srcH;
  if (Math.abs(srcRatio - ratio) < 1e-3) return null;
  const w = srcRatio > ratio ? ratio / srcRatio : 1;
  const h = srcRatio > ratio ? 1 : srcRatio / ratio;
  return { x: (1 - w) / 2, y: (1 - h) / 2, w, h };
}

/** Proporción (ancho/alto) del recorte actual sobre un origen de srcW x srcH. */
export function cropRatio(srcW, srcH, crop) {
  return crop ? (crop.w * srcW) / (crop.h * srcH) : srcW / srcH;
}
