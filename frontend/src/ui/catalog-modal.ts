// One catalogue screen, for every kind of catalogue.
//
// BMM grew six of these independently and they disagreed about everything that was not the
// content: one called the builder *Publish my own…* and another *Create catalog*; one wrote a
// folder and another a single JSON; one had the "this source is protected" block and three
// did not; the mod-list one had two buttons where the rest had a panel with tabs. Somebody
// who had followed a plugin catalogue could not use what they had learnt on a theme one.
//
// So the screen is written once and the KIND is a parameter. What a catalogue holds differs;
// what you do with one does not:
//
//   **Follow** — add a source by address or by file, see what you follow, switch one off or
//                drop it. Protected sources are handled here, once, for every kind.
//   **Create** — pick what goes in, choose per entry whether its file travels with the
//                catalogue or is fetched from an address, and get ONE file out.
//
// The output is a binary choice and the wording avoids "publish" on purpose: making a
// catalogue and putting it somewhere are different acts, and a button that says *Publish*
// promises the second while doing the first.
//
//   · **A bundle** (`.bmmbundle`) — catalog.json and every packed file, in one thing to send.
//   · **A catalogue file** (`catalog.json`) — addresses only, for content already hosted.
//
// A kind supplies a descriptor and nothing else. Everything below is shared, so a change to
// how following works lands in all six at once.

import { invoke, pickFile, saveFile } from '../core/api.js';
import { t } from '../core/i18n.js';
import { escHtml, escAttr } from '../core/utils.js';
import { toast } from './app.js';
import { sourceAccessHtml, wireSourceAccess } from '../core/source-access.js';
import { planPublish, safeFileStem, type EntryChoice } from '../core/catalog-publish.js';
import { looksLikeCatalog } from '../core/catalog-bundle.js';

/** One thing a followed catalogue offers, flattened for showing in a list. */
export interface BrowseEntry {
    id: string;
    name: string;
    sub?: string;
    /** A short right-aligned note — a count, a version, where it came from. */
    note?: string;
}

/** What one kind of catalogue has to tell this screen. */
export interface CatalogKindSpec<T> {
    /** Short id, used for element prefixes. Must be unique per kind. */
    id: string;
    /** Modal heading. */
    title: string;
    /** One line under it. */
    subtitle?: string;
    /** Where the followed addresses live in localStorage. */
    storeKey: string;
    /** The array a document of this kind carries — `presets`, `plugins`, `lists`… */
    feedField: string;
    /** The extension of a packed entry's file, without the dot. */
    ext: string;
    /** The noun a nameless entry falls back to. */
    fallbackNoun?: string;

    /** Everything the user could put in a catalogue of this kind. */
    candidates(): Promise<T[]>;
    /** How a row reads. `sub` is the muted half. */
    label(item: T): { name: string; sub?: string };
    /** Stable id for an entry, used in the document. */
    entryId(item: T): string;
    /** Write one packed entry into `dir` as `file`. Return false to report it as failed. */
    writeEntry(item: T, dir: string, file: string): Promise<boolean>;
    /** The document row for an entry, given the address decided for it. */
    row(item: T, address: string): Record<string, unknown>;

    /** Is this parsed document a catalogue of THIS kind? */
    looksLike(doc: unknown): boolean;
    /** Called whenever the followed list changed, so a screen behind can refresh. */
    onChange?(): void;
    /** Where "manage keys" should take somebody. */
    manageKeys?(): void;

    /**
     * What the followed catalogues hold, and what to do with one of them.
     *
     * Optional, because some kinds already browse their catalogues inside a bigger screen —
     * the plugin tab, the theme gallery — and a second browser here would be two places
     * showing the same list, disagreeing the first time one of them is changed. When it IS
     * supplied it becomes the first tab, because "what have I got" is the question somebody
     * opens the screen with; following and creating are what they do afterwards.
     */
    browse?: {
        load(): Promise<{ entries: BrowseEntry[]; problems: string[] }>;
        /** The button on each row. */
        action: string;
        /** Return true when acting on the entry means this screen is done. */
        pick(entry: BrowseEntry): Promise<boolean | void>;
    };
}

const readList = (key: string): string[] => {
    try { const v = JSON.parse(localStorage.getItem(key) || '[]'); return Array.isArray(v) ? v : []; }
    catch { return []; }
};
const writeList = (key: string, v: string[]): void => {
    try { localStorage.setItem(key, JSON.stringify([...new Set(v)])); } catch { /* preference only */ }
};

/** A source shown as its filename when it is a local bundle, its address otherwise. */
const sourceLabel = (u: string): string =>
    (u.startsWith('bundle:') ? u.slice('bundle:'.length).replace(/^.*[/\\]/, '') : u);

export async function openCatalogModal<T>(spec: CatalogKindSpec<T>): Promise<void> {
    const P = `cm-${spec.id}`;
    let tab: 'browse' | 'follow' | 'create' = spec.browse ? 'browse' : 'follow';
    let browsed: BrowseEntry[] = [];
    let browseProblems: string[] = [];
    let browseLoaded = false;
    let items: T[] = [];
    let loaded = false;

    /** Per-entry decision, keyed by entry id. */
    const picked = new Set<string>();
    const modes = new Map<string, { mode: 'embed' | 'link'; url: string }>();
    const modeOf = (id: string) => modes.get(id) || { mode: 'embed' as const, url: '' };
    let name = '';
    let output: 'bundle' | 'json' = 'bundle';

    const ov = document.createElement('div');
    ov.className = 'modal-overlay open';
    ov.style.zIndex = '11400';

    const close = () => { ov.remove(); document.removeEventListener('keydown', onKey); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    document.addEventListener('keydown', onKey);

    // ── Follow ──────────────────────────────────────────────────────────────
    const addSource = async (src: string) => {
        if (readList(spec.storeKey).includes(src)) { toast(t('cm.already'), 'warning'); return; }
        writeList(spec.storeKey, [...readList(spec.storeKey), src]);
        spec.onChange?.();
        // Re-read rather than append: what a source holds is only known by reading it, and a
        // browse pane still showing the old list is a screen saying following did nothing.
        browseLoaded = false;
        paint();
        void loadBrowse();
    };

    const followByLink = async () => {
        const box = ov.querySelector(`#${P}-url`) as HTMLInputElement | null;
        const url = (box?.value || '').trim();
        if (!/^https?:\/\//i.test(url)) { toast(t('cm.badUrl'), 'warning'); return; }
        await addSource(url);
        if (box) box.value = '';
    };

    const followByFile = async () => {
        // Both shapes, one picker: a catalogue arrives either as a bundle or as the
        // document on its own, and asking which before knowing is a question with no
        // answer for somebody who was just sent a file.
        const path = await pickFile({ filters: [{ name: t('cm.fileKind'), extensions: ['bmmbundle', 'json', 'zip'] }] })
            .catch(() => null);
        if (!path) return;
        const isBundle = /\.(bmmbundle|zip)$/i.test(String(path));
        try {
            let doc: unknown;
            if (isBundle) {
                const res: any = await invoke('catalog_bundle_open', { path });
                doc = JSON.parse(String(res?.catalog || ''));
            } else {
                doc = JSON.parse(await invoke('read_file_text', { path }) as string);
            }
            // Checked when it is opened, not when it is next read: a file that is not a
            // catalogue of this kind should fail here, with the reason, rather than become
            // a source that errors every time this screen is drawn.
            if (!looksLikeCatalog(doc)) { toast(t('cm.notCatalogue'), 'error'); return; }
            if (!spec.looksLike(doc)) { toast(t('cm.wrongKind'), 'error'); return; }
            await addSource(isBundle ? `bundle:${path}` : String(path));
        } catch (e) { toast(`${t('cm.cannotRead')} — ${String(e).slice(0, 120)}`, 'error'); }
    };

    // ── Create ──────────────────────────────────────────────────────────────
    const create = async () => {
        const chosen = items.filter((i) => picked.has(spec.entryId(i)));
        if (!chosen.length) { toast(t('cm.pickSomething'), 'warning'); return; }

        // A catalogue FILE has nowhere to put a packed entry. Rather than quietly linking
        // them — which would publish addresses nobody gave — every entry has to carry one,
        // and the ones that do not are named.
        const choose = (item: T): EntryChoice => {
            const m = modeOf(spec.entryId(item));
            return m.mode === 'link' || output === 'json'
                ? { mode: 'link', url: m.url }
                : { mode: 'embed' };
        };
        const plan = planPublish(
            chosen.map((item) => ({ id: spec.entryId(item), name: spec.label(item).name, item })) as any,
            (w: any) => choose(w.item),
            {
                ext: spec.ext,
                fallback: spec.fallbackNoun || 'entry',
                // The label only, never the entry id. An id is opaque — a file called
                // t-lq3k2j.bmmpa in a published catalogue helps nobody — and planPublish
                // falls back to the id unless it is told not to. Two nameless entries become
                // automation and automation-2, which is what every builder did before this.
                nameOf: (w: any) => String(w.name || ''),
            },
        );
        if (plan.errors.length) {
            toast(t('catpub.dropped').replace('{n}', String(plan.errors.length))
                + ' — ' + plan.errors.slice(0, 3).join(' · '), 'warning', 8000);
        }
        if (!plan.rows.length) { toast(t('catpub.nothing'), 'error'); return; }

        const slug = safeFileStem(name || spec.title, 'catalog');
        const asBundle = output === 'bundle' && plan.embedded > 0;
        const outPath = (await saveFile(asBundle
            ? { defaultPath: `${slug}.bmmbundle`, filters: [{ name: t('catpub.bundleKind'), extensions: ['bmmbundle'] }] }
            : { defaultPath: `${slug}.json`, filters: [{ name: t('cm.jsonKind'), extensions: ['json'] }] })
            .catch(() => null)) as string;
        if (!outPath) return;

        // A bundle is assembled in a staging folder nobody sees; a catalogue file is one
        // document and goes straight where it was asked for.
        let dir = '';
        if (asBundle) {
            dir = (await invoke('catalog_bundle_stage').catch(() => null)) as string;
            if (!dir) { toast(t('catpub.stageFailed'), 'error'); return; }
        }
        const sep = dir.includes('\\') ? '\\' : '/';

        try {
            const failed: string[] = [];
            if (asBundle) {
                for (const p of plan.rows) {
                    if (!p.embed) continue;
                    const w: any = p.item;
                    const ok = await spec.writeEntry(w.item, dir, p.file).catch(() => false);
                    if (!ok) failed.push(spec.label(w.item).name);
                }
                if (failed.length) {
                    toast(t('cm.someFailed').replace('{list}', failed.slice(0, 4).join(', ')), 'warning', 8000);
                }
            }
            const doc = {
                version: '1.0',
                name: name.trim() || spec.title,
                [spec.feedField]: plan.rows.map((p) => spec.row((p.item as any).item, p.address)),
            };
            const jsonPath = asBundle ? `${dir}${sep}catalog.json` : outPath;
            await invoke('write_text_file', { path: jsonPath, content: JSON.stringify(doc, null, 2) });

            if (asBundle) {
                const res: any = await invoke('catalog_bundle_pack', { dir, out: outPath });
                if (res?.missing?.length) {
                    toast(t('plugins.catPackMissing').replace('{n}', String(res.missing.length))
                        .replace('{list}', res.missing.slice(0, 5).join(', ')), 'warning', 7000);
                }
                toast(t('cm.doneBundle').replace('{n}', String(plan.embedded))
                    .replace('{f}', outPath.replace(/^.*[/\\]/, '')), 'success', 7000);
            } else {
                toast(t('cm.doneJson').replace('{n}', String(plan.rows.length))
                    .replace('{f}', outPath.replace(/^.*[/\\]/, '')), 'success', 7000);
            }
            close();
        } catch (e) {
            toast(`${t('common.error')}: ${e}`, 'error');
        } finally {
            if (dir) await invoke('catalog_bundle_unstage', { dir }).catch(() => {});
        }
    };

    // ── Drawing ─────────────────────────────────────────────────────────────
    const loadBrowse = async () => {
        if (!spec.browse || browseLoaded) return;
        const r = await spec.browse.load().catch(() => ({ entries: [], problems: [] }));
        browsed = r.entries;
        browseProblems = r.problems;
        browseLoaded = true;
        if (tab === 'browse') paint();
    };

    const browsePane = (): string => {
        if (!browseLoaded) return `<p class="cm-empty">${escHtml(t('common.loading'))}</p>`;
        return `
        ${browsed.length ? `<div class="cm-list">${browsed.map((e, i) => `
            <div class="cat-pub-row cm-browse-row">
                <div class="cm-browse-main">
                    <div class="cm-row-name">${escHtml(e.name)}</div>
                    ${e.sub ? `<div class="cm-row-sub cm-browse-sub">${escHtml(e.sub)}</div>` : ''}
                </div>
                ${e.note ? `<span class="cm-row-sub">${escHtml(e.note)}</span>` : ''}
                <button class="btn btn-xs btn-accent" data-open="${i}">${escHtml(spec.browse!.action)}</button>
            </div>`).join('')}</div>`
          : `<p class="cm-empty">${escHtml(readList(spec.storeKey).length ? t('cm.browseEmpty') : t('cm.browseNone'))}</p>`}
        ${browseProblems.length ? `<details class="sched-tcb-more" style="margin-top:10px">
            <summary>${escHtml(t('cm.dropped').replace('{n}', String(browseProblems.length)))}</summary>
            <p class="sched-tcb-hint">${escHtml(browseProblems.slice(0, 8).join(' · '))}</p></details>` : ''}`;
    };

    const followPane = (): string => {
        const srcs = readList(spec.storeKey);
        return `
        <div class="cm-add">
            <input class="input" id="${P}-url" spellcheck="false" placeholder="${escAttr(t('cm.urlPh'))}">
            <button class="btn btn-sm btn-secondary" id="${P}-add">${escHtml(t('cm.follow'))}</button>
            <button class="btn btn-sm btn-ghost" id="${P}-file">${escHtml(t('cm.fromFile'))}</button>
        </div>
        <p class="cm-hint">${escHtml(t('cm.followHint'))}</p>
        ${sourceAccessHtml(P)}
        <div class="cm-srcs">
            ${srcs.length ? srcs.map((u) => `
                <div class="cm-src">
                    <span class="cm-src-kind">${escHtml(u.startsWith('bundle:') ? t('cm.kindFile') : t('cm.kindLink'))}</span>
                    <span class="cm-src-url" title="${escAttr(u)}">${escHtml(sourceLabel(u))}</span>
                    <button type="button" class="btn btn-xs btn-ghost" data-drop="${escAttr(u)}">×</button>
                </div>`).join('')
              : `<p class="cm-empty">${escHtml(t('cm.noSources'))}</p>`}
        </div>`;
    };

    const createPane = (): string => {
        if (!loaded) return `<p class="cm-empty">${escHtml(t('common.loading'))}</p>`;
        if (!items.length) return `<p class="cm-empty">${escHtml(t('cm.nothingToAdd'))}</p>`;
        const linked = items.filter((i) => picked.has(spec.entryId(i)) && modeOf(spec.entryId(i)).mode === 'link').length;
        return `
        <label class="sched-label">${escHtml(t('cm.name'))}</label>
        <input class="input" id="${P}-name" value="${escAttr(name)}" placeholder="${escAttr(spec.title)}" style="margin-bottom:12px">

        <label class="sched-label">${escHtml(t('cm.output'))}</label>
        <div class="cm-out">
            <label class="cm-out-opt${output === 'bundle' ? ' on' : ''}">
                <input type="radio" name="${P}-out" value="bundle"${output === 'bundle' ? ' checked' : ''}>
                <span><b>${escHtml(t('cm.outBundle'))}</b><small>${escHtml(t('cm.outBundleSub'))}</small></span>
            </label>
            <label class="cm-out-opt${output === 'json' ? ' on' : ''}">
                <input type="radio" name="${P}-out" value="json"${output === 'json' ? ' checked' : ''}>
                <span><b>${escHtml(t('cm.outJson'))}</b><small>${escHtml(t('cm.outJsonSub'))}</small></span>
            </label>
        </div>

        <div class="cm-listh">
            <span>${escHtml(t('cm.whatGoesIn'))}</span>
            <button type="button" class="btn btn-xs btn-ghost" id="${P}-all">${escHtml(t('common.selectAll'))}</button>
            <button type="button" class="btn btn-xs btn-ghost" id="${P}-none">${escHtml(t('common.selectNone'))}</button>
        </div>
        <div class="cm-list">
            ${items.map((it) => {
                const id = spec.entryId(it);
                const l = spec.label(it);
                const m = modeOf(id);
                const on = picked.has(id);
                // With a catalogue FILE there is nowhere to pack anything, so the per-entry
                // picker would be offering a choice that is not there.
                const forced = output === 'json';
                return `
                <div class="cat-pub-row">
                    <label class="cat-pub-pick">
                        <input type="checkbox" data-pick="${escAttr(id)}"${on ? ' checked' : ''}>
                        <span class="cm-row-name">${escHtml(l.name)}</span>
                        ${l.sub ? `<span class="cm-row-sub">${escHtml(l.sub)}</span>` : ''}
                    </label>
                    ${forced ? `<span class="cm-forced">${escHtml(t('catpub.link'))}</span>`
                      : `<select class="input cat-pub-mode" data-mode="${escAttr(id)}">
                            <option value="embed"${m.mode === 'embed' ? ' selected' : ''}>${escHtml(t('catpub.embed'))}</option>
                            <option value="link"${m.mode === 'link' ? ' selected' : ''}>${escHtml(t('catpub.link'))}</option>
                         </select>`}
                    ${(forced || m.mode === 'link') && on ? `<input class="input cat-pub-url" data-url="${escAttr(id)}"
                           spellcheck="false" value="${escAttr(m.url)}" placeholder="${escAttr(t('catpub.urlPh'))}">` : ''}
                </div>`;
            }).join('')}
        </div>
        <p class="cm-hint">${escHtml(picked.size
            ? t('catpub.split').replace('{f}', String(picked.size - linked)).replace('{l}', String(linked))
            : t('cm.pickSomething'))}</p>`;
    };

    const paint = () => {
        ov.innerHTML = `
        <div class="modal glass cm-modal">
            <div class="modal-header">
                <div>
                    <h3 style="margin:0">${escHtml(spec.title)}</h3>
                    ${spec.subtitle ? `<p class="cm-sub">${escHtml(spec.subtitle)}</p>` : ''}
                </div>
                <button class="modal-close" type="button" data-x>&times;</button>
            </div>
            <div class="cm-tabs" role="tablist">
                ${spec.browse ? `<button type="button" class="cm-tab${tab === 'browse' ? ' on' : ''}" data-tab="browse"
                        role="tab" aria-selected="${tab === 'browse'}">${escHtml(t('cm.tabBrowse'))}</button>` : ''}
                <button type="button" class="cm-tab${tab === 'follow' ? ' on' : ''}" data-tab="follow"
                        role="tab" aria-selected="${tab === 'follow'}">${escHtml(t('cm.tabFollow'))}</button>
                <button type="button" class="cm-tab${tab === 'create' ? ' on' : ''}" data-tab="create"
                        role="tab" aria-selected="${tab === 'create'}">${escHtml(t('cm.tabCreate'))}</button>
            </div>
            <div class="modal-body cm-body">${
                tab === 'browse' ? browsePane() : tab === 'follow' ? followPane() : createPane()}</div>
            <div class="modal-footer">
                <div style="flex:1"></div>
                <button class="btn btn-sm btn-ghost" data-x>${escHtml(t('common.close'))}</button>
                ${tab === 'create' && loaded && items.length
                    ? `<button class="btn btn-sm btn-accent" id="${P}-go"${picked.size ? '' : ' disabled'}>${escHtml(
                        output === 'bundle' ? t('cm.makeBundle') : t('cm.makeJson'))}</button>` : ''}
            </div>
        </div>`;
        wire();
    };

    const wire = () => {
        ov.querySelectorAll('[data-x]').forEach((b) => b.addEventListener('click', close));
        ov.querySelectorAll<HTMLElement>('[data-tab]').forEach((b) => b.addEventListener('click', async () => {
            tab = b.dataset.tab === 'create' ? 'create' : b.dataset.tab === 'browse' ? 'browse' : 'follow';
            paint();
            if (tab === 'browse') await loadBrowse();
            // Loaded on FIRST use of the tab rather than when the modal opens: somebody who
            // came to follow a catalogue should not wait for a list of their own things.
            if (tab === 'create' && !loaded) {
                items = await spec.candidates().catch(() => []);
                loaded = true;
                paint();
            }
        }));

        if (tab === 'browse') {
            ov.querySelectorAll<HTMLElement>('[data-open]').forEach((b) => b.addEventListener('click', async () => {
                const e = browsed[Number(b.dataset.open)];
                if (!e || !spec.browse) return;
                try {
                    if (await spec.browse.pick(e)) close();
                } catch (err) { toast(String(err).slice(0, 160), 'error'); }
            }));
            return;
        }

        if (tab === 'follow') {
            ov.querySelector(`#${P}-add`)?.addEventListener('click', () => { void followByLink(); });
            ov.querySelector(`#${P}-file`)?.addEventListener('click', () => { void followByFile(); });
            ov.querySelector(`#${P}-url`)?.addEventListener('keydown', (e) => {
                if ((e as KeyboardEvent).key === 'Enter') void followByLink();
            });
            ov.querySelectorAll<HTMLElement>('[data-drop]').forEach((b) => b.addEventListener('click', () => {
                writeList(spec.storeKey, readList(spec.storeKey).filter((u) => u !== b.dataset.drop));
                spec.onChange?.();
                browseLoaded = false;
                paint();
                void loadBrowse();
            }));
            // The protected-source block, wired the same way on every kind. It reads the
            // address box so "which server" is answered without asking twice.
            wireSourceAccess(P, (msg, kind) => toast(t(msg), kind), () => {
                close();
                spec.manageKeys?.();
            }, () => (ov.querySelector(`#${P}-url`) as HTMLInputElement | null)?.value?.trim() || '');
            return;
        }

        (ov.querySelector(`#${P}-name`) as HTMLInputElement | null)
            ?.addEventListener('input', (e) => { name = (e.target as HTMLInputElement).value; });
        ov.querySelectorAll<HTMLInputElement>(`input[name="${P}-out"]`).forEach((r) => r.addEventListener('change', () => {
            output = r.value === 'json' ? 'json' : 'bundle';
            paint();
        }));
        ov.querySelectorAll<HTMLElement>('[data-pick]').forEach((cb) => cb.addEventListener('change', (e) => {
            const el = e.target as HTMLInputElement;
            if (el.checked) picked.add(cb.dataset.pick!); else picked.delete(cb.dataset.pick!);
            paint();
        }));
        ov.querySelectorAll<HTMLElement>('[data-mode]').forEach((sel) => sel.addEventListener('change', (e) => {
            const id = sel.dataset.mode!;
            modes.set(id, { ...modeOf(id), mode: (e.target as HTMLSelectElement).value === 'link' ? 'link' : 'embed' });
            // Saying HOW something should be published is saying you want it published.
            picked.add(id);
            paint();
        }));
        // NOT repainted on input: paint() rebuilds the pane and would take the caret out of
        // the box being typed into.
        ov.querySelectorAll<HTMLElement>('[data-url]').forEach((box) => box.addEventListener('input', (e) => {
            const id = box.dataset.url!;
            modes.set(id, { ...modeOf(id), url: (e.target as HTMLInputElement).value });
        }));
        ov.querySelector(`#${P}-all`)?.addEventListener('click', () => {
            for (const it of items) picked.add(spec.entryId(it));
            paint();
        });
        ov.querySelector(`#${P}-none`)?.addEventListener('click', () => { picked.clear(); paint(); });
        ov.querySelector(`#${P}-go`)?.addEventListener('click', () => { void create(); });
    };

    (document.getElementById('app-window-outer') || document.body).appendChild(ov);
    ov.addEventListener('mousedown', (e) => { if (e.target === ov) close(); });
    paint();
    void loadBrowse();
}
