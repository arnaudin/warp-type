/**
 * Downloads the display faces Warp Type bakes into its core, straight from the
 * upstream Google Fonts repository, together with their licenses.
 *
 * The results are committed under fonts/, so this only needs re-running when a
 * face is added or upstream ships a revision. Nothing here runs at plugin time —
 * the plugin itself never touches the network.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FACES } from './faces.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RAW = 'https://raw.githubusercontent.com/google/fonts/main';

async function download(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} — ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, buf);
  return buf.length;
}

for (const face of FACES) {
  const dir = path.join(root, 'fonts', face.dir);
  const ttf = await download(`${RAW}/${face.upstream}`, path.join(dir, path.basename(face.upstream)));
  const licenseName = path.basename(face.license);
  const lic = await download(`${RAW}/${face.license}`, path.join(dir, licenseName));
  fs.writeFileSync(
    path.join(dir, 'SOURCE.txt'),
    `${face.source} (${face.licenseName})\n${RAW}/${face.upstream}\n` +
      `unmodified original; the derived subset lives in src/core/fonts/${face.id}.ts\n` +
      (face.renamed ? `presented in this plugin as "${face.name}" (reserved font name)\n` : ''),
  );
  console.log(`${face.source.padEnd(14)} ttf ${String(ttf).padStart(8)}B · ${licenseName} ${lic}B`);
}

console.log('\nfonts fetched → fonts/<id>/ · next: node scripts/bake-fonts.mjs');
