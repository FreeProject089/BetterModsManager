/**
 * telemetry-link.ts — what a `bmm://telemetry/consent` or `bmm://telemetry/set` link may do.
 *
 * Any web page can open a bmm:// link. Before this existed, one line on a page —
 * `bmm://telemetry/consent?enabled=1&full=1` — turned telemetry on AND switched session replay
 * to UNMASKED (every text and image on screen) without a single question. So:
 *
 *   - `full=1` is never honoured from a link. Unmasked replay is switched on in
 *     Settings → Privacy, by hand, or not at all. `full=0` (masking back on) is kept.
 *   - anything that turns collection ON (consent, replay, bench) is only a REQUEST: the
 *     deep-link handler shows BMM's own consent dialog and nothing changes unless the user
 *     accepts it there.
 *   - a link that only turns things OFF still asks, but with a plain confirmation.
 *
 * Pure (no DOM, no Tauri) so the rule itself is tested against the compiled module.
 */

export interface TelemetryLinkRequest {
    consent?: boolean;
    replay?: boolean;
    replayFull?: boolean;
    bench?: boolean;
}

export interface TelemetryLinkPlan {
    /** What may be applied once the user confirms. `replayFull` can only ever be `false`. */
    apply: { consent?: boolean; replay?: boolean; replayFull?: false; bench?: boolean };
    /** Turns some collection ON: needs the consent dialog, not a plain confirmation. */
    widens: boolean;
    /** The link asked for unmasked replay and that part was dropped. */
    refusedUnmasked: boolean;
    /** Nothing left to ask about. */
    empty: boolean;
}

const flag = (q: URLSearchParams, k: string): boolean | undefined =>
    q.has(k) ? (q.get(k) === '1' || q.get(k) === 'true') : undefined;

/** Read the link's parameters, aliases included (`consent` for `enabled`, `replayFull` for `full`). */
export function parseTelemetryLink(q: URLSearchParams): TelemetryLinkRequest {
    return {
        consent: q.has('enabled') ? flag(q, 'enabled') : flag(q, 'consent'),
        replay: flag(q, 'replay'),
        replayFull: flag(q, 'full') ?? flag(q, 'replayFull'),
        bench: flag(q, 'bench'),
    };
}

export function planTelemetryLink(req: TelemetryLinkRequest): TelemetryLinkPlan {
    const apply: TelemetryLinkPlan['apply'] = {};
    if (req.consent !== undefined) apply.consent = req.consent;
    if (req.replay !== undefined) apply.replay = req.replay;
    if (req.bench !== undefined) apply.bench = req.bench;
    if (req.replayFull === false) apply.replayFull = false;
    const refusedUnmasked = req.replayFull === true;
    const widens = apply.consent === true || apply.replay === true || apply.bench === true;
    return { apply, widens, refusedUnmasked, empty: Object.keys(apply).length === 0 };
}
