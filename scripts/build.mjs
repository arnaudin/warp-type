import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const r = (p) => path.join(root, p);

fs.mkdirSync(r('dist'), { recursive: true });

// 1. Plugin main thread (Figma sandbox)
await esbuild.build({
  entryPoints: [r('src/main.ts')],
  bundle: true,
  outfile: r('dist/code.js'),
  target: 'es2017',
  // Keep the bundled fonts' /*! @license */ headers: the notices have to travel
  // with the code that embeds their outlines.
  legalComments: 'eof',
  logLevel: 'error',
});

// 2. Plugin UI: bundle ui.ts and inline it into ui.html
const uiJs = await esbuild.build({
  entryPoints: [r('src/ui/ui.ts')],
  bundle: true,
  write: false,
  format: 'iife',
  target: 'es2017',
  legalComments: 'eof',
  logLevel: 'error',
});
const uiHtml = fs
  .readFileSync(r('src/ui/ui.html'), 'utf8')
  .replace('__UI_JS__', () => uiJs.outputFiles[0].text);
fs.writeFileSync(r('dist/ui.html'), uiHtml);

// 3. Core as a browser global for the dev gallery
await esbuild.build({
  entryPoints: [r('src/core/index.ts')],
  bundle: true,
  outfile: r('dist/core.iife.js'),
  format: 'iife',
  globalName: 'WarpTypeCore',
  target: 'es2017',
  logLevel: 'error',
});

console.log('build ok → dist/code.js, dist/ui.html, dist/core.iife.js');
