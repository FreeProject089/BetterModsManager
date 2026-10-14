// A small, dependency-free layered PSD writer (Photoshop format version 1, RGB, 8 bits,
// PackBits-compressed channels). Enough for « open in Photoshop and move the version text »:
// named raster layers with transparency, trimmed to their content, and a flattened composite.
//
// Layout (Adobe Photoshop File Formats Specification):
//   header · colour mode data (empty) · image resources (empty) ·
//   layer and mask information (layer records, then channel image data) · composite image.
//
// Layers are pixels, not live text: the layered SVG next to each PSD is the source to edit text in.

/** PackBits one row. */
export function packBits(row) {
  const out = [];
  let i = 0;
  const n = row.length;
  while (i < n) {
    let run = 1;
    while (i + run < n && run < 128 && row[i + run] === row[i]) run++;
    if (run >= 2) { out.push(257 - run, row[i]); i += run; continue; }
    let j = i;
    const lit = [];
    while (j < n && lit.length < 128) {
      if (j + 2 < n && row[j] === row[j + 1] && row[j] === row[j + 2]) break;
      lit.push(row[j]); j++;
    }
    out.push(lit.length - 1, ...lit);
    i = j;
  }
  return Uint8Array.from(out);
}

/** RLE-compress one plane (w×h bytes): [u16 compression=1][u16 counts × h][rows]. */
function rlePlane(plane, w, h, withHeader = true) {
  const rows = [];
  for (let y = 0; y < h; y++) rows.push(packBits(plane.subarray(y * w, (y + 1) * w)));
  // Keep every layer channel an even number of bytes. The spec does not pad channel data, and
  // Photoshop does not need it, but Pillow's reader skips a byte after an odd offset; an even
  // length suits both. The parity is flipped without padding: row 0 is re-packed as plain
  // literal packets, whose packet count (hence length) can be chosen.
  if (withHeader && w >= 2 && h > 0 && rows.reduce((a, r) => a + r.length, 0) % 2) {
    const row = plane.subarray(0, w);
    let p = Math.ceil(w / 128);
    if ((w + p) % 2 === rows[0].length % 2) p += 1;
    rows[0] = literalPack(row, p);
  }
  return { counts: rows.map((r) => r.length), rows, header: withHeader };
}

/** PackBits with literal packets only, split into exactly `p` packets (ceil(n/128) ≤ p ≤ n). */
export function literalPack(row, p) {
  const n = row.length;
  const out = [];
  let i = 0;
  for (let k = 0; k < p; k++) {
    const left = p - k - 1;                       // packets still to write after this one
    const size = Math.min(128, n - i - left);     // leave at least one byte per remaining packet
    out.push(size - 1, ...row.subarray(i, i + size));
    i += size;
  }
  return Uint8Array.from(out);
}

function planeOf(rgba, w, h, ch, box) {
  const bw = box.right - box.left, bh = box.bottom - box.top;
  const p = new Uint8Array(bw * bh);
  for (let y = 0; y < bh; y++) {
    const sy = (y + box.top) * w;
    for (let x = 0; x < bw; x++) p[y * bw + x] = rgba[(sy + x + box.left) * 4 + ch];
  }
  return p;
}

/** Bounding box of non-transparent pixels, or null. */
function contentBox(rgba, w, h) {
  let top = h, left = w, bottom = -1, right = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (rgba[(y * w + x) * 4 + 3]) { if (y < top) top = y; if (y > bottom) bottom = y; if (x < left) left = x; if (x > right) right = x; }
  }
  return bottom < 0 ? null : { top, left, bottom: bottom + 1, right: right + 1 };
}

class Out {
  constructor() { this.parts = []; this.len = 0; }
  bytes(b) { const x = Buffer.from(b); this.parts.push(x); this.len += x.length; }
  u8(v) { this.bytes([v & 255]); }
  u16(v) { const b = Buffer.alloc(2); b.writeUInt16BE(v & 0xffff); this.bytes(b); }
  i16(v) { const b = Buffer.alloc(2); b.writeInt16BE(v); this.bytes(b); }
  u32(v) { const b = Buffer.alloc(4); b.writeUInt32BE(v >>> 0); this.bytes(b); }
  i32(v) { const b = Buffer.alloc(4); b.writeInt32BE(v); this.bytes(b); }
  str(s) { this.bytes(Buffer.from(s, 'ascii')); }
  buf() { return Buffer.concat(this.parts); }
}

const writeRle = (o, r) => { if (r.header) o.u16(1); for (const n of r.counts) o.u16(n); for (const row of r.rows) o.bytes(row); };
const rleLen = (r) => (r.header ? 2 : 0) + r.counts.length * 2 + r.rows.reduce((a, b) => a + b.length, 0);

/** Pascal string padded so (length byte + text) is a multiple of `mult`. */
function pascal(name, mult) {
  const t = Buffer.from(String(name).replace(/[^\x20-\x7e]/g, '_').slice(0, 255), 'ascii');
  let total = 1 + t.length;
  while (total % mult) total++;
  const b = Buffer.alloc(total);
  b[0] = t.length; t.copy(b, 1);
  return b;
}

/** Unicode layer name ('luni' additional layer info). */
function luni(name) {
  const s = String(name);
  const body = Buffer.alloc(4 + s.length * 2 + (s.length % 2 ? 2 : 0));
  body.writeUInt32BE(s.length, 0);
  for (let i = 0; i < s.length; i++) body.writeUInt16BE(s.charCodeAt(i), 4 + i * 2);
  const o = new Out();
  o.str('8BIM'); o.str('luni'); o.u32(body.length); o.bytes(body);
  return o.buf();
}

/**
 * width, height; layers: [{ name, rgba (Uint8Array w*h*4, full canvas), hidden }] bottom → top;
 * composite: Uint8Array w*h*4 (alpha ignored: the composite is flattened on `matte`).
 * Returns a Buffer.
 */
export function writePsd({ width: w, height: h, layers, composite, matte = [255, 255, 255] }) {
  const o = new Out();
  // Header
  o.str('8BPS'); o.u16(1); o.bytes(Buffer.alloc(6)); o.u16(3); o.u32(h); o.u32(w); o.u16(8); o.u16(3);
  o.u32(0); // colour mode data
  o.u32(0); // image resources

  // Layer records + channel data
  const recs = new Out(), data = new Out();
  for (const L of layers) {
    const box = contentBox(L.rgba, w, h) ?? { top: 0, left: 0, bottom: 0, right: 0 };
    const bw = box.right - box.left, bh = box.bottom - box.top;
    // Declared (and stored) R, G, B, then alpha: Photoshop follows the declared order, and
    // Pillow's reader assumes this one.
    const chans = [[0, 0], [1, 1], [2, 2], [-1, 3]].map(([id, ch]) => {
      const r = bw && bh ? rlePlane(planeOf(L.rgba, w, h, ch, box), bw, bh) : { counts: [], rows: [], header: true };
      return { id, r };
    });
    recs.i32(box.top); recs.i32(box.left); recs.i32(box.bottom); recs.i32(box.right);
    recs.u16(4);
    for (const c of chans) { recs.i16(c.id); recs.u32(rleLen(c.r)); }
    recs.str('8BIM'); recs.str('norm'); recs.u8(L.opacity ?? 255); recs.u8(0);
    recs.u8((L.hidden ? 0x02 : 0x00) | 0x08); recs.u8(0);
    const name = pascal(L.name, 4), uni = luni(L.name);
    recs.u32(4 + 4 + name.length + uni.length);
    recs.u32(0); recs.u32(0); recs.bytes(name); recs.bytes(uni);
    for (const c of chans) writeRle(data, c.r);
  }
  const info = new Out();
  info.i16(layers.length);
  info.bytes(recs.buf()); info.bytes(data.buf());
  let infoBuf = info.buf();
  if (infoBuf.length % 2) infoBuf = Buffer.concat([infoBuf, Buffer.alloc(1)]);

  o.u32(4 + infoBuf.length + 4); // layer and mask information section
  o.u32(infoBuf.length); o.bytes(infoBuf);
  o.u32(0); // global layer mask info

  // Composite (flattened on matte), RLE: all row counts of all channels first, then the rows.
  const planes = [0, 1, 2].map((ch) => {
    const p = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) {
      const a = composite[i * 4 + 3] / 255;
      p[i] = Math.round(composite[i * 4 + ch] * a + matte[ch] * (1 - a));
    }
    return rlePlane(p, w, h, false);
  });
  o.u16(1);
  for (const r of planes) for (const n of r.counts) o.u16(n);
  for (const r of planes) for (const row of r.rows) o.bytes(row);
  return o.buf();
}
