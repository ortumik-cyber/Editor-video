import { newId } from '../core/ids.js';
import { createProject } from '../core/project.js';
import { projectDuration } from '../core/selectors.js';

/**
 * Gestor de proyectos sobre el repositorio. Los medios se guardan por identificador de medio, y un proyecto
 * duplicado comparte los archivos del original: al borrar, solo se eliminan los medios que ningún otro
 * proyecto sigue usando.
 */
export function createProjectManager({ repo }) {
  const assetIds = (project) => Object.keys(project.assets);

  /** Medios que usa algún proyecto, salvo `exceptId`. */
  async function liveAssetIds(exceptId = null) {
    const live = new Set();
    for (const project of await repo.loadAll()) if (project.id !== exceptId) assetIds(project).forEach((id) => live.add(id));
    return live;
  }

  /** Primer medio visual en el orden de la línea de tiempo: sirve de portada. */
  function coverAssetId(project) {
    const first = Object.values(project.clips)
      .filter((c) => (c.kind === 'video' || c.kind === 'image') && project.assets[c.assetId]?.hasThumb)
      .sort((a, b) => a.start - b.start)[0];
    return first?.assetId ?? null;
  }

  return {
    liveAssetIds,

    /** Resumen de cada proyecto, el último editado primero. */
    async list() {
      const rows = await repo.list();
      const out = [];
      for (const { id, updatedAt } of rows) {
        const project = await repo.load(id);
        if (!project) continue;
        out.push({
          id, name: project.name, updatedAt, aspect: project.settings.aspect,
          duration: projectDuration(project), clips: Object.keys(project.clips).length, coverAssetId: coverAssetId(project),
        });
      }
      return out.sort((a, b) => b.updatedAt - a.updatedAt);
    },

    async create({ name = 'Proyecto sin título', aspect = '9:16', fps = 30 } = {}) {
      const project = createProject({ name: name.trim() || 'Proyecto sin título', aspect, fps });
      await repo.save(project);
      return project;
    },

    open: (id) => repo.load(id),
    save: (project) => repo.save(project),

    async rename(id, name) {
      const clean = name.trim();
      if (!clean) throw new Error('El nombre no puede estar vacío');
      const project = await repo.load(id);
      if (!project) throw new Error('Proyecto inexistente');
      await repo.save({ ...project, name: clean.slice(0, 80) });
    },

    /** Copia el proyecto con un identificador nuevo. Comparte los archivos de medios. */
    async duplicate(id) {
      const project = await repo.load(id);
      if (!project) throw new Error('Proyecto inexistente');
      const copy = { ...structuredClone(project), id: newId('prj'), name: `Copia de ${project.name}`.slice(0, 80) };
      await repo.save(copy);
      return copy;
    },

    /** Borra el proyecto y los medios que nadie más usa. Devuelve cuántos archivos eliminó. */
    async remove(id) {
      const project = await repo.load(id);
      if (!project) return 0;
      await repo.deleteProject(id);
      const live = await liveAssetIds();
      let removed = 0;
      for (const assetId of assetIds(project)) {
        if (live.has(assetId)) continue;
        await repo.removeMedia(assetId);
        await repo.removeMedia(`${assetId}:thumb`);
        removed++;
      }
      return removed;
    },
  };
}

/** Ruta de la app a partir de la parte `#...` de la URL. */
export function parseRoute(hash) {
  const m = /^#\/p\/([\w-]+)$/.exec(hash ?? '');
  return m ? { name: 'editor', id: m[1] } : { name: 'home' };
}

export const routeHash = (route) => (route.name === 'editor' ? `#/p/${route.id}` : '#/');

/** "hace 5 min", "ayer"... para la lista de proyectos. */
export function relativeTime(timestamp, now = Date.now()) {
  const s = Math.max(0, Math.round((now - timestamp) / 1000));
  if (s < 60) return 'ahora mismo';
  const m = Math.floor(s / 60);
  if (m < 60) return `hace ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.floor(h / 24);
  if (d === 1) return 'ayer';
  if (d < 30) return `hace ${d} días`;
  return new Date(timestamp).toLocaleDateString('es', { day: 'numeric', month: 'short', year: 'numeric' });
}
