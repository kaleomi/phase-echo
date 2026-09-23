import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = new URL('../', import.meta.url);
const dist = new URL('../dist/', import.meta.url);

await rm(dist, { recursive: true, force: true });
await mkdir(new URL('./vendor/addons/', dist), { recursive: true });

for (const dir of ['src', 'styles']) {
  await cp(new URL(`../${dir}/`, import.meta.url), new URL(`./${dir}/`, dist), { recursive: true });
}

await cp(
  new URL('../node_modules/three/build/three.module.js', import.meta.url),
  new URL('./vendor/three.module.js', dist),
);
await cp(
  new URL('../node_modules/three/examples/jsm/', import.meta.url),
  new URL('./vendor/addons/', dist),
  { recursive: true },
);

const sourceHtml = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const deployHtml = sourceHtml
  .replace('./node_modules/three/build/three.module.js', './vendor/three.module.js')
  .replace('./node_modules/three/examples/jsm/', './vendor/addons/');
await writeFile(new URL('./index.html', dist), deployHtml);

console.log(`Static site built at ${join(new URL('.', dist).pathname)}`);
