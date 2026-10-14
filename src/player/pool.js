/**
 * Un elemento <video>/<audio> por clip activo o inminente. Los navegadores limitan los
 * decodificadores simultáneos, así que se crean al acercarse el clip y se descartan al quedar
 * sin uso. `seekTo` agrupa saltos seguidos (al arrastrar el cursor): solo cuenta el último.
 */
export function createMediaPool({ library, audio, doc = document, idleMs = 2500, now = () => performance.now() }) {
  const entries = new Map();

  function create(clip, asset) {
    const el = doc.createElement(clip.kind === 'video' ? 'video' : 'audio');
    el.preload = 'auto';
    el.playsInline = true;
    const entry = {
      clipId: clip.id, assetId: asset.id, el, ready: false, lastUsed: now(), seekPromise: null, target: 0, primedAt: null,
      node: clip.kind === 'audio' || asset.hasAudio ? audio.attach(el) : null,
    };
    entry.whenReady = new Promise((resolve) => {
      el.addEventListener('loadedmetadata', () => { entry.ready = true; resolve(entry); }, { once: true });
      el.addEventListener('error', () => resolve(entry), { once: true });
    });
    library.getUrl(asset.id).then((url) => {
      if (url && entries.get(clip.id) === entry) el.src = url;
    });
    entries.set(clip.id, entry);
    return entry;
  }

  const clampTime = (entry, time) => Math.max(0, Math.min(time, (entry.el.duration || Infinity) - 0.001));

  function seekTo(entry, time) {
    const { el } = entry;
    entry.target = clampTime(entry, time);
    if (entry.seekPromise) return entry.seekPromise;
    if (Math.abs(el.currentTime - entry.target) < 0.001 && el.readyState >= 2) return Promise.resolve();
    entry.seekPromise = new Promise((resolve) => {
      const finish = () => { clearTimeout(timer); entry.seekPromise = null; resolve(); };
      const timer = setTimeout(finish, 1500);
      const step = () => {
        const goal = entry.target;
        const onSeeked = () => {
          el.removeEventListener('seeked', onSeeked);
          if (Math.abs(entry.target - goal) > 0.001) step(); else finish();
        };
        el.addEventListener('seeked', onSeeked);
        el.currentTime = goal;
      };
      step();
    });
    return entry.seekPromise;
  }

  function dispose(entry) {
    entry.el.pause();
    entry.node?.destroy();
    entry.el.removeAttribute('src');
    entry.el.load();
    entries.delete(entry.clipId);
  }

  return {
    acquire(clip) {
      const asset = library.getAsset(clip.assetId);
      const entry = entries.get(clip.id) ?? create(clip, asset);
      entry.lastUsed = now();
      return entry;
    },
    peek: (clipId) => entries.get(clipId),
    all: () => [...entries.values()],
    seekTo,
    clampTime,
    sourceFor(clip) {
      const entry = entries.get(clip.id);
      if (!entry?.ready || entry.el.readyState < 2) return null;
      return { image: entry.el, width: entry.el.videoWidth, height: entry.el.videoHeight };
    },
    /** Descarta lo que no está en `keep` y lleva más de `idleMs` sin usarse. */
    trim(keep) {
      const limit = now() - idleMs;
      for (const entry of [...entries.values()]) if (!keep.has(entry.clipId) && entry.lastUsed < limit) dispose(entry);
    },
    disposeAll() { for (const entry of [...entries.values()]) dispose(entry); },
  };
}
