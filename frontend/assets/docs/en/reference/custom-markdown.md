# Rich text blocks (custom markdown)


Wherever text is rendered — a plugin's documentation, a custom page, a community article on
BetterCommunity — you get ordinary Markdown **plus** a set of blocks.

Every block opens with `:::name` and closes with a bare `:::` on its own line:

```
:::tip[Optional title]
Ordinary markdown goes in here — **bold**, lists, links.
:::
```

Two rules cover almost every problem people hit:

- **Leave a blank line before a block.** `:::note` on the line straight after a paragraph is
  read as part of that paragraph and comes out as literal text.
- **Close what you open.** Blocks nest freely, and each `:::` closes the innermost block still
  open. An unclosed one swallows the rest of the page.

## Three renderers, one format

There are two renderers inside BMM, not one, and they do not have the same set.

**Documentation** — bundled pages, a plugin's docs, Help &amp; other — is rendered by the
app's own small renderer: everything you need to explain how something works, and nothing
that belongs on a landing page. **The Community tab and the release notes** show posts
written on BetterCommunity, so they render very nearly the whole website vocabulary.

| Block | In BMM docs | In the Community tab | On the website |
|---|---|---|---|
| Callouts — `note` `tip` `info` `success` `check` `warning` `caution` `danger` `error` | Yes | Yes | Yes |
| `steps` + `step` | Yes | Yes | Yes |
| `columns` + `column` | Yes | Yes | Yes |
| `details` (collapsible) | Yes | Yes | Yes |
| `roadmap` + `stage` | Yes | Yes | Yes |
| `replay` (`.bmmreplay` player) | Yes | Yes | Yes |
| `tabs` + `tab` | Yes | Yes | Yes |
| `schedule` (opening hours, in one timezone) | Yes | Yes | Yes |
| `:time` (one instant, in the reader's timezone) | Yes | Yes | Yes |
| `:kbd` (inline) | Yes | Yes | Yes |
| Tables, fenced code, lists, quotes | Yes | Yes | Yes |
| `cards` + `card` | — | Yes | Yes |
| `file` (download row) | — | Yes | Yes |
| `:button` `:link` | — | Yes | Yes |
| `:badge` `:icon` (inline) | — | Yes | Yes |
| `center` `left` `right` | — | Yes | Yes |
| `::toc` | — | Yes | Yes |

A block the renderer does not know is left as literal text, so a website-only block in a
plugin's docs shows up as `:::cards` on the page rather than vanishing. That is deliberate:
a visible mistake is one you can fix.

!!! note "This table is checked, not maintained"
    `scripts/check-md-doc-matrix.mjs` reads both renderers and fails the build if a row here
    disagrees with them. It was written because this table had said BMM renders no roadmap
    for as long as BMM had rendered one — on the same page that documents it, three sections
    further down.

## The blocks BMM renders

### Callouts

```
:::warning[Back up first]
This rewrites the file in place.
:::
```

Six names — `note`, `tip`, `info`, `success`, `warning`, `danger` — and a title in square
brackets if you want one.

### Steps

```
:::steps
:::step[Install]
Download and run the installer.
:::
:::step[Sign in]
Use your BetterCommunity account.
:::
:::
```

The numbering is automatic. Do not number the titles yourself, or every step reads
"1. 1. Install".

### Columns

```
:::columns
:::column
Left.
:::
:::column
Right.
:::
:::
```

They stack on a narrow window, so never write "the table on the left" in the prose — write
"the table above" or name it.

### Collapsible

```
:::details[Show the full output]
Hidden until clicked.
:::
```

### Session replay

```
:::replay{src="/api/assets/demo.bmmreplay" title="Installing a plugin"}
:::
```

Plays a `.bmmreplay` recording inline. Prefer a file hosted alongside the page — a replay that
404s leaves a dead frame in the middle of it.

### Roadmap

```
:::roadmap[Where we are]
:::stage[Shipped]{state=done}
- Grid questions
- Recipe checker
:::
:::stage[In progress]{state=doing percent=40}
- Blog roadmaps
:::
:::stage[Planned]
- MCP parity
:::
:::
```

Every bullet under a stage inherits that stage's state — `done`, `doing` or `planned` — and
`percent=` fills the bar of one that is under way. A state BMM does not recognise reads as
**planned**, never as finished: a typo must not report work as shipped.

Each stage shows its state three ways — the symbol, the word and the colour — so it survives
being read by somebody colourblind, and survives being pasted as plain text into a message.

!!! note "In the app, the roadmap is what the document says"
    The website's version can take `src="…/progress.json"` and poll it. In BMM the block is
    static: bundled documentation is read offline, and a tracker that silently shows nothing
    without a network is worse than one that shows what the page itself wrote down.

### Tabs

```
:::tabs
:::tab{title="Windows"}
Run `BetterModsManager.exe`.
:::
:::tab{title="Linux"}
Run `./better-mods-manager`.
:::
:::
```

One panel at a time, with a strip of titles above them. This is what a page with a Windows,
a macOS and a Linux path needs: without it all three print, and the reader has to work out
which one is theirs.

The title lives on the panel, once. A panel with no title is numbered in the strip rather
than left blank — which tells you which one to go and name.

### Opening hours

```
:::schedule[Support]{tz=Europe/Paris}
| Day | Open |
|---|---|
| Mon-Fri | 09:00-18:00 |
| Sat | 10:00-14:00 |
:::
```

A set of rows that repeat, stated in **one** timezone. `:::hours` is the same block.

**The rows are not converted, on purpose.** "Monday 09:00 Europe/Paris" is 09:00 in Paris
every week of the year; what moves when the clocks change is how far that is from the reader.
A converted row would be right today and wrong in March, with nothing on the page admitting
it. So the zone is named on the card, and underneath it the block says how far you are from
that zone **right now** — which is the only true form of that sentence, because the page does
not redraw itself twice a year.

### One instant

```
The stream starts at :time[2026-09-01T20:00]{tz=Europe/Paris}.
```

A single moment has none of that ambiguity, so it *is* converted: it renders in the reader's
own timezone, with what you typed kept in the tooltip. `:at[...]` is the same thing.

Write the date, not just the time — that is what makes it exact, because it settles which
side of a daylight-saving change the moment falls on. A value that cannot be read is shown
exactly as you typed it, never as `Invalid Date`.

## The website's extra blocks

These render on BetterCommunity — blog posts, docs pages, FAQ answers, project pages — and
are shown as plain text by the app.

The complete website list, with every attribute, is in the BCWEB repository at
`guides/reference/CUSTOM_MARKDOWN.md`, and on the site itself under **Docs → Authoring →
Documentation blocks**.
