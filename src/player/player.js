import { projectDuration } from '../core/selectors.js';
import { createAudioGraph } from './audio.js';
import { composeFrame } from './compose.js';
import { mediaPlan, upcomingMedia, visualPlan } from './plan.js';
import { createMediaPool } from './pool.js';

const LOOKAHEAD = 1;
const DRIFT_MAX = 0.25;

/**
 * Reproductor de la vista previa. El reloj es performance.now; los elementos de medios lo siguen y
 * se corrigen cuando se desvían más de 250 ms. Pausado, cada cambio dibuja un fotograma fijo
 * esperando a que los vídeos lleguen a su instante (la última petición gana al arrastrar el cursor).
 */
export function createPlayer({ store, library, canvas, doc = canvas.ownerDocument, maxPreviewSide = 960 }) {
  const audio = createAudioGraph();
  const pool = createMediaPool({ library: { ...library, getAsset: (id) => store.getProject().assets[id] }, audio, doc });
  const images = new Map();
  const listeners = new Set();
  const ctx = canvas.getContext('2d', { alpha: false });
  const stats = { frames: 0, stills: 0 };
  let playing = false;
  let raf = 0;
  let token = 0;
  let ownSeek = false;
  let clock = { wall: 0, time: 0 };

  const emit = () => listeners.forEach((fn) => fn({ playing }));
  const setHead = (t) => { ownSeek = true; store.setPlayhead(t); ownSeek = false; };

  function loadImage(assetId) {
    let entry = images.get(assetId);
    if (!entry) {
      entry = { bitmap: null };
      entry.promise = library.getFile(assetId)
        .then((blob) => (blob ? createImageBitmap(blob) : null))
        .then((bitmap) => { entry.bitmap = bitmap; })
        .catch(() => {});
      images.set(assetId, entry);
    }
    return entry.promise;
  }

  function sourceFor(clip) {
    if (clip.kind === 'image') {
      const { bitmap } = images.get(clip.assetId) ?? {};
      return bitmap ? { image: bitmap, width: bitmap.width, height: bitmap.height } : null;
    }
    return pool.sourceFor(clip);
  }

  function draw(layers) {
    const { settings } = store.getProject();
    const scale = Math.min(1, maxPreviewSide / Math.max(settings.width, settings.height));
    const w = Math.round(settings.width * scale);
    const h = Math.round(settings.height * scale);
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    composeFrame(ctx, settings, layers, sourceFor, { scale: w / settings.width });
  }

  async function renderStill() {
    const mine = ++token;
    const project = store.getProject();
    const t = store.getState().playhead;
    const layers = visualPlan(project, t);
    const keep = new Set();
    await Promise.all(layers.map(async ({ clip, srcTime }) => {
      if (clip.kind === 'image') return loadImage(clip.assetId);
      if (clip.kind !== 'video') return undefined;
      keep.add(clip.id);
      const entry = pool.acquire(clip);
      await entry.whenReady;
      return entry.ready ? pool.seekTo(entry, srcTime) : undefined;
    }));
    if (mine !== token || playing) return;
    draw(layers);
    pool.trim(keep);
    stats.stills++;
  }

  function sync(project, t) {
    const keep = new Set();
    for (const item of mediaPlan(project, t)) {
      const { clip } = item;
      keep.add(clip.id);
      const entry = pool.acquire(clip);
      if (!entry.ready) continue;
      const { el } = entry;
      const expected = pool.clampTime(entry, item.srcTime);
      if (el.paused) {
        el.playbackRate = item.speed;
        el.currentTime = expected;
        el.play()?.catch(() => {});
      } else {
        if (el.playbackRate !== item.speed) el.playbackRate = item.speed;
        if (Math.abs(el.currentTime - expected) > DRIFT_MAX) el.currentTime = expected;
      }
      entry.node?.setGain(item.gain);
    }
    for (const clip of upcomingMedia(project, t, LOOKAHEAD)) {
      keep.add(clip.id);
      const entry = pool.acquire(clip);
      if (entry.ready && entry.primedAt !== clip.in) { entry.primedAt = clip.in; pool.seekTo(entry, clip.in); }
    }
    for (const entry of pool.all()) {
      if (keep.has(entry.clipId)) continue;
      if (!entry.el.paused) entry.el.pause();
      entry.node?.setGain(0);
    }
    pool.trim(keep);
  }

  function frame(wall) {
    if (!playing) return;
    const project = store.getProject();
    const end = projectDuration(project);
    const t = clock.time + (wall - clock.wall) / 1000;
    if (t >= end) { setHead(end); pause(); return; }
    sync(project, t);
    const layers = visualPlan(project, t);
    for (const { clip } of layers) if (clip.kind === 'image') loadImage(clip.assetId);
    draw(layers);
    setHead(t);
    stats.frames++;
    raf = requestAnimationFrame(frame);
  }

  function play() {
    if (playing) return;
    const end = projectDuration(store.getProject());
    if (end <= 0) return;
    let t = store.getState().playhead;
    if (t >= end - 0.05) { t = 0; setHead(0); }
    audio.resume();
    token++;
    playing = true;
    clock = { wall: performance.now(), time: t };
    emit();
    raf = requestAnimationFrame(frame);
  }

  function pause() {
    if (!playing) return;
    playing = false;
    cancelAnimationFrame(raf);
    for (const entry of pool.all()) { entry.el.pause(); entry.node?.setGain(0); }
    emit();
    renderStill();
  }

  const unsubscribe = store.subscribe((_, meta) => {
    if (meta.type === 'select') return;
    if (meta.type === 'playhead') {
      if (ownSeek) return;
      if (playing) clock = { wall: performance.now(), time: store.getState().playhead };
      else renderStill();
      return;
    }
    if (!playing) renderStill();
  });

  renderStill();

  return {
    play,
    pause,
    toggle: () => (playing ? pause() : play()),
    isPlaying: () => playing,
    seek: (t) => store.setPlayhead(t),
    getLevel: () => audio.level(),
    audioState: () => audio.state,
    stats,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    /** Estado interno para pruebas y depuración. */
    debug: () => pool.all().map((e) => ({ clipId: e.clipId, paused: e.el.paused, time: e.el.currentTime, rate: e.el.playbackRate, ready: e.ready })),
    destroy() {
      unsubscribe();
      pause();
      cancelAnimationFrame(raf);
      pool.disposeAll();
      for (const { bitmap } of images.values()) bitmap?.close();
      images.clear();
    },
  };
}
