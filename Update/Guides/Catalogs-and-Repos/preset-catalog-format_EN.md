# Preset catalog — sharing BMM automations

> **"Preset" means two things on BetterCommunity.** A **BSM** preset is a single JSON file
> of audio settings — see *Preset catalog (BSM)* in the BetterCommunity docs. A **BMM**
> preset is a scheduled automation. Both are published as `kind=PRESET`; the `app` field
> is what tells them apart, and BMM only reads entries marked `bmm` or unmarked. This page
> is about the BMM kind.

A BMM preset is a scheduled automation somebody else built: a nightly repo sync, a
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

## A catalogue that carries its own files

Everything above assumes the `.bmmpa` files sit somewhere a URL can reach. They do not have
to. **Publish my own…** has a *pack it into one file* option: BMM writes the folder as
usual and then a single `.zip` of it beside them, holding `catalog.json` and every
automation it names.

Send that one file to somebody. In the automation catalogue panel, **Open a bundle
file…** follows it — no host, no address, nothing to keep alive.

The format is deliberately not a new one. It is the folder, zipped: `catalog.json` at the
root and the payloads next to it. Anyone with a zip tool can look inside without BMM, and
unzipping it gives back exactly the folder that would have been published.

Two things worth knowing:

- **An entry inside a bundle may still point outward.** A `download_url` of
  `https://…/big.bmmpa` works in a bundle exactly as it does in a hosted catalogue, so the
  small automations can travel with the file while a large one stays on a CDN.
- **A bundle cannot have a base address.** The option is refused if you filled the base
  address in, because a catalogue whose files live somewhere else has nothing to pack —
  and silently packing an empty zip would be worse than saying so.

Packing tells you if the catalogue names a file that is not in the folder, by name. A
catalogue promising three automations and carrying two is a thing to hear about while you
still have the folder open, not from the person you sent it to.

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
