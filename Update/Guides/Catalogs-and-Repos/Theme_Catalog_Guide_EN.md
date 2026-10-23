# Theme Catalog Guide (BMM)

BMM themes restyle the app UI. They are shared through the **theme catalog** and
packaged as a `.bmmtheme` file (a ZIP). This guide covers the package format and how
to publish one.

> **Build a catalog in-app:** open the **Theme Catalogue** and click **"Catalogues…"** — the
> same screen every other kind of catalogue uses. **Create one** ticks the installed themes
> to include and writes either one `.bmmbundle` or one `catalog.json`; **Follow** takes an
> address *or a file*, and handles a protected source. Host the file anywhere and add its URL
> as a source, or host it on **BetterCommunity** (`/submit → Host my own catalog`) as a public
> or **private** (invite-only) catalog. Local `.json`/`.bmmtheme` files added as sources are
> read directly (no server round-trip).
>
> Themes have a third per-entry choice the other kinds do not: **keep it in the catalogue**,
> the whole theme written inline. It is what every theme catalogue published so far contains
> and still the default — and it works for a custom theme with images, because a theme is
> self-contained JSON whose preview, assets and fonts are base64 inside it. The cost is that
> everybody following the catalogue downloads all of it just to read the list, so an
> image-heavy theme is better **packed** or **linked**.

---

## 1. `.bmmtheme` package structure

A `.bmmtheme` is a ZIP archive containing:

| Entry | Required | Purpose |
|---|---|---|
| `theme.json` | **Yes** | The theme manifest — tokens + metadata |
| `assets/` | No | Optional images/fonts referenced by the theme |

### `theme.json`

```json
{
  "id": "midnight-orange",
  "name": "Midnight Orange",
  "author": "FreeProject089",
  "version": "1.0.0",
  "mode": "dark",
  "vars": {
    "--bmm-bg-base": "#0e0c09",
    "--bmm-bg-elevated": "#15171e",
    "--bmm-accent": "#f97316",
    "--bmm-text-primary": "#e2e6ee"
  },
  "element_overrides": [
    { "selector": ".sidebar", "props": { "border-radius": "14px" } }
  ]
}
```

| Field | Type | Required | Purpose |
|---|---|---|---|
| `id` | string | **Yes** | Unique slug (lowercase, dashes). The only field the installer strictly requires. |
| `name` | string | Yes (in practice) | Display name shown in the theme list |
| `author` | string | No | Author name / GitHub handle |
| `version` | string | No | SemVer version |
| `vars` | object | No | `--bmm-*` CSS variables → values (this is the field, **not** `tokens`) |
| `element_overrides` | array | No | Per-selector CSS: `[{ "selector": "...", "props": { ... } }]` (an **array**, not an object) |
| `mode` | `"dark"`\|`"light"` | No | Light themes get automatic contrast patches |

> The engine reads several more optional fields — `description`, `preview`, `fonts`,
> `assets`, `global_css`, `pages` (per-view overrides), `html_swaps`, `custom_elements`,
> `bmm_min_version`. Real `--bmm-*` names include `--bmm-bg-base`, `--bmm-bg-elevated`,
> `--bmm-bg-sidebar`, `--bmm-accent`, `--bmm-border`, `--bmm-text-primary/secondary/muted`.
> Easiest path: let the **Theme Editor** export a valid manifest.

> [!TIP]
> Start from the in-app **Theme Editor** — it exports a valid `.bmmtheme` with all
> the tokens filled in, so you never hand-write the manifest.

---

## 2. Publishing to the catalog

1. Open **Dashboard → Submit content**.
2. Project = **BMM**, Type = **Theme**.
3. Pick your `.bmmtheme` file, add a description and up to 3 tags.
4. (Optional) **Generate template** fills a starter manifest.
5. Submit — a moderator reviews it before it goes live.

The catalog entry also stores a **`bmm://` deeplink** so users can one-click install
from the site.

---

## 3. Sharing without the catalog

You can also **Export** a theme to a `.bmmtheme` file, or use **Share** to copy a
one-click `bmm://theme/import-inline?data=…` link — no catalog needed.

Installing applies the theme instantly (no restart) and is fully reversible.
