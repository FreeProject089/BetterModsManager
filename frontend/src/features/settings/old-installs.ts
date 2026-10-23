// Old installations of BMM: « BMM détecte les anciennes installations et propose de les
// retirer, entièrement optionnel ».
//
// Two doors, one dialog:
//   · at start-up, ONCE per new finding (after the 0.9.x migration made the old data folder
//     removable, or when the scan finds something it never showed), and never again after
//     « Never ask again »;
//   · Settings › Application › Old installations, with « Scan again », always.
//
// Nothing is removed without a click, nothing starts ticked, and each kind of item has its own
// confirmation: an uninstaller runs the program's own uninstall; shortcuts and caches are
// confirmed together; an old data folder gets a backup step (.zip, on by default) and then a
// second confirmation that names the folder and its size. The Rust side (commands::old_installs)
// looks every id up in a fresh scan and guards every path; this page never sends a path it did
// not get from that scan.
//
// Built with DOM calls: labels and paths come from the registry and the disk.

import { t } from '../../core/i18n.js';
import { invoke, pickFolderAt } from '../../core/api.js';
import { openModal, topOverlay } from '../../ui/modal-shell.js';
import { uiIcon } from '../../ui/icons.js';
import * as M from './old-installs-model.js';

const CARD_ID = 'settings-old-installs-card';
const CSS_ID = 'old-installs-css';

let lastScan: M.OldScan | null = null;
let neverAsk = false;
let dialogOpen = false;

function ensureCss(): void {
    if (document.getElementById(CSS_ID)) return;
    const link = document.createElement('link');
    link.id = CSS_ID;
    link.rel = 'stylesheet';
    link.href = 'css/old-installs.css';
    document.head.appendChild(link);
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
};

function button(cls: string, label: string, onClick: () => void): HTMLButtonElement {
    const b = el('button', cls, label);
    b.type = 'button';
    b.addEventListener('click', onClick);
    return b;
}

// ── One row ──────────────────────────────────────────────────────────────────

function metaLine(item: M.OldItem): string {
    const parts: string[] = [M.kindLabel(t, item)];
    if (item.kind === 'install') parts.push(M.installerLabel(t, item.installer));
    const size = M.fmtSize(item.sizeBytes);
    if (size) parts.push(size);
    if (item.scope === 'machine') parts.push(t('oldInstalls.scopeMachine'));
    return parts.join(' · ');
}

function itemRow(item: M.OldItem, checked: boolean, onToggle: (on: boolean) => void, silent?: { on: boolean; set: (on: boolean) => void }): HTMLElement {
    const row = el('label', `oi-row${item.removable ? '' : ' is-off'}`);
    const box = el('input');
    box.type = 'checkbox';
    box.checked = checked;
    box.disabled = !M.selectable(item);
    box.addEventListener('change', () => onToggle(box.checked));
    row.appendChild(box);

    const info = el('div', 'oi-info');
    const title = el('div', 'oi-title');
    title.appendChild(el('span', '', item.label));
    if (item.version) title.appendChild(el('span', 'oi-chip', item.version));
    if (item.currentLine) title.appendChild(el('span', 'oi-chip', t('oldInstalls.currentLine')));
    info.appendChild(title);
    info.appendChild(el('div', 'oi-meta', metaLine(item)));
    if (item.path) info.appendChild(el('div', 'oi-path', item.path));
    if (item.target) info.appendChild(el('div', 'oi-path', t('oldInstalls.pointsTo', { path: item.target })));
    if (item.reason) info.appendChild(el('div', 'oi-note', t(item.reason)));
    if (item.warning) info.appendChild(el('div', 'oi-note is-warn', t(item.warning)));
    if (silent && item.canSilent && item.removable) {
        const lab = el('span', 'oi-silent');
        const s = el('input');
        s.type = 'checkbox';
        s.checked = silent.on;
        s.addEventListener('change', () => silent.set(s.checked));
        // A click on the silent box must not toggle the row's own checkbox.
        s.addEventListener('click', (e) => e.stopPropagation());
        lab.addEventListener('click', (e) => e.stopPropagation());
        lab.append(s, el('span', '', t('oldInstalls.silent')));
        info.appendChild(lab);
    }
    row.appendChild(info);
    return row;
}

// ── Confirmation steps ──────────────────────────────────────────────────────

function confirmStep(o: { title: string; lines: (string | { path: string })[]; ok: string; danger?: boolean }): Promise<boolean> {
    return new Promise((resolve) => {
        let answered = false;
        const body = el('div');
        for (const line of o.lines) {
            if (typeof line === 'string') body.appendChild(el('p', 'oi-lede', line));
            else body.appendChild(el('div', 'oi-confirm-path', line.path));
        }
        const foot = el('div', 'oi-footer');
        const h = openModal({
            title: o.title,
            icon: uiIcon(o.danger ? 'delete' : 'info', 20),
            tone: o.danger ? 'danger' : 'accent',
            size: 'sm',
            body,
            footer: foot,
            closeLabel: t('common.close'),
            onClose: () => { if (!answered) resolve(false); },
        });
        foot.append(
            button('btn btn-secondary', t('common.cancel'), () => { answered = true; h.close(); resolve(false); }),
            button(o.danger ? 'btn btn-danger' : 'btn btn-primary', o.ok, () => { answered = true; h.close(); resolve(true); }),
        );
    });
}

/** The backup step for one old data folder: « Back up as .zip first » (on) into a folder the
 *  person picks (Documents by default). null = cancelled. */
function backupStep(item: M.OldItem, docs: string | null): Promise<{ backupDir: string | null } | null> {
    return new Promise((resolve) => {
        let answered = false;
        let dir = docs || '';
        const body = el('div');
        body.appendChild(el('p', 'oi-lede', t('oldInstalls.backupLede', { size: M.fmtSize(item.sizeBytes) || '?' })));
        body.appendChild(el('div', 'oi-confirm-path', item.path || ''));
        const check = el('label', 'oi-check');
        const box = el('input');
        box.type = 'checkbox';
        box.checked = true;
        check.append(box, el('span', '', t('oldInstalls.backupFirst')));
        body.appendChild(check);
        const row = el('div', 'oi-backup-row');
        const field = el('input', 'input');
        field.readOnly = true;
        field.value = dir;
        field.setAttribute('aria-label', t('oldInstalls.backupFolder'));
        const pick = button('btn btn-secondary btn-sm', t('oldInstalls.choose'), async () => {
            const p = await pickFolderAt(dir || undefined);
            if (p) { dir = p; field.value = p; sync(); }
        });
        row.append(field, pick);
        body.appendChild(row);
        const foot = el('div', 'oi-footer');
        const go = button('btn btn-primary', t('oldInstalls.continue'), () => {
            answered = true;
            h.close();
            resolve({ backupDir: box.checked ? dir : null });
        });
        const sync = () => {
            row.hidden = !box.checked;
            go.disabled = box.checked && !dir;
        };
        box.addEventListener('change', sync);
        const h = openModal({
            title: t('oldInstalls.backupTitle'),
            icon: uiIcon('archive', 20),
            size: 'md',
            body,
            footer: foot,
            closeLabel: t('common.close'),
            onClose: () => { if (!answered) resolve(null); },
        });
        foot.append(button('btn btn-secondary', t('common.cancel'), () => { answered = true; h.close(); resolve(null); }), go);
        sync();
    });
}

// ── The run ─────────────────────────────────────────────────────────────────

interface RunReport { done: number; failed: number; skipped: number; lines: { text: string; bad: boolean }[] }

async function runPlan(plan: M.RemovalPlan, silentIds: Set<string>, docs: string | null, progress: (s: string) => void): Promise<RunReport> {
    const r: RunReport = { done: 0, failed: 0, skipped: 0, lines: [] };
    const ok = (text: string) => { r.done++; r.lines.push({ text, bad: false }); };
    const bad = (text: string) => { r.failed++; r.lines.push({ text, bad: true }); };
    const skip = (text: string) => { r.skipped++; r.lines.push({ text, bad: false }); };

    for (const item of plan.installs) {
        progress(t('oldInstalls.uninstalling', { name: item.label }));
        try {
            const out = await invoke('old_installs_uninstall', { id: item.id, silent: silentIds.has(item.id) }) as { removed: boolean; cancelled: boolean; exitCode: number | null };
            if (out.removed) ok(t('oldInstalls.lineUninstalled', { name: item.label }));
            else if (out.cancelled) skip(t('oldInstalls.lineCancelled', { name: item.label }));
            else bad(t('oldInstalls.lineStillThere', { name: item.label }));
        } catch (e) {
            bad(`${item.label}: ${M.errorText(t, e)}`);
        }
    }

    if (plan.quick.length) {
        const yes = await confirmStep({
            title: t('oldInstalls.confirmQuickTitle', { n: String(plan.quick.length) }),
            lines: [t('oldInstalls.confirmQuick'), ...plan.quick.map((i) => ({ path: i.path || i.label }))],
            ok: t('oldInstalls.delete'),
            danger: true,
        });
        for (const item of plan.quick) {
            if (!yes) { skip(t('oldInstalls.lineKept', { name: item.path || item.label })); continue; }
            try {
                await invoke('old_installs_remove', { id: item.id, path: item.path || '' });
                ok(t('oldInstalls.lineDeleted', { name: item.path || item.label }));
            } catch (e) {
                bad(`${item.path || item.label}: ${M.errorText(t, e)}`);
            }
        }
    }

    for (const item of plan.data) {
        const step = await backupStep(item, docs);
        if (!step) { skip(t('oldInstalls.lineKept', { name: item.path || item.label })); continue; }
        let zip: string | null = null;
        if (step.backupDir) {
            progress(t('oldInstalls.backingUp', { name: item.path || item.label }));
            try {
                const b = await invoke('old_installs_backup', { id: item.id, destDir: step.backupDir }) as { zipPath: string };
                zip = b.zipPath;
                r.lines.push({ text: t('oldInstalls.lineBackup', { path: zip }), bad: false });
            } catch (e) {
                // No backup, no delete: the person asked for one.
                bad(`${item.path || item.label}: ${M.errorText(t, e)}`);
                continue;
            }
        }
        const yes = await confirmStep({
            title: t('oldInstalls.confirmDataTitle'),
            lines: [
                t('oldInstalls.confirmData', { size: M.fmtSize(item.sizeBytes) || '?' }),
                { path: item.path || '' },
                zip ? t('oldInstalls.backupSaved', { path: zip }) : t('oldInstalls.noBackup'),
            ],
            ok: t('oldInstalls.deleteFolder'),
            danger: true,
        });
        if (!yes) { skip(t('oldInstalls.lineKept', { name: item.path || item.label })); continue; }
        try {
            await invoke('old_installs_remove', { id: item.id, path: item.path || '' });
            ok(t('oldInstalls.lineDeleted', { name: item.path || item.label }));
        } catch (e) {
            bad(`${item.path || item.label}: ${M.errorText(t, e)}`);
        }
    }
    return r;
}

// ── The dialog ──────────────────────────────────────────────────────────────

/** Open the list. `startup` adds « Never ask again » and makes closing mean « Not now ». */
export function openOldInstallsDialog(scan: M.OldScan, mode: 'startup' | 'settings', offerIds: string[] = []): void {
    if (dialogOpen) return;
    ensureCss();
    dialogOpen = true;
    let current = scan;
    let sel = M.initialSelection(current.items);
    const silentIds = new Set<string>();
    let busy = false;
    let decided = false;

    const body = el('div');
    body.appendChild(el('p', 'oi-lede', t('oldInstalls.lede')));
    const list = el('div', 'oi-list');
    body.appendChild(list);
    const status = el('p', 'oi-status');
    status.setAttribute('role', 'status');
    body.appendChild(status);
    const log = el('ul', 'oi-log');
    body.appendChild(log);
    body.appendChild(el('p', 'oi-foot-note', t('oldInstalls.footNote')));

    const foot = el('div', 'oi-footer');
    const never = button('btn btn-ghost', t('oldInstalls.neverAsk'), () => {
        decided = true;
        void invoke('old_installs_dismiss', { mode: 'never', ids: [] }).then(() => { neverAsk = true; renderCard(); }).catch(() => {});
        h.close();
    });
    const later = button('btn btn-secondary', mode === 'startup' ? t('oldInstalls.notNow') : t('common.close'), () => h.close());
    const remove = button('btn btn-primary', t('oldInstalls.removeSelected'), () => void run());

    const draw = () => {
        list.replaceChildren();
        if (!current.items.length) list.appendChild(el('p', 'oi-lede', t('oldInstalls.nothing')));
        for (const item of current.items) {
            list.appendChild(itemRow(item, sel.has(item.id), (on) => { sel = M.toggle(sel, item, on); syncButtons(); }, {
                on: silentIds.has(item.id),
                set: (on) => { if (on) silentIds.add(item.id); else silentIds.delete(item.id); },
            }));
        }
        syncButtons();
    };
    const syncButtons = () => {
        const n = M.planSize(M.planRemoval(current.items, sel));
        remove.disabled = busy || n === 0;
        remove.textContent = n ? t('oldInstalls.removeN', { n: String(n) }) : t('oldInstalls.removeSelected');
        later.disabled = busy;
        never.disabled = busy;
        list.querySelectorAll('input').forEach((i) => { (i as HTMLInputElement).disabled = busy || (i as HTMLInputElement).disabled; });
    };

    const run = async () => {
        const plan = M.planRemoval(current.items, sel);
        if (!M.planSize(plan) || busy) return;
        busy = true;
        syncButtons();
        const report = await runPlan(plan, silentIds, current.documentsDir, (s) => { status.textContent = s; });
        log.replaceChildren(...report.lines.map((l) => el('li', l.bad ? 'is-bad' : '', l.text)));
        status.textContent = t('oldInstalls.rescanning');
        try {
            current = await invoke('old_installs_scan') as M.OldScan;
            lastScan = current;
            renderCard();
        } catch { /* keep the old list */ }
        sel = M.pruneSelection(sel, current.items);
        busy = false;
        status.textContent = M.summaryLine(t, report.done, report.failed, report.skipped);
        draw();
    };

    const h = openModal({
        title: t('oldInstalls.title'),
        subtitle: t('oldInstalls.subtitle'),
        icon: uiIcon('archive', 20),
        size: 'lg',
        className: 'oi-modal',
        body,
        footer: foot,
        closeLabel: t('common.close'),
        onClose: () => {
            dialogOpen = false;
            // At start-up, closing is « Not now » unless it was « Never ask again »: these findings
            // were shown (removed or kept), and only something NEW brings the dialog back.
            if (mode === 'startup' && !decided) {
                void invoke('old_installs_dismiss', { mode: 'later', ids: offerIds }).catch(() => {});
            }
        },
    });
    if (mode === 'startup') foot.appendChild(never);
    foot.appendChild(el('span', 'oi-spacer'));
    foot.append(later, remove);
    draw();
}

// ── Start-up ────────────────────────────────────────────────────────────────

/** Called once after boot (ui/app.ts). Waits for a clear screen; never blocks anything. */
export async function offerOldInstallsAtStartup(): Promise<void> {
    let ans: M.OfferAnswer;
    try {
        ans = await invoke('old_installs_offer') as M.OfferAnswer;
    } catch (e) {
        console.warn('[old-installs] scan failed', e);
        return;
    }
    lastScan = ans.scan;
    neverAsk = !!ans.neverAsk;
    renderCard();
    if (!ans.offer) return;
    // Not over the privacy deck, the tutorial or anything else: wait for the screen to clear.
    // Still busy after two minutes, then next start (nothing was marked seen).
    for (let i = 0; i < 60 && topOverlay(); i++) await new Promise((r) => setTimeout(r, 2000));
    if (topOverlay()) return;
    openOldInstallsDialog(ans.scan, 'startup', ans.offerIds || []);
}

// ── Settings card ───────────────────────────────────────────────────────────

function renderCard(): void {
    const card = document.getElementById(CARD_ID);
    if (!card) return;
    const status = card.querySelector('.oi-card-status');
    const list = card.querySelector('.oi-card-list');
    const review = card.querySelector<HTMLButtonElement>('.oi-review');
    const sw = card.querySelector<HTMLInputElement>('.oi-offer-switch');
    if (status) status.textContent = M.cardStatus(t, lastScan);
    if (list) {
        list.replaceChildren(...(lastScan?.items || []).slice(0, 6).map((i) => {
            const size = M.fmtSize(i.sizeBytes);
            return el('li', '', `${i.label}${i.version ? ` ${i.version}` : ''} (${M.kindLabel(t, i)}${size ? `, ${size}` : ''})`);
        }));
    }
    if (review) review.disabled = !lastScan?.items.length;
    if (sw) sw.checked = !neverAsk;
}

async function scanFromCard(btn: HTMLButtonElement): Promise<void> {
    btn.disabled = true;
    try {
        const ans = await invoke('old_installs_offer') as M.OfferAnswer;
        lastScan = ans.scan;
        neverAsk = !!ans.neverAsk;
    } catch (e) {
        const status = document.querySelector(`#${CARD_ID} .oi-card-status`);
        if (status) status.textContent = M.errorText(t, e);
        btn.disabled = false;
        return;
    }
    btn.disabled = false;
    renderCard();
}

/** Build the card into the Settings page (card-order.ts places it in the Application group).
 *  Safe to call twice. It scans the first time it comes into view, not at boot. */
export function mountOldInstallsCard(): HTMLElement | null {
    const existing = document.getElementById(CARD_ID);
    if (existing) return existing;
    const parent = document.querySelector('#view-settings .settings-sections');
    if (!parent) return null;
    ensureCss();
    const card = el('div', 'glass-card');
    card.id = CARD_ID;

    const h3 = el('h3', 'card-title');
    h3.insertAdjacentHTML('afterbegin', uiIcon('archive', 16));
    const title = el('span', '', t('oldInstalls.cardTitle'));
    title.setAttribute('data-i18n', 'oldInstalls.cardTitle');
    h3.appendChild(title);
    card.appendChild(h3);

    const lede = el('p', 'stg-help oi-card-lede', t('oldInstalls.cardLede'));
    lede.setAttribute('data-i18n', 'oldInstalls.cardLede');
    card.appendChild(lede);
    const status = el('div', 'oi-card-status');
    status.setAttribute('role', 'status');
    card.appendChild(status);
    card.appendChild(el('ul', 'oi-card-list'));

    const actions = el('div', 'stg-foot oi-card-actions');
    const scanBtn = button('btn btn-secondary btn-sm', t('oldInstalls.scanAgain'), () => void scanFromCard(scanBtn));
    scanBtn.setAttribute('data-i18n', 'oldInstalls.scanAgain');
    const review = button('btn btn-primary btn-sm oi-review', t('oldInstalls.review'), () => {
        if (lastScan) openOldInstallsDialog(lastScan, 'settings');
    });
    review.setAttribute('data-i18n', 'oldInstalls.review');
    actions.append(scanBtn, review);

    const rows = el('div', 'set-rows oi-card-rows');
    const sw = el('div', 'set-row oi-card-switch');
    const swText = el('div', 'set-row-title oi-grow', t('oldInstalls.offerAtStartup'));
    swText.setAttribute('data-i18n', 'oldInstalls.offerAtStartup');
    const lab = el('label', 'bmm-switch');
    const input = el('input', 'oi-offer-switch');
    input.type = 'checkbox';
    input.checked = !neverAsk;
    input.setAttribute('aria-label', t('oldInstalls.offerAtStartup'));
    input.addEventListener('change', () => {
        const on = input.checked;
        void invoke('old_installs_dismiss', { mode: on ? 'reset' : 'never', ids: [] })
            .then(() => { neverAsk = !on; })
            .catch(() => { input.checked = !on; });
    });
    const track = el('span', 'bmm-switch-track');
    track.appendChild(el('span', 'bmm-switch-thumb'));
    lab.append(input, track);
    sw.append(swText, lab);
    rows.appendChild(sw);
    card.appendChild(rows);
    card.appendChild(actions);

    parent.appendChild(card);
    renderCard();

    // First time it is on screen, scan (unless the start-up check already did).
    if ('IntersectionObserver' in window) {
        const io = new IntersectionObserver((entries) => {
            if (!entries.some((e) => e.isIntersecting)) return;
            io.disconnect();
            if (!lastScan) void scanFromCard(scanBtn);
        });
        io.observe(card);
    }
    return card;
}
