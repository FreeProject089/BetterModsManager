// The navigation vocabulary of scheduled tasks — the part with no DOM in it.
//
// A task could already open a SCREEN (`view.open`). What it could not do is say anything more
// precise than that: open the Plugins page and stop there, never « the Create tab », « the
// Storage card in Settings », « this mod », « this button ». So a task meant to walk somebody
// through a setup, or to put them in front of the one control a reminder is about, could only
// get them as far as the right page and hope.
//
// Eight steps close that gap (`nav.*`). They are split in two by what they can CHANGE:
//
//   · showing — open a page or a tab, a Settings card, a profile/mod/modpack/repo/plugin/app,
//     scroll to and highlight something, wait for something, show a message. These move the
//     view and nothing else, so they need no permission and a preview runs them for real.
//   · acting  — open a dialog, click a control. Both are ALLOW-LISTED here (never a free
//     selector) and need the `navigate` permission; a preview highlights the control and says
//     it would click it, and never does.
//
// The allow-lists are data, in this file, so a test can read them and so the editor, the
// runner, the dry run and the task builder all offer the same thing. A control only gets on
// the click list when pressing it by hand changes nothing irreversible: no delete, no consent,
// no credential field. `sensitiveReason` is the runtime half of that rule — a control whose
// markup changed into something dangerous since it was listed is refused anyway.
//
// Import-free, so it loads in node for the tests (tests/sched-nav.test.mjs).

/** The eight navigation actions, in the order the editor lists them. */
export const NAV_ACTIONS = [
    'nav.page', 'nav.settingsCard', 'nav.item', 'nav.highlight',
    'nav.waitFor', 'nav.message', 'nav.modal', 'nav.click',
] as const;
export type NavAction = typeof NAV_ACTIONS[number];

/** The two that act rather than show: allow-listed, and gated by the `navigate` permission. */
export const NAV_ACTING: readonly string[] = ['nav.modal', 'nav.click'];

export const isNavAction = (type: string): boolean => (NAV_ACTIONS as readonly string[]).includes(type);

// ── Pages and tabs ───────────────────────────────────────────────────────────────────────────

export interface NavTab { id: string; key: string }
export interface NavPage { id: string; key: string; tabs: NavTab[] }

/**
 * Every screen and the tabs inside it a step can name.
 *
 * The ids are the sidebar's `data-view` values, the same ones `view.open` uses. A tab id is
 * what its button carries (`data-tab`, `data-repo-tab`, `data-api-sec`, or the end of its id);
 * a path `a/b` means « tab a, then section b inside it » — Plugins & API → API → Deep links.
 * The runner also accepts a tab that is not listed here, found live on the page, so a tab
 * added later is reachable before this list learns its name.
 */
export const NAV_PAGES: NavPage[] = [
    { id: 'library', key: 'snav.page.library', tabs: [] },
    { id: 'profiles', key: 'snav.page.profiles', tabs: [] },
    { id: 'modpacks', key: 'snav.page.modpacks', tabs: [] },
    { id: 'modlist', key: 'snav.page.modlist', tabs: [] },
    {
        id: 'repo', key: 'snav.page.repo', tabs: [
            { id: 'sync', key: 'snav.tab.repo.sync' },
            { id: 'host', key: 'snav.tab.repo.host' },
        ],
    },
    {
        id: 'apps', key: 'snav.page.apps', tabs: [
            { id: 'browse', key: 'snav.tab.apps.browse' },
            { id: 'installed', key: 'snav.tab.apps.installed' },
            { id: 'favorites', key: 'snav.tab.apps.favorites' },
            { id: 'history', key: 'snav.tab.apps.history' },
            { id: 'sources', key: 'snav.tab.apps.sources' },
            { id: 'create', key: 'snav.tab.apps.create' },
        ],
    },
    {
        id: 'plugins', key: 'snav.page.plugins', tabs: [
            { id: 'installed', key: 'snav.tab.plugins.installed' },
            { id: 'catalog', key: 'snav.tab.plugins.catalog' },
            { id: 'create', key: 'snav.tab.plugins.create' },
            { id: 'scripts', key: 'snav.tab.plugins.scripts' },
            { id: 'scripts/test', key: 'snav.tab.plugins.test' },
            { id: 'scripts/endpoints', key: 'snav.tab.plugins.endpoints' },
            { id: 'scripts/deeplinks', key: 'snav.tab.plugins.deeplinks' },
            { id: 'automations', key: 'snav.tab.plugins.automations' },
            { id: 'perms', key: 'snav.tab.plugins.perms' },
        ],
    },
    { id: 'community', key: 'snav.page.community', tabs: [] },
    { id: 'mapper', key: 'snav.page.mapper', tabs: [] },
    { id: 'docs', key: 'snav.page.docs', tabs: [] },
    { id: 'settings', key: 'snav.page.settings', tabs: [] },
    { id: 'credits', key: 'snav.page.credits', tabs: [] },
];

export function pageById(id: string): NavPage | null {
    return NAV_PAGES.find((p) => p.id === id) || null;
}

/** A page id is a plain word: it ends up in a CSS attribute selector. */
export const validPageId = (id: string): boolean => /^[a-z][a-z0-9-]{0,40}$/.test(id);
/** A tab path: one or two plain words joined by `/`. */
export const validTabPath = (tab: string): boolean => /^[A-Za-z0-9_-]{1,40}(?:\/[A-Za-z0-9_-]{1,40})?$/.test(tab);

// ── Things a step can open by id ─────────────────────────────────────────────────────────────

export const NAV_ITEM_KINDS = ['mod', 'profile', 'modpack', 'repo', 'plugin', 'app'] as const;
export type NavItemKind = typeof NAV_ITEM_KINDS[number];

/** The page each kind lives on. A repo is a FOLLOWED repo, listed on Server Repo → Sync. */
export const ITEM_PAGE: Record<NavItemKind, { page: string; tab?: string }> = {
    mod: { page: 'library' },
    profile: { page: 'profiles' },
    modpack: { page: 'modpacks' },
    repo: { page: 'repo', tab: 'sync' },
    plugin: { page: 'plugins', tab: 'installed' },
    app: { page: 'apps', tab: 'installed' },
};

/**
 * Where an item's card can be found once its page is open: the attribute selectors that name
 * it, tried in order. The id is escaped by the caller (CSS.escape) — it is data from a task.
 */
export function itemSelectors(kind: NavItemKind, escapedId: string): string[] {
    const v = `"${escapedId}"`;
    switch (kind) {
        case 'mod': return [`.mod-card[data-id=${v}]`];
        case 'profile': return [`#view-profiles [data-kind="profile"][data-id=${v}]`, `#view-profiles .btn-activate[data-id=${v}]`];
        case 'modpack': return [`#view-modpacks [data-kind="modpack"][data-id=${v}]`];
        case 'repo': return [`.rp-follow-row[data-url=${v}]`];
        case 'plugin': return [`#view-plugins .plug-btn-apply[data-id=${v}]`, `#view-plugins .plug-btn-sha[data-id=${v}]`];
        case 'app': return [`.apps-card[data-app-id=${v}]`];
    }
}

/** The enclosing card to light up, from the element the selector found (a button inside it). */
export const ITEM_CARD = '.mod-card, .profile-card, .modpack-card, .rp-follow-row, .apps-card, .plug-card';

// ── Controls a step may click ────────────────────────────────────────────────────────────────

/** What pressing a control does, as the dry run reports it. */
export type ControlEffect = 'open' | 'read' | 'change';

export interface NavControl {
    id: string;
    page: string;
    tab?: string;
    /** An id selector — never anything looser. */
    sel: string;
    key: string;
    effect: ControlEffect;
}

/**
 * The controls `nav.click` may press, and nothing else.
 *
 * Each one is something a person presses without being asked « are you sure »: it opens a
 * dialog, it checks something, it reloads a list. No delete, no consent, no field. `change` is
 * reserved for the one listed control that can install (« Check now » on followed repos does
 * what each repo is set to do), so the dry run can say so.
 */
export const NAV_CONTROLS: NavControl[] = [
    { id: 'library.history', page: 'library', sel: '#btn-show-history', key: 'snav.ctl.libraryHistory', effect: 'open' },
    { id: 'library.addMod', page: 'library', sel: '#btn-add-mod', key: 'snav.ctl.libraryAddMod', effect: 'open' },
    { id: 'library.verify', page: 'library', sel: '#btn-verify-integrity', key: 'snav.ctl.libraryVerify', effect: 'read' },
    { id: 'library.checkUpdates', page: 'library', sel: '#btn-lib-check-updates', key: 'snav.ctl.libraryCheckUpdates', effect: 'read' },
    { id: 'profiles.new', page: 'profiles', sel: '#btn-new-profile', key: 'snav.ctl.profilesNew', effect: 'open' },
    { id: 'repo.browse', page: 'repo', tab: 'sync', sel: '#btn-browse-repos', key: 'snav.ctl.repoBrowse', effect: 'open' },
    { id: 'repo.refreshProfiles', page: 'repo', tab: 'sync', sel: '#btn-refresh-repo-profiles', key: 'snav.ctl.repoRefreshProfiles', effect: 'read' },
    { id: 'repo.followCheckAll', page: 'repo', tab: 'sync', sel: '#btn-repo-follow-check-all', key: 'snav.ctl.repoFollowCheckAll', effect: 'change' },
    { id: 'repo.modUpdates', page: 'repo', sel: '#btn-check-mod-updates', key: 'snav.ctl.repoModUpdates', effect: 'read' },
    { id: 'repo.monitoring', page: 'repo', tab: 'host', sel: '#btn-open-monitoring', key: 'snav.ctl.repoMonitoring', effect: 'open' },
    { id: 'apps.reload', page: 'apps', sel: '#apps-btn-reload', key: 'snav.ctl.appsReload', effect: 'read' },
    { id: 'plugins.import', page: 'plugins', sel: '#plug-head-import', key: 'snav.ctl.pluginsImport', effect: 'open' },
];

export function controlById(id: string): NavControl | null {
    return NAV_CONTROLS.find((c) => c.id === id) || null;
}

// ── Dialogs a step may open ──────────────────────────────────────────────────────────────────

/** How a dialog is opened: the global its own module exposes, or the button that opens it. */
export type ModalOpener =
    | { kind: 'global'; name: string; arg?: string }
    | { kind: 'click'; page: string; tab?: string; sel: string };

export interface NavModal { id: string; key: string; open: ModalOpener }

const TOOL = (tool?: string): ModalOpener => ({ kind: 'global', name: 'openToolsHub', arg: tool });

/**
 * The dialogs `nav.modal` may open. Each goes through its REAL opener — the global its module
 * already exposes for the command palette (`openToolsHub`, `openStorageManager`…), or the
 * button that opens it — so its content is initialised exactly as when a person opens it. The
 * ids are the command palette's, so a reader can match them. Only things that OPEN something are
 * here, never a command that does the work itself (« Enable all mods », « Start the server »).
 */
export const NAV_MODALS: NavModal[] = [
    { id: 'tools.hub', key: 'snav.modal.toolsHub', open: TOOL() },
    { id: 'tools.disk', key: 'snav.modal.toolsDisk', open: TOOL('disk') },
    { id: 'tools.cache', key: 'snav.modal.toolsCache', open: TOOL('cache') },
    { id: 'tools.logs', key: 'snav.modal.toolsLogs', open: TOOL('logs') },
    { id: 'tools.duplicates', key: 'snav.modal.toolsDuplicates', open: TOOL('duplicates') },
    { id: 'tools.conflicts', key: 'snav.modal.toolsConflicts', open: TOOL('conflicts') },
    { id: 'tools.orphans', key: 'snav.modal.toolsOrphans', open: TOOL('orphans') },
    { id: 'tools.deployed', key: 'snav.modal.toolsDeployed', open: TOOL('deployed') },
    { id: 'tools.largefiles', key: 'snav.modal.toolsLargefiles', open: TOOL('largefiles') },
    { id: 'settings.storage', key: 'snav.modal.storage', open: { kind: 'global', name: 'openStorageManager' } },
    { id: 'settings.hashing', key: 'snav.modal.hashing', open: { kind: 'global', name: 'showHashingStats' } },
    { id: 'settings.graphics', key: 'snav.modal.graphics', open: { kind: 'global', name: 'openGraphicsSettings' } },
    { id: 'mods.history', key: 'snav.modal.modsHistory', open: { kind: 'click', page: 'library', sel: '#btn-show-history' } },
    { id: 'repo.browse', key: 'snav.modal.repoBrowse', open: { kind: 'click', page: 'repo', tab: 'sync', sel: '#btn-browse-repos' } },
    { id: 'repo.monitoring', key: 'snav.modal.repoMonitoring', open: { kind: 'click', page: 'repo', tab: 'host', sel: '#btn-open-monitoring' } },
];

/** The globals a dialog opener may call — nothing else is looked up on `window`. */
export const MODAL_GLOBALS: readonly string[] = ['openToolsHub', 'openStorageManager', 'showHashingStats', 'openGraphicsSettings'];

export function modalById(id: string): NavModal | null {
    return NAV_MODALS.find((m) => m.id === id) || null;
}

// ── The runtime guard ────────────────────────────────────────────────────────────────────────

/** What the runner reads off an element before pressing it. Plain data, so this is testable. */
export interface ElementFacts {
    tag: string;
    type?: string;
    id?: string;
    classes?: string[];
    text?: string;
    /** Inside a consent surface (privacy, telemetry, terms). */
    inConsent?: boolean;
    /** Inside a form that holds a password or token field. */
    inCredentialForm?: boolean;
    disabled?: boolean;
}

const DANGER_WORDS = /\b(delete|remove|uninstall|reset|wipe|erase|purge|format|factory|consent|accept|agree|decline|revoke|password|passphrase|token|secret|private.?key|supprimer|effacer|désinstaller|réinitialiser|accepter|refuser|mot de passe|jeton)\b/i;
const DANGER_CLASS = /^(btn-danger|danger|is-danger|btn-del|btn-delete)$/i;

/**
 * Why this element must not be clicked by a task, or null when it may be.
 *
 * The allow-list already says which controls may be clicked; this is the second lock, read off
 * the element at the moment of the click. It catches the control that CHANGED — a « Check »
 * button turned into « Delete » by a later edit, an id reused for a danger button — which the
 * list alone cannot.
 */
export function sensitiveReason(f: ElementFacts): string | null {
    const tag = (f.tag || '').toLowerCase();
    const type = (f.type || '').toLowerCase();
    if (f.disabled) return 'disabled';
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return 'field';
    if (type === 'password' || type === 'file') return 'field';
    if (f.inConsent) return 'consent';
    if (f.inCredentialForm) return 'credentials';
    if ((f.classes || []).some((c) => DANGER_CLASS.test(c))) return 'danger';
    if (DANGER_WORDS.test(f.id || '') || DANGER_WORDS.test((f.text || '').slice(0, 120))) return 'danger';
    return null;
}

/** A selector a task may HIGHLIGHT or WAIT FOR (never click): bounded, no markup. */
export function selectorProblem(sel: string): string | null {
    const s = sel.trim();
    if (!s) return 'empty';
    if (s.length > 300) return 'long';
    if (/[<>{}]/.test(s)) return 'invalid';
    return null;
}

// ── Effects, for the dry run ─────────────────────────────────────────────────────────────────

/**
 * What one step would do, in the dry run's words.
 *
 *   nav      moves the view (a preview runs it for real)
 *   read     looks at something and changes nothing
 *   change   changes BMM's own state (a mod on, a file written, a server started)
 *   delete   removes something
 *   network  sends to or downloads from the internet
 *   external starts or stops something outside BMM
 *   flow     a wait, a branch, a variable — no effect of its own
 */
export type Effect = 'nav' | 'read' | 'change' | 'delete' | 'network' | 'external' | 'flow';

const READ_ACTIONS = new Set([
    'mods.checkUpdates', 'perf.diskSpace', 'library.counts', 'app.buildInfo', 'app.checkUpdate',
    'data.validate', 'text.extract', 'log.print', 'notify', 'id.of', 'map.get', 'ai.status',
    'mods.verifyIntegrity', 'disk.report', 'storage.diskBenchmark', 'benchmark.run',
    'wait.http', 'wait.hook', 'plugin.compare',
    'pkg.verify', 'modlist.verify',
]);
const FLOW_ACTIONS = new Set([
    'var.set', 'var.clear', 'var.ternary', 'math.set', 'rule.table', 'task.stop',
    'list.set', 'list.push', 'list.clear', 'map.set', 'map.clear',
    'ui.ask',
]);
const DELETE_ACTIONS = new Set([
    'profile.delete', 'mod.remove', 'modpack.delete', 'plugin.delete', 'catalog.delete',
    'cache.clean', 'logs.rotate', 'mods.clearHistory', 'system.clearApiLog', 'system.clearResourceRecords',
]);
const NETWORK_ACTIONS = new Set([
    'webhook.send', 'discord.send', 'slack.send', 'http.request', 'repo.publishSsh', 'repo.fetchSsh',
    'feed.publish',
]);
const EXTERNAL_ACTIONS = new Set([
    'app.launch', 'app.stop', 'file.open', 'folder.open', 'custom.command', 'custom.script',
    'launchpack.run', 'open.url', 'restart',
    'game.launch',
]);

export function effectOf(type: string, params: Record<string, unknown> = {}): Effect {
    if (isNavAction(type)) {
        if (type === 'nav.click') {
            // A listed control's own effect: a click that opens a dialog is a view change.
            const c = controlById(String(params.control || ''));
            return !c || c.effect === 'open' ? 'nav' : c.effect === 'read' ? 'read' : 'change';
        }
        return 'nav';
    }
    if (type === 'repos.checkFollowed') return String(params.mode || 'report') === 'auto' ? 'change' : 'read';
    if (type === 'catalog.updates') return String(params.mode || 'check') === 'check' ? 'read' : 'network';
    if (type === 'catalog.install') return 'network';
    if (type === 'api.call') return String(params.method || 'GET').toUpperCase() === 'GET' ? 'read' : 'change';
    if (READ_ACTIONS.has(type)) return 'read';
    if (FLOW_ACTIONS.has(type)) return 'flow';
    if (DELETE_ACTIONS.has(type)) return 'delete';
    if (NETWORK_ACTIONS.has(type)) return 'network';
    if (EXTERNAL_ACTIONS.has(type)) return 'external';
    return 'change';
}

/**
 * The actions whose dry run is MEASURED rather than described: they answer « what would
 * happen » by looking (a cache preview, a rotation plan, an update check) and touch nothing.
 * Every other action is listed with its effect and skipped — including the read-only scans
 * (integrity, disk usage), which change nothing but can take minutes on a big library.
 */
export const DRY_MEASURED: readonly string[] = [
    'cache.clean', 'logs.rotate', 'catalog.updates', 'repos.checkFollowed',
    'repo.server',
    // Read-only and quick: the dry run of the DCS join gate says whether the list would pass.
    'modlist.verify', 'pkg.verify',
];

// ── The plan ─────────────────────────────────────────────────────────────────────────────────

export interface PlanRow {
    /** Where the step sits, as the editor's paths: `0`, `2.then.1`… */
    path: string;
    depth: number;
    /** The step kind (`action`, `if`, `delay`…). */
    kind: string;
    /** The action type, for an action step. */
    type: string;
    params: Record<string, unknown>;
    /** False inside a branch, a loop, an error handler: it may not run. */
    certain: boolean;
    effect: Effect;
    disabled: boolean;
}

type AnyStep = Record<string, any>;

/**
 * Every step of a task, flattened in run order, with what it would do and whether it is sure
 * to run. Read-only: nothing is evaluated, nothing runs. The same « may not run » rule as the
 * mod preview (sched-preview.ts): a `then`/`else`, a loop body, an `onError` and a `default`
 * are maybes; a `try` body and a `retry` body always start.
 */
export function planSteps(steps: AnyStep[], base = '', depth = 0, sure = true, out: PlanRow[] = []): PlanRow[] {
    (steps || []).forEach((st, i) => {
        if (!st || typeof st !== 'object') return;
        const path = base ? `${base}.${i}` : String(i);
        const kind = String(st.kind || '');
        const disabled = st.disabled === true;
        if (kind === 'action') {
            const type = String(st.action?.type || '');
            const params = (st.action?.params || {}) as Record<string, unknown>;
            out.push({ path, depth, kind, type, params, certain: sure, effect: effectOf(type, params), disabled });
            return;
        }
        out.push({ path, depth, kind, type: '', params: {}, certain: sure, effect: 'flow', disabled });
        if (disabled) return;
        const sub = (key: string, s: boolean) => {
            if (Array.isArray(st[key])) planSteps(st[key], `${path}.${key}`, depth + 1, s, out);
        };
        switch (kind) {
            case 'if': sub('then', false); sub('else', false); break;
            case 'try': sub('steps', sure); sub('onError', false); break;
            case 'retry': sub('steps', sure); break;
            case 'repeat': sub('steps', st.mode === 'doWhile' ? sure : false); break;
            case 'forEach': case 'ensure': sub('steps', false); break;
            case 'switch':
                (st.cases || []).forEach((c: AnyStep, ci: number) => {
                    if (Array.isArray(c?.steps)) planSteps(c.steps, `${path}.cases.${ci}`, depth + 1, false, out);
                });
                sub('default', false);
                break;
            case 'parallel':
                (st.branches || []).forEach((b: AnyStep[], bi: number) => planSteps(b, `${path}.branches.${bi}`, depth + 1, sure, out));
                break;
        }
    });
    return out;
}

/** Counts per effect, disabled steps left out: the dry run's headline. */
export function planSummary(rows: PlanRow[]): Record<Effect, number> {
    const out: Record<Effect, number> = { nav: 0, read: 0, change: 0, delete: 0, network: 0, external: 0, flow: 0 };
    for (const r of rows) if (!r.disabled && r.kind === 'action') out[r.effect]++;
    return out;
}
