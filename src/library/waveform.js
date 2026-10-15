/** Picos por tramo (0-255) sobre uno o varios canales. Cada tramo toma el máximo absoluto. */
export function computePeaks(channels, buckets) {
  const length = Math.max(...channels.map((c) => c.length));
  const peaks = new Array(buckets).fill(0);
  if (!length) return peaks;
  const per = length / buckets;
  for (const data of channels) {
    for (let b = 0; b < buckets; b++) {
      const from = Math.floor(b * per);
      const to = Math.min(data.length, Math.max(from + 1, Math.floor((b + 1) * per)));
      let max = 0;
      for (let i = from; i < to; i++) {
        const v = Math.abs(data[i]);
        if (v > max) max = v;
      }
      const level = Math.round(Math.min(1, max) * 255);
      if (level > peaks[b]) peaks[b] = level;
    }
  }
  return peaks;
}

/** 5 picos por segundo, entre 50 y 1000. */
export const bucketsFor = (duration) => Math.min(1000, Math.max(50, Math.round(duration * 5)));

/** Fotogramas de la tira de un vídeo: uno cada 2 s, entre 4 y 16. */
export const stripFrames = (duration) => Math.min(16, Math.max(4, Math.round(duration / 2)));

/** Instantes del centro de cada tramo. Evita el primer y el último fotograma, que suelen ser negros. */
export const stripTimes = (duration, n = stripFrames(duration)) => Array.from({ length: n }, (_, i) => ((i + 0.5) / n) * duration);

export const thumbnailTime = (duration) => (duration < 2 ? duration / 2 : 1);
