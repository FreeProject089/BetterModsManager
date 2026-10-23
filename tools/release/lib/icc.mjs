// A small sRGB ICC profile (version 2.1, display class, RGB → XYZ), written from the published
// numbers so the PSDs can say « this is sRGB » without shipping a vendor's profile file:
// D50-adapted sRGB primaries (Bradford), the D50 white point, and the sRGB tone curve
// (IEC 61966-2-1) as a 1024-entry table. Photoshop and Photopea read it as the document profile.

const S15 = (v) => { const b = Buffer.alloc(4); b.writeInt32BE(Math.round(v * 65536)); return b; };
const xyz = (x, y, z) => Buffer.concat([Buffer.from('XYZ ', 'ascii'), Buffer.alloc(4), S15(x), S15(y), S15(z)]);

function desc(text) {
  const ascii = Buffer.from(text + '\0', 'ascii');
  const head = Buffer.alloc(12); head.write('desc', 0, 'ascii'); head.writeUInt32BE(ascii.length, 8);
  // ASCII part, then empty Unicode (lang + count) and ScriptCode (code + count + 67 bytes) parts.
  return Buffer.concat([head, ascii, Buffer.alloc(8), Buffer.alloc(3 + 67)]);
}
function text(t) { return Buffer.concat([Buffer.from('text', 'ascii'), Buffer.alloc(4), Buffer.from(t + '\0', 'ascii')]); }
function curve() {
  const n = 1024;
  const b = Buffer.alloc(12 + n * 2);
  b.write('curv', 0, 'ascii'); b.writeUInt32BE(n, 8);
  for (let i = 0; i < n; i++) {
    const v = i / (n - 1);
    const lin = v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    b.writeUInt16BE(Math.round(lin * 65535), 12 + i * 2);
  }
  return b;
}

let _cache = null;
/** The profile bytes (built once). */
export function srgbProfile() {
  if (_cache) return _cache;
  const trc = curve();
  const tags = [
    ['desc', desc('sRGB IEC61966-2.1')],
    ['cprt', text('No copyright, use freely')],
    ['wtpt', xyz(0.9642, 1.0, 0.8249)],
    ['rXYZ', xyz(0.4360, 0.2225, 0.0139)],
    ['gXYZ', xyz(0.3851, 0.7169, 0.0971)],
    ['bXYZ', xyz(0.1431, 0.0606, 0.7141)],
    ['rTRC', trc], ['gTRC', trc], ['bTRC', trc],
  ];
  // Tag data, each 4-byte aligned; the three TRC tags share one block.
  const blocks = [];
  let off = 128 + 4 + tags.length * 12;
  const table = [];
  const seen = new Map();
  for (const [sig, data] of tags) {
    if (seen.has(data)) { table.push([sig, ...seen.get(data)]); continue; }
    const pad = (4 - (data.length % 4)) % 4;
    table.push([sig, off, data.length]); seen.set(data, [off, data.length]);
    blocks.push(data, Buffer.alloc(pad)); off += data.length + pad;
  }
  const size = off;
  const h = Buffer.alloc(128);
  h.writeUInt32BE(size, 0);
  h.write('none', 4, 'ascii');
  h.writeUInt32BE(0x02100000, 8);           // version 2.1
  h.write('mntr', 12, 'ascii'); h.write('RGB ', 16, 'ascii'); h.write('XYZ ', 20, 'ascii');
  h.writeUInt16BE(2026, 24); h.writeUInt16BE(1, 26); h.writeUInt16BE(1, 28);
  h.write('acsp', 36, 'ascii');
  h.writeUInt32BE(0, 64);                    // rendering intent: perceptual
  S15(0.9642).copy(h, 68); S15(1.0).copy(h, 72); S15(0.8249).copy(h, 76);   // PCS illuminant D50
  const tt = Buffer.alloc(4 + tags.length * 12);
  tt.writeUInt32BE(tags.length, 0);
  table.forEach(([sig, o, l], i) => { tt.write(sig, 4 + i * 12, 'ascii'); tt.writeUInt32BE(o, 8 + i * 12); tt.writeUInt32BE(l, 12 + i * 12); });
  _cache = Buffer.concat([h, tt, ...blocks]);
  return _cache;
}
