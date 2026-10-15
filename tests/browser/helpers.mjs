// Utilidades de las pruebas en navegador. Requieren ffmpeg y Playwright global.
import { execSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from '../../scripts/serve.mjs';

const { chromium } = createRequire(import.meta.url)(`${execSync('npm root -g').toString().trim()}/playwright`);

/** Genera medios de prueba con ffmpeg y devuelve la carpeta. */
export function makeMedia() {
  const dir = mkdtempSync(join(tmpdir(), 'editor-video-media-'));
  const ff = (args) => execSync(`ffmpeg -loglevel error -y ${args}`, { cwd: dir });
  ff('-f lavfi -i testsrc=duration=3:size=640x360:rate=30 -f lavfi -i sine=frequency=440:duration=3 -c:v libvpx -c:a libopus -shortest con_audio.webm');
  ff('-f lavfi -i testsrc=duration=2:size=360x640:rate=30 -c:v libvpx sin_audio.webm');
  ff('-f lavfi -i sine=frequency=220:duration=4 musica.wav');
  ff('-f lavfi -i testsrc=size=1200x800 -frames:v 1 foto.png');
  ff('-f lavfi -i color=c=red:s=320x180:r=30:d=3 -f lavfi -i sine=frequency=440:duration=3 -c:v libvpx -c:a libopus -shortest rojo.webm');
  ff('-f lavfi -i color=c=green:s=200x200 -frames:v 1 verde.png');
  ff('-f lavfi -i color=c=red:s=200x200 -frames:v 1 rojo.png');
  ff('-f lavfi -i color=c=0x808080:s=200x200 -frames:v 1 gris.png');
  ff('-f lavfi -i color=c=red:s=50x100 -f lavfi -i color=c=green:s=50x100 -filter_complex hstack -frames:v 1 mitad.png');
  execSync('head -c 5000 /dev/urandom > roto.mp4 && : > vacio.mp4 && echo hola > notas.txt', { cwd: dir });
  return dir;
}

export async function launch(options = {}) {
  const server = await startServer(0);
  const browser = await chromium.launch({ args: options.args ?? [] });
  const { args: _args, ...contextOptions } = options;
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  return {
    page, errors, base: `http://localhost:${server.address().port}`,
    async close() { await browser.close(); server.close(); },
  };
}

/** Utilidades comunes para probar páginas con el editor: leer píxeles, esperar al dibujo y ejecutar en la página. */
export function pageTools(page) {
  const run = (fn, arg) => page.evaluate(fn, arg);
  return {
    run,
    px: (fx, fy) => run(([x, y]) => {
      const c = document.querySelector('.pv__canvas');
      return [...c.getContext('2d').getImageData(Math.floor(x * c.width), Math.floor(y * c.height), 1, 1).data].slice(0, 3);
    }, [fx, fy]),
    async settle(action) {
      const before = await run(() => player.stats.stills);
      await action();
      await page.waitForFunction((n) => player.stats.stills > n, before, { timeout: 8000 });
    },
    clipOf: (name) => run((n) => { const p = store.getProject(); return Object.values(p.clips).find((c) => p.assets[c.assetId]?.name === n); }, name),
  };
}
