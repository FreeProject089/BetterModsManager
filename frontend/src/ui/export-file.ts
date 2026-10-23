// export-file.ts — the app's exports with the app's dependencies (save dialog, write_text_file,
// open_folder, toast, t). The logic and why it exists: export-file-core.ts.
import { invoke, saveFile } from '../core/api.js';
import { t } from '../core/i18n.js';
import * as Core from './export-file-core.js';

export type { ExportDeps } from './export-file-core.js';
export const { folderOf, savedText, safeStringify } = Core;

function w(): any { return typeof window !== 'undefined' ? (window as any) : {}; }

export function defaultExportDeps(): Core.ExportDeps {
    return {
        save: (o) => saveFile(o),
        write: (path, content) => invoke('write_text_file', { path, content }),
        open: (folder) => invoke('open_folder', { path: folder }),
        toast: (...a) => w().toast?.(...a),
        t: (k, v) => t(k, v || {}),
        decorate: (folder) => decorateLastToast(folder),
    };
}

export function showSaved(message: string, path: string): void { Core.showSaved(message, path, defaultExportDeps()); }
export function showExportError(what: string, err: unknown): void { Core.showExportError(what, err, defaultExportDeps()); }
export function exportText(o: { what: string; defaultName: string; content: string; ext: string; filterName: string }): Promise<string | null> {
    return Core.exportText(o, defaultExportDeps());
}

/** The « Open folder » button on the toast that was just added (ui/app.ts toast). */
function decorateLastToast(folder: string): void {
    // Synchronously: toast() appends its element at once, and a toast shown right after this one
    // (an error from the next step) would otherwise get the button.
    const el = document.querySelector('#toast-container .toast:last-child') as HTMLElement | null;
    if (!el || el.querySelector('.toast-open-folder')) return;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn btn-xs btn-ghost toast-open-folder';
    b.textContent = t('dev.export.openFolder');
    b.title = folder;
    b.addEventListener('click', (e) => {
        e.stopPropagation();
        invoke('open_folder', { path: folder }).catch((err) => {
            w().toast?.(t('dev.export.openFail', { error: String((err as { message?: string })?.message ?? err) }), 'error', 8000);
        });
    });
    el.appendChild(b);
}
