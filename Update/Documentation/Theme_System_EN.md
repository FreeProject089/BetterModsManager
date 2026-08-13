# Theme System

> 📚 **Canonical docs:** the [BMM Docs site — Themes & Appearance](https://freeproject089.github.io/BMM-Docs/features/themes/) and the in-app **Help & other → Themes** article (tokens, `.bmmtheme` format, `bmm://` share links, WCAG contrast enforcement). This file is a quick tour.

BMM ships a full theming engine: **100% of the interface is customisable without any CSS knowledge** — and power users still get raw CSS when they want it.

## Opening the editor

Open the **Theme Editor** (floating panel). It has four tabs:

| Tab | What it does |
|---|---|
| **Simple** | Presets, auto-palette generator, token groups, change tracker |
| **+ Elements** | Add your own buttons/banners/widgets anywhere in BMM |
| **CSS** | Free-form CSS, global or scoped to one page |
| **Installed** | Manage, apply, export and delete your themes |

## Quick start

1. Pick one of the **11 built-in presets** (BMM Default, Sombre, Void/Noir, Full White, Discord, Orange/Noir, Spotify Green, Brutalist, Clay, Nord, Sakura), or
2. Use the **auto-palette**: pick one colour → *Generate dark* / *Generate light* builds a complete coherent theme from it.
3. Tweak anything in the collapsible groups (Background, Accent, Text, Typography, Shape, Effects, Buttons, Charts, Diagrams, Intro & Outro…).
4. **Save as…** to keep it (you can store as many themes as you want).

## Editing any element

- Click the **eyedropper**, then **right-click any element** in BMM (middle-click works too, Esc cancels).
- The element editor lets you change **text / background / border colours**, the **hover and active states**, add **free-form CSS**, **set/replace an image**, or even **swap an icon's SVG**.
- Prefer lists? The **Modals & shared elements** group offers one-click targets for every page, modal, button kind, dropdown, toast, scrollbar…

## Change tracking

The **Your changes** panel lists every edit (token, element override, asset, icon swap) with a **per-item revert** and a *Revert all*. *Discard* restores the theme that was active when you opened the editor.

## How it works (under the hood)

- A theme is a JSON of `--bmm-*` **CSS tokens** + optional element overrides, custom elements, assets and fonts. Applying a theme injects `<style>` blocks — **source files are never modified**, everything is reversible.
- An **inline patcher** (MutationObserver) rewrites hardcoded inline colours on dynamically generated content so it follows the theme too.
- On light themes, the **auto-contrast engine** darkens light text/surfaces that would otherwise be unreadable (toggleable in the Simple tab).
- Benchmark **charts** and interactive **diagrams** read theme tokens as well.

## Sharing

- **Export** produces a `.bmmtheme` (ZIP with theme.json + embedded assets/fonts).
- **Share** copies a one-click install link (`bmm://theme/import-inline?...`).
- The **Theme Catalog** lists themes from official, partner and community sources.
