// A tiny PNG codec (8-bit RGB or RGBA, not interlaced) for the art tools: no dependencies.
import zlib from 'node:zlib';

const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Decode an 8-bit RGBA, non-interlaced PNG to { width, height, data }. */
export function decodePng(buf) {
  if (!buf.subarray(0, 8).equals(SIG)) throw new Error('not a PNG');
  let at = 8, width = 0, height = 0, ctype = 6; const idat = [];
  while (at < buf.length) {
    const len = buf.readUInt32BE(at), type = buf.toString('ascii', at + 4, at + 8), body = buf.subarray(at + 8, at + 8 + len);
    if (type === 'IHDR') { width = body.readUInt32BE(0); height = body.readUInt32BE(4); ctype = body[9]; if (body[8] !== 8 || (ctype !== 6 && ctype !== 2) || body[12] !== 0) throw new Error('only 8-bit RGB or RGBA, non-interlaced PNGs are supported'); }
    else if (type === 'IDAT') idat.push(body);
    else if (type === 'IEND') break;
    at += 12 + len;
  }
  const bpp = ctype === 6 ? 4 : 3, rawStride = width * bpp, raw = zlib.inflateSync(Buffer.concat(idat)), stride = width * 4, data = Buffer.alloc(stride * height);
  const line = Buffer.alloc(rawStride), prevLine = Buffer.alloc(rawStride);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (rawStride + 1)], src = raw.subarray(y * (rawStride + 1) + 1, (y + 1) * (rawStride + 1)), row = line, prev = y ? prevLine : null;
    for (let i = 0; i < rawStride; i++) {
      const a = i >= bpp ? row[i - bpp] : 0, b = prev ? prev[i] : 0, c = prev && i >= bpp ? prev[i - bpp] : 0;
      let v = src[i];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      row[i] = v & 255;
    }
    for (let x = 0; x < width; x++) { data[y * stride + x * 4] = line[x * bpp]; data[y * stride + x * 4 + 1] = line[x * bpp + 1]; data[y * stride + x * 4 + 2] = line[x * bpp + 2]; data[y * stride + x * 4 + 3] = bpp === 4 ? line[x * bpp + 3] : 255; }
    line.copy(prevLine);
  }
  return { width, height, data };
}

const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (b) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, body) => { const t = Buffer.from(type, 'ascii'), out = Buffer.alloc(12 + body.length); out.writeUInt32BE(body.length, 0); t.copy(out, 4); body.copy(out, 8); out.writeUInt32BE(crc32(Buffer.concat([t, body])), 8 + body.length); return out; };
export function encodePng({ width, height, data }) {
  const stride = width * 4, raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) { raw[y * (stride + 1)] = 0; data.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([SIG, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
