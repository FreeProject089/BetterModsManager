# Theme Catalog Guide (BMM)

BMM themes restyle the app UI. They are shared through the **theme catalog** and
packaged as a `.bmmtheme` file (a ZIP). This guide covers the package format and how
to publish one.

> **Build a catalog in-app:** open the **Theme Catalogue** and click **"Create theme
> catalog"** — tick the installed themes to include and **Export** the `catalog.json`
> (or "Export & add as source" to test it right away). Host the file anywhere and add its
> URL as a community source, or host it on **BetterCommunity** (`/submit → Host my own
> catalog`) as a public or **private** (invite-only) catalog. Local `.json`/`.bmmtheme`
> files added as sources are read directly (no server round-trip).

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
  "tokens": {
    "--bmm-bg": "#0e0c09",
    "--bmm-surface": "#15171e",
    "--bmm-accent": "#f97316",
    "--bmm-text": "#e2e6ee"
  },
  "overrides": {
    ".sidebar": { "border-radius": "14px" }
  }
}
```

| Field | Type | Required | Purpose |
|---|---|---|---|
| `id` | string | **Yes** | Unique slug (lowercase, dashes) |
| `name` | string | **Yes** | Display name |
| `author` | string | **Yes** | Author name / GitHub handle |
| `version` | string | **Yes** | SemVer version |
| `tokens` | object | **Yes** | `--bmm-*` CSS variables → values |
| `overrides` | object | No | Per-selector CSS overrides |

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
