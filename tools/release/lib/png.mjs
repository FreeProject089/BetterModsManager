// A minimal PNG decoder (8-bit RGB / RGBA / grey / grey+alpha, non-interlaced), enough to
// read back what headless Chrome writes, so layers can be packed into a PSD with no
// dependency. Returns { width, height, data: Uint8Array RGBA }.

import { inflateSync } from 'node:zlib';

const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function decodePng(buf) {
  buf = Buffer.from(buf);
  if (!buf.subarray(0, 8).equals(SIG)) throw new Error('not a PNG');
  let pos = 8, w = 0, h = 0, depth = 0, type = 0, interlace = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const kind = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (kind === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); depth = data[8]; type = data[9]; interlace = data[12]; }
    else if (kind === 'IDAT') idat.push(data);
    else if (kind === 'IEND') break;
    pos += 12 + len;
  }
  if (depth !== 8 || interlace !== 0) throw new Error(`unsupported PNG (depth ${depth}, interlace ${interlace})`);
  const bpp = { 6: 4, 2: 3, 0: 1, 4: 2 }[type];
  if (!bpp) throw new Error(`unsupported PNG colour type ${type}`);
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * bpp;
  const px = new Uint8Array(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    const src = y * (stride + 1) + 1, dst = y * stride, prev = dst - stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? px[dst + x - bpp] : 0;
      const b = y > 0 ? px[prev + x] : 0;
      const cc = y > 0 && x >= bpp ? px[prev + x - bpp] : 0;
      let v = raw[src + x];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const p = a + b - cc, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - cc); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : cc; }
      px[dst + x] = v & 255;
    }
  }
  if (bpp === 4) return { width: w, height: h, data: px };
  const out = new Uint8Array(w * h * 4);
  for (let i = 0, j = 0; i < w * h; i++) {
    if (bpp === 3) { out[j++] = px[i * 3]; out[j++] = px[i * 3 + 1]; out[j++] = px[i * 3 + 2]; out[j++] = 255; }
    else if (bpp === 1) { out[j++] = px[i]; out[j++] = px[i]; out[j++] = px[i]; out[j++] = 255; }
    else { out[j++] = px[i * 2]; out[j++] = px[i * 2]; out[j++] = px[i * 2]; out[j++] = px[i * 2 + 1]; }
  }
  return { width: w, height: h, data: out };
}
