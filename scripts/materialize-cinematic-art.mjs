import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const source = resolve('src/pages/chargeurs-cinematic-home.b64');
const target = resolve('public/cinematic-home.jpg');

const raw = await readFile(source, 'utf8');
const clean = raw.replace(/\s+/g, '');
const bytes = Buffer.from(clean, 'base64');

if (bytes.length < 1024) {
  throw new Error(`Cinematic artwork decode produced only ${bytes.length} bytes`);
}
if (bytes[0] !== 0xff || bytes[1] !== 0xd8) {
  throw new Error('Cinematic artwork is not a valid JPEG payload');
}

await mkdir(dirname(target), { recursive: true });
await writeFile(target, bytes);
console.log(`[cinematic-art] wrote ${bytes.length} bytes to ${target}`);
