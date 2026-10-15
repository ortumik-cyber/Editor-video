/** Caché de imágenes decodificadas (ImageBitmap) por medio. La comparten el reproductor y el exportador. */
export function createImageCache(library) {
  const entries = new Map();
  return {
    /** Decodifica el medio una sola vez; devuelve una promesa que se cumple cuando está listo (o falla en silencio). */
    load(assetId) {
      let entry = entries.get(assetId);
      if (!entry) {
        entry = { bitmap: null };
        entry.promise = library.getFile(assetId)
          .then((blob) => (blob ? createImageBitmap(blob) : null))
          .then((bitmap) => { entry.bitmap = bitmap; })
          .catch(() => {});
        entries.set(assetId, entry);
      }
      return entry.promise;
    },
    /** `{ image, width, height }` si ya está decodificada. */
    source(assetId) {
      const bitmap = entries.get(assetId)?.bitmap;
      return bitmap ? { image: bitmap, width: bitmap.width, height: bitmap.height } : null;
    },
    dispose() {
      for (const { bitmap } of entries.values()) bitmap?.close();
      entries.clear();
    },
  };
}
