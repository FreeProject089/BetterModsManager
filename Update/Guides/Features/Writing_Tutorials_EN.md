# Writing an interactive tutorial

BMM's tutorials are not videos or screenshots. They **drive the real application**: they open
the view they are talking about, put a spotlight on the button they mean, and — when it
matters — wait until you have actually done the thing before letting you move on.

You can write your own, share it as a file, and publish a catalogue of them.

---

## Where it lives

The tutorial hub (**Help & Other → Interactive tutorial**, or the mascot) lists lessons on the
left. At the bottom of that list:

| Button | What it does |
|---|---|
| **Create…** | Opens the editor on a new, empty tutorial. |
| **Import…** | Reads a `.bmmtut` file from disk and adds it to the list. |
| **Catalogues…** | Follows a catalogue address and installs tutorials from it. |

Selecting a tutorial you wrote shows three more: **Edit**, **Share (.bmmtut)** and
**Delete**. Official tutorials have none of those, and the absence is the point — they are
not yours to change.

---

## The shape of a tutorial

A tutorial is **parts**, and a part is **steps**. That is the whole hierarchy.

A part is a chapter: something a reader can start at and finish. A step is one thing to
understand or do. The reader sees the parts as chapters they can jump between, so a part that
is one step long and a part that is thirty both read badly — five to ten is comfortable.

### What a step can carry

| Field | Meaning |
|---|---|
| **Title** | The heading of the coach card. |
| **Text** | The explanation. Formatting tags allowed: `<b>` `<i>` `<u>` `<ul>` `<li>` `<code>` `<kbd>` `<br>`. |
| **Page** | Which view BMM opens when the step appears. Leave it on *Stay on the current page* when the reader is already where they need to be. |
| **Element to highlight** | A CSS selector — `#some-id` or `.some-class`. The spotlight dims everything else. |
| **Wait for the reader to…** | An action. Until it happens, **Next** stays locked. |

Everything else about the engine — the dimming, the card placement, the progress record, the
resume-where-you-left-off — is the same code the official tutorials run. You are not writing
for a simpler runner.

---

## Finding a selector

The **Test** button beside the selector field flashes whatever the selector matches *right
now*, in the running app, and scrolls it into view. If nothing matches it says so.

That is a typo-catcher, and the button says as much. It cannot tell you the element will
exist on somebody else's screen — a selector that matches a card in *your* library matches
nothing in an empty one. Prefer:

- **ids over classes.** `#btn-add-mod` is a decision somebody made; `.card:nth-child(3)` is
  an accident of your data.
- **elements that always exist** — a nav button, a panel header, an empty-state box — over
  ones that only appear when there is content.
- **no selector at all** for a step that only explains. A spotlight on nothing is worse than
  no spotlight.

---

## Gating a step on a real action

*Wait for the reader to…* lists the actions BMM announces: a profile created, a mod enabled,
a repo connected, a theme applied, and so on. Pick one and the step will not advance until it
genuinely happens.

Use it for the moment the lesson exists to teach, and nowhere else. A tutorial that gates
every step turns into a checklist somebody wants out of; one that gates the single step where
doing beats reading is the reason interactive tutorials are worth writing.

Mark a step **optional** if the reader might reasonably not be able to do it — they have no
repo to connect to, no second profile to compare.

---

## Two languages

Every text field has an English value and an optional French one. If you leave the French
empty, French readers see the English — the tutorial stays whole rather than turning half its
steps into blanks.

Write the English first. It is the fallback for every language BMM does not have a value for.

---

## Sharing

**Share (.bmmtut)** writes one file. It is signed with your creator key, so whoever imports it
is told one of three things:

| Verdict | Meaning |
|---|---|
| **signed by its author** | The file is exactly what was signed. |
| **unsigned** | No signature. Importable — plenty of files legitimately have none. |
| **SIGNATURE INVALID** | It was **edited after signing**. Import it only if you know why. |

The id you choose names the file and the progress record. It is locked once the tutorial
exists, because changing it would fork the tutorial rather than rename it — readers who are
half-way through would silently start again.

### What a shared tutorial cannot do

It displays text and highlights parts of the interface. That is all.

Text from a shared file is stripped to the formatting tags listed above: scripts, links,
images, styles and event attributes are removed before it is ever displayed. A tutorial from
a stranger cannot run code, install anything, or reach the network. If you want those, you
are describing a **plugin** or an **automation**, and both have their own permission gates.

---

## Publishing a catalogue

A tutorial catalogue is a JSON file listing tutorials:

```json
{
  "version": "1.0",
  "name": "My tutorials",
  "tutorials": [
    {
      "id": "getting-started",
      "name": "Getting started with modding",
      "description": "Profiles, mods and your first sync.",
      "url": "https://example.com/tutorials/getting-started.bmmtut"
    }
  ]
}
```

`url` may be relative to the catalogue — `getting-started.bmmtut` beside `catalog.json`
works, and keeps the catalogue and its files moving hosts together.

Host it anywhere that serves a file over HTTPS, or on BetterCommunity (**Submit content →
Host my own catalog**, type *Tutorial*). Readers add the address under **Catalogues…**.

A catalogue can be protected with a download password or authorised keys, exactly like every
other BMM catalogue; the fold in the catalogue window is where readers supply them.

---

## A checklist before you share

- Every step's selector matches something on a **fresh** install, not just yours.
- No step is gated on an action a reader might be unable to perform.
- The first step of every part makes sense as a starting point — readers jump between parts.
- English is filled in everywhere, even where French is too.
- You have run it yourself, start to finish, at least once.

---

## See also

- **Catalog index — one address for many catalogs** — publishing several catalogues under one
  address, tutorials included.
- **Server-Repo access control** — the password and key fold, in detail.
