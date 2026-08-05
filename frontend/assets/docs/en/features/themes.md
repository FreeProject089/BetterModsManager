# Themes & Appearance


> Customise every colour, font and element of BMM. Share themes in one click.

Not a light/dark switch. BMM ships **twelve** built-in themes (dark and light) and an editor
that can rebuild the app's entire look — then export it as a file someone else imports in one
click.

![The Theme Editor](../assets/screens/themes.annotated.png)

| | | |
|---|---|---|
| **1** | **Installed** | Your themes. Click to apply. |
| **2** | **Editor** | Three tabs — see below. |
| **3** | **Catalogue** | Official, partner & community themes. |

<div class="bmm-replay"
     data-src="../assets/replays/themes.bmmreplay"
     data-title="Restyling BMM with the theme editor (placeholder clip)"></div>

*Placeholder recording — a focused clip of this screen will replace it.*

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
    your own**. A button that runs a [deeplink](doc-page:../reference/api), a banner with your
    server's rules, a badge on a profile card.

=== "CSS"

    Raw CSS, for when the fields don't reach. Everything the other two tabs do lands here in
    the end.

!!! tip "Point at what you want to change"

    Don't hunt for the right variable. Click the **eyedropper**, then click **any element in
    BMM** — the editor jumps straight to it. It's the fastest answer to "how do I recolour
    *that* button". Building a light theme? Set the theme's **mode** to *light* and BMM applies
    automatic contrast patches so text stays readable. (More controls in
    [Tips & controls](doc-page:../reference/tips).)

## Assets

> Replace BMM's built-in images. Files are embedded into your theme.

The logo, the wallpaper (with blur and opacity controls), and **Tasky** — the floating
mascot *and* the spinning boot loader, replaced together.

**Embedded** is the important word: an asset lives inside the theme file. Share the theme and
the images travel with it — no broken links, no "works on my machine".

## Sharing

A theme exports as a file and imports as one. Beyond that, a **theme catalogue** works like
the [App Catalog](doc-page:apps):

> Pick the themes to include, then export the catalog or add it as a source.

Host it and you've got a channel — anyone adding your source sees your themes, and updates
to them.

<!-- TODO(content): the + Elements placement picker and the wallpaper blur/opacity controls
     each deserve their own capture. -->
