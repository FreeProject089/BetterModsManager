// laya-telemetry.ts — the "Laya usage statistics" telemetry category, the webview half.
//
// Every Laya feature is a Tauri command whose name starts with `ai_`. Rather than a call in
// each dialog, this watches those commands as they finish (api.ts setInvokeObserver) and turns
// each into a content-free event (telemetry-model.ts eventsForCommand): which feature, which
// provider, how long, whether it answered, which FIELDS were suggested and which were kept.
// Never a question, a mod or file name, a suggestion's value or an error message.
//
// The one thing a command cannot tell is that the reader clicked an Ask result: ai-ask.ts calls
// noteAskClick() for that, with the action (reduced here to its kind).
//
// Sending goes through analytics.track, which drops the event unless telemetry is accepted AND
// the Laya category is on. This module holds no switch of its own.

import { setInvokeObserver } from './api.js';
import { eventsForCommand, newObserverState, askClickKind } from './telemetry-model.js';

type Track = (event: string, props: Record<string, unknown>) => void;

let _track: Track | null = null;
const _state = newObserverState();

export function initLayaTelemetry(track: Track): void {
    _track = track;
    setInvokeObserver('ai_', (command, args, ok, result, ms) => {
        for (const e of eventsForCommand(_state, command, args, ok, result, ms)) _track?.(e.event, e.props);
    });
}

/** An Ask Laya result was opened. `action` is the result's action; only its kind is kept. */
export function noteAskClick(action: unknown): void {
    try { _track?.('laya_ask_click', { feature: 'ask', kind: askClickKind(action) }); } catch { /* never */ }
}
