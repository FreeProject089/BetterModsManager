/**
 * credits-extras.ts — the two parts of Credits that read generated data beside the stack list:
 *
 *   · Code contributors: who wrote the code, from the git history of BMM, BetterCommunity,
 *     BMM Docs and BetterInstaller (scripts/gen-credits.mjs → credits-stack.gen.json
 *     `contributors`; aliases folded by scripts/credits-authors.json, no email ever shipped).
 *   · The licence reader: the LICENSE / COPYING / NOTICE files shipped inside each package,
 *     read at generation time into assets/credits-licenses.gen.json (deduplicated by hash) and
 *     fetched only when somebody opens one. Plain text in a <pre>; a .md licence goes through
 *     B.MD's untrusted path (md-lite + sanitiser), because it is somebody else's text.
 */
import { t } from '../core/i18n.js';
import { escHtml, escAttr } from '../core/utils.js';
import { uiIcon, brandIcon } from './icons.js';

export interface LicFile { f: string; id: string }
export interface CodeContributor { name: string; github: string | null; contributor: string | null; repos: string[]; since: string | null }
export interface CodeRepo { id: string; label: string; url: string | null }
export interface CodeContributors { repos: CodeRepo[]; people: CodeContributor[] }

const tx = (k: string, fallback: string) => { const v = t(k); return v && v !== k ? v : fallback; };
const openExt = (u: string) => (window as any).openExternal?.(u);

// ── Code contributors ───────────────────────────────────────────────────────────────────────
/**
 * Appends the "Code" section to the contributors grid. `cards` are the people of
 * contributors.json (their picture, display name and card), so a person who has a card is
 * shown with it and opens it; anyone else gets an initial and their GitHub.
 */
export function renderCodeContributors(grid: HTMLElement, data: CodeContributors | null | undefined, cards: any[]): void {
    grid.querySelector('.credits-code-section')?.remove();
    if (!data?.people?.length) return;
    const repoLabel = new Map(data.repos.map((r) => [r.id, r] as const));
    const sec = document.createElement('div');
    sec.className = 'credits-category-section credits-code-section';
    const people = data.people.map((p, i) => {
        const card = p.contributor ? cards.find((c) => c.id === p.contributor) : null;
        const shown = card?.display_name || card?.username || p.name;
        const repos = p.repos.map((id) => repoLabel.get(id)?.label || id);
        const pic = card?.pfp
            ? `<img src="${escAttr(card.pfp)}" class="credits-code-pfp" alt="">`
            : `<span class="credits-code-pfp is-initial" aria-hidden="true">${escHtml(shown.slice(0, 1).toUpperCase())}</span>`;
        return `<div class="credits-code-card glass-card">
            ${pic}
            <div class="credits-code-main">
                <div class="credits-code-name">${escHtml(shown)}</div>
                <div class="credits-code-meta">${escHtml(tx('credits.codeRepos', 'Commits in {n} repositories').replace('{n}', String(repos.length)))}${p.since ? ` · ${escHtml(tx('credits.codeSince', 'since {year}').replace('{year}', p.since))}` : ''}</div>
                <div class="credits-code-repos">${p.repos.map((id) => {
                    const r = repoLabel.get(id);
                    return r?.url
                        ? `<button type="button" class="bms-chip credits-code-repo" data-code-open="${escAttr(r.url)}" title="${escAttr(r.url)}">${uiIcon('git-branch', 12)} ${escHtml(r.label)}</button>`
                        : `<span class="bms-chip credits-code-repo">${uiIcon('git-branch', 12)} ${escHtml(r?.label || id)}</span>`;
                }).join('')}</div>
            </div>
            <div class="credits-code-actions">
                ${p.github ? `<button type="button" class="btn btn-secondary btn-sm" data-code-open="${escAttr(p.github)}">${brandIcon('github', 14)} GitHub</button>` : ''}
                ${card ? `<button type="button" class="btn btn-ghost btn-sm" data-code-card="${escAttr(card.id)}" data-i="${i}">${escHtml(tx('credits.codeProfile', 'Profile'))}</button>` : ''}
            </div>
        </div>`;
    }).join('');
    sec.innerHTML = `
        <div class="credits-category-title" data-i18n="credits.sections.code">${escHtml(tx('credits.sections.code', 'Code'))}</div>
        <p class="credits-code-blurb" data-i18n="credits.codeBlurb">${escHtml(tx('credits.codeBlurb', 'Everyone who wrote code in Better Mod Manager, BetterCommunity, BMM Docs and BetterInstaller, read from the git history of each repository.'))}</p>
        <div class="credits-code-grid">${people}</div>`;
    sec.addEventListener('click', (e) => {
        const tgt = e.target as HTMLElement;
        const open = tgt.closest<HTMLElement>('[data-code-open]');
        if (open?.dataset.codeOpen) { openExt(open.dataset.codeOpen); return; }
        const cardBtn = tgt.closest<HTMLElement>('[data-code-card]');
        if (cardBtn?.dataset.codeCard) (window as any).openContributorModal?.(cardBtn.dataset.codeCard);
    });
    // First: the people who wrote the code come before the supporters and testers.
    grid.insertBefore(sec, grid.firstChild);
}

// ── Licence reader ──────────────────────────────────────────────────────────────────────────
let _texts: Promise<Record<string, string>> | null = null;
function loadTexts(): Promise<Record<string, string>> {
    if (!_texts) {
        _texts = fetch('assets/credits-licenses.gen.json')
            .then((r) => (r.ok ? r.json() : { texts: {} }))
            .then((j) => (j && typeof j.texts === 'object' ? j.texts as Record<string, string> : {}))
            .catch(() => { _texts = null; return {}; });
    }
    return _texts;
}

/**
 * Shows a package's licence files inside `host` (the stack dialog's detail pane). One tab per
 * file when there are several (LICENSE-MIT + LICENSE-APACHE). `onBack` restores the detail.
 */
export async function openLicenceReader(host: HTMLElement, o: { name: string; version?: string | null; license?: string | null; files: LicFile[]; onBack: () => void; notify?: (message: string) => void }): Promise<void> {
    host.innerHTML = `<div class="bms-empty stk-state">${escHtml(tx('credits.licLoading', 'Loading the licence…'))}</div>`;
    const texts = await loadTexts();
    const files = o.files.filter((f) => typeof texts[f.id] === 'string');
    let at = 0;
    const body = async (f: LicFile) => {
        const text = texts[f.id];
        if (/\.(md|markdown)$/i.test(f.f)) {
            try {
                const { renderDocMarkdown } = await import('../docs/md-lite.js');
                return `<div class="stk-lic-md">${renderDocMarkdown(text)}</div>`;
            } catch { /* fall through to plain text */ }
        }
        return `<pre class="stk-lic-text" tabindex="0">${escHtml(text)}</pre>`;
    };
    const render = async () => {
        if (!files.length) {
            host.innerHTML = `<div class="stk-lic-head">
                    <button type="button" class="btn btn-ghost btn-sm" data-lic-back>${uiIcon('arrow-left', 14)} ${escHtml(o.name)}</button>
                </div>
                <div class="bms-empty stk-state"><div class="bms-empty-t">${escHtml(tx('credits.licUnavailable', 'This licence text is not bundled with this build.'))}</div></div>`;
            return;
        }
        const f = files[at];
        host.innerHTML = `
            <div class="stk-lic-head">
                <button type="button" class="btn btn-ghost btn-sm" data-lic-back>${uiIcon('arrow-left', 14)} ${escHtml(o.name)}</button>
                <div class="stk-lic-title">${uiIcon('scale', 14)} <span>${escHtml(tx('credits.licTitle', 'Licence'))}</span>${o.license ? ` <span class="stk-lic">${escHtml(o.license)}</span>` : ''}</div>
            </div>
            ${files.length > 1 ? `<div class="stk-lic-tabs" role="tablist">${files.map((x, i) => `<button type="button" role="tab" class="stk-lic-tab" aria-selected="${i === at}" data-lic-tab="${i}">${escHtml(x.f)}</button>`).join('')}</div>` : `<div class="stk-lic-file">${uiIcon('file-text', 12)} ${escHtml(f.f)}</div>`}
            ${await body(f)}
            <div class="stk-d-actions">
                <button type="button" class="btn btn-secondary btn-sm" data-lic-copy>${uiIcon('copy', 14)} ${escHtml(tx('credits.licCopy', 'Copy the text'))}</button>
            </div>`;
        // md-lite output is a shell until hydrated (headings, code copy buttons, cards).
        const md = host.querySelector<HTMLElement>('.stk-lic-md');
        if (md) {
            try { (await import('../docs/md-hydrate.js')).hydrateMdLite(md); } catch { /* stays readable unhydrated */ }
        }
    };
    host.onclick = (e) => {
        const tgt = e.target as HTMLElement;
        if (tgt.closest('[data-lic-back]')) { host.onclick = null; o.onBack(); return; }
        const tab = tgt.closest<HTMLElement>('[data-lic-tab]');
        if (tab) { at = Number(tab.dataset.licTab) || 0; void render().then(() => host.querySelector<HTMLElement>(`[data-lic-tab="${at}"]`)?.focus()); return; }
        if (tgt.closest('[data-lic-copy]')) {
            const text = texts[files[at]?.id] || '';
            navigator.clipboard?.writeText(text).then(() => o.notify?.(tx('credits.licCopied', 'Licence text copied'))).catch(() => { });
        }
    };
    await render();
    host.querySelector<HTMLElement>('[data-lic-back]')?.focus({ preventScroll: true });
}
