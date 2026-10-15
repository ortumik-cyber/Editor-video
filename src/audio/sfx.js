/**
 * Efectos de sonido sintetizados (originales: sin muestras ni derechos de terceros).
 * Cada uno se genera muestra a muestra y es determinista: dos llamadas dan lo mismo.
 * Mono, 44,1 kHz, pico de 0,8 y fundidos de 1 ms al empezar y de 5 ms al acabar para evitar chasquidos
 * (se aplican antes de normalizar, para que el pico final sea siempre el indicado).
 */
export const SAMPLE_RATE = 44100;
const TAU = Math.PI * 2;

/** Ruido pseudoaleatorio reproducible (congruencial lineal), en [-1, 1). */
function noise(seed) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296) * 2 - 1;
}

function build(seconds, fn) {
  const out = new Float32Array(Math.round(seconds * SAMPLE_RATE));
  const state = {};
  for (let i = 0; i < out.length; i++) out[i] = fn(i / SAMPLE_RATE, state);
  return out;
}

/** Aplica los fundidos y luego normaliza: así el pico final es exactamente `peak` aunque la energía esté al principio. */
function finish(samples, { peak = 0.8, fadeInSeconds = 0.001 } = {}) {
  const fadeIn = Math.max(1, Math.round(fadeInSeconds * SAMPLE_RATE));
  const fadeOut = Math.round(0.005 * SAMPLE_RATE);
  for (let i = 0; i < samples.length; i++) {
    if (i < fadeIn) samples[i] *= i / fadeIn;
    if (i >= samples.length - fadeOut) samples[i] *= (samples.length - 1 - i) / fadeOut;
  }
  let max = 0;
  for (const v of samples) max = Math.max(max, Math.abs(v));
  const k = max > 0 ? peak / max : 0;
  for (let i = 0; i < samples.length; i++) samples[i] *= k;
  return samples;
}

/** Seno de frecuencia variable: integra la fase para que el barrido no tenga saltos. */
const sweep = (state, f) => { state.phase = (state.phase ?? 0) + (TAU * f) / SAMPLE_RATE; return Math.sin(state.phase); };

export const SFX = Object.freeze([
  {
    id: 'ding', label: 'Campanilla', duration: 1.2,
    render: () => finish(build(1.2, (t) => [[1, 1, 0.45], [2.76, 0.5, 0.22], [5.4, 0.25, 0.12], [8.93, 0.12, 0.07]]
      .reduce((sum, [ratio, amp, tau]) => sum + amp * Math.sin(TAU * 880 * ratio * t) * Math.exp(-t / tau), 0))),
  },
  {
    id: 'pop', label: 'Pop', duration: 0.14,
    render: () => finish(build(0.14, (t, s) => sweep(s, 150 + 450 * Math.exp(-t * 40)) * Math.exp(-t * 38))),
  },
  {
    id: 'click', label: 'Clic', duration: 0.05,
    render: () => { const rnd = noise(7); return finish(build(0.05, (t) => rnd() * Math.exp(-t * 1200) + 0.6 * Math.sin(TAU * 1800 * t) * Math.exp(-t * 600)), { fadeInSeconds: 0.0002 }); },
  },
  {
    id: 'whoosh', label: 'Barrido de aire', duration: 0.9,
    render: () => {
      const rnd = noise(11);
      return finish(build(0.9, (t, s) => {
        const cutoff = 300 + 3500 * Math.sin((Math.PI * t) / 0.9) ** 2;
        const alpha = 1 - Math.exp((-TAU * cutoff) / SAMPLE_RATE);
        s.y = (s.y ?? 0) + alpha * (rnd() - (s.y ?? 0));
        return s.y * Math.sin((Math.PI * t) / 0.9) ** 1.5;
      }));
    },
  },
  {
    id: 'rise', label: 'Subida', duration: 1.2,
    render: () => finish(build(1.2, (t, s) => (sweep(s, 200 * Math.exp((Math.log(8) * t) / 1.2)) + 0.4 * Math.sin(s.phase * 1.005)) * (t / 1.2) ** 1.5)),
  },
  {
    id: 'drop', label: 'Bajada', duration: 0.6,
    render: () => finish(build(0.6, (t, s) => sweep(s, 800 * Math.exp((Math.log(0.1) * t) / 0.6)) * (1 - t / 0.6) ** 0.7)),
  },
  {
    id: 'coin', label: 'Moneda', duration: 0.4,
    render: () => finish(build(0.4, (t) => {
      const [f, local] = t < 0.08 ? [988, t] : [1319, t - 0.08];
      const wave = 0.6 * Math.sign(Math.sin(TAU * f * t)) + 0.4 * Math.sin(TAU * f * t);
      return wave * (t < 0.08 ? 1 : Math.exp(-local * 9));
    })),
  },
  {
    id: 'buzzer', label: 'Error', duration: 0.5,
    render: () => finish(build(0.5, (t) => (2 * ((150 * t) % 1) - 1) * (1 + 0.3 * Math.sin(TAU * 25 * t)))),
  },
  {
    id: 'heartbeat', label: 'Latido', duration: 0.7,
    render: () => finish(build(0.7, (t) => [0, 0.22].reduce((sum, start) => {
      const u = t - start;
      return u < 0 ? sum : sum + Math.sin(TAU * 55 * u) * Math.exp(-u * 18) + 0.5 * Math.sin(TAU * 110 * u) * Math.exp(-u * 30);
    }, 0))),
  },
]);

/** WAV PCM de 16 bits, mono. */
export function encodeWav(samples, sampleRate = SAMPLE_RATE) {
  const bytes = 44 + samples.length * 2;
  const view = new DataView(new ArrayBuffer(bytes));
  const text = (offset, s) => { for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i)); };
  text(0, 'RIFF'); view.setUint32(4, bytes - 8, true); text(8, 'WAVE');
  text(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  text(36, 'data'); view.setUint32(40, samples.length * 2, true);
  samples.forEach((v, i) => view.setInt16(44 + i * 2, Math.round(Math.max(-1, Math.min(1, v)) * 32767), true));
  return new Uint8Array(view.buffer);
}

export const sfxFile = (sfx) => new File([encodeWav(sfx.render())], `sfx-${sfx.id}.wav`, { type: 'audio/wav' });
