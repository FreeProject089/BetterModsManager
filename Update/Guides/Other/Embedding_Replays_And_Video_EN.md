# Embedding replays (rrweb / .bmmreplay) & video in the docs

BMM records real, replayable clips of the app itself as `.bmmreplay` files (rrweb under the
hood) and can play them inline — in the **in-app** Help & Other hub *and* in the **BMM Docs**
website. This guide covers recording one and embedding it in both places, plus plain video.

> [!TIP]
> A `.bmmreplay` is a *vector* recording of the DOM, not a video: tiny, crisp at any zoom, and
> the player has play/pause, a scrubber, 1×/2×/4× speed and fullscreen. Prefer it over an MP4 for
> UI walkthroughs.

---

## 1. Record a clip

Two ways, both in the app:

- **Settings → Privacy → Session recorder (local)** — record a session, then **export** it to a
  `.bmmreplay` file.
- **Replay Studio** (DevTools) — record a chosen screen region, trim, and export.

A `.bmmreplay` is JSON: `{ bmmReplay, app, durationMs, events: [ … ] }` where `events` is a
standard rrweb array (an optional `regions` timeline can crop/follow a frame).

> [!NOTE]
> Keep clips **10–30 seconds** and focused on one screen. Long recordings make big files and a
> sluggish scrubber.

---

## 2. Embed in the in-app hub (`docs-hub.ts`)

Two equivalent ways — both render a **play card** that opens the in-app rrweb viewer
(`playReplayFromUrl`, `frontend/src/features/settings/replay-watcher.ts`).

**A. The `media` field** (shown above the article body):

```ts
{
  id: 'scheduler',
  title: { en: 'Scheduling & automation', fr: 'Planification & automatisation' },
  media: {
    kind: 'replay',
    src: 'https://freeproject089.github.io/BMM-Docs/assets/replays/scheduler.bmmreplay',
    caption: { en: 'Building an automation', fr: 'Construire une automatisation' },
  },
  body: { en: '…', fr: '…' },
},
```

**B. Inline in the body** with the md-lite `:::replay` directive:

```md
:::replay{src="https://…/assets/replays/scheduler.bmmreplay" title="Building an automation"}
:::
```

`media.kind` can also be `'image'` (`src` → `<img>`) or `'svg'` (inline SVG). There is no
`:::video` directive in-app; a body that starts with `<` is raw HTML, so a raw `<video>` also works.

> [!IMPORTANT]
> The in-app player **fetches the URL**, so the `.bmmreplay` must be reachable — host it on the
> BMM Docs site (recommended, they share the same recordings) or any URL BMM can reach.

---

## 3. Embed in BMM Docs (the MkDocs site)

The site uses a **raw HTML block**, not `:::replay`. The player script/CSS are already wired in
`mkdocs.yml` (`assets/rrweb/*`).

```html
<div class="bmm-replay"
     data-src="../assets/replays/scheduler.bmmreplay"
     data-title="Building an automation"></div>
```

- `data-src` is **relative to the page** — `../assets/replays/…` from `features/` or `reference/`,
  `assets/replays/…` from the docs root.
- `data-title` is the optional caption on the play poster.
- The player lazy-loads the (large) JSON only on click.

### Add the file with git-lfs

`.bmmreplay` files are tracked by **git-lfs** — `BMM Docs/.gitattributes` already has:

```
docs/assets/replays/*.bmmreplay filter=lfs diff=lfs merge=lfs -text
```

Drop your recording in `BMM Docs/docs/assets/replays/`, then:

```bash
git lfs install          # once per machine
git add docs/assets/replays/scheduler.bmmreplay
git commit -m "docs: add scheduler replay"
```

> [!CAUTION]
> If git-lfs isn't installed, the file commits as a tiny text pointer and the player shows nothing.
> `git lfs ls-files` should list your replay.

---

## 4. Video & YouTube

Neither system has a `:::video` directive, but both allow raw HTML (MkDocs via `md_in_html`, the
in-app hub via an HTML body). Use a real video only when a `.bmmreplay` can't capture it (game
footage, external tools):

```html
<video controls src="../assets/clips/demo.mp4"
       style="width:100%;border-radius:12px"></video>

<div class="yt-embed">
  <iframe src="https://www.youtube-nocookie.com/embed/VIDEO_ID" allowfullscreen></iframe>
</div>
```

Use `youtube-nocookie.com` for privacy. Self-hosted MP4s are large — keep them short, or link out
instead of embedding.

---

## 5. Checklist

- [ ] Clip recorded, trimmed to 10–30 s, exported as `.bmmreplay`.
- [ ] File in `BMM Docs/docs/assets/replays/`, committed **through git-lfs**.
- [ ] In-app: `media:{kind:'replay',src,caption}` **or** `:::replay{src=… title=…}`, `src` reachable.
- [ ] BMM Docs: `<div class="bmm-replay" data-src=… data-title=…>`, path relative to the page.
- [ ] Verified: play card appears and the viewer opens in **both** surfaces.
