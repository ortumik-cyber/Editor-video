/** Nivel RMS (0-1) a porcentaje de medidor (0-100) en una escala de decibelios de -60 a 0. */
export function levelToPercent(rms) {
  const db = 20 * Math.log10(Math.max(rms, 1e-5));
  return Math.min(100, Math.max(0, ((db + 60) / 60) * 100));
}

/** Sube al instante y baja poco a poco, como un medidor de aguja. `release` es la fracción que se conserva por paso. */
export function smoothLevel(previous, next, release = 0.9) {
  return next >= previous ? next : Math.max(next, previous * release);
}
