// A small, dependency-free layered PSD writer (Photoshop format version 1, RGB, 8 bits,
// PackBits-compressed channels). Enough for « open in Photoshop and move the version text »:
// named raster layers with transparency, trimmed to their content, and a flattened composite.
//
// Layout (Adobe Photoshop File Formats Specification):
//   header · colour mode data (empty) · image resources (empty) ·
//   layer and mask information (layer records, then channel image data) · composite image.
//
// Layers are pixels, not live text: the layered SVG next to each PSD is the source to edit text in
// (and a .txt sidecar lists the words of each text layer). Layers can be grouped (folders), the
// document can carry an ICC profile (sRGB), and readPsd() reads a file back for the checks.

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

/** Additional layer info block: 8BIM <key> <u32 length> <body padded to even>. */
function addInfo(key, body) {
  const o = new Out();
  const b = body.length % 2 ? Buffer.concat([body, Buffer.alloc(1)]) : body;
  o.str('8BIM'); o.str(key); o.u32(b.length); o.bytes(b);
  return o.buf();
}

/** Section divider ('lsct'): 1 = open folder, 3 = bounding section divider (end of a group). */
function lsct(type) { const b = Buffer.alloc(type === 3 ? 4 : 12); b.writeUInt32BE(type, 0); if (type !== 3) { b.write('8BIM', 4, 'ascii'); b.write('norm', 8, 'ascii'); } return addInfo('lsct', b); }

/**
 * The layer list Photoshop expects for groups, bottom → top: for each run of layers sharing a
 * `group`, a hidden « </Layer group> » divider, the layers, then the folder record named after
 * the group. Layers without a group stay as they are.
 */
export function withGroups(layers) {
  const out = [];
  for (let i = 0; i < layers.length;) {
    const g = layers[i].group;
    if (!g) { out.push(layers[i]); i++; continue; }
    let j = i;
    while (j < layers.length && layers[j].group === g) j++;
    out.push({ name: '</Layer group>', divider: 3 }, ...layers.slice(i, j).map((l) => ({ ...l, group: undefined })), { name: g, divider: 1 });
    i = j;
  }
  return out;
}

/** Image resource block: 8BIM <u16 id> <empty pascal name> <u32 size> <data padded to even>. */
function resource(id, data) {
  const o = new Out();
  o.str('8BIM'); o.u16(id); o.u16(0); o.u32(data.length); o.bytes(data); if (data.length % 2) o.u8(0);
  return o.buf();
}

/**
 * width, height; layers: [{ name, rgba (Uint8Array w*h*4, full canvas), hidden, opacity, group }]
 * bottom → top (consecutive layers with the same `group` become one layer group);
 * composite: Uint8Array w*h*4 (alpha ignored: the composite is flattened on `matte`);
 * icc: an ICC profile (Buffer) embedded as the document's colour profile (sRGB: lib/icc.mjs).
 * Returns a Buffer.
 */
export function writePsd({ width: w, height: h, layers, composite, matte = [255, 255, 255], icc = null }) {
  const o = new Out();
  // Header
  o.str('8BPS'); o.u16(1); o.bytes(Buffer.alloc(6)); o.u16(3); o.u32(h); o.u32(w); o.u16(8); o.u16(3);
  o.u32(0); // colour mode data
  const res = icc ? resource(1039, icc) : Buffer.alloc(0);
  o.u32(res.length); if (res.length) o.bytes(res); // image resources: the ICC profile

  // Layer records + channel data
  const recs = new Out(), data = new Out();
  const list = withGroups(layers);
  for (const L of list) {
    const box = L.divider ? null : contentBox(L.rgba, w, h);
    const b = box ?? { top: 0, left: 0, bottom: 0, right: 0 };
    const bw = b.right - b.left, bh = b.bottom - b.top;
    // Declared (and stored) R, G, B, then alpha: Photoshop follows the declared order, and
    // Pillow's reader assumes this one.
    const chans = [[0, 0], [1, 1], [2, 2], [-1, 3]].map(([id, ch]) => {
      const r = bw && bh ? rlePlane(planeOf(L.rgba, w, h, ch, b), bw, bh) : { counts: [], rows: [], header: true };
      return { id, r };
    });
    recs.i32(b.top); recs.i32(b.left); recs.i32(b.bottom); recs.i32(b.right);
    recs.u16(4);
    for (const c of chans) { recs.i16(c.id); recs.u32(rleLen(c.r)); }
    recs.str('8BIM'); recs.str(L.divider === 1 ? 'pass' : 'norm'); recs.u8(L.opacity ?? 255); recs.u8(0);
    recs.u8((L.hidden || L.divider === 3 ? 0x02 : 0x00) | 0x08 | (L.divider ? 0x10 : 0)); recs.u8(0);
    const name = pascal(L.name, 4), uni = luni(L.name), sec = L.divider ? lsct(L.divider) : Buffer.alloc(0);
    recs.u32(4 + 4 + name.length + uni.length + sec.length);
    recs.u32(0); recs.u32(0); recs.bytes(name); recs.bytes(uni); recs.bytes(sec);
    for (const c of chans) writeRle(data, c.r);
  }
  const info = new Out();
  info.i16(list.length);
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

/** Undo PackBits for one row of `n` bytes. */
function unpack(buf, at, len, n) {
  const out = new Uint8Array(n);
  let i = at, k = 0;
  const end = at + len;
  while (i < end && k < n) {
    const c = buf[i++];
    if (c < 128) { for (let j = 0; j <= c && k < n; j++) out[k++] = buf[i++]; }
    else if (c > 128) { const v = buf[i++]; for (let j = 0; j < 257 - c && k < n; j++) out[k++] = v; }
  }
  return out;
}

/**
 * Read back what writePsd writes (and any 8-bit RGB PSD with RLE or raw data): { width, height,
 * channels, depth, mode, icc (Buffer|null), layers: [{ name, top, left, bottom, right, hidden,
 * divider (0 | 1 open folder | 2 closed folder | 3 end), group (the folder it sits in) }]
 * bottom → top, composite: Uint8Array w*h*3 }. Used by the tests and by the media step to prove
 * every PSD it writes opens and matches its PNG.
 */
export function readPsd(buf) {
  let p = 0;
  const u8 = () => buf[p++], u16 = () => { const v = buf.readUInt16BE(p); p += 2; return v; }, i16 = () => { const v = buf.readInt16BE(p); p += 2; return v; };
  const u32 = () => { const v = buf.readUInt32BE(p); p += 4; return v; }, i32 = () => { const v = buf.readInt32BE(p); p += 4; return v; };
  const str = (n) => { const s = buf.toString('ascii', p, p + n); p += n; return s; };
  if (str(4) !== '8BPS') throw new Error('not a PSD (signature)');
  const version = u16(); if (version !== 1) throw new Error(`PSD version ${version}`);
  p += 6;
  const channels = u16(), height = u32(), width = u32(), depth = u16(), mode = u16();
  { const n = u32(); p += n; } // colour mode data
  const resEnd = p + 4 + buf.readUInt32BE(p); p += 4;
  let icc = null;
  while (p < resEnd) {
    if (str(4) !== '8BIM') throw new Error('bad image resource');
    const id = u16(); const nl = u8(); p += nl + ((nl + 1) % 2);
    const size = u32(); if (id === 1039) icc = buf.subarray(p, p + size);
    p += size + (size % 2);
  }
  p = resEnd;
  const lmEnd = p + 4 + buf.readUInt32BE(p); p += 4;
  const layers = [];
  if (lmEnd > p) {
    const liLen = u32(); const liEnd = p + liLen;
    if (liLen) {
      let n = i16(); n = Math.abs(n);
      const chanLens = [];
      for (let i = 0; i < n; i++) {
        const top = i32(), left = i32(), bottom = i32(), right = i32();
        const nc = u16(); const lens = []; for (let c = 0; c < nc; c++) { i16(); lens.push(u32()); }
        chanLens.push(lens);
        if (str(4) !== '8BIM') throw new Error('bad blend signature');
        str(4); u8(); u8(); const flags = u8(); u8();
        const extraEnd = p + 4 + buf.readUInt32BE(p); p += 4;
        p += 4 + buf.readUInt32BE(p);           // mask
        p += 4 + buf.readUInt32BE(p);           // blending ranges
        const nl = u8(); let name = buf.toString('latin1', p, p + nl); p += nl;
        // the pascal name is padded to a multiple of 4 (length byte included)
        p += (4 - ((nl + 1) % 4)) % 4;
        let divider = 0;
        while (p + 12 <= extraEnd) {
          const sig = str(4); const key = str(4); const len = u32();
          if (sig !== '8BIM' && sig !== '8B64') break;
          if (key === 'luni') { const k = buf.readUInt32BE(p); name = ''; for (let c = 0; c < k; c++) name += String.fromCharCode(buf.readUInt16BE(p + 4 + c * 2)); }
          if (key === 'lsct') divider = buf.readUInt32BE(p);
          p += len;
        }
        p = extraEnd;
        layers.push({ name, top, left, bottom, right, hidden: !!(flags & 2), divider });
      }
      for (const lens of chanLens) for (const l of lens) p += l;   // channel image data
    }
    p = liEnd;
  }
  p = lmEnd;
  // Groups: walk top → bottom, a folder record opens a group, its divider closes it.
  const stack = [];
  for (let i = layers.length - 1; i >= 0; i--) {
    const L = layers[i];
    if (L.divider === 1 || L.divider === 2) { L.group = stack.at(-1) ?? null; stack.push(L.name); continue; }
    if (L.divider === 3) { stack.pop(); L.group = stack.at(-1) ?? null; continue; }
    L.group = stack.at(-1) ?? null;
  }
  // Composite
  const comp = u16();
  const plane = width * height;
  const composite = new Uint8Array(plane * 3);
  if (comp === 1) {
    const counts = []; for (let i = 0; i < channels * height; i++) counts.push(u16());
    for (let ch = 0; ch < channels; ch++) for (let y = 0; y < height; y++) {
      const len = counts[ch * height + y];
      if (ch < 3) { const row = unpack(buf, p, len, width); for (let x = 0; x < width; x++) composite[(y * width + x) * 3 + ch] = row[x]; }
      p += len;
    }
  } else if (comp === 0) {
    for (let ch = 0; ch < Math.min(3, channels); ch++) for (let i = 0; i < plane; i++) composite[i * 3 + ch] = buf[p + ch * plane + i];
  } else throw new Error(`composite compression ${comp}`);
  return { width, height, channels, depth, mode, icc, layers, composite };
}

/** The visible layers of a read PSD (no group records), as « Group / name » strings. */
export function layerNames(psd) {
  return psd.layers.filter((l) => !l.divider).map((l) => (l.group ? `${l.group} / ${l.name}` : l.name));
}
