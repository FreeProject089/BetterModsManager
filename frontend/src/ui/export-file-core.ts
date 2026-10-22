// export-file-core.ts — an export that says what it did and where (no imports: the node tests load it).
//
// The owner's diagnostic log: `Click: Button [debug-btn-export]` ten times, nothing on screen.
// The DevTools exports built a Blob and clicked an <a download>: in the Tauri webview that is, at
// best, a file dropped in the Downloads folder without a word, at worst nothing at all; and a
// state with a Set or a cycle threw in JSON.stringify before even that. Every export now:
//   · asks where with the save dialog (or writes to a folder BMM owns and names it),
//   · writes through the core (`write_text_file`),
//   · shows a toast with the FULL path and an « Open folder » button (and the same action in the
//     notification centre),
//   · reports a failure in words — and a cancelled dialog says that nothing was saved.
//
//   exportText({ what, defaultName, content, ext, filterName })  → the path, or null
//   showSaved(message, path)                                     → the toast for a file written
//   showExportError(what, err)                                   → the toast for a failure
//   safeStringify(value)                                         → JSON that survives Sets, Maps, cycles
export interface ExportDeps {
    save: (o: { defaultPath?: string; filters?: Array<{ name: string; extensions: string[] }> }) => Promise<string | null>;
    write: (path: string, content: string) => Promise<unknown>;
    open: (folder: string) => Promise<unknown>;
    toast: (msg: string, kind: string, ms?: number, icon?: string, source?: string, opts?: Record<string, unknown>) => unknown;
    t: (key: string, vars?: Record<string, string>) => string;
    /** Put the « Open folder » button on the toast just shown (DOM only). */
    decorate?: (folder: string) => void;
}

/** The folder of a file path (either separator). */
export function folderOf(path: string): string {
    const s = String(path || '');
    const i = Math.max(s.lastIndexOf('\\'), s.lastIndexOf('/'));
    return i > 0 ? s.slice(0, i) : s;
}

/** « <message>: <full path> ». */
export function savedText(message: string, path: string): string {
    return `${message}: ${path}`;
}

/** The toast for a file that was written: the full path, and « Open folder ». */
export function showSaved(message: string, path: string, deps: ExportDeps): void {
    const folder = folderOf(path);
    deps.toast(savedText(message, path), 'success', 12000, '', 'BMM', {
        action: { kind: 'open-folder', arg: folder, label: deps.t('dev.export.openFolder') },
    });
    deps.decorate?.(folder);
}

/** The toast for an export that failed: what, and the reason in the words that came back. */
export function showExportError(what: string, err: unknown, deps: ExportDeps): void {
    const why = String((err as { message?: string })?.message ?? err ?? '');
    deps.toast(`${deps.t('dev.export.failed', { what })}: ${why || '?'}`, 'error', 10000);
}

/** Ask where, write, and say so. Resolves the path written, or null (cancelled or failed:
 *  both are said on screen). */
export async function exportText(
    o: { what: string; defaultName: string; content: string; ext: string; filterName: string },
    deps: ExportDeps,
): Promise<string | null> {
    let path: string | null = null;
    try {
        path = await deps.save({ defaultPath: o.defaultName, filters: [{ name: o.filterName, extensions: [o.ext] }] });
    } catch (e) {
        showExportError(o.what, e, deps);
        return null;
    }
    if (!path) { deps.toast(deps.t('dev.export.cancelled'), 'info', 5000); return null; }
    try {
        await deps.write(path, o.content);
    } catch (e) {
        showExportError(o.what, e, deps);
        return null;
    }
    showSaved(deps.t('dev.export.saved', { what: o.what }), path, deps);
    return path;
}

/** JSON for a debugging snapshot: Sets and Maps as arrays/objects, cycles and DOM nodes named
 *  instead of thrown on, functions and BigInts as text. Never throws. */
export function safeStringify(value: unknown, space = 2): string {
    const seen = new WeakSet<object>();
    try {
        return JSON.stringify(value, (_k, v) => {
            if (typeof v === 'bigint') return v.toString();
            if (typeof v === 'function') return `[function ${v.name || 'anonymous'}]`;
            if (v && typeof v === 'object') {
                if (typeof Node !== 'undefined' && v instanceof Node) return `[${(v as Node).nodeName}]`;
                if (seen.has(v)) return '[circular]';
                seen.add(v);
                if (v instanceof Map) return Object.fromEntries(Array.from(v.entries()).map(([a, b]) => [String(a), b]));
                if (v instanceof Set) return Array.from(v);
            }
            return v;
        }, space) ?? 'null';
    } catch (e) {
        return JSON.stringify({ error: `could not serialise: ${String((e as Error)?.message || e)}` });
    }
}
