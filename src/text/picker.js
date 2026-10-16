import { SFX, sfxFile } from '../audio/sfx.js';
import { addAudioClip, addEmojiClip, addOverlayAsset, addStyledText } from '../timeline/actions.js';
import { formatDuration } from '../library/kinds.js';
import { EMOJI_GROUPS, STICKERS, TEXT_STYLES, rasterizeSticker } from './stickers.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/**
 * Panel para añadir texto (con estilos de partida), stickers, emoji, música propia y efectos de sonido.
 * Un sticker o un sonido se genera e importa una sola vez; las veces siguientes reutiliza el medio.
 */
export function createAddPanel(root, { store, library, doc = root.ownerDocument }) {
  const abort = new AbortController();
  const pending = new Map();
  root.classList.add('add');
  root.innerHTML = `
    <section class="add__sec" aria-labelledby="add-h-text"><h3 id="add-h-text">Texto</h3>
      <div class="add__chips" role="group" aria-label="Estilos de texto">${TEXT_STYLES.map((s) => `<button type="button" class="add__chip" data-style="${s.id}">${s.label}</button>`).join('')}</div></section>
    <section class="add__sec" aria-labelledby="add-h-stickers"><h3 id="add-h-stickers">Stickers</h3>
      <div class="add__grid">${STICKERS.map((s) => `<button type="button" class="add__tile" data-sticker="${s.id}" aria-label="Sticker: ${s.label}" title="${s.label}">${s.svg}</button>`).join('')}</div></section>
    <section class="add__sec" aria-labelledby="add-h-emoji"><h3 id="add-h-emoji">Emoji</h3>
      <div class="add__chips" role="group" aria-label="Categorías de emoji">${EMOJI_GROUPS.map((g, i) => `<button type="button" class="add__chip" data-group="${g.id}" aria-pressed="${i === 0}">${g.label}</button>`).join('')}</div>
      <div class="add__grid add__emoji"></div></section>
    <section class="add__sec" aria-labelledby="add-h-music"><h3 id="add-h-music">Música</h3>
      <button type="button" class="add__import" data-music-import>Importar música</button>
      <input class="add__file" type="file" multiple accept="audio/*" hidden aria-label="Elegir archivos de audio">
      <p class="add__hint">Elige canciones o audios de tu dispositivo (MP3, M4A, WAV). Se añaden donde está el cursor.</p>
      <ul class="add__tracks" aria-label="Música del proyecto"></ul></section>
    <section class="add__sec" aria-labelledby="add-h-sfx"><h3 id="add-h-sfx">Sonidos</h3>
      <div class="add__chips" role="group" aria-label="Efectos de sonido">${SFX.map((s) => `<button type="button" class="add__chip" data-sfx="${s.id}">${s.label}</button>`).join('')}</div></section>
    <div class="add__status" role="status" aria-live="polite"></div>`;
  const status = root.querySelector('.add__status');
  const emojiGrid = root.querySelector('.add__emoji');
  const tracks = root.querySelector('.add__tracks');
  const fileInput = root.querySelector('.add__file');
  const say = (message) => { status.textContent = ''; status.textContent = message; };
  const report = (result) => { if (!result.ok) say(result.error?.message ?? result.message ?? 'No se pudo añadir'); return result; };

  /** Medio ya importado con ese nombre, o el resultado de crearlo e importarlo (una sola vez aunque se pulse dos veces). */
  function ensureAsset(name, make) {
    const existing = Object.values(store.getProject().assets).find((a) => a.name === name);
    if (existing) return Promise.resolve(existing.id);
    if (pending.has(name)) return pending.get(name);
    const job = (async () => {
      const { added, rejected } = await library.importFiles([await make()]);
      if (!added.length) throw new Error(rejected[0]?.message ?? 'No se pudo importar');
      return added[0].id;
    })().finally(() => pending.delete(name));
    pending.set(name, job);
    return job;
  }

  const stickerAsset = (id) => ensureAsset(`sticker-${id}.png`, async () => {
    const blob = await rasterizeSticker(STICKERS.find((s) => s.id === id), 512, doc);
    return new File([blob], `sticker-${id}.png`, { type: 'image/png' });
  });
  const sfxAsset = (id) => ensureAsset(`sfx-${id}.wav`, () => sfxFile(SFX.find((s) => s.id === id)));

  function showGroup(id) {
    const group = EMOJI_GROUPS.find((g) => g.id === id) ?? EMOJI_GROUPS[0];
    for (const chip of root.querySelectorAll('[data-group]')) chip.setAttribute('aria-pressed', String(chip.dataset.group === group.id));
    emojiGrid.innerHTML = group.emoji.map((e) => `<button type="button" class="add__tile add__tile--emoji" data-emoji="${e}" aria-label="Emoji ${e}">${e}</button>`).join('');
  }
  showGroup(EMOJI_GROUPS[0].id);

  /** Audios del proyecto que no son efectos de sonido: son la música que el usuario ha importado. */
  const songs = () => Object.values(store.getProject().assets).filter((a) => a.kind === 'audio' && !a.name.startsWith('sfx-'));
  let shown = '';
  function renderTracks() {
    const list = songs();
    const key = list.map((a) => a.id).join();
    if (key === shown) return;
    shown = key;
    tracks.innerHTML = list.map((a) => `<li class="add__track"><span class="add__track-name" title="${esc(a.name)}">${esc(a.name)}</span><span class="add__track-time">${formatDuration(a.duration)}</span><button type="button" class="add__track-add" data-song="${a.id}" aria-label="Añadir ${esc(a.name)} a la línea de tiempo" title="Añadir a la línea de tiempo">+</button></li>`).join('');
  }
  renderTracks();
  const unsubscribe = store.subscribe(renderTracks);

  async function importMusic(files) {
    say('Importando…');
    const { added, rejected } = await library.importFiles(files);
    let at = store.getState().playhead;
    for (const asset of added) {
      const result = addAudioClip(store, asset.id, { at });
      if (result.ok) at += asset.duration;
    }
    if (added.length) say(`${added.length === 1 ? 'Música añadida' : `${added.length} audios añadidos`}.`);
    if (rejected.length) say(rejected[0].message);
  }
  fileInput.addEventListener('change', async () => {
    const files = [...fileInput.files];
    fileInput.value = '';
    if (files.length) await importMusic(files).catch((error) => say(error.message));
  }, { signal: abort.signal });

  root.addEventListener('click', async (e) => {
    const button = e.target.closest('button');
    if (!button) return;
    if ('musicImport' in button.dataset) { fileInput.click(); return; }
    if (button.dataset.group) { showGroup(button.dataset.group); return; }
    if (button.dataset.song) { report(addAudioClip(store, button.dataset.song)); return; }
    const { style, sticker, emoji, sfx } = button.dataset;
    if (style) report(addStyledText(store, TEXT_STYLES.find((s) => s.id === style).text, 'Texto'));
    else if (emoji) report(addEmojiClip(store, emoji));
    else if (sticker) {
      try { report(addOverlayAsset(store, await stickerAsset(sticker))); } catch (error) { say(error.message); }
    } else if (sfx) {
      try { report(addAudioClip(store, await sfxAsset(sfx))); } catch (error) { say(error.message); }
    }
  }, { signal: abort.signal });

  return { destroy() { abort.abort(); unsubscribe(); root.replaceChildren(); root.classList.remove('add'); } };
}
