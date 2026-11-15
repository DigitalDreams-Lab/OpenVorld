// Exercise the real client modules in Node without a DOM or a Phaser/WebGL boot.
import fs from 'node:fs';
import { transformWithOxc } from 'vite';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const encoded = source => 'data:text/javascript;base64,' + Buffer.from(source).toString('base64');
export async function clientModuleUrl(file, replacements = {}) {
  const absolute = path.resolve(file);
  const source = fs.readFileSync(absolute, 'utf8').replace(/from (['"])([^'"]+)\1/g, (whole, quote, spec) => {
    if (replacements[spec]) return `from ${JSON.stringify(replacements[spec])}`;
    if (spec.startsWith('.')) return `from ${JSON.stringify(pathToFileURL(path.resolve(path.dirname(absolute), spec)).href)}`;
    return whole;
  });
  return encoded((await transformWithOxc(source, absolute)).code);
}
/** `fresh`: a new module instance (its own top-level state), not the cached one. */
export async function clientModule(file, replacements = {}, fresh = false) {
  let url = await clientModuleUrl(file, replacements);
  if (fresh) url = encoded(Buffer.from(url.slice(url.indexOf(',') + 1), 'base64').toString() + `\n// ${Math.random()}`);
  return import(url);
}
export const stubModule = encoded;
