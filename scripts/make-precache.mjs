// Calcula la lista de archivos que el service worker guarda y una versión derivada de su contenido.
// Uso: node scripts/make-precache.mjs  (escribe precache.json; `--check` falla si está desfasado)
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const walk = (d) => readdirSync(join(root, d)).flatMap((n) => {
  const p = join(d, n);
  return statSync(join(root, p)).isDirectory() ? walk(p) : [p];
});
const KEEP = /\.(js|mjs|css|woff2|png|svg|webmanifest|html)$/;

export function buildPrecache() {
  const files = ['index.html', 'manifest.webmanifest', ...['src', 'assets', 'vendor', 'icons'].flatMap(walk)]
    .map((f) => relative('.', f).split('\\').join('/'))
    .filter((f) => KEEP.test(f)).sort();
  const hash = createHash('sha256');
  for (const f of files) hash.update(f).update(readFileSync(join(root, f)));
  return { version: hash.digest('hex').slice(0, 12), files };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const precache = buildPrecache();
  const files = {
    'precache.json': `${JSON.stringify(precache, null, 2)}\n`,
    'sw.js': readFileSync(join(root, 'sw.js'), 'utf8').replace(/const BUILD = '[^']*';/, `const BUILD = '${precache.version}';`),
  };
  const stale = Object.entries(files).filter(([name, text]) => { try { return readFileSync(join(root, name), 'utf8') !== text; } catch { return true; } });
  if (process.argv.includes('--check')) {
    if (stale.length) { console.error(`Desfasado: ${stale.map(([n]) => n).join(', ')}. Ejecuta \`npm run precache\`.`); process.exit(1); }
  } else for (const [name, text] of stale) writeFileSync(join(root, name), text);
}
