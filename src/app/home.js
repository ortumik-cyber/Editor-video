import { ASPECTS } from '../core/project.js';
import { formatClock } from '../library/kinds.js';
import { askChoice, askConfirm, askNewProject, askText } from '../ui/dialog.js';
import { icon } from '../ui/icons.js';
import { ASPECT_LABELS } from './project-panel.js';
import { relativeTime } from './projects.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const ASPECT_CHOICES = Object.keys(ASPECTS).map((id) => ({ id, label: `${id} · ${ASPECT_LABELS[id]}`, w: ASPECTS[id].width, h: ASPECTS[id].height }));
const mb = (n) => (n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(1)} GB` : `${Math.max(1, Math.round(n / 1024 ** 2))} MB`);

/** Pantalla de proyectos: lista con portada, crear, abrir, renombrar, duplicar y borrar. */
export async function mountHome(root, { manager, repo, navigate, toaster, doc = root.ownerDocument }) {
  const urls = [];
  const abort = new AbortController();
  root.innerHTML = `
    <div class="home">
      <header class="home__top">
        <h1>Mis proyectos</h1>
        <button type="button" class="home__new" data-act="new">${icon('plus')}<span>Nuevo proyecto</span></button>
      </header>
      <main class="home__main">
        <ul class="home__grid" aria-label="Proyectos"></ul>
        <div class="home__empty" hidden>
          <h2>Empieza tu primer vídeo</h2>
          <p>Crea un proyecto, importa tus vídeos y fotos, y añade texto, música y efectos. Todo se queda en tu dispositivo.</p>
          <button type="button" class="home__new" data-act="new">${icon('plus')}<span>Nuevo proyecto</span></button>
        </div>
      </main>
      <footer class="home__foot"><p class="home__storage" role="status"></p></footer>
    </div>`;
  const grid = root.querySelector('.home__grid');
  const empty = root.querySelector('.home__empty');
  const storage = root.querySelector('.home__storage');
  doc.title = 'Mis proyectos · Editor de vídeo';

  async function renderStorage() {
    try {
      const { usage, quota } = await navigator.storage.estimate();
      const persisted = await navigator.storage.persisted?.();
      storage.textContent = `Almacenamiento: ${mb(usage)} usados de ${mb(quota)}.${persisted ? ' Tus proyectos están protegidos contra el borrado automático.' : ''}`;
    } catch { storage.textContent = ''; }
  }

  async function render() {
    urls.splice(0).forEach((u) => URL.revokeObjectURL(u));
    const list = await manager.list();
    empty.hidden = list.length > 0;
    grid.hidden = list.length === 0;
    grid.replaceChildren(...await Promise.all(list.map(async (p) => {
      const li = doc.createElement('li');
      li.className = 'card';
      li.dataset.projectId = p.id;
      let cover = '';
      if (p.coverAssetId) {
        const blob = await repo.getMedia(`${p.coverAssetId}:thumb`);
        if (blob) { const url = URL.createObjectURL(blob); urls.push(url); cover = `<img alt="" src="${url}">`; }
      }
      li.innerHTML = `
        <button type="button" class="card__open" data-act="open" aria-label="Abrir ${esc(p.name)}">
          <span class="card__cover">${cover || `<span class="card__ph">${icon('film')}</span>`}</span>
          <span class="card__name">${esc(p.name)}</span>
          <span class="card__meta">${formatClock(p.duration).replace(/\.\d$/, '')} · ${p.aspect} · ${relativeTime(p.updatedAt)}</span>
        </button>
        <button type="button" class="card__more" data-act="more" aria-label="Opciones de ${esc(p.name)}">${icon('more')}</button>`;
      return li;
    })));
    renderStorage();
  }

  async function newProject() {
    const result = await askNewProject({ aspects: ASPECT_CHOICES, doc });
    if (!result) return;
    const project = await manager.create({ name: result.name, aspect: result.aspect });
    navigator.storage?.persist?.().catch(() => {});
    navigate(`#/p/${project.id}`);
  }

  async function options(id) {
    const project = await manager.open(id);
    if (!project) return;
    const choice = await askChoice({
      title: project.name, doc,
      options: [{ id: 'rename', label: 'Cambiar nombre' }, { id: 'duplicate', label: 'Duplicar' }, { id: 'delete', label: 'Eliminar', danger: true }],
    });
    if (choice === 'rename') {
      const name = await askText({ title: 'Cambiar nombre', label: 'Nombre', value: project.name, confirm: 'Guardar', doc });
      if (name?.trim()) { await manager.rename(id, name); toaster.show('Nombre cambiado'); }
    } else if (choice === 'duplicate') {
      await manager.duplicate(id);
      toaster.show('Proyecto duplicado');
    } else if (choice === 'delete') {
      const ok = await askConfirm({ title: 'Eliminar proyecto', message: `«${project.name}» se eliminará con todos sus medios. No se puede deshacer.`, confirm: 'Eliminar', danger: true, doc });
      if (ok) { await manager.remove(id); toaster.show('Proyecto eliminado'); }
    }
    await render();
  }

  root.addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    const id = e.target.closest('[data-project-id]')?.dataset.projectId;
    if (act === 'new') newProject();
    else if (act === 'open' && id) navigate(`#/p/${id}`);
    else if (act === 'more' && id) options(id);
  }, { signal: abort.signal });

  await render();
  root.querySelector('h1').setAttribute('tabindex', '-1');
  return { destroy() { abort.abort(); urls.forEach((u) => URL.revokeObjectURL(u)); root.replaceChildren(); } };
}
