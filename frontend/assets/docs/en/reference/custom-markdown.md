# B.MD — better.markdown


**B.MD** (better.markdown) is the block vocabulary shared by BMM and BetterCommunity.
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
app's own small renderer. **The Community tab and the release notes** show posts written on
BetterCommunity. Both now answer to the whole website vocabulary: a post written once reads
the same in the browser and in the app, which is the entire point of the two lists being one
list.

They still differ in one way, and it is a deliberate one. The documentation renderer has no
dictionary — it cannot speak the reader's language — so the few blocks that write a sentence
of their own (the schedule card's heading, a download button's label) are filled in after
rendering rather than by the renderer itself. Nothing you write is affected.

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
| Maths — `$$E = mc^2$$` | Yes | Yes | Yes |
| Emoji shortcodes — `:rocket:` `:warning:` | Yes | Yes | Yes |
| `cards` + `card` | Yes | Yes | Yes |
| `file` (download row) | Yes | Yes | Yes |
| `:button` `:link` | Yes | Yes | Yes |
| `:badge` `:icon` (inline) | Yes | Yes | Yes |
| `center` `left` `right` | Yes | Yes | Yes |
| `::toc` | Yes | Yes | Yes |

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

## Keyboard keys, either way

Two spellings, both drawn on both surfaces:

```
Press :kbd[Ctrl+K] to open the palette.
Press ++ctrl+k++ to open the palette.
```

`:kbd[…]` is B.MD's; `++…++` is the one the documentation site's own extension uses. They were
not interchangeable until recently — ten `++esc++` in these pages drew keycaps on the website
and printed as literal text in the app, and four `:kbd[…]` did the reverse, in the same two
files. `scripts/check-doc-dialects.mjs` in the BMM repository now fails the build when a page
uses syntax only one of the two renders.

## Maths

Wrap TeX in `$$`:

```
The mass–energy relation is $$E = mc^2$$, and Pythagoras says

$$
a^2 + b^2 = c^2
$$
```

On its own lines it is centred; inside a sentence it stays in the line. Single `$` is **not**
maths, deliberately — this app quotes prices, and "$5 and $10" would otherwise be typeset as
a formula, silently, because a price does not raise an error. A formula that will not parse is
shown exactly as you wrote it rather than as a parser's complaint: you can fix the source, and
nobody can fix a message.

## Emoji

`:rocket:` becomes 🚀. The same 380-odd names the website knows, so the same document reads the
same in both. An unknown name stays as you typed it rather than disappearing, and a name that
is part of a word (`path:rocket:x`) or a time (`10:30:45`) is never touched.

Pasting the character itself has always worked; the shortcode exists because keyboards do not
have 🚀 on them.

## Where a document comes from, and what that changes

A page in this documentation is ours. **A plugin's documentation is not** — it arrives with
the plugin, written by whoever made it, and it is rendered in a window that can call the
application's own commands.

So B.MD in BMM renders as **untrusted** unless the caller says otherwise:

- Raw HTML is not passed through. A `README.md` that begins with `<` used to be handed to the
  page verbatim; now it is sanitised like anything else.
- Every link, image, download and recording is checked before it is written. `javascript:`,
  `data:text/html`, `vbscript:` and a protocol-relative `//host` are all refused — the last
  one matters because it has no scheme, so a check that only looks at schemes lets it past.
- A refused link keeps its text and loses its destination, rather than becoming a button that
  goes somewhere nobody chose.

Nothing about writing a document changes. This is what happens to one you did not write.

## The full website list

Every block above renders in both places. The complete list with every attribute is in the
BCWEB repository at `guides/reference/CUSTOM_MARKDOWN.md`, and on the site itself under
**Docs → Authoring → Documentation blocks**.
