// The CLI's command tree, read out of the clap `Commands` enum.
//
// Shared by `check-cli-reference.mjs` (which holds the reference page to it) and usable on
// its own — `node scripts/cli-tree.mjs` prints it — because the alternative is a second
// hand-written list of 62 commands, which is the thing the reference page already is.
//
// Everything here comes from the enum: the section comments, the `///` doc comments clap
// shows as help, `#[command(name = "…")]`, and each `#[arg(…)]`. Nothing is inferred from a
// name, so a command renamed in the source is renamed here on the next run.
import { readFileSync } from 'node:fs';

const SRC = 'src-tauri/src/extra_tools/mcp_server.rs';

/** clap's default: CamelCase → kebab-case, unless `#[command(name = "…")]` says otherwise. */
const kebab = (n) => n.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();

export function cliTree(src = readFileSync(SRC, 'utf8')) {
    const at = src.indexOf('enum Commands {');
    if (at < 0) throw new Error(`enum Commands not found in ${SRC}`);
    let i = at + 'enum Commands {'.length, depth = 1;
    while (i < src.length && depth > 0) {
        const c = src[i];
        if (c === '{') depth++;
        else if (c === '}') depth--;
        i++;
    }
    const body = src.slice(at + 'enum Commands {'.length, i - 1);

    const out = [];
    let section = null, doc = [], rename = null, inside = null, argAttr = null;
    let d = 0;

    for (const raw of body.split('\n')) {
        const t = raw.trim();

        if (d === 0) {
            const sec = t.match(/^\/\/ ── (.+?) ─+$/);
            if (sec) { section = sec[1]; doc = []; continue; }
            if (t.startsWith('///')) { doc.push(t.slice(3).trim()); continue; }
            if (t.startsWith('//')) continue;
            const nm = t.match(/#\[command\(name = "([^"]+)"\)\]/);
            if (nm) { rename = nm[1]; continue; }
            if (t.startsWith('#[')) continue;
            const v = t.match(/^([A-Z][A-Za-z0-9]*)\s*(\{)?\s*,?\s*$/);
            if (v) {
                const cmd = {
                    section, name: rename || kebab(v[1]), variant: v[1],
                    desc: doc.join(' ').trim(), args: [],
                };
                out.push(cmd);
                doc = []; rename = null;
                if (v[2]) { d = 1; inside = cmd; }
                continue;
            }
            if (t) { doc = []; rename = null; }
            continue;
        }

        // inside one variant's braces
        if (t === '},' || t === '}') { d = 0; inside = null; doc = []; argAttr = null; continue; }
        if (t.startsWith('///')) { doc.push(t.slice(3).trim()); continue; }
        if (t.startsWith('#[arg')) { argAttr = t; continue; }
        if (t.startsWith('#[')) continue;
        const f = t.match(/^([a-z_][a-z0-9_]*)\s*:\s*(.+?),?$/);
        if (f) {
            const a = argAttr || '';
            const ty = f[2].replace(/,$/, '').trim();
            // `#[arg(long = "type")]` renames the flag. `kind` is the Rust field and
            // `--type` is what a person types; the page documents the second.
            const renamed = (a.match(/long\s*=\s*"([^"]+)"/) || [])[1];
            inside.args.push({
                name: renamed || f[1].replace(/_/g, '-'),
                // A clap field is positional unless the attribute says `long`.
                flag: /\blong\b/.test(a),
                optional: /^Option</.test(ty) || /^Vec</.test(ty) || /default_value/.test(a),
                list: /^Vec</.test(ty),
                def: (a.match(/default_value(?:_t)?\s*=\s*"?([^",)]+)"?/) || [])[1] || null,
                desc: doc.join(' ').trim(),
                rust: ty,
            });
            doc = []; argAttr = null;
        }
    }
    return out;
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}`) {
    const tree = cliTree();
    let sec = null;
    for (const c of tree) {
        if (c.section !== sec) { sec = c.section; console.log(`\n── ${sec ?? '(top level)'}`); }
        const args = c.args.map((a) => (a.flag ? `--${a.name}` : `<${a.name}>`) + (a.def ? `=${a.def}` : '')).join(' ');
        console.log(`  ${c.name.padEnd(20)} ${args}`);
    }
    console.log(`\n${tree.length} command(s)`);
}
