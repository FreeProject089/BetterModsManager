// SHA256SUMS.txt: the format `sha256sum -c` and PowerShell users both read (« <hash> *<path> »,
// binary marker, forward slashes, sorted by path). Pure formatting + parsing; hashing is in util.

export const SUMS_NAME = 'SHA256SUMS.txt';

/**
 * Files of a release folder that the checksum list covers. Logs, the list itself and hidden working
 * folders (a recorder's .chrome-profile/ or .frames/, held open while it runs) are not.
 */
export function sumsFilter(rel) {
  return rel !== SUMS_NAME && !rel.startsWith('logs/') && !/(^|\/)\./.test(rel) && !/(^|\/)(Thumbs\.db|desktop\.ini|\.DS_Store)$/i.test(rel);
}

/** entries: [{ path, sha256 }] → text. Throws on a malformed hash or a duplicate path. */
export function formatSums(entries) {
  const seen = new Set();
  const rows = [...entries].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)).map(({ path, sha256 }) => {
    if (!/^[0-9a-f]{64}$/.test(sha256)) throw new Error(`bad sha256 for ${path}: ${sha256}`);
    const p = path.replace(/\\/g, '/');
    if (seen.has(p)) throw new Error(`duplicate path ${p}`);
    seen.add(p);
    return `${sha256} *${p}`;
  });
  return rows.join('\n') + (rows.length ? '\n' : '');
}

/** text → [{ path, sha256 }] (accepts both « *path » and « ␠path » forms). */
export function parseSums(text) {
  return String(text).split(/\r?\n/).filter((l) => l.trim()).map((l) => {
    const m = /^([0-9a-fA-F]{64}) [ *](.+)$/.exec(l.trim());
    if (!m) throw new Error(`not a checksum line: ${l}`);
    return { sha256: m[1].toLowerCase(), path: m[2] };
  });
}

/** Markdown table of the published assets (file → SHA-256), in the given order. */
export function sumsTable(entries) {
  return ['| File | SHA-256 |', '|---|---|', ...entries.map((e) => `| \`${e.path}\` | \`${e.sha256}\` |`)].join('\n');
}
