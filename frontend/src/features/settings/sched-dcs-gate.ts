// The « DCS server join gate » template: check you are ready for a server, then join it.
//
// Built here, not as a static preset, because it is made from ANSWERS: the server, whether
// the server checks players, the mod list it requires, where DCS is. The guided form asks only
// those, shows a dry run first, and then writes an ordinary automation — with a package that
// carries the hook script (and the list, so the whole gate can be exported and handed to the
// server's players as one .bmmbundle).
//
// What the automation does, in order:
//   1. (server checks players) installs BMM-JoinGate.lua into Saved Games\DCS*\Scripts\Hooks —
//      asked in a BMM dialog, with a receipt — and checks it is there, identical;
//   2. checks the mod list: every mod installed and switched on, nothing else on (« only these
//      mods »), each deployed file still in the game folder, each file the list hashes intact;
//   3. (server checks players) writes the result where the hook reads it
//      (Saved Games\DCS*\Config\bmm-joingate.json, signed with your BMM key);
//   4. passing: starts DCS (with your arguments) and puts the server address on the clipboard;
//      DCS has no supported command-line option to join a server, so BMM does not invent one —
//      you paste the address in Multiplayer › Connect by IP;
//   5. failing: does not start DCS, says what is wrong, and offers to fix it: switch the list on
//      and install what is missing from the sources the list names, then check again.
//
// The KICK is the server's: BMM-JoinGate-Server.lua, which an admin installs on their own
// server and configures. BMM never touches a server and nothing here bypasses DCS's rules.
//
// `buildJoinGate` is pure (tests/sched-dcs-gate.test.mjs); the form below is the only DOM.

import { buildGraph, type AnyStep } from './sched-flow-model.js';
import { frameAround, type FlowFrame, type FlowUi } from './sched-flow-ui.js';

export const HOOK_FILE = 'files/BMM-JoinGate.lua';
export const SERVER_HOOK_FILE = 'files/BMM-JoinGate-Server.lua';
export const HOOK_DEST = 'Scripts/Hooks';

export interface GateOptions {
    server: string;
    serverName?: string;
    /** The server checks players: install the hook and write the report. */
    whitelist: boolean;
    /** The list, as carried by the package (`files/<name>.mm`), or a path on this PC. */
    listFile?: string;
    listPath?: string;
    exact: boolean;
    dcsExe: string;
    dcsArgs?: string;
    grantFiles: boolean;
    grantCommand: boolean;
}

/** The sentences the automation shows, in the reader's language (filled by the caller). */
export interface GateWords {
    name: string;
    description: string;
    hookMissing: string;
    joinHow: string;
    notReadyTitle: string;
    notReadyBody: string;
    fixYes: string;
    fixNo: string;
    stopped: string;
    readyTitle: string;
    readyBody: string;
    launchYes: string;
    stillBad: string;
    frameHook: string;
    frameCheck: string;
    frameJoin: string;
}

/** The sentences of the automation, in the language of the person creating it. */
export function gateWords(t: (key: string, params?: Record<string, string>) => string): GateWords {
    // The placeholders stay placeholders here: buildJoinGate fills them with the answers.
    return {
        name: t('sched.dg.taskName', { name: '{name}' }),
        description: t('sched.dg.taskDesc', { name: '{name}' }),
        hookMissing: t('sched.dg.hookMissing', { name: '{name}' }),
        joinHow: t('sched.dg.joinHow', { server: '{server}' }),
        notReadyTitle: t('sched.dg.notReadyTitle', { name: '{name}' }),
        notReadyBody: t('sched.dg.notReadyBody'),
        fixYes: t('sched.dg.fixYes'),
        fixNo: t('sched.dg.fixNo'),
        stopped: t('sched.dg.stopped', { name: '{name}' }),
        readyTitle: t('sched.dg.readyTitle', { name: '{name}' }),
        readyBody: t('sched.dg.readyBody'),
        launchYes: t('sched.dg.launchYes'),
        stillBad: t('sched.dg.stillBad'),
        frameHook: t('sched.dg.frameHook'),
        frameCheck: t('sched.dg.frameCheck'),
        frameJoin: t('sched.dg.frameJoin'),
    };
}

const act = (type: string, params: Record<string, unknown>): AnyStep => ({ kind: 'action', action: { type, params } });
const isVal = (source: string, value: number) => ({ type: 'value', params: { source, op: '==', value } });

/** Fill `{server}` and `{name}` in a sentence. */
function fill(s: string, o: GateOptions): string {
    return s.split('{server}').join(o.server).split('{name}').join(o.serverName || o.server);
}

export function buildJoinGate(o: GateOptions, w: GateWords, pkg?: { id: string; name: string; signature: string }): Record<string, any> {
    const list: Record<string, unknown> = o.listFile ? { file: o.listFile } : { path: o.listPath || '' };
    const verify = act('modlist.verify', { ...list, exact: o.exact, hashes: true });
    const report = act('gate.report', { server: o.server, root: 'dcs' });
    const launch = act('game.launch', { exe: o.dcsExe, args: o.dcsArgs || '', clipboard: o.server });
    const how = act('notify', { message: fill(w.joinHow, o) });

    const hook: AnyStep[] = o.whitelist ? [
        act('pkg.install', { file: HOOK_FILE, root: 'dcs', dest: HOOK_DEST }),
        act('pkg.verify', { file: HOOK_FILE, root: 'dcs', dest: HOOK_DEST }),
        {
            kind: 'if', condition: isVal('pkg.ok', 0),
            then: [act('notify', { message: fill(w.hookMissing, o) }), act('task.stop', { reason: fill(w.hookMissing, o) })],
            else: [],
        },
    ] : [];

    const fix: AnyStep[] = [
        act('modlist.apply', { path: '{list.path}', install: true, exact: o.exact }),
        act('modlist.verify', { ...list, exact: o.exact, hashes: true }),
        ...(o.whitelist ? [act('gate.report', { server: o.server, root: 'dcs' })] : []),
        {
            kind: 'if', condition: isVal('list.ok', 1),
            then: [
                act('ui.ask', { title: fill(w.readyTitle, o), message: fill(w.readyBody, o), yes: w.launchYes, no: w.fixNo }),
                { kind: 'if', condition: isVal('ask.yes', 1), then: [launch, how], else: [] },
            ],
            else: [act('notify', { message: fill(w.stillBad, o) })],
        },
    ];

    const steps: AnyStep[] = [
        ...hook,
        verify,
        ...(o.whitelist ? [report] : []),
        {
            kind: 'if', condition: isVal('list.ok', 1),
            then: [launch, how],
            else: [
                act('ui.ask', { title: fill(w.notReadyTitle, o), message: fill(w.notReadyBody, o), yes: w.fixYes, no: w.fixNo, tone: 'warn' }),
                { kind: 'if', condition: isVal('ask.yes', 1), then: fix, else: [act('task.stop', { reason: fill(w.stopped, o) })] },
            ],
        },
    ];

    const perms: Record<string, boolean> = {};
    if (o.grantFiles) perms.files = true;
    if (o.grantCommand) perms.command = true;

    return {
        name: fill(w.name, o),
        description: fill(w.description, o),
        trigger: { type: 'manual' },
        steps,
        perms,
        allowCustomCommands: false,
        ...(pkg ? { pkg } : {}),
        ui: gateUi(steps, o.whitelist, w),
    };
}

/** Three frames, so the automation reads as what it is the first time it is opened. */
function gateUi(steps: AnyStep[], whitelist: boolean, w: GateWords): FlowUi {
    const g = buildGraph(steps, null);
    const boxes = (pred: (path: string) => boolean) => g.nodes.filter((n) => n.type !== 'trigger' && pred(n.id)).map((n) => ({ id: n.id, x: n.x, y: n.y, w: n.w, h: n.h }));
    // Joins (`2#join`) and empty-lane buttons (`2.else#add`) belong to their block's frame too:
    // a folded frame must hide the whole block, not leave its join floating.
    const top = (id: string) => Number(id.split(/[.#]/)[0]);
    const nHook = whitelist ? 3 : 0;
    const frames: FlowFrame[] = [];
    if (whitelist) frames.push(frameAround(boxes((p) => top(p) < nHook), 'gate-hook', w.frameHook, 'warning'));
    frames.push(frameAround(boxes((p) => /^\d+$/.test(p) && top(p) >= nHook && top(p) < steps.length - 1), 'gate-check', w.frameCheck, 'info'));
    frames.push(frameAround(boxes((p) => top(p) === steps.length - 1), 'gate-join', w.frameJoin, 'success'));
    return { v: 1, frames, folder: 'DCS', tags: ['dcs', 'server'] };
}
