# BMM Design Tokens (W3C DTCG)

The `--bmm-*` CSS custom properties in `frontend/css/tokens.css` are BMM's official theming
surface. This folder converts them — plus every built-in theme — into standard
**[W3C Design Tokens (DTCG)](https://design-tokens.github.io/community-group/format/)** JSON,
importable into design tools.

## Regenerate

```bash
node design/tokens/generate-tokens.mjs
```

Outputs into `out/`:

| File | Contents |
|---|---|
| `out/bmm.penpot-bundle.tokens.json` | **Everything in one file** — the default set + all 12 themes as sets, with theme-switching pre-wired (`$themes` + `$metadata`). Import this for a one-shot setup. |
| `out/bmm.default.tokens.json` | The full default token set (130 tokens: colors, sizes incl. the 4-pt spacing scale, fonts, shadows, RGB channels, assets, motion) |
| `out/themes/bmm.<id>.tokens.json` | One file per built-in theme — **only its overrides** over the default set (the `vars` of its `.bmmtheme.json`) |

The files are **generated — do not edit by hand**; change `tokens.css` or a
`frontend/assets/builtin-themes/*.bmmtheme.json` and re-run.

## Use them in Penpot

Penpot has design-tokens support natively — no plugin needed.

### One-shot (recommended)

1. Open (or create) a Penpot **file**.
2. In the left panel switch to the **Tokens** tab.
3. Open the tab's menu (the **⋯ / Tools** control) → **Import**.
4. Choose **`out/bmm.penpot-bundle.tokens.json`**. Penpot creates one **set** per source
   (`default` + `themes/bmm-<id>`) and one **theme** per built-in (BMM Default, Sombre, Discord…).
5. In the **Themes** selector, pick a theme to preview it. `default` supplies the base values;
   the theme set overrides on top — exactly how `.bmmtheme` overlays work in the app.

### Manual (if you'd rather add sets yourself)

1. **Import** → `bmm.default.tokens.json` → becomes your base set.
2. **Import** a `themes/bmm.<id>.tokens.json` as a **second set**.
3. Create a Penpot **theme** with both sets active (default first, theme second so its overrides
   win). Repeat per built-in.

### Applying a token to something

Select a shape, then in the right-panel property (Fill / Stroke / Border radius / Sizing /
Spacing / Typography) click the **token** control and pick from the tree, e.g.
`bmm › color › accent`, `bmm › size › radius-card`, `bmm › size › space-4`. Change the active
theme and everything bound to a token re-colours at once.

## Use them in Figma

Use the **Tokens Studio** plugin: its import understands the same single-file bundle
(`bmm.penpot-bundle.tokens.json`) — load it and the sets + themes appear directly. (Or import
`bmm.default.tokens.json` as the source set and each theme file as an additional set/mode.)

## Notes & caveats

- **Aliases** (`{bmm.color.bg-elevated}`) mirror the `var(--bmm-*)` references in the CSS.
- **Untyped tokens** (no `$type`) are values that don't map cleanly to a DTCG type — computed
  `rgba(var(--bmm-…))` compositions, gradients, `url(...)` assets, multi-part shadows kept as
  raw strings. Importers may skip them; they're kept so the file remains a complete inventory.
- **RGB channels** (`channel/*`, e.g. `accent-r`) exist so the app can compose
  `rgba(var(--bmm-accent-r)…)` tints. In a design tool you'll normally use the composed colors
  and can ignore the channel group.
- The **brand wordmark** tokens (`color/brand-*`) are deliberately not themeable in the app —
  keep them fixed in your designs too.
