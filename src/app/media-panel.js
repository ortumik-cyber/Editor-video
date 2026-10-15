import { formatDuration } from '../library/kinds.js';
import { addAssetClip, addOverlayAsset } from '../timeline/actions.js';
import { askConfirm } from '../ui/dialog.js';
import { icon } from '../ui/icons.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const KIND_LABEL = { video: 'Vídeo', image: 'Imagen', audio: 'Audio' };

/** Pestaña «Medios»: importar y ver los archivos del proyecto, añadirlos a la línea de tiempo o quitarlos. */
export function createMediaPanel(root, { store, library, onMessage, doc = root.ownerDocument }) {
  const abort = new AbortController();
  const on = (target, type, fn) => target.addEventListener(type, fn, { signal: abort.signal });
  let shown = '';
  let token = 0;

  root.classList.add('media');
  root.innerHTML = `
    <div class="media__bar">
      <button type="button" class="media__import" data-act="import">${icon('plus')}<span>Importar</span></button>
      <input class="media__file" type="file" multiple accept="video/*,image/*,audio/*" hidden aria-label="Elegir archivos">
    </div>
    <p class="media__hint">Tus archivos se quedan en este dispositivo.</p>
    <p class="media__status" role="status" aria-live="polite"></p>
    <ul class="media__grid"></ul>
    <p class="media__empty">Aún no hay medios. Importa vídeos, fotos o música.</p>`;
  const input = root.querySelector('.media__file');
  const grid = root.querySelector('.media__grid');
  const empty = root.querySelector('.media__empty');
  const status = root.querySelector('.media__status');

  async function importFiles(files) {
    const list = [...files];
    if (!list.length) return;
    const { added, rejected } = await library.importFiles(list, {
      onProgress: ({ index, total, name }) => { status.textContent = name ? `Importando ${index + 1} de ${total}: ${name}` : ''; },
    });
    status.textContent = '';
    if (rejected.length) onMessage?.(rejected.map((r) => r.message).join(' '));
    else if (added.length) onMessage?.(added.length === 1 ? `Importado: ${added[0].name}` : `${added.length} archivos importados`);
  }

  function render() {
    const project = store.getProject();
    const assets = Object.values(project.assets);
    const key = assets.map((a) => a.id).join(',');
    if (key === shown) return;
    shown = key;
    const mine = ++token;
    empty.hidden = assets.length > 0;
    grid.replaceChildren(...assets.map((a) => {
      const li = doc.createElement('li');
      li.className = 'media__tile';
      li.dataset.assetId = a.id;
      const visual = a.kind !== 'audio';
      const meta = a.kind === 'image' ? KIND_LABEL.image : `${KIND_LABEL[a.kind]} · ${formatDuration(a.duration)}`;
      li.innerHTML = `
        <div class="media__thumb">${a.hasThumb ? '<img alt="">' : `<span class="media__glyph">${icon(a.kind === 'audio' ? 'volume' : 'film')}</span>`}</div>
        <div class="media__name" title="${esc(a.name)}">${esc(a.name)}</div>
        <div class="media__meta">${meta}</div>
        <div class="media__actions">
          <button type="button" class="media__btn" data-act="add" aria-label="Añadir ${esc(a.name)} a la línea de tiempo" title="Añadir a la línea de tiempo">${icon('plus')}</button>
          ${visual ? `<button type="button" class="media__btn" data-act="layer" aria-label="Superponer ${esc(a.name)} como capa" title="Superponer como capa">${icon('layer')}</button>` : ''}
          <button type="button" class="media__btn" data-act="remove" aria-label="Quitar ${esc(a.name)} del proyecto" title="Quitar del proyecto">${icon('trash')}</button>
        </div>`;
      if (a.hasThumb) library.getThumbUrl(a.id).then((url) => { if (url && mine === token) li.querySelector('img').src = url; });
      return li;
    }));
  }

  on(root, 'click', async (e) => {
    const button = e.target.closest('button[data-act]');
    if (!button) return;
    if (button.dataset.act === 'import') { input.click(); return; }
    const id = button.closest('[data-asset-id]').dataset.assetId;
    const asset = store.getProject().assets[id];
    if (button.dataset.act === 'add') { const r = addAssetClip(store, id); if (!r.ok) onMessage?.(r.error.message); else onMessage?.(`Añadido: ${asset.name}`); }
    else if (button.dataset.act === 'layer') { const r = addOverlayAsset(store, id); if (!r.ok) onMessage?.(r.error.message); }
    else if (button.dataset.act === 'remove') {
      const used = Object.values(store.getProject().clips).filter((c) => c.assetId === id).length;
      const ok = await askConfirm({
        title: 'Quitar del proyecto', danger: true, confirm: 'Quitar', doc,
        message: used ? `«${asset.name}» se quitará del proyecto junto con ${used === 1 ? 'su clip' : `sus ${used} clips`}. Podrás deshacerlo.` : `«${asset.name}» se quitará del proyecto.`,
      });
      if (ok) library.removeAsset(id);
    }
  });
  on(input, 'change', async () => { await importFiles(input.files); input.value = ''; });

  const unsubscribe = store.subscribe((_, meta) => { if (meta.type !== 'playhead' && meta.type !== 'select') render(); });
  render();
  return { importFiles, destroy() { abort.abort(); unsubscribe(); root.replaceChildren(); root.classList.remove('media'); } };
}
