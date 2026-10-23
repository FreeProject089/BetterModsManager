# Markdown Guide — writing notes & blog posts

Both the **BMM update notes** and the **BetterCommunity blog** use the same Markdown
renderer. Anything shown here works in both places. Copy/paste and adapt.

> [!TIP]
> Keep posts short and scannable: a heading, a few bullet points, and the change
> badges below do most of the work.

---

## 1. Text basics

```md
**bold**   *italic*   ~~strikethrough~~   `inline code`

[A link](https://bettercommunity.example)
```

**bold** · *italic* · ~~strikethrough~~ · `inline code` · [a link](https://example.com)

---

## 2. Headings & lists

```md
# Title
## Section
### Sub-section

- bullet
- another bullet
  - nested

1. first
2. second

- [x] done task
- [ ] todo task
```

---

## 3. Change badges

Wrap a keyword in square brackets and it becomes a coloured chip. Use them at the
start of a bullet to label what changed:

```md
- [NEW] Added a dark theme
- [IMPROVED] Faster catalog loading
- [FIXED] Crash when opening an empty repo
- [REFINE] Tightened spacing on cards
- [VISUAL] New hero animation
- [MAJOR] Rewrote the update engine
```

- [NEW] Added a dark theme
- [IMPROVED] Faster catalog loading
- [FIXED] Crash when opening an empty repo

French spellings also work: `[NOUVEAU]`, `[AMÉLIORÉ]`, `[FIXÉ]`, `[RAFFINEMENT]`, `[VISUEL]`, `[MAJEUR]`.

---

## 4. Callouts (alerts)

Start a blockquote with `[!TYPE]` to get a coloured callout box:

```md
> [!NOTE]
> Useful background information.

> [!TIP]
> A helpful shortcut.

> [!IMPORTANT]
> Something the reader must not miss.

> [!WARNING]
> Proceed carefully.

> [!CAUTION]
> This can break things.
```

> [!WARNING]
> Only install content from sources you trust.

Types: `NOTE`, `TIP`, `IMPORTANT`, `WARNING`, `CAUTION` (French: `REMARQUE`, `ASTUCE`, `IMPORTANT`, `AVERTISSEMENT`, `ATTENTION`).

---

## 5. Code blocks

Fence code with three backticks and an optional language:

````md
```json
{ "name": "example", "version": "1.0.0" }
```
````

---

## 6. Tables

```md
| Feature | Status |
|---|---|
| Dark theme | [NEW] |
| Repo sync | [IMPROVED] |
```

| Feature | Status |
|---|---|
| Dark theme | Shipped |
| Repo sync | Faster |

---

## 7. Images, video & YouTube (blog)

In the blog editor, use the toolbar buttons — they insert the right snippet for you:

```md
![alt text](https://.../image.png)
```

```html
<video controls src="https://.../clip.mp4" style="width:100%;border-radius:12px"></video>

<div class="yt-embed">
  <iframe src="https://www.youtube-nocookie.com/embed/VIDEO_ID" allowfullscreen></iframe>
</div>
```

---

## 8. Dividers

Use three dashes on their own line for a horizontal rule:

```md
---
```

---

## 9. Rich blocks — icons, badges & cards

The website's GitBook-style blocks now render in BMM too (Release notes,
update notes **and** the BetterCommunity blog):

```md
:icon[rocket]   :icon[simple:github]        inline icon (lucide / brand)
:badge[New]{color="#16a34a"}                a coloured pill
:kbd[Ctrl+S]                                a keyboard shortcut

:::note[Heads up]
A callout block. Also: tip / warning / danger / success / info.
:::

:::details[Click to expand]
Hidden content revealed on click.
:::

::::cards
:::card[Read the docs]{href="/docs/getting-started"}
A clickable card with a title and body.
:::
::::
```

- **Icons** come from **lucide** (e.g. `rocket`, `download`, `shield`) or from
  **Simple Icons** with the `simple:` prefix (e.g. `simple:discord`, `simple:steam`).
- **Colours** and URLs that contain `#` must be quoted: `{color="#16a34a"}`.
- Outer containers need **more colons** than the inner ones (`::::cards` wraps `:::card`).

That's everything. Combine badges + callouts + short bullets for clean, readable notes.
