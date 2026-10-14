# BMM themes

**English** · [Français](THEMES_FR.md)

Better Mod Manager ships fourteen built-in themes, nine dark and five light, and a theme editor
to change any of them or make your own. A theme is one small file (`.bmmtheme`): you can export
it, send it to someone, or publish it in a theme catalogue.

Every picture below is the real app, in the browser preview with demo data, wearing the theme.

- [The built-in themes](#the-built-in-themes)
- [Make your own](#make-your-own)
- [Share it](#share-it)
- [The tokens, in short](#the-tokens-in-short)
- [The file format](#the-file-format)
- [Read more](#read-more)

## The built-in themes

| | |
|---|---|
| **Default** · dark<br>The original look: a deep navy canvas, a blue accent and soft glass cards.<br>`bmm-default`<br>![Default](.github/themes/bmm-default.png) | **Graphite** · dark<br>Soft dark grey with an indigo accent. Calm, low-contrast surfaces.<br>`bmm-sombre`<br>![Graphite](.github/themes/bmm-sombre.png) |
| **Pure Black** · dark<br>True black, a monochrome grey-white accent and hairline borders. Made for OLED screens and late nights.<br>`bmm-void`<br>![Pure Black](.github/themes/bmm-void.png) | **Daylight** · light<br>A clean, flat light interface: a light-grey canvas, crisp white cards and dark text.<br>`bmm-white`<br>![Daylight](.github/themes/bmm-white.png) |
| **Indigo** · dark<br>Layered warm greys with an indigo accent and 8 px corners. Friendly and familiar.<br>`bmm-indigo`<br>![Indigo](.github/themes/bmm-indigo.png) | **Ember** · dark<br>Deep black with a bold, warm orange accent.<br>`bmm-orange`<br>![Ember](.github/themes/bmm-orange.png) |
| **Neon** · dark<br>Near-black with a bright green accent and pill-shaped buttons.<br>`bmm-neon`<br>![Neon](.github/themes/bmm-neon.png) | **Newsprint** · light<br>Neo-brutalist: a warm paper canvas, no rounding, ink borders and chunky offset shadows.<br>`bmm-brutal`<br>![Newsprint](.github/themes/bmm-brutal.png) |
| **Clay** · light<br>Calm and warm: a soft cream canvas, gentle borders and a clay accent.<br>`bmm-clay`<br>![Clay](.github/themes/bmm-clay.png) | **Arctic** · dark<br>Cool and quiet: deep slate surfaces, snow-white text and a frost-blue accent.<br>`bmm-arctic`<br>![Arctic](.github/themes/bmm-arctic.png) |
| **Blossom** · light<br>A soft light theme: a warm ivory canvas, a petal-pink accent and deep plum text.<br>`bmm-sakura`<br>![Blossom](.github/themes/bmm-sakura.png) | **Charcoal** · dark<br>A dense working look: flat charcoal surfaces, 1 px borders, a blue focus accent and small square corners.<br>`bmm-charcoal`<br>![Charcoal](.github/themes/bmm-charcoal.png) |
| **Cobalt** · dark<br>Graphite with hairline borders, 10 px corners and a bright cobalt-blue accent.<br>`bmm-cobalt`<br>![Cobalt](.github/themes/bmm-cobalt.png) | **BMM Logo** · light<br>The colours of the BMM logo: a pale grey canvas, ink-black shapes and signal yellow. The logo replaces Tasky wherever the mascot appears.<br>`bmm-logo`<br>![BMM Logo](.github/themes/bmm-logo.png) |

The code under each name is the theme's id, the one a `bmm://theme/apply?id=…` link, a scheduler
task or the MCP bridge uses.

> **Renamed in 1.0.3.** Six built-in ids used to name other products. They were renamed, the
> themes themselves did not change, and the old ids keep working everywhere (your saved choice,
> hidden presets, scheduler tasks, links, the installer, the MCP bridge):
>
> | Old id | New id |
> |---|---|
> | `bmm-discord` | `bmm-indigo` |
> | `bmm-spotify` | `bmm-neon` |
> | `bmm-claude` | `bmm-clay` |
> | `bmm-nord` | `bmm-arctic` |
> | `bmm-vscode` | `bmm-charcoal` (was shown as *Editor*) |
> | `bmm-macos` | `bmm-cobalt` |

Choose a theme in **Settings → Themes**, in the **Theme catalogue**, or from the theme editor's
**Library**. A built-in theme you never use can be hidden from the lists and brought back later
from the catalogue.

## Make your own

Open the editor from **Settings → Themes → Editor** (or the link `bmm://theme/editor`).
It floats over BMM, docks to the side, or pops out into a window of its own.

1. **Start from something close.** In **Basics**, pick a built-in under *Start from*, or give
   *A palette from one colour* your accent and let it build the backgrounds, surfaces and text.
2. **Choose the mode.** *Dark* or *Light*. Switching rebuilds the backgrounds and the text for the
   other mode and keeps your accent and everything else, so a light version of a dark theme is
   one click (then *Save as new* to keep both).
3. **Adjust the four families** in Basics: background, surfaces, text, accent and status colours.
   Every other token is in **All tokens**, searchable by name or by what it paints, with a
   *Changed only* filter.
4. **Watch the preview.** The right side shows real BMM parts (sidebar, cards, buttons, fields, a
   dialog, notifications, a tooltip) painted with your draft only. The app itself does not change
   until you save, unless you tick *Apply to BMM as I edit*.
5. **Check the contrast.** Under the preview, each pair that has to stay readable (main text on
   the background and on cards, secondary and faint text, sidebar items, text on main buttons,
   notifications, tooltips, error and success colours) shows its WCAG ratio and grade. A pair that
   fails offers **Fix**: the closest colour that passes, in the same hue (white or near-black for
   text on a button). *Fix all* does them all.
6. **Go further if you want.** *Pictures* replaces Tasky, the sidebar logo or the wallpaper (the
   files are embedded in the theme). *Elements* restyles one kind of element (pick it on screen
   with a right-click) or adds your own buttons and banners. *CSS* takes any CSS, for the whole
   app or one page.
7. **Save.** *Save* writes over your own theme; on a built-in it saves a copy. *Save as new* always
   makes a new theme. Undo and redo (Ctrl+Z, Ctrl+Y) cover every change, and the reset button
   either undoes all unsaved changes or starts again from the default look.

The footer says whether the file is valid. A problem that would stop the theme from loading
(an unsafe id, a value that would break out of the stylesheet) is shown before you save.

## Share it

- **File → Export as .bmmtheme** writes the file. **Import a theme file** reads one back; an
  import never overwrites a different theme that happens to use the same id, it gets a new one.
- **File → Copy a share link** copies a `bmm://theme/import-inline` link that installs the theme in
  one click. A theme with embedded pictures is too large for a link and is exported as a file.
- **File → Copy the theme as JSON** puts the whole file on the clipboard.
- A **theme catalogue** groups several themes into a source others can follow; host it on
  BetterCommunity and your updates reach everyone who added it.

A theme can carry CSS, HTML and pictures, so install themes only from people you trust. BMM
removes scripts and event handlers from a theme's HTML and ignores token values that would break
out of the stylesheet, but a theme can still change how BMM looks in ways you did not expect.

## The tokens, in short

A theme is mostly a list of `--bmm-*` tokens. The editor explains each one; the main families:

| Family | Tokens (examples) | Paints |
|---|---|---|
| Background | `--bmm-bg-base`, `--bmm-bg-sidebar`, `--bmm-bg-titlebar` | Behind every page, the sidebar, the title bar |
| Surfaces | `--bmm-bg-elevated`, `--bmm-bg-hover`, `--bmm-surface-r/g/b` | Cards, panels, dialogs, menus, the hover wash |
| Borders | `--bmm-border`, `--bmm-border-hover`, `--bmm-border-accent` | Lines around cards and fields, focus |
| Text | `--bmm-text-primary`, `--bmm-text-secondary`, `--bmm-text-muted`, `--bmm-text-on-accent` | Titles, descriptions, hints, text on an accent fill |
| Accent and status | `--bmm-accent`, `--bmm-success`, `--bmm-warning`, `--bmm-danger`, `--bmm-info` | Main buttons, selection, switches, states |
| Typography | `--bmm-font-sans`, `--bmm-font-mono`, `--bmm-font-size-base` | Fonts and the base size |
| Shape | `--bmm-radius-card`, `--bmm-radius-btn`, `--bmm-radius-input` | Corner rounding |
| Effects | `--bmm-shadow-card`, `--bmm-card-glow`, `--bmm-anim-speed` | Shadows, glow, animation speed |
| Notifications and tooltips | `--bmm-toast-*`, `--bmm-tasky-bubble-*` | The small pop-ups and Tasky's help bubbles |
| Wallpaper and pictures | `--bmm-app-bg-image`, `--bmm-app-bg-blur`, `--bmm-app-bg-opacity` | A picture behind the app, and how it sits |

The accent is a fill: it paints buttons, switches and the selected item, and text sitting on it
uses `--bmm-text-on-accent`. Text itself uses the text tokens, so a light theme stays readable.

## The file format

```json
{
  "format_version": 2,
  "id": "my-theme",
  "name": "My theme",
  "author": "You",
  "version": "1.0.0",
  "description": "One line, shown in the theme lists.",
  "mode": "dark",
  "vars": { "--bmm-accent": "#22c55e", "--bmm-bg-base": "#07100a" },
  "assets": {},
  "global_css": "",
  "custom_elements": [],
  "element_overrides": [],
  "html_swaps": [],
  "pages": {}
}
```

- `id` (one plain name) and `name` are the only required fields; an empty `vars` is the Default look.
- `format_version` is the version of this format. A file without it is version 1 and is migrated
  when it is read: token names written without their `--` get it, numbers become text, an invalid
  `mode` is dropped. Nothing is written back until you save.
- Fields BMM does not know are kept as they are, so a file made by a newer BMM or another tool
  survives a round trip through the editor.

## Read more

- [Themes and appearance](https://freeproject089.github.io/BMM-Docs/features/themes/) in the BMM Docs
- [Make your own theme](https://freeproject089.github.io/BMM-Docs/features/making-themes/): every token, group by group
