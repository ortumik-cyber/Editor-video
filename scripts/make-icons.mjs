// Genera los PNG de icons/ desde los SVG con Chromium. Uso: node scripts/make-icons.mjs
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const { chromium } = createRequire(import.meta.url)(`${execSync('npm root -g').toString().trim()}/playwright`);
const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'icons');
const jobs = [['icon.svg', 'icon-192.png', 192], ['icon.svg', 'icon-512.png', 512], ['maskable.svg', 'maskable-512.png', 512], ['icon.svg', 'apple-touch-icon.png', 180]];
const browser = await chromium.launch();
const page = await browser.newPage();
for (const [src, out, size] of jobs) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<style>html,body{margin:0}svg{display:block;width:${size}px;height:${size}px}</style>${readFileSync(join(dir, src), 'utf8')}`);
  writeFileSync(join(dir, out), await page.screenshot({ type: 'png' }));
}
await browser.close();
