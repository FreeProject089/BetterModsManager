# Making your mod updatable — Modding Guide

This guide is for **mod authors and repo hosts**: how to make a mod that BMM users
can keep up to date, and how to publish a new version with a changelog. For the
API/integration side, see Developer → *"Mod Update API"*.

---

## 1. How BMM tracks updates

BMM links each installed mod to the repo it came from using two values:

- **`repo_url`** — the repository that hosts the mod.
- **`repo_mod_id`** — the mod's **stable id inside that repo**. This must stay the
  same across versions, so BMM can recognise "this installed mod" is the same as
  "this newer mod in the repo".

When a user syncs your repo, BMM records both automatically. Later, *Check for mod
updates* compares the installed version string to your repo's current version — if
they differ, the user is offered the update.

> The stable id is **not** the file fingerprint (`content_id`), which changes every
> time you change files. That's why a dedicated stable id exists.

---

## 2. Give your mod a stable id (recommended)

By default a mod's id is generated. To guarantee a stable identity across
re-packagings and machines, ship a **`bmm.json`** at the root of your mod folder:

```json
{ "id": "yourname.coolmod" }
```

BMM uses this `id` as the mod's `content_id` and, when you host it in a repo, as
its `repo_mod_id`. Pick something unique and never change it.

If you don't ship `bmm.json`, BMM derives a fingerprint id from the file list —
which still works, but can change if you restructure files.

---

## 3. Publishing a new version (repo host)

1. In your local library, **bump the mod's version** (e.g. `1.0.0` → `1.1.0`).
   Update the files as needed.
2. Open **Server Repo → Host → "Update an existing repo"** and pick your repo
   folder.
3. In the **current content** list and the **add** list, every mod shows its
   **`repo_mod_id`** with a **Copy** button — this is the value your users need if
   they want to link a manually-installed copy.
4. Tick the changed mod(s), and **type a changelog** in the field under each mod
   (e.g. *"Fixed the broken texture, added 2 variants"*). It's shown to users when
   the update is detected.
5. Click **Apply**. Your `repo.json` now carries the new version + changelog.

Users will see the update on their next *Check for mod updates* (or automatically,
if they enabled an interval).

---

## 4. Helping users link a mod manually

Some users install a mod by hand (not via your repo). They can still get updates:

1. They open the mod's **⋯ menu → Configure updates** in their library.
2. They paste your **repo URL** and the **`repo_mod_id`** (the value you can Copy
   from the *Update an existing repo* screen).
3. From then on, BMM checks your repo for that mod.

You can also offer a **global update repo**: tell users to add your repo URL in
**Settings → Global update repositories**. Then any mod whose `repo_mod_id` exists
in your repo is checked automatically — no per-mod setup.

---

## 5. Versioning tips

- Use clear, increasing version strings. BMM flags an update whenever the repo
  version **differs** from the installed one (it doesn't enforce semver ordering),
  so avoid reusing an old version number for new content.
- Keep `repo_mod_id` constant forever. Changing it makes BMM treat it as a
  different mod (the old one stops receiving updates).
- Write a short, specific changelog each time — it's the only "what changed" info
  the user sees before updating.

---

*See also: Modding → "Mod Identity", and Developer → "Mod Update API".*
