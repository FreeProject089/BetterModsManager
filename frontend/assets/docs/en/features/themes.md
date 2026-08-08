# Themes & Appearance


> Customise every colour, font and element of BMM. Share themes in one click.

Not a light/dark switch. BMM ships **twelve** built-in themes (dark and light) and an editor
that can rebuild the app's entire look — then export it as a file someone else imports in one
click.

![The Theme Editor](assets/docs/media/screens/themes.annotated.png)

| | | |
|---|---|---|
| **1** | **Installed** | Your themes. Click to apply. |
| **2** | **Editor** | Three tabs — see below. |
| **3** | **Catalogue** | Official, partner & community themes. |

<div class="bmm-replay" data-remote="https://freeproject089.github.io/BMM-Docs/assets/replays/themes.bmmreplay" data-page="features/themes" data-title="Restyling BMM with the theme editor"></div>


## The editor has three levels

Pick the one that matches how far you want to go. You can stop at the first.

=== "Simple"

    > Pick a preset, then tweak anything. Hover labels for help, click **?** for MDN docs.

    Colours, fonts, spacing — as fields. The **?** next to a property opens the MDN page for
    it, which makes this a decent way to learn CSS rather than just a way to use it.

    Each section has **Reset this section**, so you can experiment in one area and undo just
    that, without losing the rest.

=== "+ Elements"

    > Add your own buttons, banners, badges or widgets anywhere in BMM. Pick a spot, choose a
    > type…

    This is the one people don't expect: you're not restyling BMM's elements, you're **adding
    your own**. A button that runs a [deeplink](doc-page:reference/api), a banner with your
    server's rules, a badge on a profile card.

=== "CSS"

    Raw CSS, for when the fields don't reach. Everything the other two tabs do lands here in
    the end.

!!! tip "Point at what you want to change"

    Don't hunt for the right variable. Click the **eyedropper**, then click **any element in
    BMM** — the editor jumps straight to it. It's the fastest answer to "how do I recolour
    *that* button". Building a light theme? Set the theme's **mode** to *light* and BMM applies
    automatic contrast patches so text stays readable. (More controls in
    [Tips & controls](doc-page:reference/tips).)

## Assets

> Replace BMM's built-in images. Files are embedded into your theme.

The logo, the wallpaper (with blur and opacity controls), and **Tasky** — the floating
mascot *and* the spinning boot loader, replaced together.

**Embedded** is the important word: an asset lives inside the theme file. Share the theme and
the images travel with it — no broken links, no "works on my machine".

## Sharing

A theme exports as a file and imports as one. Beyond that, a **theme catalogue** works like
the [App Catalog](doc-page:features/apps):

> Pick the themes to include, then export the catalog or add it as a source.

Host it and you've got a channel — anyone adding your source sees your themes, and updates
to them.

## The wallpaper, and why it has three controls

A theme can set a full-app background — an image or a video — from **Assets** in the editor.
It comes with two settings you will want, both in the **Background** group:

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

Clearing the wallpaper from Assets also clears the token, so removing it does not leave a
half-set background behind.

## + Elements: putting your own things into BMM

The **+ Elements** tab adds your own HTML — a button, a banner, a badge, a widget — anywhere in
the app. It is a three-step form, and the first step is the one that matters.

**1. Where should it go?** Either press *Click a spot in BMM* and pick the element with the
eyedropper, or type a CSS selector yourself. The picker is the honest way to do it: you get the
selector that actually matches what you clicked, instead of guessing at class names.

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

**2 and 3** are the content: start from a template or write the HTML, and style it.

Your elements are listed above the form, each showing its selector, its placement and its
scope, so a theme with a dozen of them stays readable. They travel with the theme — someone who
installs it gets them too, which is worth remembering before you put something personal in one.
