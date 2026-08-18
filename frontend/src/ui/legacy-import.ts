// "You already use OvGME / Open Mod Manager" — offered on first launch, before anything asks
// you to set up a profile.
//
// BMM has imported both for a long time (commands::ovgme, commands::omm). Both imports are
// buttons inside Profiles — a screen you only reach after creating a profile by hand. So the
// person the feature exists for, the one who says "not redoing my whole setup for this", is
// exactly the one who cannot have found it yet. The answer was written and unreachable, which
// is this codebase's most common defect and worth naming when it recurs.
//
// The offer is shown ONLY when there is something to import: scan_legacy_managers reads two
// known config files and stats what they point at, so a machine with neither pays two failed
// exists() calls and nobody is interrupted for nothing.
//
// Built with DOM calls, not interpolated markup: the names come out of another program's
// configuration files, which are not ours to trust.

import { t } from '../core/i18n.js';
import { invoke } from '../core/api.js';

// No toast here, and not to dodge the import cycle it would create (app.ts reaches this
// module back through onboarding): the modal is the thing on screen when the import
// finishes, and a message behind it is a message you have to close something to read. The
// result is written into the modal, where you are already looking. style-modal.ts avoids the
// same edge for the same kind of reason.

const OVERLAY_ID = 'bmm-legacy-import';

interface LegacyFind { count: number; names: string[]; source: string }
interface LegacyScan { ovgme: LegacyFind; omm: LegacyFind; any: boolean }

const el = (tag: string, cls?: string, text?: string): HTMLElement => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
};

/** At most three names, then "+N more" — a hub list can be long and the offer is a glance. */
function nameLine(names: string[]): string {
    const shown = names.slice(0, 3).join(', ');
    return names.length > 3
        ? t('legacy.andMore', { names: shown, n: String(names.length - 3) })
        : shown;
}

function row(find: LegacyFind, titleKey: string, onImport: () => void): HTMLElement {
    const card = el('div', 'legacy-row');

    const info = el('div', 'legacy-row-info');
    info.appendChild(el('div', 'legacy-row-title', t(titleKey)));
    info.appendChild(el('div', 'legacy-row-names', nameLine(find.names)));
    // The path it was read from: an offer about another program's data should be checkable,
    // not taken on faith.
    info.appendChild(el('div', 'legacy-row-src', find.source));
    card.appendChild(info);

    const btn = el('button', 'btn btn-primary legacy-row-btn', t('legacy.import')) as HTMLButtonElement;
    btn.type = 'button';
    btn.addEventListener('click', () => {
        btn.disabled = true;
        btn.textContent = t('legacy.importing');
        onImport();
    });
    card.appendChild(btn);
    return card;
}

/**
 * Show the offer if there is anything to offer, then call `next()` either way.
 *
 * `next` runs exactly once, whichever way this ends — imported, skipped, or never shown.
 * Losing the tutorial hub to a failed scan would be a worse bug than never offering.
 */
export async function offerLegacyImport(next: () => void): Promise<void> {
    let scan: LegacyScan;
    try {
        scan = await invoke('scan_legacy_managers') as LegacyScan;
    } catch (e) {
        console.warn('[legacy] scan failed', e);
        next();
        return;
    }
    // `any` comes from the scan, not recomputed here: one rule, one place.
    if (!scan?.any) {
        next();
        return;
    }

    let done = false;
    const finish = () => {
        if (done) return;      // Skip then a slow import resolving must not run next() twice
        done = true;
        document.getElementById(OVERLAY_ID)?.remove();
        next();
    };

    const overlay = el('div', 'modal-overlay legacy-overlay');
    overlay.id = OVERLAY_ID;
    const modal = el('div', 'modal legacy-modal');

    const head = el('div', 'modal-header');
    head.appendChild(el('h3', '', t('legacy.title')));
    modal.appendChild(head);

    const skip = el('button', 'btn btn-secondary', t('legacy.skip')) as HTMLButtonElement;
    skip.type = 'button';
    skip.addEventListener('click', finish);

    const body = el('div', 'modal-body');
    body.appendChild(el('p', 'legacy-lede', t('legacy.lede')));

    // The result line, written where you are already looking. Closing is then YOUR move:
    // an import that silently dismissed the modal would leave you unsure what it did.
    const result = el('p', 'legacy-result');
    result.hidden = true;

    const runImport = async (cmd: string, okKey: string) => {
        try {
            const n = await invoke(cmd) as number;
            result.textContent = n > 0 ? t(okKey, { n: String(n) }) : t('legacy.nothingNew');
            result.className = n > 0 ? 'legacy-result ok' : 'legacy-result';
        } catch (e) {
            result.textContent = t('legacy.failed', { error: String(e) });
            result.className = 'legacy-result bad';
        }
        result.hidden = false;
        skip.textContent = t('legacy.done');
    };

    if (scan.ovgme?.count) {
        body.appendChild(row(scan.ovgme, 'legacy.ovgme', () => void runImport('import_ovgme_profiles', 'legacy.imported')));
    }
    if (scan.omm?.count) {
        body.appendChild(row(scan.omm, 'legacy.omm', () => void runImport('auto_import_omm', 'legacy.imported')));
    }

    // What importing does NOT do, said before the click rather than discovered after it: it
    // reads their configuration and creates profiles pointing at the same folders. It moves
    // no files, and it changes nothing in the other manager.
    body.appendChild(result);
    body.appendChild(el('p', 'legacy-note', t('legacy.note')));
    modal.appendChild(body);

    const foot = el('div', 'modal-footer');
    foot.appendChild(skip);
    modal.appendChild(foot);

    overlay.appendChild(modal);
    document.getElementById('app-window-outer')?.appendChild(overlay);
}
