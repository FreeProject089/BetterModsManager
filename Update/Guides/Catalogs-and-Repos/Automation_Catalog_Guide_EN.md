# 🗓️ Publishing a catalogue of automations

An automation catalogue is a list of shareable scheduled tasks. Somebody follows its address
in BMM, sees what you published, and installs one.

BMM has read these for a while. It can now **write** one: **Settings → Scheduler → From a
catalogue… → Publish my own…**

---

## 🧱 What it writes

A folder, not a file:

```text
my-automations/
├── catalog.json
├── Nightly-tidy.bmmpa
├── Weekly-backup.bmmpa
└── Sync-and-launch.bmmpa
```

One signed `.bmmpa` per automation, and a `catalog.json` that lists them. Upload the whole
folder anywhere static — a GitHub repository, GitHub Pages, an S3 bucket, your own server —
and give people the address of the `catalog.json`.

That is the entire mechanism. There is no account to create and nothing to register.

---

## 🔗 Why the addresses are relative

The entries BMM writes look like this:

```json
{ "id": "nightly-tidy", "name": "Nightly tidy", "download_url": "Nightly-tidy.bmmpa" }
```

`Nightly-tidy.bmmpa`, not `https://…/Nightly-tidy.bmmpa`. BMM resolves it against wherever it
fetched the `catalog.json` from.

That is deliberate. A catalogue that names its own host stops working the moment it is moved,
mirrored or forked — and being forked is the normal life of a folder on GitHub. With relative
addresses, somebody who forks your repository has a working catalogue at their own address,
and you can move hosts without editing anything.

**When to use a full address instead:** only when the `.bmmpa` files genuinely live somewhere
other than beside the `catalog.json` — a CDN, a release page. The builder asks for that base
address and leaves it empty by default.

Anything that is not `http://` or `https://` after resolving is refused. That check is on the
**result**, not on what you typed, because an absolute `javascript:` address passes through
resolution untouched.

---

## 📦 What travels with an automation

Everything it calls, followed transitively:

| It uses | What is carried |
|---|---|
| `Run another task` | that task, and anything *it* calls |
| `Call a shared block` | the block's steps |
| `Run a launch pack` | the launch pack |
| `Apply a plugin` | the plugin |
| A modpack action | the modpack |

So a task that runs two others publishes as a working automation rather than a third of one.

Two automations with the same name get different filenames (`Nightly-tidy`,
`Nightly-tidy-2`). Without that the second would overwrite the first while the catalogue
still listed both — one entry quietly serving another's contents, which reads as the wrong
automation being published rather than as a name clash.

---

## 🔐 What the person installing gets

**Not your permissions.** An automation imported from a catalogue — or from any `.bmmpa`, or
from a shared `.bmmscript` — arrives **disabled**, with all four capability grants removed:
run external programs, run scripts, fire deeplinks, stop a program.

BMM then tells them what the file asked for, so they can grant what they actually want.

This matters to you as a publisher: **an automation that needs to run a script will not work
until the person turns that permission on.** Say so in the description. A task that appears to
do nothing is one people delete.

The `.bmmpa` files are signed on the way out, so the person importing can see whether the file
is still what you wrote.

---

## 📋 The feed format

If you want to write or generate the `catalog.json` yourself:

```json
{
  "version": "1.0",
  "name": "My automations",
  "presets": [
    {
      "id": "nightly-tidy",
      "name": "Nightly tidy",
      "description": "Scan, then disable anything huge",
      "author": "you",
      "version": "1.0",
      "download_url": "Nightly-tidy.bmmpa",
      "tags": ["maintenance"],
      "tasks": 1
    }
  ]
}
```

| Field | Required | Notes |
|---|---|---|
| `id` | yes | Unique in the catalogue. Listed twice, the first wins. |
| `name` | yes | What people see. |
| `download_url` | yes | Relative is preferred. `downloadUrl` is also accepted. |
| `description` | no | One or two lines. |
| `author` · `version` · `tags` | no | Shown beside the entry. |
| `tasks` | no | How many automations are inside. Omitted means *not stated*, which is not the same as zero and is not displayed as it. |

An entry with no usable address is **dropped**, not shown as a row that cannot be installed —
and BMM reports how many it dropped and why.

---

## 🌐 Publishing it on BetterCommunity

A catalogue hosted with us is a `PRESET` catalogue on a **BMM** project. The entry points at a
`.bmmpa` exactly as above. See the *Submit content* page on the site.

---

## ❓ FAQ

**Can I update an automation after publishing?**
Replace the `.bmmpa` at the same address. Anybody who follows the catalogue gets the new one
next time they install it. Existing copies are theirs and are not touched.

**Does the person get my profile names, paths or tokens?**
Only what is inside the tasks you picked. Export one and read it before publishing — a
`.bmmpa` is plain JSON. Paths you typed into a step are in there.

**Can I mix automations and other content in one catalogue?**
No. One catalogue is one kind. Use a **catalogue index** to hand somebody a single address
that brings in several catalogues of different kinds at once.
