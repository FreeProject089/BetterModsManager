# 📦 Embed or link — and the single-file bundle

*🇫🇷 [Version française](Embed_Or_Link_FR.md).*

Every catalogue in BMM is a `catalog.json` listing things that live somewhere. **Where** is
now a decision you make per entry, in every builder, and the same two words mean the same
thing in all of them:

| Choice | What happens |
|---|---|
| **Pack the file** | BMM writes the file beside `catalog.json` and the entry names it, relatively. |
| **Link to it** | The entry carries an `https://` address and nothing is written for it. |

A catalogue can be any mix. That is the point: pack the three small automations, link the
90 MB one somebody already hosts, in one document.

---

## Why relative

A packed entry's address is a bare filename — `Nightly-tidy.bmmpa`, not
`https://your-host/Nightly-tidy.bmmpa`. The reader resolves it against wherever it fetched
the catalogue from, so the folder keeps working when it is moved, mirrored or forked. Being
forked is the normal life of a folder on GitHub, and a catalogue that names its own host
stops working the moment it happens.

Every builder still offers an **address the files will live at**, and empty is almost always
right. It prefixes **packed** entries only — a linked entry already said where it lives, and
prefixing it would rewrite somebody else's address into one on your host.

---

## The bundle

Tick **Publish it as ONE file** and you get a single `.bmmbundle` instead of a folder: the
`catalog.json` and every file it packs, in one thing you can send somebody. There is nothing
to host and no address to keep alive.

Three things worth knowing:

- **You choose where it goes.** The payloads are written to a working folder nobody sees,
  the bundle is saved where you say, and the working folder is removed afterwards — nothing
  is left in either place.
- **Only what the catalogue uses is packed.** The bundle holds `catalog.json` and exactly the
  files its entries name. Not whatever else was in the folder.
- **It is a zip with its own extension.** Rename it to `.zip` and any tool opens it. The
  extension exists so a person can tell a catalogue from a mod archive at a glance, and so
  double-clicking one never means "unpack this into my downloads".

A catalogue of nothing but links has nothing to pack, so the option switches itself off — an
archive holding one `catalog.json` is not a bundle, it is a `catalog.json` somebody has to
unzip first.

### Following one

Every catalogue screen that can follow an address can also open a bundle: *Open a bundle
file…*. It is checked when you open it rather than when it is next read, so a file that is
not a catalogue fails there and then, with the reason.

An entry inside a bundle may still be a link. The two kinds are told apart per entry before
either is followed, and anything that is neither — a scheme, an absolute path, a `..` — is
refused rather than repaired.

---

## Which builders have it

| Catalogue | Where | Pack | Link | Bundle |
|---|---|---|---|---|
| Automations | Scheduler → Files… → *Publish my own…* | yes | yes | yes |
| Plugins | Plugins → My catalogues → *Publish…* | yes | yes | yes |
| Tutorials | Tutorial hub → *Build a catalogue* | yes | yes | yes |
| Themes | Themes → *Create theme catalog* | yes¹ | yes | yes |
| Mod lists | Mod lists → *Publish…* | yes | yes | yes |
| Modpacks | Modpacks → Catalogues → *Publish* | yes² | yes | n/a² |
| Apps | — | no³ | yes | no³ |

¹ Themes have a third choice, **Keep it in the catalogue** — the body written inline, which
is what every theme catalogue published before this contained, and still the default. Pack
writes a `.bmmtheme` beside the catalogue instead.

² A `.cbmp` already *is* a bundle: it carries its packs. Links were what it was missing.

³ An app entry points at an installer binary. BMM never holds a copy, so there is nothing to
pack — and making it work would mean running an executable out of an archive somebody sent
you, which is a different question from reading a JSON document out of one.

---

## For plugins, the address field *is* the choice

There is no extra control on a plugin row. Fill the address in and the entry is **linked**;
leave it blank and the plugin is **packed**, if it is installed here. Each row says which of
the three it is:

- **Pack the file** — installed here, so a blank address means pack it
- **Link to it** — an address is filled in
- **no source** — installed nowhere and no address, which would publish an entry nobody can
  follow

---

## What the reader sees

Nothing changes for the person following your catalogue. A packed entry is fetched from
beside the catalogue, or read out of the bundle; a linked one is fetched from its address.
Both end in the same review screen, and nothing installs without being read first.

If you publish it on BetterCommunity, its **Inspect a BMM file** tool reads a bundle and says
how many entries are packed, how many are fetched from elsewhere, which hosts those use, and
whether the archive actually holds everything the catalogue names.

---

## See also

- [Automation catalogues](Automation_Catalog_Guide_EN.md)
- [Plugin catalogues](Plugin_Catalog_Guide_EN.md)
- [Theme catalogues](Theme_Catalog_Guide_EN.md)
- [The preset catalogue format](preset-catalog-format_EN.md)
- [The catalogue index format](catalog-index-format_EN.md)
