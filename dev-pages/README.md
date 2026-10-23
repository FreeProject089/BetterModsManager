# dev-pages/

Standalone pages used while developing BMM. **They are not part of the app.**

They live here rather than in `frontend/` because `frontend/` is `frontendDist` in
`src-tauri/tauri.conf.json`: everything in that directory is copied into the installer.
A test harness and two animation previews were shipping to every user, reachable inside
the packaged app.

| Page | What it is |
|---|---|
| `inline-actions-test.html` | 38 assertions for `frontend/src/core/inline-actions.ts`, run in a real browser engine. Covers the things reading cannot settle: that a delegated `mouseover`/`mouseout` pair behaves like the `mouseenter`/`mouseleave` it replaced, that `data-act-stop` really stops a click, that a value containing quotes survives the round trip. |
| `docs-article-check.html` | Parses one docs-hub article body (both languages) with the real HTML parser and reports what the browser built. `tsc` compiles those bodies whatever is inside them — they are ordinary string literals, so an unclosed `<ul>` is a valid TypeScript program. Open it as `?id=server-reach`. |
| `loader-preview.html` | The boot loader animation, on its own, for `scripts/record-loader.mjs`. |
| `vhs-exit-preview.html` | The exit animation, likewise, for `scripts/record-vhs-exit.mjs`. |

## Running them

They load their code from `../frontend/`, so serve the **repository root**, not this folder:

```bash
python -m http.server 8778
```

Then open `http://127.0.0.1:8778/dev-pages/inline-actions-test.html`. Opening the file
directly with `file://` does not work — the test page uses ES modules.

`security-guard.mjs` fails the build if an `.html` other than `index.html` appears in
`frontend/` again.
