/**
 * Grafo de Web Audio: cada elemento de vídeo o audio pasa por su ganancia (volumen, fundidos,
 * silencio) hacia una salida común con un medidor de nivel. Solo así se admite volumen superior a 1.
 * El contexto se crea al primer uso; los navegadores lo dejan suspendido hasta un gesto del usuario.
 */
export function createAudioGraph({ AudioContextCtor = globalThis.AudioContext ?? globalThis.webkitAudioContext } = {}) {
  let ctx = null;
  let master = null;
  let analyser = null;
  let samples = null;

  function ensure() {
    if (ctx) return ctx;
    ctx = new AudioContextCtor();
    master = ctx.createGain();
    analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    samples = new Float32Array(analyser.fftSize);
    master.connect(analyser);
    analyser.connect(ctx.destination);
    return ctx;
  }

  return {
    /** No espera: sin gesto del usuario la promesa puede quedar pendiente. */
    resume() {
      ensure();
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    },
    attach(element) {
      ensure();
      const source = ctx.createMediaElementSource(element);
      const gain = ctx.createGain();
      gain.gain.value = 0;
      source.connect(gain);
      gain.connect(master);
      return {
        setGain: (value) => gain.gain.setTargetAtTime(value, ctx.currentTime, 0.015),
        destroy() { source.disconnect(); gain.disconnect(); },
      };
    },
    /** Nivel RMS (0-1) de lo que suena ahora. */
    level() {
      if (!analyser) return 0;
      analyser.getFloatTimeDomainData(samples);
      let sum = 0;
      for (const v of samples) sum += v * v;
      return Math.sqrt(sum / samples.length);
    },
    get state() { return ctx?.state ?? 'none'; },
  };
}
