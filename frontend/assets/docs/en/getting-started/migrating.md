# Migrating from OvGME or OMM

Written because the four questions below are the ones people actually ask before switching,
and they were not answered anywhere. Every claim here was checked against the source rather
than taken from another page.

The short version: **your mods and your hosting stay as they are.** The work is on your side
once, not on your users' side repeatedly.

---

## Do I have to repack my mods?

No.

A BMM mod is a **folder or an archive** (`.zip`, `.rar`, `.7z`, `.tar`…) whose internal tree
mirrors the game root — the same convention OvGME and OMM use. An existing package works as
it is.

There is an optional `bmm.json` carrying a stable mod id, and it really is optional: without
one, BMM derives a deterministic fingerprint from the sorted (relative path, file size) pairs,
so the same files produce the same id on every machine. Nothing has to be added to a mod for
BMM to track it.

!!! tip "Archives stay archived"

    A `.zip` is not unpacked into your library. BMM reads what it needs from it and extracts to
    a temporary cache only when files are actually required — see [Library](doc-page:features/library).

---

## Do I have to maintain a manifest by hand?

No — and this is usually the deciding answer for anyone maintaining an OMM repository.

BMM **generates** the repository manifest. Point *Export Server Repo* at your mods and it walks
them, computes the SHA-256 of each file (plus chunk hashes for large ones), records the sizes,
and writes `repo.json` itself. Add, remove or update a mod and re-export.

It also recovers the existing repo seed from a previous `repo.json`, so re-exporting an updated
repository does not invalidate the clients already using it.

You never open that file.

---

## I host over HTTP. Does that work?

Yes, in two different shapes — pick whichever fits your infrastructure.

| You have | Use |
|---|---|
| Any web host that serves a directory | The repo generator can emit a **static** directory (`index.html` + the manifest) you simply drop in place. No Node process, nothing to run. |
| Per-mod download URLs | **Direct downloads** are a first-class source type, alongside GitHub, Drive and MEGA. |

!!! warning "`ftp://` is not a transport BMM speaks"

    Downloads go over http(s). If your files sit on an FTP server but are reachable through an
    HTTP link, that is the supported case and you are fine. If the only access is the FTP
    protocol itself, BMM cannot fetch it.

---

## How does applying a mod actually differ from OMM?

Less magically than you may have been told, and the honest answer is worth more than the pitch.

**BMM does not use a virtual filesystem, symlinks or junctions.** It copies real files into the
destination folder and backs up whatever real game file it replaced into the profile's `_original/`
store. That is fundamentally the same approach OMM takes.

The difference is everything around the copy:

- **Conflict awareness.** BMM indexes which mods ship the same files — inside a profile, and
  across profiles that share a destination folder — and can show every overlap at once instead of one
  at a time. See [Conflicts](doc-page:how-it-works/conflicts).
- **Explicit activation order.** The order is stored as part of the profile, so it is something
  you set and share, not an accident of what you clicked last.
- **Layered restore.** Disabling a mod does not blindly put the vanilla file back. BMM first
  looks for another **still-active** mod that provides that same file and restores *that*; only
  if none does does it fall back to `_original/`; and if the file never existed in the game, it
  is removed. This is what makes disabling one mod out of an overlapping stack behave sensibly.

If your mental model is *"OMM, with conflict handling and no manifest to maintain"*, that is
accurate.

---

## Bringing your existing setup across

BMM reads both managers' own configuration, so profiles come over without being rebuilt by hand:

- **OMM** — reads `%APPDATA%\Open Mod Manager\config.xml` and imports the profiles it lists.
- **OvGME** — reads OvGME's own config and imports the same way.

Both are offered on the empty-profile screen at first launch, and from the
[command palette](doc-page:features/command-palette).

!!! note "What does not come across"

    Conflict decisions and activation order from the other manager. BMM rebuilds its own conflict
    index from the files themselves, and the activation order starts from the imported list —
    worth a look at the [global conflict view](doc-page:features/library#conflicts) after importing.
