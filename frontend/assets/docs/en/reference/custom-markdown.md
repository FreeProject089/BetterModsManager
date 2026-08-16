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

## Two renderers, one format

BMM and BetterCommunity share the format and the styling, but not the whole set. The app
renders the blocks you need to write documentation; the website adds the ones a marketing or
roadmap page wants.

| Block | In BMM | On the website |
|---|---|---|
| Callouts — `note` `tip` `info` `success` `warning` `danger` | Yes | Yes |
| `steps` + `step` | Yes | Yes |
| `columns` + `column` | Yes | Yes |
| `details` (collapsible) | Yes | Yes |
| `replay` (`.bmmreplay` player) | Yes | Yes |
| Tables, fenced code, lists, quotes | Yes | Yes |
| `cards` + `card` | — | Yes |
| `roadmap` + `stage` | — | Yes |
| `file` (download row) | — | Yes |
| `:badge` `:icon` `:kbd` (inline) | — | Yes |
| `::toc` | — | Yes |

A block the renderer does not know is left as literal text, so a website-only block in a
plugin's docs shows up as `:::roadmap` on the page rather than vanishing. That is deliberate:
a visible mistake is one you can fix.

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

## The website's extra blocks

These render on BetterCommunity — blog posts, docs pages, FAQ answers, project pages. The
roadmap is the one most people are looking for:

```
:::roadmap[Where we are]
:::stage[Shipped]{state=done}
- Grid questions
- Recipe checker
:::
:::stage[In progress]{state=doing percent=40}
- Blog roadmaps
:::
:::stage[Planned]{state=planned}
- MCP parity
:::
:::
```

Every bullet under a stage becomes a tracked item and inherits that stage's state — `done`,
`doing` or `planned`. `percent=` fills the bar of a stage that is under way.

The complete website list, with every attribute, is in the BCWEB repository at
`guides/reference/CUSTOM_MARKDOWN.md`, and on the site itself under **Docs → Authoring →
Documentation blocks**.
