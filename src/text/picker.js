import { SFX, sfxFile } from '../audio/sfx.js';
import { addAudioClip, addEmojiClip, addOverlayAsset, addStyledText } from '../timeline/actions.js';
import { EMOJI, STICKERS, TEXT_STYLES, rasterizeSticker } from './stickers.js';

/**
 * Panel para añadir texto (con estilos de partida), stickers, emoji y efectos de sonido.
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
      <div class="add__grid">${EMOJI.map((e) => `<button type="button" class="add__tile add__tile--emoji" data-emoji="${e}" aria-label="Emoji ${e}">${e}</button>`).join('')}</div></section>
    <section class="add__sec" aria-labelledby="add-h-sfx"><h3 id="add-h-sfx">Sonidos</h3>
      <div class="add__chips" role="group" aria-label="Efectos de sonido">${SFX.map((s) => `<button type="button" class="add__chip" data-sfx="${s.id}">${s.label}</button>`).join('')}</div></section>
    <div class="add__status" role="status" aria-live="polite"></div>`;
  const status = root.querySelector('.add__status');
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

  root.addEventListener('click', async (e) => {
    const button = e.target.closest('button');
    if (!button) return;
    const { style, sticker, emoji, sfx } = button.dataset;
    if (style) report(addStyledText(store, TEXT_STYLES.find((s) => s.id === style).text, 'Texto'));
    else if (emoji) report(addEmojiClip(store, emoji));
    else if (sticker) {
      try { report(addOverlayAsset(store, await stickerAsset(sticker))); } catch (error) { say(error.message); }
    } else if (sfx) {
      try { report(addAudioClip(store, await sfxAsset(sfx))); } catch (error) { say(error.message); }
    }
  }, { signal: abort.signal });

  return { destroy() { abort.abort(); root.replaceChildren(); root.classList.remove('add'); } };
}
