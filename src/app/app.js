import { createIndexedDbBackend, createRepo } from '../core/persist.js';
import { createToaster } from '../ui/dialog.js';
import { mountEditor } from './editor.js';
import { mountHome } from './home.js';
import { createProjectManager, parseRoute } from './projects.js';

/** Arranque: repositorio en IndexedDB, rutas por hash y las dos pantallas. */
export function startApp({ root = document.getElementById('app'), dbName = 'editor-video' } = {}) {
  const repo = createRepo(createIndexedDbBackend(dbName));
  const manager = createProjectManager({ repo });
  const toaster = createToaster(document);
  let current = null;
  let sequence = 0;

  const navigate = (hash) => { if (location.hash === hash) route(); else location.hash = hash; };

  async function route() {
    const mine = ++sequence;
    const previous = current;
    current = null;
    await previous?.destroy();
    if (mine !== sequence) return;
    const target = parseRoute(location.hash);
    const deps = { repo, manager, navigate, toaster, doc: document };
    let mounted;
    if (target.name === 'editor') {
      const project = await manager.open(target.id);
      if (mine !== sequence) return;
      if (!project) { toaster.show('Ese proyecto ya no existe.'); navigate('#/'); return; }
      mounted = await mountEditor(root, { ...deps, project });
    } else {
      mounted = await mountHome(root, deps);
    }
    if (mine !== sequence) { await mounted.destroy(); return; }
    current = mounted;
    root.dataset.screen = target.name;
    root.dataset.ready = 'true';
    if (target.name === 'home') root.querySelector('h1')?.focus({ preventScroll: true });
  }

  window.addEventListener('hashchange', route);
  route();
  return { repo, manager, route, get editor() { return current; } };
}

if (document.getElementById('app') && !window.__noAutoStart) window.editorApp = startApp();
