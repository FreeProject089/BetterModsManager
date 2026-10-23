// The Storage Manager's live feed, without the app around it (so a test can import it).
//
// The governor's sampler (governor/telemetry.rs) runs only while somebody is subscribed and
// emits one `bmm://governor-tick` a second. Three things used to go wrong on this side:
//
//   · two renders in flight (a toggle re-rendering the modal while it was still drawing) each
//     subscribed and only one ever unsubscribed, so the sampler ran for the rest of the session;
//   · a closed modal stayed subscribed until the next tick happened to notice, and a window
//     hidden in the tray never stopped it at all;
//   · every tick rebuilt the queue's DOM, and ticks that arrived together (the main thread busy
//     for a moment) were each painted in turn.
//
// So: one feed, whose subscribe and unsubscribe are serialised; a `wanted` flag the caller
// derives from (modal open, a live tab shown, window visible) and re-evaluates on every one of
// those events; and a coalescer that paints only the latest sample, at most once a frame and at
// most once per `minMs`.

export interface LiveBridge {
    invoke(cmd: string, args?: Record<string, unknown>): Promise<unknown>;
    listen(event: string, cb: (e: { payload: unknown }) => void): Promise<() => void>;
}

export interface FrameScheduler {
    /** Run `cb` before the next paint (requestAnimationFrame in the app). */
    frame(cb: () => void): void;
    /** Run `cb` after `ms` (setTimeout in the app). */
    later(cb: () => void, ms: number): void;
    now(): number;
}

export const TICK_EVENT = 'bmm://governor-tick';
/** No faster than the sampler itself: a burst of queued ticks paints once. */
export const MIN_PAINT_MS = 900;
/** The tabs that show live values. The others read a status once and need no feed. */
export const LIVE_TABS: readonly string[] = ['intensity', 'game', 'live'];

/** Whether the feed should run. Every condition is needed; any one false stops it. */
export function liveWanted(s: { open: boolean; visible: boolean; tab: string }): boolean {
    return s.open && s.visible && LIVE_TABS.includes(s.tab);
}

export interface Coalescer<T> { push(v: T): void; cancel(): void; }

/** Paint only the latest value, at most once a frame and once per `minMs`. */
export function createCoalescer<T>(paint: (v: T) => void, minMs: number, sch: FrameScheduler): Coalescer<T> {
    let latest: T | undefined;
    let has = false;
    let pending = false;
    let last = Number.NEGATIVE_INFINITY;
    let dead = false;
    const flush = (): void => {
        pending = false;
        if (dead || !has) return;
        const wait = last + minMs - sch.now();
        if (wait > 0) { pending = true; sch.later(() => sch.frame(flush), wait); return; }
        has = false;
        last = sch.now();
        const v = latest as T;
        latest = undefined;
        paint(v);
    };
    return {
        push(v: T) {
            if (dead) return;
            latest = v;
            has = true;
            if (!pending) { pending = true; sch.frame(flush); }
        },
        cancel() { dead = true; has = false; latest = undefined; },
    };
}

/** The subscription itself. `set(true)` twice subscribes once; `set(false)` undoes it once. */
export class LiveFeed<T = unknown> {
    private chain: Promise<void> = Promise.resolve();
    private wanted = false;
    private subscribed = false;
    private unlisten: (() => void) | null = null;
    private co: Coalescer<T> | null = null;

    constructor(
        private readonly bridge: LiveBridge,
        private readonly paint: (s: T) => void,
        private readonly sch: FrameScheduler,
        private readonly minMs = MIN_PAINT_MS,
    ) {}

    get live(): boolean { return this.subscribed; }

    /** Ask for the feed on or off. Calls are applied in order; the last one wins. */
    set(want: boolean): Promise<void> {
        this.wanted = want;
        this.chain = this.chain.then(() => this.reconcile(), () => this.reconcile());
        return this.chain;
    }

    private async reconcile(): Promise<void> {
        if (this.wanted && !this.subscribed) {
            const co = createCoalescer<T>((s) => this.paint(s), this.minMs, this.sch);
            this.co = co;
            this.unlisten = await this.bridge.listen(TICK_EVENT, (e) => co.push(e.payload as T));
            this.subscribed = true;
            await this.bridge.invoke('resources_subscribe').catch(() => undefined);
        } else if (!this.wanted && this.subscribed) {
            this.co?.cancel();
            this.co = null;
            try { this.unlisten?.(); } catch { /* already gone */ }
            this.unlisten = null;
            this.subscribed = false;
            await this.bridge.invoke('resources_unsubscribe').catch(() => undefined);
        }
    }
}

/** What `bindLifecycle` needs from the page: the modal's overlay, the document, and the
 *  MutationObserver constructor (injected, so the test can run without a browser). */
export interface LifecycleEnv {
    overlay: { classList: { contains(c: string): boolean } };
    doc: { visibilityState?: string; addEventListener(t: string, f: () => void): void; removeEventListener(t: string, f: () => void): void };
    MutationObserver: new (cb: () => void) => { observe(target: unknown, opts: { attributes: boolean; attributeFilter: string[] }): void; disconnect(): void };
}

/** Keep `feed` on exactly while the modal is open, a live tab is shown and the window is
 *  visible. Returns `refresh` (call it after switching tabs) and `dispose`. Closing the modal
 *  stops the feed at once: the overlay's class is observed, no tick has to notice. */
export function bindLifecycle(env: LifecycleEnv, feed: { set(want: boolean): Promise<void> }, getTab: () => string): { refresh(): Promise<void>; dispose(): Promise<void> } {
    let disposed = false;
    const refresh = (): Promise<void> => {
        if (disposed) return feed.set(false);
        return feed.set(liveWanted({
            open: env.overlay.classList.contains('open'),
            visible: env.doc.visibilityState !== 'hidden',
            tab: getTab(),
        }));
    };
    const onVis = (): void => { void refresh(); };
    env.doc.addEventListener('visibilitychange', onVis);
    const mo = new env.MutationObserver(() => {
        if (!env.overlay.classList.contains('open')) void dispose(); else void refresh();
    });
    mo.observe(env.overlay, { attributes: true, attributeFilter: ['class'] });
    const dispose = (): Promise<void> => {
        if (!disposed) {
            disposed = true;
            mo.disconnect();
            env.doc.removeEventListener('visibilitychange', onVis);
        }
        return feed.set(false);
    };
    return { refresh, dispose };
}

/** A keyed list update: reuse the row for a key, create the missing ones, drop the rest, and
 *  keep the order. `update` should only write what changed. Returns how many rows were created
 *  or removed (0 on a tick where only numbers moved). */
export function reconcileKeyed<T>(
    parent: { children: ArrayLike<Element>; insertBefore(n: Element, ref: Element | null): unknown; removeChild(n: Element): unknown },
    items: T[],
    key: (item: T) => string,
    create: (item: T) => Element,
    update: (el: Element, item: T) => void,
): number {
    let churn = 0;
    const existing = new Map<string, Element>();
    for (const el of Array.from(parent.children)) {
        const k = (el as HTMLElement).dataset?.key;
        if (k != null) existing.set(k, el); else { parent.removeChild(el); churn++; }
    }
    let i = 0;
    for (const item of items) {
        const k = key(item);
        let el = existing.get(k);
        if (el) existing.delete(k);
        else { el = create(item); (el as HTMLElement).dataset.key = k; churn++; }
        update(el, item);
        const at = parent.children[i] ?? null;
        if (at !== el) parent.insertBefore(el, at);
        i++;
    }
    for (const el of existing.values()) { parent.removeChild(el); churn++; }
    return churn;
}

/** Set a text node only when it differs (a write, even of the same text, is a mutation). */
export function setText(el: { textContent: string | null } | null | undefined, text: string): void {
    if (el && el.textContent !== text) el.textContent = text;
}

/** Set an attribute only when it differs. */
export function setAttr(el: Element | null | undefined, name: string, value: string): void {
    if (el && el.getAttribute(name) !== value) el.setAttribute(name, value);
}
