import { autosave } from '../core/persist.js';
import { createStore } from '../core/store.js';
import { createInspector } from '../effects/panel.js';
import { createExportPanel } from '../export/panel.js';
import { createDomAdapters } from '../library/dom.js';
import { createLibrary } from '../library/library.js';
import { createPreview } from '../player/preview.js';
import { createAddPanel } from '../text/picker.js';
import { createTimeline } from '../timeline/timeline.js';
import { askConfirm, askText } from '../ui/dialog.js';
import { icon } from '../ui/icons.js';
import { createMediaPanel } from './media-panel.js';
import { createProjectPanel } from './project-panel.js';

const TABS = [
  { id: 'media', label: 'Medios', icon: 'film' },
  { id: 'add', label: 'Añadir', icon: 'plus' },
  { id: 'edit', label: 'Editar', icon: 'sliders' },
  { id: 'project', label: 'Proyecto', icon: 'frame' },
];
const TITLES = { media: 'Medios', add: 'Añadir', edit: 'Editar', project: 'Proyecto', export: 'Exportar' };
const WIDE = '(min-width: 960px)';

/**
 * Pantalla del editor. En móvil el cajón de herramientas ocupa el sitio de la línea de tiempo, de modo que la
 * vista previa mide siempre lo mismo; en pantalla ancha el panel va al lado y la línea de tiempo debajo.
 * Todos los paneles quedan montados: cambiar de pestaña no pierde su estado.
 */
export async function mountEditor(root, { project, repo, manager, navigate, toaster, doc = root.ownerDocument }) {
  const store = createStore(project);
  const library = createLibrary({ store, repo, adapters: createDomAdapters({ document: doc }) });
  await library.collectGarbage(await manager.liveAssetIds(project.id));
  const saver = autosave(store, repo, { delay: 500 });
  const abort = new AbortController();
  const on = (target, type, fn, options) => target.addEventListener(type, fn, { ...options, signal: abort.signal });
  const say = (message) => toaster.show(message);

  root.innerHTML = `
    <div class="editor" data-tab="">
      <header class="ed__top">
        <button type="button" class="ed__icon" data-act="back" aria-label="Volver a mis proyectos">${icon('back')}</button>
        <button type="button" class="ed__title" data-act="rename"></button>
        <span class="ed__spacer"></span>
        <button type="button" class="ed__icon" data-act="undo" aria-label="Deshacer (Ctrl+Z)" title="Deshacer (Ctrl+Z)">${icon('undo')}</button>
        <button type="button" class="ed__icon" data-act="redo" aria-label="Rehacer (Ctrl+Mayús+Z)" title="Rehacer (Ctrl+Mayús+Z)">${icon('redo')}</button>
        <button type="button" class="ed__export" data-act="export">${icon('download')}<span>Exportar</span></button>
      </header>
      <main class="ed__preview" id="ed-preview" aria-label="Vista previa"></main>
      <section class="ed__timeline" id="ed-timeline" aria-label="Línea de tiempo"></section>
      <div class="ed__side">
        <section class="ed__drawer" aria-labelledby="ed-drawer-title">
          <div class="ed__drawer-head"><h2 id="ed-drawer-title"></h2><button type="button" class="ed__icon" data-act="close" aria-label="Cerrar las herramientas">${icon('close')}</button></div>
          <div class="ed__panels">
            ${[...TABS.map((t) => t.id), 'export'].map((id) => `<div class="ed__panel" id="panel-${id}" role="tabpanel" data-panel="${id}" hidden></div>`).join('')}
          </div>
        </section>
        <nav class="ed__tabs" role="tablist" aria-label="Herramientas">
          ${TABS.map((t) => `<button type="button" class="ed__tab" role="tab" id="tab-${t.id}" data-tab="${t.id}" aria-controls="panel-${t.id}" aria-selected="false">${icon(t.icon)}<span>${t.label}</span></button>`).join('')}
        </nav>
      </div>
    </div>`;
  const $ = (sel) => root.querySelector(sel);
  const editor = $('.editor');
  const panel = (id) => $(`[data-panel="${id}"]`);
  const title = $('.ed__title');
  const wide = doc.defaultView.matchMedia(WIDE);

  // ---------- componentes ----------
  let tab = '';
  const setTab = (next) => {
    tab = next;
    editor.dataset.tab = tab;
    $('#ed-drawer-title').textContent = TITLES[tab] ?? '';
    for (const el of root.querySelectorAll('[data-panel]')) el.hidden = el.dataset.panel !== tab;
    for (const el of root.querySelectorAll('[role="tab"]')) el.setAttribute('aria-selected', String(el.dataset.tab === tab));
  };
  const focusTextBox = () => requestAnimationFrame(() => doc.getElementById('ins-t-content')?.focus());

  const preview = createPreview($('#ed-preview'), {
    store, library,
    onMessage: say,
    onEditText: () => { setTab('edit'); focusTextBox(); },
  });
  const timeline = createTimeline($('#ed-timeline'), { store, library });
  preview.player.subscribe(({ playing }) => { timeline.follow = playing; });
  const components = [
    createMediaPanel(panel('media'), { store, library, onMessage: say }),
    createAddPanel(panel('add'), { store, library }),
    createInspector(panel('edit'), { store }),
    createProjectPanel(panel('project'), {
      store, onMessage: say,
      onDelete: async () => {
        const ok = await askConfirm({ title: 'Eliminar proyecto', message: `«${store.getProject().name}» se eliminará con todos sus medios. No se puede deshacer.`, confirm: 'Eliminar', danger: true, doc });
        if (!ok) return;
        await saver();
        await manager.remove(store.getProject().id);
        navigate('#/');
      },
    }),
    createExportPanel(panel('export'), { store, library, player: preview.player, onMessage: say }),
  ];
  const mediaPanel = components[0];

  // ---------- barra superior ----------
  function syncTop() {
    const name = store.getProject().name;
    title.textContent = name;
    title.setAttribute('aria-label', `Nombre del proyecto: ${name}. Pulsa para cambiarlo`);
    doc.title = `${name} · Editor de vídeo`;
    $('[data-act="undo"]').disabled = !store.canUndo();
    $('[data-act="redo"]').disabled = !store.canRedo();
    $('#tab-edit').toggleAttribute('data-badge', store.getState().selection.length > 0);
  }
  const unsubscribe = store.subscribe(syncTop);
  syncTop();

  const goBack = async () => { await saver.flush(); navigate('#/'); };
  on(root, 'click', async (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    const tabButton = e.target.closest('[data-tab].ed__tab');
    if (tabButton) { setTab(!wide.matches && tab === tabButton.dataset.tab ? '' : tabButton.dataset.tab); return; }
    if (act === 'back') await goBack();
    else if (act === 'undo') store.undo();
    else if (act === 'redo') store.redo();
    else if (act === 'export') setTab('export');
    else if (act === 'close') setTab(wide.matches ? 'media' : '');
    else if (act === 'rename') {
      const name = await askText({ title: 'Nombre del proyecto', label: 'Nombre', value: store.getProject().name, confirm: 'Guardar', doc });
      if (name?.trim()) store.dispatch({ type: 'project/rename', name });
    }
  });

  // En pantalla ancha siempre hay una pestaña abierta; en móvil, ninguna hasta que se elige.
  const adapt = () => { if (wide.matches && !tab) setTab('media'); else if (wide.matches && tab === '' ) setTab('media'); };
  setTab(wide.matches ? 'media' : '');
  wide.addEventListener('change', adapt, { signal: abort.signal });

  // ---------- atajos globales (los de la línea de tiempo ya se ocuparon si el foco estaba allí) ----------
  on(doc, 'keydown', (e) => {
    if (e.defaultPrevented || e.target.closest?.('input, textarea, select, [contenteditable="true"], dialog')) return;
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    if (mod && key === 'z') { e.preventDefault(); if (e.shiftKey) store.redo(); else store.undo(); }
    else if (mod && key === 'y') { e.preventDefault(); store.redo(); }
  });

  // ---------- guardado y arrastrar archivos ----------
  const flush = () => { saver.flush().catch(() => {}); };
  on(doc, 'visibilitychange', () => { if (doc.visibilityState === 'hidden') flush(); });
  on(doc.defaultView, 'pagehide', flush);
  on(editor, 'dragover', (e) => { if (e.dataTransfer?.types?.includes('Files')) e.preventDefault(); });
  on(editor, 'drop', (e) => {
    if (!e.dataTransfer?.files?.length) return;
    e.preventDefault();
    mediaPanel.importFiles(e.dataTransfer.files);
    if (!wide.matches) setTab('media');
  });

  return {
    store, library, preview, timeline,
    async destroy() {
      abort.abort();
      unsubscribe();
      await saver();
      for (const c of components) c.destroy();
      timeline.destroy();
      preview.destroy();
      library.dispose();
      root.replaceChildren();
    },
  };
}
