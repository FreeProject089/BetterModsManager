// The resources dashboard's pure parts (G6), apart so a test can import them without the
// app (resources-dash.ts reaches the Tauri API and the app state at import).
export const HISTORY = 60;
/** Keep the last HISTORY values of a series, oldest first.  */
export function pushHistory(arr: number[], v: number, max = HISTORY): number[] {
    const out = arr.concat([Number.isFinite(v) ? v : 0]);
    return out.length > max ? out.slice(out.length - max) : out;
}

/** An SVG polyline for a 0..ceil series in a w×h box.  */
export function sparkPoints(values: number[], w: number, h: number, ceil: number): string {
    if (!values.length) return '';
    const top = Math.max(ceil, ...values, 1e-9);
    const step = values.length > 1 ? w / (values.length - 1) : 0;
    return values.map((v, i) => `${(i * step).toFixed(1)},${(h - (Math.max(0, v) / top) * h).toFixed(1)}`).join(' ');
}


/** One matrix row's inputs → the rule to store (S1). An empty input is "inherit", so it is
 *  left out; a row with nothing set is `null`, which removes the rule. Numbers are floored
 *  and anything non-numeric or below 1 is dropped rather than stored. */
export function ruleFromInputs(v: { rate?: string; parallel?: string; buffer?: string; io?: string }): Record<string, unknown> | null {
    const num = (s?: string) => { const n = Math.floor(Number(String(s ?? '').trim())); return String(s ?? '').trim() !== '' && Number.isFinite(n) && n >= 1 ? n : undefined; };
    const out: Record<string, unknown> = {};
    const rate = num(v.rate), parallel = num(v.parallel), buffer = num(v.buffer);
    if (rate !== undefined) out.rate_mb_s = rate;
    if (parallel !== undefined) out.parallel = parallel;
    if (buffer !== undefined) out.buffer_kib = buffer;
    if (v.io === 'low' || v.io === 'normal') out.io_priority = v.io;
    return Object.keys(out).length ? out : null;
}

/** A pause-all in force (owner card 2): who set it and, unless the user did, when it ends. */
export interface PausedAll { by: string; age_ms: number; remaining_ms: number | null; }

/** The "everything is paused" line: who paused (`user`, `task:<name>`, `plugin:<id>`, `api`)
 *  and, for anything but the user's own pause, when it ends by itself (TASK_PAUSE_MAX, 30 min).
 *  Plain text: the caller puts it in `textContent`. `t` is i18n's (a parameter, so the tests
 *  can call it without the i18n module); an empty answer falls back to the English text. */
export function pausedAllText(p: PausedAll, t: (k: string) => string): string {
    const by = String(p.by || '');
    const [kind, ...rest] = by.split(':');
    const name = rest.join(':');
    let who: string;
    if (by === 'user') who = t('res.pausedBy.user') || 'Paused by you, until you resume it.';
    else if (by === 'game') who = t('stm.game.pausedByGame') || 'Paused by you until you close the app: it resumes by itself when app mode ends.';
    else if (kind === 'task' && name) who = (t('res.pausedBy.task') || 'Paused by the task “{n}”.').replace('{n}', name);
    else if (kind === 'plugin' && name) who = (t('res.pausedBy.plugin') || 'Paused by the plugin {n}.').replace('{n}', name);
    else if (by === 'api') who = t('res.pausedBy.api') || 'Paused through the local API.';
    else who = t('res.pausedBy.unknown') || 'Paused by an automation.';
    const left = p.remaining_ms == null ? ''
        : ' ' + (t('res.pausedLeft') || 'Resumes by itself in {m} min.').replace('{m}', String(Math.max(1, Math.ceil(p.remaining_ms / 60000))));
    return `${t('res.pausedAll') || 'Everything is paused: deploys and installs wait until it is resumed.'} ${who}${left}`;
}

/** What WebGL says draws the window, in words (the Storage Manager's Graphics tab). */
export interface RendererInfo { name: string; api: string; software: boolean; raw: string; }

/** ANGLE on Windows reports "ANGLE (AMD, AMD Radeon RX 7800 XT (0x0000747E) Direct3D11 vs_5_0
 *  ps_5_0, D3D11)": the card is the second part, without its PCI id and shader models. An empty
 *  string means no WebGL context at all, which only happens when nothing draws with a GPU. */
export function describeRenderer(raw: string): RendererInfo {
    const s = String(raw || '').trim();
    const software = !s || /swiftshader|llvmpipe|softpipe|basic render|software rasteri|\bwarp\b/i.test(s);
    let name = s;
    let api = '';
    const m = /^ANGLE \((.*)\)$/.exec(s);
    if (m) {
        const inner = m[1];
        const parts = inner.split(', ');
        const dev = parts.length >= 2 ? parts[1] : parts[0];
        api = /Direct3D11|D3D11/.test(inner) ? 'Direct3D 11' : /Direct3D9|D3D9/.test(inner) ? 'Direct3D 9'
            : /Vulkan/i.test(inner) ? 'Vulkan' : /OpenGL/i.test(inner) ? 'OpenGL' : '';
        name = dev.replace(/\s*\(0x[0-9a-f]+\)/gi, '').replace(/\s+(Direct3D\S*|vs_\d\S*|OpenGL.*|Vulkan.*)(\s.*)?$/i, '').trim();
    }
    return { name: name || s, api, software, raw: s };
}

/** What to tell the user about the cards: how many real ones the PC has, and whether the window
 *  is drawn by the processor although it has one and the user did not turn the GPU off (a
 *  blocklisted or crashed driver, which an update usually fixes). */
export function gpuAdvice(v: { renderer: RendererInfo; gpus: { name: string; software?: boolean }[]; activeMode: string }): { cards: number; softwareFallback: boolean } {
    const cards = (v.gpus || []).filter((g) => !g.software).length;
    return { cards, softwareFallback: v.renderer.software && cards > 0 && v.activeMode !== 'off' };
}

// ── Game mode, in words (the Game mode tab) ──────────────────────────────────────────────────

export type GameSource = 'profile_folder' | 'listed' | 'exclusive_fullscreen' | 'fullscreen_window' | 'forced';
export interface GameTrigger { exe: string; name: string; source: GameSource; dir?: string | null; }
/** governor/game_mode.rs `GameView`. */
export interface GameView {
    active: boolean; manual: 'auto' | 'on' | 'off'; trigger: GameTrigger | null;
    since_ms: number | null; leaving_in_ms: number | null;
    watched_dirs: string[]; paused_kinds: string[]; leave_after_secs: number;
}
/** governor/config.rs `GameOptions`. */
export interface GameOptions { pause: string[]; leave_after_secs: number; notify: boolean; fullscreen_window: boolean; ignored_dirs: string[]; hold_scheduler?: boolean; }

type T = (k: string) => string;
/** t() with the English text on a miss (t() answers a miss with the key, or '' in the tests). */
const say = (t: T, k: string, en: string): string => { const v = t(k); return v && v !== k ? v : en; };

/** A folder as game mode compares it (config.rs `norm_game_dir`): lower case, `\`, one trailing `\`. */
export function normGameDir(p: string): string {
    let s = String(p || '').trim().replace(/\//g, '\\').toLowerCase();
    while (s.endsWith('\\\\')) s = s.slice(0, -1);
    return s.endsWith('\\') ? s : s + '\\';
}

/** A drive root (`c:\`, `\`, `\\server\share\`): never watched, a whole drive is not a game. */
export function isWholeDrive(dir: string): boolean {
    if (dir === '\\' || /^[a-z]:\\$/i.test(dir)) return true;
    if (dir.startsWith('\\\\')) return dir.slice(2).replace(/\\+$/, '').split('\\').length <= 2;
    return false;
}

/** "4 s", "2 min", "1 h 5 min". */
export function durationText(ms: number, t: T): string {
    const s = Math.max(0, Math.round(ms / 1000));
    if (s < 60) return say(t, 'stm.dur.s', '{n} s').replace('{n}', String(s));
    const m = Math.floor(s / 60);
    if (m < 60) return say(t, 'stm.dur.min', '{n} min').replace('{n}', String(m));
    return say(t, 'stm.dur.h', '{h} h {m} min').replace('{h}', String(Math.floor(m / 60))).replace('{m}', String(m % 60));
}

/** The status line's headline. */
export function gameHeadline(v: GameView, t: T): string {
    if (v.manual === 'off') return say(t, 'stm.game.hOff', 'App mode is off: BMM never steps aside');
    if (v.manual === 'on') return say(t, 'stm.game.hForced', 'App mode is forced on');
    if (!v.active || !v.trigger) return say(t, 'stm.game.hNone', 'No app detected');
    const src = v.trigger.source;
    if (src === 'exclusive_fullscreen') return say(t, 'stm.game.hFullscreen', 'An app is running in full screen');
    return say(t, 'stm.game.hGame', 'An app is running: {g}').replace('{g}', v.trigger.name || '?');
}

/** Where the game was found, since when, and the cooldown left once it closed. */
export function gameDetail(v: GameView, profiles: { name: string; game_path: string }[], t: T): string {
    if (!v.active || !v.trigger || v.manual !== 'auto') return '';
    const tr = v.trigger;
    let where: string;
    if (tr.source === 'profile_folder') {
        const p = profiles.find((x) => x.game_path && normGameDir(x.game_path) === tr.dir);
        where = p ? say(t, 'stm.game.fromProfile', 'Found in the app folder of your profile “{p}”.').replace('{p}', p.name)
            : say(t, 'stm.game.fromProfileAny', 'Found in one of your profiles\' app folders.');
    } else if (tr.source === 'listed') where = say(t, 'stm.game.fromList', 'It is in your list of apps.');
    else if (tr.source === 'exclusive_fullscreen') where = say(t, 'stm.game.fromExclusive', 'Windows says a program runs in exclusive full screen.');
    else where = say(t, 'stm.game.fromWindow', 'Its window covers the whole screen.');
    const parts = [where];
    if (v.since_ms != null) parts.push(say(t, 'stm.game.since', 'On for {d}.').replace('{d}', durationText(v.since_ms, t)));
    if (v.leaving_in_ms != null) parts.push(say(t, 'stm.game.leaving', 'The app closed: back to normal in {d}.').replace('{d}', durationText(v.leaving_in_ms, t)));
    return parts.join(' ');
}

/** Each profile's game folder, and whether it is watched (a profile with none is left out). */
export function profileFolders(profiles: { name: string; game_path: string }[], ignored: string[]): { name: string; path: string; dir: string; ignored: boolean; wholeDrive: boolean }[] {
    const ign = new Set((ignored || []).map(normGameDir));
    return (profiles || []).filter((p) => String(p.game_path || '').trim()).map((p) => {
        const dir = normGameDir(p.game_path);
        return { name: p.name, path: p.game_path, dir, ignored: ign.has(dir), wholeDrive: isWholeDrive(dir) };
    });
}

// ── Words for the Storage Manager's rows (sizes, what a queued operation is about) ──────────────

/** "1,5 To", "820 Go": a size in the user's language (Intl number, the unit word from `t`). */
export function sizeText(bytes: number, t: T, lang = 'en'): string {
    const units: [string, string][] = [['stm.unit.b', 'B'], ['stm.unit.kb', 'KB'], ['stm.unit.mb', 'MB'], ['stm.unit.gb', 'GB'], ['stm.unit.tb', 'TB']];
    let v = Math.max(0, Number(bytes) || 0), i = 0;
    while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
    let num: string;
    try { num = new Intl.NumberFormat(lang, { maximumFractionDigits: v < 10 && i > 0 ? 1 : 0 }).format(v); } catch { num = (v < 10 && i > 0 ? v.toFixed(1) : Math.round(v).toString()); }
    return `${num} ${say(t, units[i][0], units[i][1])}`;
}

/** "1,5 To sur 1,8 To". */
export function usedOfText(used: number, total: number, t: T, lang = 'en'): string {
    return say(t, 'stm.space.usedOf', '{u} of {t}').replace('{u}', sizeText(used, t, lang)).replace('{t}', sizeText(total, t, lang));
}

/** What the backend's ticket subjects start with (the `begin(kind, subject)` calls), in words. */
const SUBJECTS: [prefix: string, key: string, en: string][] = [
    ['content id ', 'stm.subj.contentId', 'Identifying'],
    ['rehash ', 'stm.subj.rehash', 'Re-checking files'],
    ['hash ', 'stm.subj.hash', 'Checking files'],
    ['integrity ', 'stm.subj.integrity', 'Verifying'],
    ['verify integrity (profile)', 'stm.subj.verifyProfile', 'Verifying the profile'],
    ['disk benchmark ', 'stm.subj.diskBench', 'Testing the disk'],
    ['size ', 'stm.subj.size', 'Measuring'],
    ['scan ', 'stm.subj.scan', 'Scanning'],
    ['find logs ', 'stm.subj.findLogs', 'Looking for logs'],
    ['mapper ', 'stm.subj.mapper', 'Mapping'],
    ['redact old reports', 'stm.subj.redact', 'Cleaning old reports'],
    ['load order', 'stm.subj.loadOrder', 'Applying the load order'],
    ['export mod list', 'stm.subj.exportList', 'Exporting the mod list'],
    ['repo export → ', 'stm.subj.repoExport', 'Exporting a repository'],
    ['repo update → ', 'stm.subj.repoUpdate', 'Updating a repository'],
    ['repo manifest ← ', 'stm.subj.repoManifest', 'Building a manifest'],
    ['direct update → ', 'stm.subj.directUpdate', 'Updating'],
    ['catalog bundle → ', 'stm.subj.catalogBundle', 'Packing a catalog'],
    ['crop → ', 'stm.subj.crop', 'Cropping an image'],
    ['icon → ', 'stm.subj.icon', 'Making an icon'],
    ['launch pack icon <- ', 'stm.subj.icon', 'Making an icon'],
];
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;

/** A queued operation's subject as a person reads it: the action in words, then the file or
 *  folder by its last name only ("Checking files: SkyUI"), never an internal id. */
export function humanSubject(subject: string, t: T): string {
    const s = String(subject || '').trim();
    const low = s.toLowerCase();
    const hit = SUBJECTS.find(([p]) => low.startsWith(p));
    let rest = hit ? s.slice(hit[0].length) : s;
    rest = rest.replace(UUID, '').trim();
    if (/[\\/]/.test(rest)) rest = rest.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || rest;
    if (!hit) return rest || s;
    const verb = say(t, hit[1], hit[2]);
    return rest ? say(t, 'stm.subj.join', '{v}: {s}').replace('{v}', verb).replace('{s}', rest) : verb;
}

// ── Game detection: what is never a game ────────────────────────────────────────────────────

/** Programs that are never a game by themselves (governor/game_mode.rs NOT_GAMES, the same
 *  list; a test compares the two): browsers, players, chat, launchers, editors. The Game mode
 *  tab leaves them out of "pick a running program" and warns when one is added by hand. */
export const NOT_GAMES: readonly string[] = [
    'firefox.exe', 'chrome.exe', 'msedge.exe', 'opera.exe', 'brave.exe', 'vivaldi.exe', 'iexplore.exe',
    'waterfox.exe', 'librewolf.exe', 'zen.exe', 'arc.exe', 'floorp.exe',
    'vlc.exe', 'mpv.exe', 'mpc-hc.exe', 'mpc-hc64.exe', 'mpc-be64.exe', 'potplayermini64.exe', 'wmplayer.exe',
    'discord.exe', 'spotify.exe', 'obs64.exe', 'teams.exe', 'ms-teams.exe', 'slack.exe', 'zoom.exe',
    'steam.exe', 'steamwebhelper.exe', 'epicgameslauncher.exe', 'galaxyclient.exe', 'eadesktop.exe',
    'ubisoftconnect.exe', 'upc.exe', 'battle.net.exe',
    'code.exe', 'explorer.exe', 'powerpnt.exe',
];

/** Is this executable (a name or a full path) one of NOT_GAMES? */
export function isKnownNonGame(exe: string): boolean {
    const name = String(exe || '').split(/[\\/]/).pop()!.toLowerCase();
    return NOT_GAMES.includes(name);
}
