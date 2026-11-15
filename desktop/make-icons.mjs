// Deterministic PNG, ICO and ICNS versions of assets/icon.svg; no platform-specific tools needed.
import fs from 'node:fs';
import { deflateSync } from 'node:zlib';
const dir = new URL('./assets/', import.meta.url);
fs.mkdirSync(dir, { recursive: true });
const crc32 = data => {
  let crc = 0xffffffff;
  for (const byte of data) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
  return (crc ^ 0xffffffff) >>> 0;
};
function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type), data]), head = Buffer.alloc(4), tail = Buffer.alloc(4);
  head.writeUInt32BE(data.length); tail.writeUInt32BE(crc32(body)); return Buffer.concat([head, body, tail]);
}
function inside(x, y, polygon) {
  let hit = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [a, b] = polygon[i], [c, d] = polygon[j];
    if ((b > y) !== (d > y) && x < (c - a) * (y - b) / (d - b) + a) hit = !hit;
  }
  return hit;
}
function png(size) {
  const stride = size * 4 + 1, pixels = Buffer.alloc(stride * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const px = (x + 0.5) / size * 128, py = (y + 0.5) / size * 128;
    const cx = Math.max(28, Math.min(100, px)), cy = Math.max(28, Math.min(100, py));
    let color = Math.hypot(px - cx, py - cy) <= 28 ? [23, 28, 36, 255] : [0, 0, 0, 0];
    if (inside(px, py, [[24,36],[42,36],[64,82],[86,36],[104,36],[73,100],[55,100]])) color = [230, 185, 95, 255];
    if (Math.abs(px - 64) + Math.abs(py - 26) <= 10) color = [111, 211, 179, 255];
    pixels.set(color, y * stride + 1 + x * 4);
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(size); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
}
const large = png(1024), small = png(256);
fs.writeFileSync(new URL('icon.png', dir), large);
const ico = Buffer.alloc(22); ico.writeUInt16LE(1, 2); ico.writeUInt16LE(1, 4); ico.writeUInt16LE(1, 10); ico.writeUInt16LE(32, 12); ico.writeUInt32LE(small.length, 14); ico.writeUInt32LE(22, 18);
fs.writeFileSync(new URL('icon.ico', dir), Buffer.concat([ico, small]));
const icns = Buffer.alloc(16); icns.write('icns'); icns.writeUInt32BE(large.length + 16, 4); icns.write('ic10', 8); icns.writeUInt32BE(large.length + 8, 12);
fs.writeFileSync(new URL('icon.icns', dir), Buffer.concat([icns, large]));
console.log('Desktop icons generated.');
