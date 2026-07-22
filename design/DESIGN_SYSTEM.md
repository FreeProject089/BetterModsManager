# BMM Design System — rebuild reference

Companion to [`tokens/`](tokens/README.md). Where the token files give a design tool BMM's
**values**, this file gives it BMM's **components and screens** — enough to rebuild them
faithfully in Penpot or Figma. Every spec below is extracted from the live code
(`frontend/css/*.css`, `frontend/src/ui/kit.ts`, `frontend/index.html`); re-verify against those
if the app changes.

All values reference tokens by their DTCG path — e.g. `{bmm.color.accent}` is CSS `--bmm-accent`,
importable from `tokens/out/bmm.default.tokens.json`.

---

## 1. Core components

### Button — `.btn` + variant
Base: inline-flex, `gap 7px`, `padding 9px 16px`, `radius {bmm.size.radius-btn}` (10px), border
`1px solid transparent`, font 13.5px / weight 500 / `{bmm.font.font-sans}`. Hover paints a
`{bmm.other.s08}` overlay via `::after`; `:active` lifts `translateY(-1px)`.

| Variant | Background | Text | Border |
|---|---|---|---|
| **primary** | `{bmm.color.accent}` | `#ffffff` | `{bmm.other.s12}`; hover adds `{bmm.shadow.accent-glow}` |
| **secondary** (default) | `{bmm.other.s06}` | `{bmm.color.text-primary}` | `{bmm.other.border}` → hover `{bmm.other.s15}` |
| **ghost** | transparent | `{bmm.color.text-secondary}` | transparent; hover bg `{bmm.other.bg-hover}` |
| **danger** | `{bmm.color.danger-dim}` | `{bmm.color.danger}` | danger @ 0.2 alpha |
| **accent** | accent-dim family | `{bmm.color.accent}` | `{bmm.other.border-accent}` |

Sizes: `md` (default), `sm`, `xs` (smaller padding/font). States: default / hover / active /
disabled (muted, `{bmm.other.s05}`) / loading (spinner swaps the icon). Factory: `button()` in `kit.ts`.

### Badge / pill — `.kit-badge-<tone>`
`radius {bmm.size.radius-chip}` pill, 12px icon slot. Tones map to the semantic dim/solid pairs:
neutral `{bmm.other.s08}`/`text-secondary`, info, success, warning, danger, accent — each
`*-dim` background + solid text + the RGB-channel border at 0.35 alpha. Factory: `badge()`.

### Card — `.kit-card`
`{bmm.color.bg-elevated}` fill, `1px {bmm.other.border}`, `radius {bmm.size.radius-card}` (14px),
`padding {bmm.size.space-4}`, column flex `gap {bmm.size.space-3}`. Optional `.kit-card-title`
(13px / weight 800). Factory: `card()`.

### Input — `.form-input`
`{bmm.other.s04}` fill, `1px {bmm.other.border}`, `radius {bmm.size.radius-input}` (9px),
`padding 9px 12px`, 13.5px text. Hover → `{bmm.other.border-hover}` + `{bmm.other.s06}`; focus → accent
ring. Full-width by default. (Native `<select>` is replaced app-wide by a themed DOM dropdown —
see `.bmm-csel-*`.)

### Field row — `.kit-field`
Column flex `gap {bmm.size.space-1}`: label (11px / weight 600 / `text-secondary`) → control →
optional hint (11px / `text-muted`). Factory: `field()`.

### Nav item — `.nav-item`
Full-width flex, `gap 10px`, `padding 9px 10px`, `radius 10px`, transparent → `text-secondary`;
active state gets an accent bar + tint. Carries `data-view` (built-in) or `data-custom-id`
(custom pages). This is the sidebar row.

### Modal — `.modal-overlay` + `.modal`
Overlay: fixed, `rgba(0,0,0,0.7)` + `blur(8px)`, `z 5000`, centered, `padding 32px`,
`contain: paint`. `.modal`: `{bmm.color.bg-elevated}`, `1px {bmm.other.border}`, `radius 16px`,
`max-width 520px`. Shown via `.open`. (In-app modals are clipped inside `#app-window-outer`.)

### Toast — `.toast`
Flex, `gap 10px`, `padding 12px 16px`, `radius 10px`, `min-width 280px`,
bg `{bmm.other.toast-bg}` (falls back to bg-elevated), `blur({bmm.other.toast-blur})`,
`shadow {bmm.other.toast-shadow}`. Enter animation `toastIn` (spring cubic-bezier).

### Tag / conflict badge — `.tag-conflict`
Tiny uppercase pill: 9px / weight 900, `padding 2px 8px`, `radius 5px`, letter-spacing 0.5px.
Used for the mod conflict marker; other `.tag*` follow the same shape at semantic colours.

### Mod card — `.mod-card`
The Library's primary object (built in `components.ts`). A `.kit-card`-like surface holding: an
icon/thumbnail, title, a `.kit-meta` line (category · version · size), a status/enable toggle
(`.mod-toggle`), and conflict/status tags. States: enabled / disabled / conflicted / updating.
This is the highest-value component to build as a Penpot component-with-variants.

---

## 2. Layout shell

- **App window** — `#app-window-outer` (`mascot.css`): inset frame, `radius 16px`,
  `overflow: hidden`, `contain: paint`. Everything (including overlays and the Ctrl+K palette)
  mounts inside it so shadows never bleed into the transparent OS-webview margin.
- **Title bar** — height `{bmm.size.titlebar-h}` (38px), bg `{bmm.other.titlebar-bg}`.
- **Sidebar** — width `{bmm.size.sidebar-w}` (240px), bg `{bmm.color.bg-sidebar}`; holds the nav
  items + the brand wordmark (uses the FIXED `{bmm.color.brand-*}` tokens, never themed).
- **Content area** — one `#view-<name>` container shown at a time.
- **Spacing** — everything is on the 4-pt grid: `{bmm.size.space-1}`…`space-16` (4→64px).

---

## 3. Screen inventory (the 12 views)

Each is a `data-view` nav item + a `#view-<id>` container. Rebuild priority ⭐ = a designer's
first targets.

| View id | Screen | Contains |
|---|---|---|
| `library` ⭐ | Library | Toolbar (search / status / tag / sort), the mod-card grid, batch actions |
| `profiles` ⭐ | Profiles | Profile cards, the create-profile modal (name + game + 3 folder paths + colour/icon) |
| `modpacks` | Modpacks | Pack cards, create/apply flows |
| `mapper` ⭐ | Mapper | Two-panel drag mapping (archive tree ↔ game tree) + preview |
| `repo` ⭐ | Server Repo | Sync tab + Host tab; monitoring & whitelist/bans modals |
| `modlist` | .MM Lists | Import/export a mod list |
| `apps` | App Catalog | Catalog grid, install cards |
| `plugins` | Plugins & API | Plugin cards + the API/Quick-Test docs surface |
| `community` | BetterCommunity | Blog/feed embed |
| `docs` ⭐ | Help & Other | The docs hub (article cards, search, diagram gallery) |
| `settings` ⭐ | Settings | Sectioned cards: Themes, Storage, Language, Identity/API, Privacy, Shortcuts, Scheduler, Launch packs… |
| `credits` | Credits | Contributors |

Plus the always-present **command palette** overlay (`.cp-box`) and **Tasky** mascot bubble.

---

## 4. Exporting the screens (the semi-automated part)

Tokens convert cleanly (done). **Screens don't auto-convert into clean components** — the best
any importer gives you is an editable visual snapshot. Two routes:

### Figma — html.to.design
1. Serve the frontend: `npx serve frontend` (or any static server) → open `index.html`.
2. In Figma, run the **html.to.design** plugin against that URL. It imports the rendered page as
   layers, styled by the real CSS.
3. Caveat: BMM is a **Tauri app** — without the `invoke` bridge, JS-populated views render mostly
   empty (the shell, nav, settings static markup and CSS still come through). Capture one view at
   a time; for data-filled screens, either take an in-app screenshot to trace over, or feed the
   plugin a static HTML fixture with sample rows.

### Penpot — SVG per screen
Penpot ingests SVG well. Take an in-app screenshot or an SVG capture per view and import it as a
board; then rebuild interactive pieces as real components on top of the imported **tokens**
(so they recolour per theme). No first-party HTML importer as mature as html.to.design yet.

### Recommended order
1. Import `tokens/out/bmm.penpot-bundle.tokens.json` (default + all 12 themes, switchable) — **done, ready now**. See [`tokens/README.md`](tokens/README.md#use-them-in-penpot) for the click-path.
2. Build the ~8 core components above as components/variants, wired to the tokens.
3. Snapshot the ⭐ screens and recompose them from those components.
4. Add the remaining views as needed.

> Why not fully automatic? A snapshot importer produces flat layers, not components with variants
> and auto-layout — which is the actual value of having the design in Penpot/Figma. The tokens +
> this spec are the reusable foundation; the components are a deliberate rebuild.
