# Editing the "Help & Other" docs (and keeping BMM Docs in sync)

BMM has **two** documentation surfaces that cover the same ground:

- **Help & Other** — the in-app hub (nav → *Help & other*). Concise, bilingual, opens
  tutorials/diagrams and deep-links back into the app.
- **BMM Docs** — the public MkDocs site (`BMM Docs/`, published to GitHub Pages). The long
  version, screenshots, replays.

They are **mirrored by hand** — there is no generator. When you change one, change the other.
This guide is about the in-app hub; a companion covers the site's extras
([tabs, mermaid, screenshots](#8-portability--the-site-vs-the-app)).

> [!TIP]
> The two renderers deliberately share the **BCWEB / GitBook** directive syntax (`:::tip`,
> `:::details`, `:kbd[…]`). Author with those and most content pastes between them unchanged.

---

## 1. Where the content lives

Everything in Help & Other is **one array** in `frontend/src/docs/docs-hub.ts`:

```ts
const CATEGORIES: Category[] = [ /* … */ ];
```

Content is **co-located bilingual data** — no separate JSON, no separate FR file. Every string
is a `{ en, fr }` object, and the app picks the field by the current language.

> [!NOTE]
> `docs-hub.ts` is TypeScript. After editing it you must recompile the frontend
> (`npx tsc` from `frontend/`) so `frontend/js/` is regenerated — the app runs the compiled JS.

---

## 2. The data model

```ts
type L = { en: string; fr: string };   // every user-facing string is bilingual

interface Category {
  id: string;
  part: 'user' | 'dev';                 // which tab: User guide vs Developer
  icon: string;                         // key from the ICON set at the top of the file
  title: L; blurb: L;
  articles: Article[];
}

interface Article {
  id: string;                           // unique — also the cross-link + deeplink target
  title: L; summary: L;
  body: L;                              // HTML *or* md-lite markdown (see §4)
  media?: Media;                        // a replay / image / svg shown ABOVE the body
  tutorial?: { id: string; part?: string; step?: string };  // deep-link into the tutorial
  diagram?: string;                     // diagram id → "Open the diagram" button
  docsPath?: string;                    // appended to the BMM Docs URL → "Read full docs"
  view?: string;                        // nav data-view → "Open in BMM" button
  keywords?: string;                    // extra search terms
}
```

---

## 3. Add an article (or a category)

**New article** — push an object into the target category's `articles: [ … ]`:

```ts
{
  id: 'storage-manager',
  title: { en: 'Storage manager', fr: 'Gestionnaire de stockage' },
  summary: { en: 'Per-disk speed limits, space alerts, Smart I/O.',
             fr: 'Limites de vitesse par disque, alertes d’espace, Smart I/O.' },
  view: 'settings',                     // adds an "Open in BMM" button to Settings
  docsPath: 'features/storage/',        // adds "Read full docs" → BMM Docs
  keywords: 'disk io space cache ssd hdd throttle',
  body: {
    en: `:::tip[One knob that matters]
**Smart I/O** keeps the UI smooth during big copies. Turn it off for raw speed.
:::`,
    fr: `:::tip[Le réglage qui compte]
**Smart I/O** garde l’interface fluide pendant les grosses copies. Désactive-le pour la vitesse brute.
:::`,
  },
},
```

**New category** — push a `Category` (`id`, `part`, an `icon` key that exists in the `ICON`
record near the top of the file, `title`, `blurb`, `articles`).

> [!IMPORTANT]
> Every `{ en, fr }` needs **both** languages filled in. A missing `fr` shows English to French
> users. IDs must be unique — they're used by cross-links and the `bmm://docs/open?article=<id>`
> deeplink.

---

## 4. Writing the body — md-lite directives

If a body **starts with `<`** it's treated as raw HTML and passed through. Otherwise it's
rendered by **md-lite** (`frontend/src/docs/md-lite.ts`), which speaks the BCWEB directive set:

```md
**bold**  *italic*  `code`  [external link](https://…)

:kbd[Ctrl+K]                          → styled keyboard chips (split on + or space)

[See conflicts](doc:conflicts)        → in-app cross-link to another article by id

:::tip[Optional title]                 callout — also: note info hint success warning danger
Body markdown, recursively rendered.
:::

:::steps
:::step[Open Profiles → New profile]
Pick the three folders.
:::
:::step[Scan]
BMM lists what it finds.
:::
:::

:::columns
:::column
Left column.
:::
:::column
Right column.
:::
:::

:::details[Click to expand]
Hidden until clicked.
:::
```

> [!TIP]
> Prefer md-lite over raw HTML for new articles — it's shorter, themable, and portable to the
> MkDocs site. Reach for HTML only when you need something md-lite can't express.

---

## 5. Media, diagrams and deep-links

- **Media above the body** — `media: { kind: 'replay' | 'image' | 'svg', src, caption }`. For
  replays see the companion guide *Embedding replays & video*.
- **Diagram button** — `diagram: 'scheduler'` adds an "Open the diagram" button that calls the
  interactive diagram registry (`interactive-docs.ts`).
- **Open in BMM** — `view: 'settings'` (any nav `data-view`) adds a button that navigates the
  app to that page.
- **Read full docs** — `docsPath: 'features/scheduler/'` links out to the matching BMM Docs page.
- **Tutorial** — `tutorial: { id, part, step }` deep-links into the interactive tutorial.

---

## 6. Cross-linking

Inside a body: `[label](doc:article-id)` → an in-app button that jumps to that article. Use the
target article's `id`. From **outside** the app you can open a specific article with the
deeplink `bmm://docs/open?article=<id>` (register new deeplinks/APIs in the *Plugins & API* page).

---

## 7. Build & check

```bash
# from frontend/
npx tsc            # recompile → regenerates frontend/js/ (the app runs the compiled JS)
```

`npx tsc` with no errors is the gate. Then open Help & Other in the app and read your article in
**both** languages (use the language switcher) before committing.

---

## 8. Portability — the site vs. the app

Same syntax works in both, except where noted:

| Construct | BMM Docs (MkDocs) | In-app (md-lite) |
|---|---|---|
| Callout | `!!! tip "T"` **or** `:::tip[T]` | `:::tip[T]` |
| Collapsible | `??? note "S"` **or** `:::details[S]` | `:::details[S]` |
| Keyboard | `<kbd>Ctrl</kbd>` or `++ctrl+k++` | `:kbd[Ctrl+K]` |
| Tabs | `=== "Tab"` | — (not supported) |
| Mermaid | ```` ```mermaid ```` fence | — (use `diagram:` field) |
| Steps / Columns | — (not supported) | `:::steps` · `:::columns` |
| Cross-link | `[x](page.md)` | `[x](doc:article-id)` |
| Replay | `<div class="bmm-replay" data-src=…>` | `:::replay{src=…}` or `media` |

> [!NOTE]
> Bilingual convention differs by system. In-app: one file, `{ en, fr }` fields. BMM Docs: two
> files, `page.md` (EN) + `page.fr.md` (FR). Repo guides (this folder): `Name_EN.md` + `Name_FR.md`.
