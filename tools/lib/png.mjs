// The size of a PNG image (its header), so a sprite sheet can be checked without decoding it.
export function pngSize(buf) {
  if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG image');
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}
