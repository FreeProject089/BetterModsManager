# Server Repo


A **Server Repo** is a shared, versioned collection of mods. Two things flow through it: you
**sync** mods *from* a repo into a profile, and BMM uses the repo to tell you when those mods
have an **update**. You can also **host** one yourself. Without a repo, a mod you installed by
hand stays at the version you installed, forever, silently.

> Browse Server Repositories — official and partner server repositories.

![The Server Repo screen](assets/docs/media/screens/repo.annotated.png)

| | | |
|---|---|---|
| **1** | **Repo list** | Sources you've added. |
| **2** | **Browse** | Official and partner repos. |
| **3** | **Add** | Point BMM at a repo URL. |

<div class="bmm-replay" data-remote="https://freeproject089.github.io/BMM-Docs/assets/replays/repo.bmmreplay" data-page="features/repo" data-title="Connecting to a repo and syncing"></div>


## Connecting to a repo

Browse the official and partner list, or paste a repo URL directly. Once connected, the
repo's mods appear in your [Library](doc-page:features/library) alongside your local ones, marked with the
repo's name.

## Syncing mods from a repo

A protected repo asks for its **download password** once — and if you already know the
repo is protected, open the *"This repo has a download password"* row under the URL field
and type it before Fetch, instead of fetching, failing, and typing. A server with **no
`repo.json` at all** still works: Fetch reads its folder index instead, and every mod it
finds installs marked *unverified*, with the card saying so in as many words.

Syncing pulls the repo's mods onto your machine and into a profile. BMM does a **delta-sync**:
it compares what the repo has against what you already have and downloads **only the changed
files**, so updating a 5 GB repo after a small patch costs a few megabytes, not five gigs. A
long sync can be **cancelled** mid-flight, and you can cap its download speed so it doesn't
saturate your connection.

## Update detection

Once a mod is linked to a repo, *Check for mod updates* compares your installed version to the
repo's current version and offers the update when they differ. Linking is a separate step from
connecting:

> Link this mod to one or more repos so BMM can detect updates for it.

One mod can point at several repos. That's deliberate: if a source disappears, the mod is
still tracked by the other. There's also a **global update repositories** setting in
[Settings](doc-page:features/settings) — list a repo there and it is added to the update check for every mod
that already carries a repo mod id.

!!! warning "A global repo only reaches mods that are already linked"

    The app states the rule: a global repo is matched *by the mod's `repo_mod_id`*. A mod you
    added by hand from a `.zip` has no such id, so a global repo will never find it — link
    that mod to a repo once, and the globals apply from then on.

### Direct downloads have no version

Worth understanding, because it looks like a bug and isn't:

> No update detected. A direct download has no version, so BMM cannot tell if it is newer.

A raw file URL carries no version number, so BMM has nothing to compare. It offers a **direct
re-download** instead of pretending to know. If you want real update detection, link the mod
to a repo that publishes versions.

## Hosting your own repo

You can turn your own mods into a repo other people sync from. The Host tab is split in two:
**producing the `repo.json`**, then **serving the files**.

### Three ways to produce the manifest

They are alternatives — pick the one that matches where your mods already are.

| Route | What it does | Use it when |
|---|---|---|
| **Full export** | Copies every mod into an output folder alongside the manifest. | Starting from scratch; the mods are on this machine. |
| **Manifest only** | Writes just `repo.json` for folders BMM can read here — one, several, or a set of profiles. **Nothing is copied.** | The mods are already where you want them. |
| **Update from the server** | Reads your server's directory listing and writes the manifest without pulling the repo back. | The mods live only on the server. |

Whichever you use, the manifest lists every mod, its version, per-file SHA-256 hashes (plus
4 MB block hashes on large files) and any changelog, and is **signed with your creator key** —
so anyone syncing can confirm it came from you and was not tampered with. Every generation
re-signs, including updates.

**Your server does not have to move.** The manifest carries a layout template — `{id}` and
`{path}`, default `mods/{id}/{path}` — so files already served under, say, `addons/<mod>/`
are described rather than relocated. In *Manifest only* the layout is derived from where the
manifest lands relative to the folder, so `repo.json` and the folder stay portable together.

**Several folders, one repo.** *Manifest only* takes a list: add as many mods folders as you
like, or switch to *From profiles* and tick several — profiles kept in different mods folders
no longer have to become separate repos. A mod's id is its folder name, so two folders holding
a folder of the same name would describe two different things under one id: that pair is
reported and nothing is written, rather than being merged into a repo where half the files
404. With more than one folder the layout is no longer derived (there is no single directory
to derive it from) — the default `mods/{id}/{path}` applies, and the report says what each
folder contributed, including the ones that contributed nothing.

### Updating

Run the same generation again. The repo keeps its identity — same seed and id — so
subscribers see an update rather than an unrelated repo, and you are told what was **added**,
**changed** and **removed**. That last one matters: a mistyped path writes a perfectly valid
manifest describing an empty server.

There are no version numbers to bump; changes are detected by hash.

*Update from the server* goes further: it compares the listing's sizes and timestamps against
your last manifest and downloads only what actually changed, reusing the recorded hash for
everything else. It reports **what the manifest is missing** separately from what merely
changed — an incomplete repo and a stale one are different problems. It writes `repo.json`
locally; you upload that one file with the client you already use, so BMM never needs write
access to your server.

You do not need a local manifest to start. Point it at a base URL and, if the server already
publishes a `repo.json`, BMM fetches that as the starting point instead of your own last copy
— so a repo you host but whose manifest you no longer have on this machine can still be
updated, and a machine that has never seen the repo can produce a correct one. With no local
path given, the result is written under `RemoteRepos/` rather than next to files you did not
choose.

!!! note "Requires directory listing"
    *Update from the server* reads your server's own index, so `autoindex on` (nginx) or the
    equivalent must be enabled. Without it BMM cannot see what the server holds.

**Host.** Serve the generated repo over BMM's built-in HTTP server so others can reach it.
Optional switches make it public without port-forwarding gymnastics:

| Option | What it does |
|---|---|
| **Cloudflare Tunnel** | Exposes your local server at a public URL with no router config. |
| **UPnP** | Opens the port on your router automatically, for a direct connection. |
| **Upload limit** | Caps outbound speed so hosting doesn't starve your own connection. |
| **Download password** | Optional. Subscribers must enter it on first connect (sent as `X-Repo-Password`); blank = open repo. Distinct from the admin password. |

Repo owners also get **access control** — allow lists and bans by IP, by creator key, or by
**BetterCommunity account** — so a private repo stays private.

Account entries are worth preferring. `X-Creator-ID` is supplied by the caller, so a ban on
it is evaded by dropping the header and an allow list is passed by claiming an id that is on
it. An account entry is checked against a short-lived attestation signed by BetterCommunity
and verified offline, and it matches every identifier that account holds — its bcid, its
linked creator ids and its linked Discord ids — so banning the account follows the person
rather than one of their handles. Account entries apply only when the repo requires an
account, since that is the only case where a signed identity exists.

## Admin panel & monitoring

Hosting comes with two host-side tools, both on the Server Repo screen:

**Monitoring** — a live table refreshed every second: each connected client's IP, creator ID,
protocol (**Local / LAN / WAN**), the file being downloaded with progress and speed, plus idle
sessions and totals (clients, combined speed, active files). From any row you can **whitelist**
or **ban** that client in one click. It also aggregates a running standalone server's
`monitoring.json`, so both servers show in one place.

**Whitelist & bans** — two managers with search, manual add (by IP and/or creator key),
one-click removal and JSON export. The whitelist has a master on/off switch: off = everyone may
download (minus bans); on = only listed identities pass.

The generated standalone server exposes matching endpoints:

| Endpoint | Access |
|---|---|
| `/dashboard`, `/monitoring.json` | Public, read-only status. |
| `/admin/data`, `/admin/update`, `/admin/logs` | Admin password (Authorization header, constant-time compare). |

```mermaid
graph LR
    subgraph Host["Host (BMM)"]
        MON["Monitoring table (1 s refresh)"]
        WL["Whitelist / bans managers"]
    end
    subgraph Server["Generated server"]
        MJSON["/monitoring.json"]
        ADMIN["/admin/* (password)"]
        GATE["Access gate: bans → login → whitelist → download password"]
    end
    MJSON --> MON
    WL -- "push config" --> ADMIN
    CLIENT["Subscriber"] --> GATE
```

### Publishing a new version

When you update your mods, use **Update an existing repo**: an incremental flow that bumps
versions and lets you write a per-mod changelog (shown to users when the update is detected).
It only rewrites what changed, mirroring the delta-sync on the download side. The mod-author
walkthrough lives in the developer guide *Making your mod updatable*.

## Getting the folder onto the server (SSH/SFTP)

Exporting writes a folder. **Publish over SSH**, on the same screen, is what puts that folder
on the machine that serves it — no separate file-transfer program in between.

### What you fill in

| Field | Notes |
|---|---|
| **Host, port, user** | The same three things any SSH client asks for. Port defaults to 22. |
| **Key or password** | Two buttons at the top. A password is what most accounts already have; a key is what a server running `PasswordAuthentication no` requires. |
| **Private key** | OpenSSH or PuTTY `.ppk`, both read as they are — no conversion step. |
| **Remote folder** | An absolute path. **Browse…** opens the server's folders so you can pick it rather than type it. |

**Test the connection** does everything an upload does except upload: it authenticates, opens
the folder, and writes-then-deletes a probe file. "The folder exists" and "I may write into
it" are different questions, and only the second one matters — the upload version of that
failure happens after transferring everything.

### Fetching it back

**Fetch from the server** is the same connection in the other direction: it copies the repo
the server is actually serving into your export folder. Use it to edit a repo from a second
machine, to recover a lost local copy, or to confirm that what is online is what you think.

Files of the same name are overwritten by the server's version; local files the server does
not have are left alone. Deleting them would let a fetch aimed at the wrong folder destroy
something unrelated.

### What is stored, and what is not

Host, port, user, remote folder, the chosen method and the **path** to your key are saved. The
key itself never is, and neither is the passphrase or the password. A key copied into BMM's
config would be a key in every backup, every export and every crash report that attaches
settings.

The server's fingerprint is recorded on the first connection and must match on every later
one. A **changed** fingerprint is refused outright rather than warned about: the case it
protects against is exactly the one where a warning gets clicked through.

### Order of transfer

Files are sent first and `repo.json` **last**, deliberately. Subscribers read the manifest and
then fetch what it lists, so sending it first would hand everyone syncing during the upload
window a manifest promising files that do not exist yet.

### Syncing FROM an SSH repo

The other side of the same connection: installing mods from a repo that lives on an SSH
server rather than behind an HTTP URL.

Put **`ssh://`** in the sync URL field. That value carries no host, user or key — everything
about where to connect comes from the target configured above. The rest of the sync screen
works exactly as it does over HTTP: the profile list, the choices, delta by hash, the
"add as update source" checkbox.

Because it is only a URL, every existing entry point inherits it with no new action:

| Entry point | Value |
|---|---|
| Sync screen | `ssh://` in the URL field |
| Deeplink | `bmm://repo/sync?url=ssh://` |
| Scheduler | *Sync repo*, URL `ssh://` |
| Local API | `POST /api/repo/sync` with `"url": "ssh://"` |

!!! note "Two differences from HTTP"
    Chunk-level **resume** is an HTTP Range feature and is not used over SFTP — a file that
    needs fetching is fetched whole. The per-file delta that saves the real time still
    applies: the sync compares hashes and only asks for what changed.

    A **password**-authenticated source works while the SSH panel is open and filled in.
    Unattended runs need a key with no passphrase, for the same reason publishing does.

### Without opening the screen

| Entry point | Publish | Fetch |
|---|---|---|
| Scheduler | *Publish repo over SSH* | *Fetch repo over SSH* |
| Deeplink | `bmm://repo/publish-ssh?dir=<folder>` | `bmm://repo/fetch-ssh?dir=<folder>` |
| Local API | `POST /api/repo/publish-ssh` | `POST /api/repo/fetch-ssh` |

All of them use the target saved in Server Repo. **None can name a different host, key or
password** — the call says "publish (or fetch) what I already configured", and that is all it
can say. The rule matters most for fetching, which writes to your own disk.

Unattended runs need a key with **no passphrase**, and cannot use a password at all: nothing
is stored and there is nobody to ask at 04:00, so they fail with a message rather than waiting
forever on a prompt no one will see.
