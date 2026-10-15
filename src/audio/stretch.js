/**
 * Estiramiento temporal sin cambiar el tono (WSOLA). `speed` 2 dura la mitad; 0,5, el doble.
 * Es lo que hace el navegador en la vista previa (`preservesPitch`): sin esto, un clip a 2× exportado
 * sonaría una octava más agudo que lo que se oyó al editarlo.
 *
 * Cada trozo de 46 ms se toma cerca de la posición nominal, en el punto que mejor continúa al anterior
 * (correlación normalizada sobre el audio mezclado y diezmado), y se solapa con ventana de Hann.
 * Todos los canales usan las mismas posiciones, así que la fase entre ellos se conserva.
 */
export function timeStretch(channels, sampleRate, speed, { windowSeconds = 0.046, decimation = 4 } = {}) {
  if (!(speed > 0)) throw new RangeError('speed debe ser positivo');
  if (Math.abs(speed - 1) < 1e-6) return channels.map((c) => c.slice());
  const n = channels[0].length;
  const N = Math.max(64, Math.round((windowSeconds * sampleRate) / 2) * 2);
  const Hs = N / 2;
  const Ha = Hs * speed;
  const tolerance = Math.floor(N / 4);
  const outLength = Math.max(1, Math.floor(n / speed));
  const hann = Float32Array.from({ length: N }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N));
  const out = channels.map(() => new Float32Array(outLength + N));

  const D = decimation;
  const mono = new Float32Array(Math.ceil(n / D));
  for (let i = 0; i < mono.length; i++) {
    let s = 0;
    for (const c of channels) s += c[Math.min(n - 1, i * D)];
    mono[i] = s / channels.length;
  }
  const at = (i) => (i >= 0 && i < mono.length ? mono[i] : 0);

  let prev = 0;
  for (let k = 0, outStart = 0; outStart < outLength; k++, outStart += Hs) {
    let pos = 0;
    if (k > 0) {
      const nominal = Math.round(k * Ha);
      const refStart = Math.floor((prev + Hs) / D);
      const len = Math.floor(Hs / D);
      let best = -Infinity;
      pos = Math.min(Math.max(0, nominal), Math.max(0, n - 1));
      for (let cand = nominal - tolerance; cand <= nominal + tolerance; cand += D) {
        if (cand < 0 || cand >= n) continue;
        const c0 = Math.floor(cand / D);
        let dot = 0, ec = 0, er = 0;
        for (let i = 0; i < len; i++) { const a = at(c0 + i); const b = at(refStart + i); dot += a * b; ec += a * a; er += b * b; }
        const score = dot / Math.sqrt(ec * er + 1e-9);
        if (score > best) { best = score; pos = cand; }
      }
    }
    for (let ch = 0; ch < channels.length; ch++) {
      const src = channels[ch];
      const dst = out[ch];
      for (let i = 0; i < N; i++) {
        const j = pos + i;
        if (j >= n) break;
        const w = k === 0 && i < Hs ? 1 : hann[i];
        dst[outStart + i] += src[j] * w;
      }
    }
    prev = pos;
  }
  return out.map((c) => c.slice(0, outLength));
}
