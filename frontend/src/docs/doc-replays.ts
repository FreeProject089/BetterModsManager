// doc-replays.ts — whether Help & Other shows session replays (.bmmreplay) at all.
//
// One switch, read once from app.cfg (`DocsReplays=false`, see APP_CFG.md) through the
// `docs_replays_enabled` command. When it is off, every replay embed in the in-app docs renders
// as NOTHING: no player, no play button, no "replay hidden" note, and no fetch of the
// .bmmreplay file (the click paths check it too, so a page rendered before the setting arrived
// cannot start one either). Video clips (.mp4/.webm) are not replays and are left alone.
//
// No DOM and no Tauri import: md-lite's tests load the compiled renderer directly, and the
// renderer only needs to ask "on or off?".

let _enabled = true;

/** True unless app.cfg switched doc replays off. Default ON: a missing file changes nothing. */
export function docReplaysEnabled(): boolean {
    return _enabled;
}

/** Set by the docs hub once app.cfg has been read (and by tests). */
export function setDocReplaysEnabled(on: boolean): void {
    _enabled = on !== false;
}

let _loaded: Promise<boolean> | null = null;

/**
 * Read the switch once. A failed call (no bridge, old backend) keeps the default, ON, because
 * a config file nobody wrote must not take content away.
 */
export function loadDocReplaysSetting(invoke: (cmd: string, args?: Record<string, unknown>, opts?: Record<string, unknown>) => Promise<unknown>): Promise<boolean> {
    if (!_loaded) {
        _loaded = invoke('docs_replays_enabled', {}, { quiet: true })
            .then((v) => { setDocReplaysEnabled(v !== false); return _enabled; })
            .catch(() => _enabled);
    }
    return _loaded;
}
