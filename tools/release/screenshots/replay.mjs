// .bmmreplay recordings made in the same headless preview as the GIFs (gifs.mjs, stories.mjs).
//
// The recorder is the app's own: js/core/replay-recorder.js, the module behind the Session
// recorder and Replay Studio, with the same rrweb options (no pointer moves, coarse scroll,
// Tasky blocked) and the same image inlining. The preview only subscribes one more listener to
// it, in full mode (demo data: nothing to mask), and writes the events in the envelope the app's
// players read (replay-watcher.ts, Replay Studio, the docs site's bmm-replay.js):
//
//   { bmmReplay: 1, app, createdAt, masked: false, durationMs, title, markers: [{ t, label }],
//     events: [...rrweb events], demo: true, recordedWith }
//
// `markers` are the chapters the in-app player draws over its scrubber (one per story step).
// The drawn GIF pointer (#gif-cursor) is ordinary DOM, so it is recorded too: the replay shows
// where the clip's pointer went even though rrweb's own mouse-move track is off.

/** Start recording the page. Resolves once the recorder has restarted with a full snapshot. */
export async function startReplay(page) {
  await page.evaluate(async () => {
    try { localStorage.setItem('bmm_replay_full', '1'); } catch { /* storage off */ }
    const m = await import('/js/core/replay-recorder.js');
    const rec = { events: [], m };
    const l = (ev) => { rec.events.push(ev); };
    l.requiresMasking = false;
    rec.listener = l;
    window.__gifReplay = rec;
    await m.subscribeReplay(l);
    // If the app's own recorder was already running with this configuration, subscribing does
    // not restart it, and this listener would only ever see incremental events: a file no
    // player opens. A new block list restarts it, which emits Meta + FullSnapshot to everyone.
    rec.events.push({ __start: true });
    await m.setExtraBlockSelectors([`[data-gif-replay-${Date.now()}]`]);
  });
  // The restart and the asset inlining run on a promise chain: give the snapshot time to land.
  await new Promise((r) => setTimeout(r, 600));
}

/** Stop and return the playable events (from the first Meta after the restart). */
export async function stopReplay(page) {
  await new Promise((r) => setTimeout(r, 400));
  const events = await page.evaluate(async () => {
    const rec = window.__gifReplay;
    if (!rec) return [];
    await rec.m.unsubscribeReplay(rec.listener);
    await rec.m.setExtraBlockSelectors([]);
    const all = rec.events;
    const from = all.findIndex((e) => e && e.__start);
    const tail = all.slice(from + 1);
    const meta = tail.findIndex((e) => e.type === 4);
    window.__gifReplay = null;
    return meta < 0 ? [] : tail.slice(meta);
  });
  return events;
}

/** Why a replay would not play, or null. Same checks as Replay Studio's playabilityProblem. */
export function replayProblem(events) {
  if (!Array.isArray(events) || events.length < 2) return 'fewer than two events';
  if (events[0].type !== 4) return 'does not start with a Meta event';
  if (!events.some((e) => e.type === 2)) return 'no full snapshot';
  return null;
}

/**
 * The .bmmreplay text. `origin` (the preview's http://127.0.0.1:port/) is removed from every URL
 * so a reader's player never asks the reader's own machine for a file; images are already inlined
 * by the recorder. `markers` are [{ at (epoch ms), label }] and become [{ t (ms from start), label }].
 */
export function buildReplay(events, { title = '', markers = [], origin = '', dropMoves = true } = {}) {
  let evs = events;
  // Pointer moves (source 1) and touch moves (source 6) are the bulk of a long take and the
  // drawn pointer already shows the path. The app records none; this only guards a change there.
  if (dropMoves) evs = evs.filter((e) => !(e.type === 3 && (e.data?.source === 1 || e.data?.source === 6)));
  const t0 = evs[0].timestamp;
  const durationMs = evs[evs.length - 1].timestamp - t0;
  const bundle = {
    bmmReplay: 1,
    app: 'BetterModsManager',
    createdAt: new Date().toISOString(),
    masked: false,
    durationMs,
    title: String(title).slice(0, 120),
    markers: markers.map((m) => ({ t: Math.max(0, Math.round(m.at - t0)), label: String(m.label).slice(0, 80) }))
      .filter((m) => m.t <= durationMs),
    demo: true,
    recordedWith: 'tools/release/screenshots (browser preview, demo data)',
    events: evs,
  };
  let text = JSON.stringify(bundle);
  if (origin) text = text.split(origin).join('');
  return text;
}

/**
 * The recorder inlines every <img> of the page as a data URL, at its full size, hidden dialogs
 * included: Tasky's 1000 px poses and the illustrations alone are ~7 MB of a 12 MB take. Each
 * big picture is redrawn in the page at `maxEdge` px at most (WebP), which is more than any of
 * them is ever displayed at. Animated GIFs and pictures that would not get smaller are kept.
 * Returns the new text.
 */
export async function shrinkReplayImages(page, text, { minBytes = 40000, maxEdge = 420, quality = 0.82 } = {}) {
  const re = /data:image\/(?:png|jpeg|jpg|webp);base64,[A-Za-z0-9+/=]+/g;
  const big = [...new Set(text.match(re) || [])].filter((u) => u.length >= minBytes);
  if (!big.length) return text;
  const map = new Map();
  for (const url of big) {
    const out = await page.evaluate(async (u, edge, q) => {
      try {
        const img = new Image();
        img.src = u;
        await img.decode();
        const k = Math.min(1, edge / Math.max(img.naturalWidth, img.naturalHeight));
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(img.naturalWidth * k)); c.height = Math.max(1, Math.round(img.naturalHeight * k));
        const g = c.getContext('2d');
        g.imageSmoothingQuality = 'high';
        g.drawImage(img, 0, 0, c.width, c.height);
        return c.toDataURL('image/webp', q);
      } catch { return null; }
    }, url, maxEdge, quality);
    if (out && out.length < url.length * 0.8) map.set(url, out);
  }
  if (!map.size) return text;
  return text.replace(re, (u) => map.get(u) ?? u);
}
