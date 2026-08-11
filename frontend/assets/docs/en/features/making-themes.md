# Make your own theme


> Every token the editor exposes, explained — plus the theme file format and a
> from-zero walkthrough. The [Themes & Appearance](doc-page:features/themes) page tours the editor;
> this one is the reference you keep open **while** building.

## The mental model

A BMM theme is a set of **overrides**. The app ships a complete look (the *Default* theme is
literally an empty override set); your theme replaces only the tokens you touch, and
everything else falls through to the default. That is why a three-line theme is valid — and
why **Reset this section** can undo one area without touching the rest.

A token is a CSS variable, always named `--bmm-*`. Change `--bmm-accent` and every button,
link and active state that uses it follows. You never chase individual elements — unless you
want to, which is what the **CSS** tab and **+ Elements** are for.

Three rules keep a theme readable, learned from the built-ins:

1. **Contrast beats beauty.** BMM is a screen you *read* — mod names, paths, versions.
   Test your text tokens against your background tokens before anything else.
2. **The surface tint is the light/dark switch.** Almost every panel is built from one
   translucent tint (see [Surfaces](#surfaces)). Get it right first; the rest is detail.
3. **Declare your `mode`.** A light theme with `mode: "light"` gets automatic contrast
   patches on elements that hardcode light text. Without it, some text goes invisible.

## Start from zero, in order

1. Open the editor: **Settings → Themes → Editor**, or [this link](bmm://theme/editor).
2. Pick the built-in closest to what you want and **Save as** a copy — inheriting a working
   theme beats starting from a blank page.
3. Set **Surfaces** (the tint) and **Background** (base, cards, sidebar). Look at the app
   after each change — the editor applies live.
4. Set **Text** and check every level (primary/secondary/muted) against your new surfaces.
5. Pick your **Accent** family, then **Borders**, **Shape**, **Typography**.
6. Only then: wallpaper, effects, Tasky, charts — the decoration layer.
7. **Export** (or **Share**) from the footer's *File* menu.

The **eyedropper** is the shortcut through all of this: click it, then click any element in
BMM, and the editor jumps to the token that styles it.

## Every token, by group

The tables below are the editor's **Simple** tab, in full. *Type* tells you what a value
looks like: a `color` accepts anything CSS does (`#0af`, `rgb(...)`, `rgba(...)` for
transparency); a `size` is a CSS length or number as noted; `font` is a font-family list;
`image` is a URL or a picked file (embedded into the theme).

### Background

Colours behind the whole app, cards and bars.

| Token | What it styles | Type |
|---|---|---|
| `--bmm-bg-base` | The outermost background behind everything | color |
| `--bmm-bg-elevated` | Cards, panels, modals and dropdowns | color |
| `--bmm-bg-overlay` | The translucent surface used by glass cards and modals | color |
| `--bmm-bg-hover` | Anything under the cursor — rows, nav items, buttons | color |
| `--bmm-bg-active` | The selected / pressed state | color |
| `--bmm-bg-sidebar` | The left navigation sidebar | color |
| `--bmm-bg-titlebar` | The top window bar (logo & window buttons) | color |
| `--bmm-titlebar-bg` | Exact title-bar background — supports `rgba()` for transparency | color |
| `--bmm-loader-bg` | The startup & close screen | color |
| `--bmm-app-bg-image` | Full-app wallpaper — pick a file or paste a URL | image |
| `--bmm-app-bg-blur` | Blur applied to the wallpaper, e.g. `8px` | size |
| `--bmm-app-bg-opacity` | Wallpaper opacity, `0` (hidden) to `1` (full) | size |

!!! note "Why the wallpaper has three tokens"

    A detailed image competes with the text on top of it. A photo at full strength makes a
    mod list hard to scan; the same photo at `8px` blur and `0.35` opacity reads as a colour.
    Clearing the wallpaper from **Assets** clears all three.

### Surfaces

The translucent tint every panel is built from — **the light/dark switch of a theme**.

| Token | What it styles | Type |
|---|---|---|
| `--bmm-surface-r` | Red channel (0–255) of the surface tint | size |
| `--bmm-surface-g` | Green channel (0–255) of the surface tint | size |
| `--bmm-surface-b` | Blue channel (0–255) of the surface tint | size |
| `--bmm-glass-bg` | Background of frosted-glass panels | color |
| `--bmm-glass-border` | Border of frosted-glass panels | color |
| `--bmm-color-scheme` | `light` or `dark` — drives **native** scrollbars and select popups | size |

The three channels are one colour split apart so the app can reuse it at many opacities.
Dark themes tint towards white (e.g. `255,255,255` at low alpha = subtle light sheen);
**for a light theme set all three to `0`** so panels shade towards dark instead. Set
`--bmm-color-scheme` to match, or your scrollbars will disagree with your theme.

### Text

| Token | What it styles | Type |
|---|---|---|
| `--bmm-text-primary` | Titles and important text | color |
| `--bmm-text-secondary` | Descriptions and labels | color |
| `--bmm-text-muted` | Hints, placeholders, metadata | color |
| `--bmm-text-on-accent` | Text sitting **on** an accent-coloured fill (primary buttons, badges) | color |

`--bmm-text-on-accent` is the one people forget: if your accent is light, this must be dark,
or primary buttons become unreadable — this exact bug shipped in five built-ins once.

### Accent

Highlight colours — buttons, active items, states. The first is *the* accent; the rest are
the semantic palette used by badges, states and tags across the app.

| Token | What it styles | Type |
|---|---|---|
| `--bmm-accent` | The main highlight — buttons, active items, links | color |
| `--bmm-cyan` | Secondary highlight (paths, info badges) | color |
| `--bmm-success` | Success / enabled / verified states | color |
| `--bmm-warning` | Warnings and caution states | color |
| `--bmm-danger` | Errors, delete actions, conflicts | color |
| `--bmm-purple` | Tertiary accent (deeplinks, plugin tags) | color |
| `--bmm-info` | Informational badges and callouts | color |
| `--bmm-amber` | Softer caution tone (some badges and charts) | color |

Keep success/warning/danger *recognisable* — a theme where danger is green fights ten years
of user instinct.

### Borders

| Token | What it styles | Type |
|---|---|---|
| `--bmm-border` | Default subtle border around cards & inputs | color |
| `--bmm-border-hover` | Border when the cursor is over a card or input | color |
| `--bmm-border-accent` | Border for focused / active elements | color |

### Typography

| Token | What it styles | Type |
|---|---|---|
| `--bmm-font-sans` | The font used everywhere in the interface | font |
| `--bmm-font-mono` | Code, paths and hashes | font |
| `--bmm-font-size-base` | Base font size (e.g. `13px`) — scales the whole UI | size |

Custom fonts can be **embedded** into the theme from the editor, so they travel with the
file — no "install this font first" README.

### Shape

How rounded things are. `0` = square everywhere, for the brutalist look.

| Token | What it styles | Type |
|---|---|---|
| `--bmm-radius-card` | Corner radius of cards (e.g. `14px`) | size |
| `--bmm-radius-btn` | Corner radius of buttons | size |
| `--bmm-radius-input` | Corner radius of text inputs and selects | size |
| `--bmm-radius-chip` | Corner radius of small chips and pills | size |

### Buttons

| Token | What it styles | Type |
|---|---|---|
| `--bmm-btn-primary-bg` | Background of primary (main-action) buttons — defaults to the accent | color |

This exists so you can recolour the main action **without** repainting everything else the
accent touches.

### Toasts

The small notification popups.

| Token | What it styles | Type |
|---|---|---|
| `--bmm-toast-bg` | Toast background | color |
| `--bmm-toast-border` | Toast border | color |
| `--bmm-toast-text` | Toast text | color |

### Tasky Tooltips

The helper bubbles that pop up on hover.

| Token | What it styles | Type |
|---|---|---|
| `--bmm-tasky-bubble-bg` | Tooltip background (`rgba()` for glass) | color |
| `--bmm-tasky-bubble-text` | Text inside the tooltips | color |
| `--bmm-tasky-bubble-border` | Tooltip border | color |
| `--bmm-tasky-bubble-radius` | Corner radius of the bubble | size |

### Effects

Glows, shadows, hover lift and animation speed.

| Token | What it styles | Type |
|---|---|---|
| `--bmm-card-glow` | Extra glow on cards, e.g. `0 0 20px rgba(...)` — `0 0 0 transparent` for none | size |
| `--bmm-card-hover-lift` | How far cards rise on hover, e.g. `-2px` — `0` for no lift | size |
| `--bmm-shadow-card` | Drop shadow under cards | size |
| `--bmm-shadow-modal` | Drop shadow under modals | size |

### Intro & Outro

The startup/close screen.

| Token | What it styles | Type |
|---|---|---|
| `--bmm-loader-img` | The image shown spinning while BMM starts | image |
| `--bmm-intro-duration` | Boot/exit fade duration, e.g. `0.65s` — lower is faster | size |
| `--bmm-anim-speed` | Global animation multiplier — `1` normal, `0` instant (disables all) | size |

`--bmm-anim-speed: 0` doubles as an accessibility/performance switch, and a theme may ship it.

### Charts

Line colours of the performance / benchmark graphs.

| Token | What it styles | Type |
|---|---|---|
| `--bmm-chart-cpu` | The CPU line | color |
| `--bmm-chart-ram` | The RAM line | color |
| `--bmm-chart-disk-read` | The disk-read line | color |
| `--bmm-chart-disk-write` | The disk-write line | color |

### Diagrams

Node colours of the interactive flowcharts in **Help & other**.

| Token | What it styles | Type |
|---|---|---|
| `--bmm-diagram-node` | Fill of diagram boxes/nodes | color |
| `--bmm-diagram-node-border` | Border of diagram nodes | color |
| `--bmm-diagram-node-text` | Text inside diagram nodes | color |

### DevTools

The developer tools overlay (F12) follows the same tokens, so a theme keeps the debugging
surface readable without extra work.

## The theme file (`.bmmtheme`)

A theme exports as one JSON file. Everything is optional except `id` and `name` — an empty
`vars` is a valid theme (that *is* the Default theme).

```json
{
  "id": "my-theme",
  "name": "My Theme",
  "author": "you",
  "version": "1.0.0",
  "description": "One line, shown in the theme list.",
  "mode": "dark",
  "vars": {
    "--bmm-accent": "#22c55e",
    "--bmm-bg-base": "#07100a"
  },
  "global_css": "/* anything the tokens don't reach */",
  "assets": { "wallpaper": "data:image/png;base64,..." },
  "fonts": [],
  "custom_elements": [],
  "element_overrides": [],
  "html_swaps": [],
  "pages": {},
  "bmm_min_version": "1.0.0"
}
```

| Field | What it carries |
|---|---|
| `vars` | The token overrides — the tables above |
| `mode` | `"dark"` or `"light"` — **declare it**; light mode triggers contrast patches |
| `global_css` | Raw CSS appended after the tokens (the editor's **CSS** tab) |
| `assets` | Embedded images (wallpaper, logo, Tasky) as base64 — they travel with the file |
| `fonts` | Embedded font files |
| `custom_elements` | Your **+ Elements** additions — buttons, banners, badges |
| `element_overrides` / `html_swaps` | Per-element style overrides / innerHTML swaps (icons) |
| `pages` | Per-view overrides, keyed by view id |
| `bmm_min_version` | Refuses to load on older BMM builds |

Because a theme can carry CSS, HTML elements and assets, **only install themes from sources
you trust** — the same rule as any catalogue content.

## Drop-in folder

Besides Import, any valid `.bmmtheme` / `.json` dropped into `<app data>/theme-presets/`
appears alongside the bundled presets — in the editor and every theme selector. The folder is
created on first launch; **Settings → Storage** shows where your app data lives. Handy while
iterating in an external editor, and it makes a community theme pack "unzip here" instead of
an import loop.

## Sharing it

- **File → Export** in the editor footer produces the `.bmmtheme`.
- **File → Share** copies a link others open in one click.
- A **theme catalogue** turns several themes into a subscribable source — host it on
  [BetterCommunity](doc-page:features/community) and updates reach everyone who added you.
