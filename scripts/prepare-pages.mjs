// Copies site/ into docs/ so GitHub Pages can serve it.
// GitHub Pages only deploys from the repo root or a /docs folder.
import { cp, rm, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(root, 'site');
const target = join(root, 'docs');

await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });
await cp(source, target, { recursive: true });
// .nojekyll stops GitHub Pages from running Jekyll (which would skip files/folders it dislikes).
await writeFile(join(target, '.nojekyll'), '');
console.log(`Copied ${source} -> ${target}`);
console.log('Now run: git add docs && git commit -m "Update Pages site" && git push');
