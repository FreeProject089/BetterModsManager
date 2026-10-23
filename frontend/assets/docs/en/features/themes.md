# Themes & Appearance


> Customise every colour, font and element of BMM. Share themes in one click.
> Building your own? The full token-by-token reference is
> **[Make your own theme](doc-page:features/making-themes)**.

Not a light/dark switch. BMM ships **fourteen** built-in themes — nine dark ones (*Arctic*,
*Charcoal*, *Cobalt*, *Indigo*, *Neon*…) and five light ones, *BMM Logo* among them (the logo's
own colours, the logo in place of Tasky) — and an editor that can rebuild the app's entire
look — then export it as a file someone else imports in one click.

!!! note "Renamed in 1.0.4"

    Six built-in themes that were named after other products have neutral names now: Indigo,
    Neon, Clay, Arctic, Charcoal and Cobalt. Only the name and the id changed; a theme you
    picked under the old name stays applied. The table of old and new ids is in
    [Make your own theme](doc-page:features/making-themes#renamed-in-104).




<!-- story:make-it-yours -->
![Make BMM yours](assets/docs/media/gifs/make-it-yours.gif)

*Make BMM yours. A theme made in the theme editor, a navigation bar rearranged with a custom page of your own, and a string translated in the translation studio.*

<!-- /story:make-it-yours -->

## The mark each theme wears

Every theme carries a **brand mark**. The built-in ones that use the **BMM logo** are Graphite, Pure
Black, Daylight, Indigo, Arctic, Cobalt and BMM Logo; **Charcoal** uses the **BMM badge**; the
others (the default theme and the warmer or louder ones) keep **Tasky**. The sidebar's wordmark
reads *Better Mod.Manager*, drawn as a vector in Bricolage Grotesque with a small BMM badge, so it
stays sharp at any size and takes the theme's colours.

## The editor

The editor is one panel in three parts: the **sections** on the left, a **preview** on the
right with the **contrast checks** under it, and a footer that says whether the file is valid,
whether there are unsaved changes, and holds **File**, **Save as new** and **Save theme**.

Six sections, from the quickest change to the deepest:

=== "Basics"

    The four things most themes change, and three ways to start.

    - **Mode** — *Dark* or *Light*. Switching rebuilds the backgrounds and the text for the
      other mode; your accent and everything else stay, and **Undo** brings the previous mode
      back. Want both? Switch, then **Save as new**.
    - **A palette from one colour** — pick an accent, and the backgrounds, surfaces and text
      are derived from it, in the current mode.
    - **Start from** — one tile per built-in theme. It takes that theme's colours; your name,
      pictures, elements and CSS stay.
    - **The four families** — *Background*, *Surfaces*, *Text*, *Accent and status*: the
      handful of tokens that decide the look, each with a line saying what it paints.

    The **Auto contrast on light themes** switch lives here too.

=== "All tokens"

    Every `--bmm-*` token, grouped (background, surfaces, borders, text, accent and status,
    typography, shape, effects, notifications and tooltips, wallpaper and pictures, diagrams
    and charts). **Search tokens by name or use** finds one by its name *or* by what it does
    — "sidebar", "corners", "notification". **Changed only** hides everything the theme leaves
    at its default, which is the fastest way to read what a theme actually does.

    A token the file sets but BMM does not know (a newer BMM, a typo) is listed too, so it
    can be edited or removed.

=== "Pictures"

    > Replace BMM's built-in images. Files are embedded into your theme.

    The **Tasky mascot** (the floating one *and* the spinning boot loader, replaced together),
    the **Sidebar logo** and the **App wallpaper** (an image or a video), with the wallpaper's
    fit, position, blur and opacity just below.

    **Mascot or logo** chooses what BMM shows wherever it would show its mascot — the corner, the
    start-up screen, empty pages and dialogs: **Tasky**, the **BMM logo** (the one in the app icon) or
    the **BMM badge** (the letters BMM on a tile in your accent colour). It is saved in the theme.

=== "Elements"

    Two things. **Element styles** restyles one kind of element — colours, hover, gradient,
    picture, any CSS: **Pick on screen**, or choose it from *Modals & shared elements*
    (buttons, fields, dialogs, notifications, the sidebar…). **Your elements** adds your own
    HTML anywhere in BMM; see [below](#elements-putting-your-own-things-into-bmm).

=== "CSS"

    Raw CSS, for when the fields don't reach — for the whole app, or scoped to one screen. Use
    `var(--bmm-…)` tokens so it follows the theme.

=== "Library"

    Your themes and the built-ins: **Edit**, **Apply**, export, delete (a built-in is hidden
    instead, and comes back from the Theme Catalog), plus **Import a theme file** and the
    catalogue.

### The preview is a sandbox

The preview on the right is made of real BMM components — a mod list, buttons, a dialog,
notifications — painted with the **draft only**. Editing does not repaint the app, or the
editor itself, so a half-finished theme cannot make the panel you are using unreadable.

When you do want the whole app to follow along, tick **Apply to BMM as I edit**. Off, only
the preview changes until you save; on, every change lands on the app at once.

### Contrast checks

Under the preview, BMM checks the pairs that matter — main text on the background and on
cards, secondary and faint text, sidebar items, text on main buttons, notifications, Tasky's
tooltips, errors and successes on cards — against the WCAG ratios. Each row shows the ratio
and a grade (*Too low*, *Large text only*, or a pass). A row that fails has a **Fix** button:
it uses the closest colour that passes. **Fix all** does every failing row at once.

### Undo, redo, and getting out

- **Undo** (<kbd>Ctrl</kbd>+<kbd>Z</kbd>) and **Redo** (<kbd>Ctrl</kbd>+<kbd>Y</kbd>) cover
  every change, a mode switch included.
- **Reset** asks what you mean: *Undo all unsaved changes*, or *Start from the default look*.
- Closing with unsaved changes asks first.

!!! tip "Point at what you want to change"

    Don't hunt for the right variable. Click the **eyedropper** in the editor's header, then
    right-click (or middle-click) **any element in BMM** — the editor jumps to the token that
    paints it. In *All tokens*, clicking a token's name shows you everything on screen it
    paints. (More controls in [Tips & controls](doc-page:reference/tips).)

### Floating, docked, or in its own window

The panel floats over the app, docks to the side, or — with the **Open in its own window**
button in its header — pops out into a window of its own, which you can put on a second
screen while BMM stays full size. **Back into BMM's window** returns it.

### The file

The status at the bottom left reads the theme the way BMM will: *Valid theme file*, *Valid,
N warning(s)*, or *N problem(s) to fix before saving*. Click it for the list (*What the theme
file says*). The **File** menu imports a theme file, exports a `.bmmtheme`, copies the theme
as JSON, or copies a share link.

## Sharing

A theme exports as a file and imports as one. Beyond that, a **theme catalogue** works like
the [App Catalog](doc-page:features/apps):

> Pick the themes to include, then export the catalog or add it as a source. Host it on
> BetterCommunity to share it.

Host it and you've got a channel — anyone adding your source sees your themes, and updates
to them.

## The wallpaper, and why it has three controls

A theme can set a full-app background — an image or a video — from **Pictures** in the editor,
where its other settings sit just below it:

| Setting | Token | What it is for |
|---|---|---|
| Wallpaper | `--bmm-app-bg-image` | The image itself, picked or pasted as a URL |
| Wallpaper blur | `--bmm-app-bg-blur` | A blur in pixels, e.g. `8px` |
| Wallpaper opacity | `--bmm-app-bg-opacity` | `0` (hidden) to `1` (full) |

The blur and the opacity are not decoration. A wallpaper with detail in it competes with the
text on top of it, and BMM is a screen you *read* — mod names, file paths, version numbers.
Blur removes the detail, opacity removes the contrast. A photo at full strength will make a
mod list hard to scan; the same photo at `8px` and `0.35` reads as a colour, and the text
stays legible.

Clearing the wallpaper from Pictures also clears the token, so removing it does not leave a
half-set background behind.

## Elements: putting your own things into BMM

**Your elements**, in the **Elements** section, adds your own HTML — a button, a banner, a
badge, a widget — anywhere in the app. It is a three-step form, and the first step is the one
that matters.

**1. Where should it go?** Either press the eyedropper and right-click the element in BMM, or
type a CSS selector yourself. The picker is the honest way to do it: you get the selector that
actually matches what you clicked, instead of guessing at class names.

Then two choices decide exactly where it lands:

| Placement | Result |
|---|---|
| Inside, at the end | Appended as the last child of the target |
| Inside, at the start | Inserted as the first child |
| Just before it | A sibling, immediately before the target |
| Just after it | A sibling, immediately after |

**Show on** scopes it: every page, or exactly one of BMM's screens — Library, Profiles,
Modpacks, Mapper, Server Repo, Plugins & API, App Catalog, Help & other, Settings, Credits,
BetterCommunity, `.MM` Lists. A banner that only makes sense on the Library should not follow
you into Settings.

**2 and 3** are the content: start from a template (Button, Banner, Badge, Note, Link) or
write the HTML, and style it.

Your elements are listed above the form, each showing its selector, its placement and its
scope, so a theme with a dozen of them stays readable. They travel with the theme — someone who
installs it gets them too, which is worth remembering before you put something personal in one.
