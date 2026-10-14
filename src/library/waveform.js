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

export const thumbnailTime = (duration) => (duration < 2 ? duration / 2 : 1);
