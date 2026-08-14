# Preset catalog — sharing automations

A **preset** is a scheduled automation somebody else built: a nightly repo sync, a
tidy-up after a game closes, a weekly backup. BMM already exports them as `.bmmpa` files.
A **preset catalog** is a published list of them.

Open it in BMM under **Scheduler → new task → *From a catalog…***.

---

## The document

```json
{
  "version": "1.0",
  "name": "My automations",
  "presets": [
    {
      "id": "nightly-sync",
      "name": "Nightly repo sync",
      "description": "Syncs a repo at 3am and tells you what changed.",
      "author": "Someone",
      "version": "1.2",
      "download_url": "https://example.com/nightly.bmmpa",
      "tags": ["repo", "sync"],
      "tasks": 2
    }
  ]
}
```

| Field | Required | What it means |
|---|---|---|
| `id` | **yes** | Unique within the catalog. A repeat is dropped, first wins. |
| `download_url` | **yes** | The `.bmmpa`. `http`/`https` only. `downloadUrl` also accepted. |
| `name` | no | Falls back to the `id`. |
| `description` | no | Shown in the list. |
| `author` | no | Shown in the list. |
| `version` | no | Shown in the list. |
| `tags` | no | Up to 8. |
| `tasks` | no | How many automations are inside. |

### Why an entry points at a file instead of describing it

A `.bmmpa` is what BMM already exports and imports. A catalog that spelled its tasks out
in JSON would be a second format describing the same thing, and the two would drift — so
the catalog carries the address and the file carries the content.

### `tasks` — say it or leave it out

Omitting it means "not stated". BMM shows nothing rather than `0`, because "the publisher
did not say" and "it contains nothing" are different claims about somebody else's work.

---

## Nothing installs without being read first

Every row in the browser ends in **Inspect**, never in *Install*. Choosing it downloads
the `.bmmpa` and shows what is inside:

- what each task would do, and when it would run
- **what it grants itself** — running external programs, running scripts, firing
  deeplinks, stopping programs
- **what it reaches outside BMM**, including anything buried inside a loop or a branch
- the **full text of every script**, so you can read the actual code
- every program, path and URL it names, printed exactly as written and never resolved

Only then can you import it. Downloading is not importing.

This is the same reader as the **Inspect a .BMMPA** button, on the same rules, because a
preset from a catalog deserves no more trust than a file somebody sent you — it just
arrived more conveniently.

---

## Publishing

Serve the JSON at a stable `https` address and add it to your catalog index with
`"type": "preset"`, or share the address for people to add by hand.

An entry with no usable download address is dropped from the list with a reason rather
than shown as a row nobody can act on.

BetterCommunity publishes its own at:

```
https://bettercommunity.ch/api/catalog.json?project=bmm&kind=PRESET
```
