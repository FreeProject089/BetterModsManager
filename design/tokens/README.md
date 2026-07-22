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
| `out/bmm.default.tokens.json` | The full default token set (120 tokens: colors, sizes, fonts, shadows, RGB channels, assets, motion) |
| `out/themes/bmm.<id>.tokens.json` | One file per built-in theme — **only its overrides** over the default set (the `vars` of its `.bmmtheme.json`) |

The files are **generated — do not edit by hand**; change `tokens.css` or a
`frontend/assets/builtin-themes/*.bmmtheme.json` and re-run.

## Import into Penpot

Penpot supports DTCG natively (Tokens panel → Tools → **Import**):

1. Import `bmm.default.tokens.json` — this becomes your base set.
2. Optionally import a `themes/bmm.<id>.tokens.json` as a **second set** and combine them in a
   theme: with both sets active, the theme's overrides win — exactly how `.bmmtheme` overlays
   work in the app.
3. Repeat per theme to mirror all 12 built-ins as Penpot themes.

## Import into Figma

Use the **Tokens Studio** plugin (or Figma Variables import): load
`bmm.default.tokens.json` as the source set, then each theme file as an additional set/mode.

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
