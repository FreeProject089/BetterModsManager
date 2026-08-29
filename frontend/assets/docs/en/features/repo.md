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
| **Update from the server** | Reads what your server holds — over HTTP, or over SFTP on an SSH machine — and writes the manifest without pulling the repo back. | The mods live only on the server. |

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

!!! note "Over HTTP, this needs directory listing"
    Reading an HTTP server means reading its own index, so `autoindex on` (nginx) or the
    equivalent must be enabled. Without it BMM cannot see what the server holds.

    **Over SSH it does not.** SFTP lists directories itself, which is the whole point of the
    route below: a machine you reach by SSH usually publishes no index at all, and is exactly
    the case where the mods exist nowhere else.

### Reading an SSH machine instead

Open **This repo is on an SSH machine** on the same screen and pick one of the servers you
configured under *Publish over SSH*. Host, port, account and folder come from there — asking
for them twice would be a second copy of the same facts, free to drift, and a fingerprint
trusted in one place and unknown in the other.

Two fields are yours to fill in, because they are the two things BMM never stores:

| Field | Notes |
|---|---|
| **Account password** | Filling it in means "authenticate this run by password", and it takes precedence over the key. |
| **Private key** | Optional. Empty means the key already saved on the chosen server; fill it — or pick one from the identity keyring — to use a different key for this run without editing the server. |
| **Passphrase** | For the key, if it has one. |

The same block sits in **Update the Server Repo**, where it does one more thing: a server that
authenticates by *password* could not be used there at all before. The stored-target helpers
refuse one on purpose — nothing about a password is written down, so a scheduled run has
nobody to ask. In front of a dialog there is somebody to ask.

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

The card opens with the route: **the exported folder → `user@host:/remote/dir`**, filled in
from the fields as you type. That line is doing the job a numbered list used to: the form asks
for a host before anything says a folder has to exist, and the two halves of "where does this
go" were never next to each other — the source is configured on a different card, and the
destination is a host and a remote directory four rows apart.

So there is nothing to memorise. Generate the repo above, fill the server in here, and the
line tells you what will move where before you press anything. Later uploads reuse what is
saved.

### The same button, wherever the folder is

Publishing is offered on three screens now, all using the connection saved here:

- **the SSH card itself**, under the export — re-publish an existing folder without
  regenerating it;
- **Manifest only**, once it has written a `repo.json` for mods you already host — putting
  that file on the server is the next thing you do, and the only route used to be scrolling
  back here and retyping the folder;
- **Update a repo**, in both modes. It was hidden in local mode, on the grounds that it would
  "offer to push a folder to a server nobody named". True before targets were saved; not true
  after — a local working copy that gets published is the ordinary way to run a repo.

All three ask the same confirmation, naming the target. Publishing overwrites what people are
downloading right now, and an entry point that skipped the question would make one act
careful on one screen and casual on another.

!!! note "This screen is also what automations reuse"

    What you save here is the connection the scheduled action **Publish repo over SSH** and
    `POST /api/repo/publish-ssh` both use. Neither can name a host or a key of its own, on
    purpose: a task or a caller able to name those could make BMM read a private key of its
    choosing and ship a repo to a machine of its choosing.

    Which means a key protected by a **passphrase cannot run unattended** — nothing about that
    passphrase is kept, so there would be nobody to ask. A scheduled publish against one fails
    with a message rather than hanging on a prompt no one will see.


### What you fill in

| Field | Notes |
|---|---|
| **Host, port, user** | The same three things any SSH client asks for. Port defaults to 22. |
| **Key or password** | Two buttons at the top. A password is what most accounts already have; a key is what a server running `PasswordAuthentication no` requires. |
| **Private key** | OpenSSH or PuTTY `.ppk`, both read as they are — no conversion step. |
| **Identity key** | The chooser under the path field lists the keys from *Settings → Identity & API*. A keyring entry is a name and a path, which is exactly what SFTP needs, so the key a catalogue knows you by can open a shell too. Picking one **fills** the path field rather than replacing what it means, and the reverse is deliberately not wired: configuring a server must not silently change which identity BMM presents to catalogues. |
| **Remote folder** | An absolute path. **Browse…** opens the server's folders so you can pick it rather than type it. |

**Test the connection** does everything an upload does except upload: it authenticates, opens
the folder, and writes-then-deletes a probe file. "The folder exists" and "I may write into
it" are different questions, and only the second one matters — the upload version of that
failure happens after transferring everything.

When the probe is refused, the report says **why** rather than only that it was: the remote
folder's owner and mode, and the account BMM connected as. That is almost always the whole
story and it is invisible from your side of the connection:

```text
/srv belongs to uid 0:0 with mode rwxr-xr-x, and BMM connected as "bob".
On the server: sudo chown bob /srv — or publish into a subfolder you own, e.g. /srv/bmm.
```

`/srv`, `/var/www` and `/opt` are root-owned and mode 755 on most distributions: **everyone
may list them and only root may create a file in one.** Nothing is wrong with your account or
your key, which is why "permission denied" on its own sends people to check the one thing that
was never the problem.

### Which SSH keys work

Verified by decoding one of each with the library BMM actually uses, not from memory.

| Key type | Accepted |
|---|---|
| **ed25519** | Yes — the modern default, and the one to prefer |
| **RSA** (3072, 4096) | Yes |
| **ECDSA** nistp256 / nistp384 / nistp521 | Yes |
| **DSA** | No — OpenSSH removed it; `ssh-keygen -t dsa` refuses to generate one |

The **container** matters as much as the algorithm. Any of these are read as they are:

| Header in the file | What produced it |
|---|---|
| `-----BEGIN OPENSSH PRIVATE KEY-----` | `ssh-keygen` today |
| `PuTTY-User-Key-File-…` | PuTTY / WinSCP (`.ppk`) — no conversion needed |
| `-----BEGIN RSA PRIVATE KEY-----` | `ssh-keygen -m PEM` (PKCS#1) |
| `-----BEGIN PRIVATE KEY-----`, `-----BEGIN EC PRIVATE KEY-----` | PKCS#8 |
| `-----BEGIN ENCRYPTED PRIVATE KEY-----` | PKCS#8, passphrase-protected |

A passphrase-protected key works: type the passphrase in the field beside the key. It is used
for that connection and never stored, which is why an unattended run — a scheduled task, a
deeplink — needs a key with **no** passphrase.

!!! warning "RSA needs a modern server, and BMM now asks for one"
    The legacy `ssh-rsa` signature is SHA-1, refused by default since OpenSSH 8.8. BMM
    negotiates `rsa-sha2-512` / `rsa-sha2-256` with the server instead. If yours is older than
    8.8 and offers nothing else, use an ed25519 key.

#### The public half goes on the server

BMM only ever reads the PRIVATE key. The PUBLIC one has to be in `~/.ssh/authorized_keys` on
the server, and it must be the **one-line OpenSSH format**:

```
ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAA… you@machine
```

PuTTY's *Save public key* writes something else — the RFC4716 block:

```
---- BEGIN SSH2 PUBLIC KEY ----
Comment: "256-bit ED25519…"
AAAAC3NzaC1lZDI1NTE5AAAA…
---- END SSH2 PUBLIC KEY ----
```

`authorized_keys` cannot read that, and the server rejects the key while everything looks
correct. Convert it, or derive the public half from the private key you already have:

```bash
ssh-keygen -i -m RFC4716 -f exported.pub    # RFC4716 → OpenSSH
ssh-keygen -y -f ~/.ssh/id_ed25519          # straight from the private key
```

In PuTTYgen the same thing is the *Public key for pasting into OpenSSH authorized_keys* box at
the top of the window — not the **Save public key** button.

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

## Protecting a repo: password, or a public key

Two different guarantees, and they can be used together.

A **download password** is a shared secret. Anyone who has it can sync, and anyone who has it
can pass it on — which is the point when you want to hand access to a group, and the problem
when you want to hand it to one machine.

A **public key** cannot be handed on so easily. You paste the public half into the repo's
access list; the client has to hold the matching private half and *sign* for it on every
request. Nothing that travels over the wire can be replayed elsewhere, and revoking a key is
deleting one line.

!!! warning "Related to the SSH key above, but not the same job"
    The SSH key is how BMM logs in to a *server* to move files. This key is how BMM proves
    *who it is* to a repository or catalogue it fetches over HTTPS.

    The same **file** can do both, and the SSH panel will offer you this keyring to pick from.
    What is not shared is the *choice*: picking a key for an SFTP target does not change which
    identity BMM presents to catalogues. One is "let me in", the other is "this is who I am",
    and answering one by changing the other is how you end up presenting the wrong identity
    without ever deciding to.

### On the client (BMM)

Keys live in **Settings → Identity & API → Identity keys**. Add as many as you like, each
under a name you choose. One is the **default** — the one presented to anything that asks —
and any individual server can be pointed at a different one, so a work identity and a personal
one can coexist without swapping files between runs.

Where a key chooser appears elsewhere in BMM — a protected catalogue, a repo, the SSH panel —
it lists these same keys by name. Choosing one for a source is remembered for that server's
origin.

Only the **path** is stored. The file is read at the moment a proof is signed and the bytes
are dropped — BMM never writes key material to disk, exactly as with the SSH passphrase.

It must be an **unencrypted private key** — **ed25519, RSA or ECDSA**, OpenSSH format or
PuTTY `.ppk`. A passphrase-protected file is refused, because BMM has nowhere to keep the
passphrase and nobody to ask for it while signing. BMM checks the file when you pick it rather
than failing later against someone else's server, so a wrong file is reported as a wrong file.

```bash
ssh-keygen -t ed25519 -N "" -f ~/.ssh/bmm_identity
```

### On the server

Paste the **public** half — the `.pub` file, one-line OpenSSH format, the same form
`authorized_keys` wants:

- **A repo hosted on BetterCommunity** → the repo dashboard, *Access* → *Authorised public
  keys*.
- **A community catalogue** → your catalogue's *Access* panel, same field. This covers every
  kind a catalogue can hold: plugin, theme, preset and app.
- **A catalogue index you host yourself** → it is just a JSON file on your server, so it is
  protected by whatever protects that server, and BMM presents both the password and the key
  when fetching it.

!!! note "BetterCommunity's own index is public on purpose"
    `/api/catalogs.json` is the platform's directory of listed public catalogues. It has no
    access gate and is not meant to get one — closing it would hide the catalogues it exists
    to advertise. Protect the individual catalogues instead; a private one never appears in
    it in the first place.
- **A repo you serve yourself** from BMM → the same list, passed to the built-in server.

Adding a key makes it **required for everyone**. It is not one more way onto an allow list —
it is a condition on every request, so add your own key before you add anybody else's.

**ed25519, RSA and ECDSA** are accepted, and anything unparseable is refused at the moment you
paste it. That refusal is deliberate: a key that cannot be verified would store a requirement
nothing could ever satisfy, and would lock out every client including you.

The earlier wire format accepted ed25519 only. That was a defensible trade until it met the
common case — somebody whose only key is an RSA `.ppk` from PuTTY, being told to regenerate
their identity because their perfectly good key was the wrong shape.

### What the client sends

A short-lived signed statement, not the key:

```
X-BMM-Key-Proof: bmmk2.<payload>.<signature>
```

The payload names the public key, the **origin it is addressed to**, and an expiry two minutes
out. Being addressed to one origin is what stops a proof captured by one server from opening
another — a signature for `https://a.example` is refused by `https://b.example`, and the
server checks that against its own configured address, never against the address the request
claims to be for.

Signing is cached per origin, so a sync of a thousand files costs one signature every two
minutes rather than a thousand.


## Everything else the repo carries

A repo used to mean profiles of mods, plus modpacks. The rest of a setup — the plugin that
drives it, the automation that keeps it in step, the theme, the mod lists, the catalogues to
follow — had to be published somewhere else and described in prose, so what somebody received
was a folder of mods and a reading exercise.

**Server Repo → Include in the repo…** takes a repo FOLDER, not a fresh export. That is
deliberate: it works on a repo you exported five minutes ago and on one you published last
spring, without regenerating a single mod.

### Choosing what goes in

**Include in the repo…** opens the list. It used to open a Windows folder dialog *first*,
whenever the export-path box happened to be empty — so the answer to "what can I include?"
was a file explorer, and you only saw the list after committing to a folder. The list never
depended on the folder.

The destination is now a row inside the screen with **Choose a folder…** beside it. Picking a
different folder re-reads it and re-seeds what is ticked: those ticks are a fact about ONE
repo, and carrying them over from the folder you looked at before would publish things nobody
chose. A folder that is not a repo says so on the screen, next to the button that can fix it.

### Choosing now, publishing later

The picker records a **decision**. It used to write, immediately, into a repo folder that had
to exist already — so publishing a plugin alongside a repo meant generating the repo,
remembering to come back, adding the plugin, and generating again if a profile had changed.
Choosing and publishing were the same act, in the wrong order.

Open it with no folder chosen and what you tick is kept. It goes in when the repo is made,
and **every** path that leaves a folder worth publishing applies it:

| | |
|---|---|
| **Generate** | a fresh repo, at the end of the export |
| **Manifest only** | after `repo.json` is written |
| **Update an existing repo** | after the update finishes |
| **Update from the server** | the same handler as above |

A badge beside the button says how many are waiting, because a selection applied later is one
people forget they made — and it disappears the moment they are written.

!!! note "It clears once, and not on a failure"

    Applied, it stops being pending: otherwise the same selection lands in every repo you
    generate afterwards, including ones it was never meant for. A **failure** keeps it — that
    is usually a file that has moved or a folder that is not writable, and clearing would make
    the fix "choose all fourteen again" instead of "generate again".

Choosing a folder still writes into it straight away, which is the right thing when the repo
is already published and you are adding to it. The button says which of the two it will do.

### Two shapes, and the difference matters

=== "Files travel with the repo"

    A **plugin**, an **automation**, a **theme**, a **mod list** (`.mm`), a **catalogue
    bundle** (`.bmmbundle`) and a **launch pack** (`.bmmlaunch`) are copied into
    `extras/<kind>/` and listed in `repo.json` with a sha256. They are checked on arrival
    exactly as a mod file is.

    These are snapshots by nature. What you published is what somebody gets.

=== "Catalogues and app sources travel as addresses"

    A **catalogue** is a thing that CHANGES. Copying one into a repo would publish a frozen
    fork that quietly stops matching its source, and the reader would have no way to tell —
    so only the address travels, and whoever follows it gets the catalogue as it is on the
    day they look.

!!! tip "Where the bundle comes from"

    The picker lists every catalogue you follow. An `https://` one appears as an address to
    recommend; a `.bmmbundle` you follow appears as a file to carry — the format always
    allowed both and the picker only ever offered the first, so the one kind of catalogue
    that needs no host was the one kind a repo could not pass on.

    **Carry a catalogue file…** takes one that is not in your followed list at all: a bundle
    somebody sent you, or one you just published from the app catalogue's Create screen. It
    is opened and checked before it is offered, so a zip that is not a catalogue fails there
    rather than on somebody else's machine.

### Modpacks are on this screen too

They used to be a list on the export form, so a modpack could only be shared while
re-exporting every mod in the repo. That is the thing this screen exists to avoid.

A modpack is **not** an extra and is not treated as one: an extra is a file under
`extras/` listed in `repo.extras`, while a modpack is an entry in `repo.modpacks` with its
own **share mode** — public, the repo's whitelist, or a list of ids you type. The control for
that rides on the modpack rows only, because the other kinds have nothing like it.

Ticking and unticking is the whole list: this screen shows what the repo publishes and you
edit it, so unticking the last modpack means the repo stops sharing it.

!!! warning "Re-exporting used to throw all of this away"

    `repo.json` is rebuilt from scratch by an export, and only the **seed** was carried
    across — because losing that breaks every client at once. Everything this screen
    published failed quietly instead: plugins, themes, automations, mod lists, catalogues,
    bundles and shared modpacks simply stopped being offered, with nothing said.

    They are carried over now. An export supplies mods; what it says nothing about, it
    leaves alone.

### What arrives, and what it is allowed to do

Nothing installed from a repo runs.

| Kind | On arrival |
|---|---|
| Plugin | Installed **disabled**, with **no permissions** — and any permission previously granted to that id is cleared. |
| Automation | Added to the scheduler **disabled**. |
| Theme | Installed. It is data. |
| Mod list · bundle | Saved, and BMM **asks** before opening it. |
| Catalogue · app source | Followed, and listed with the repo as its origin so you can un-follow it later. |

!!! warning "Why plugins and automations are unticked by default"

    A plugin is code that runs inside BMM; an automation can run commands on your machine.
    Syncing a repo is a decision about mods. A default tick would turn it into a decision
    about running a stranger's code that nobody made out loud.

    The permission clearing is the less obvious half. Ids are chosen by whoever writes the
    manifest, so without it a repo could name its plugin after one you had already trusted
    and inherit the grant in silence.

!!! note "A kind this build does not know"

    It is still **listed**, named, and refused with a reason. A repo published by a newer BMM
    must not look like a repo with things missing from it.

### The manifest

```json
{
  "extras": [
    { "kind": "plugin", "id": "dcs-helper", "name": "DCS Helper", "version": "1.2",
      "file": { "relative_path": "dcs-helper.bmmplug", "size": 40122, "sha256_hash": "…" } },
    { "kind": "catalog", "id": "…", "name": "Squadron themes",
      "url": "https://example.org/themes/catalog.json", "catalog_type": "theme" },
    { "kind": "modlist", "id": "ops", "name": "Ops list", "locked": true,
      "file": { "relative_path": "ops.mm", "size": 8210, "sha256_hash": "…" } }
  ]
}
```

`kind` is one of `plugin` · `task` · `theme` · `modlist` · `bundle` · `launchpack` ·
`catalog` · `app`. A locked mod list says so in the manifest, so the screen can tell you it
needs a passphrase *before* the download rather than after — otherwise what arrives is a file
that will not open and no way to tell whether that is the point or a broken transfer.

!!! warning "A launch pack is never installed by a sync"

    A launch pack is a **list of programs to start on your machine**, chosen by whoever
    published the repo. Every other extra can be applied at the end of a sync; this one is
    written out and offered, with a confirm that says what it is, and the toast afterwards
    names how many of those programs are not where the file claims they are. A pack whose
    games sit on `D:` for the publisher and `C:` for you is the ordinary case, and both
    silently importing something that starts nothing and silently dropping half of it are
    worse than saying so.

**Adding extras re-signs `repo.json`**, because they are inside what the signature covers.
Leaving the old signature would publish a manifest that fails its own check, which reads to a
downloader as tampering and is indistinguishable from it.

!!! tip "File names are narrowed on purpose"

    A carried file's name keeps only `A-Z a-z 0-9 . _ -`. Hosts normalise paths — BetterCommunity
    replaces everything else, spaces included — so a name this kept that the host does not
    would put `My Theme.bmmtheme` in the manifest, `My_Theme.bmmtheme` on the server, and a
    404 on a file sitting right there. The failure reads as a publisher who forgot to upload
    something.

### From a script, the CLI or an assistant

```bash
bmm repo-extras https://example.org/repo
bmm repo-take https://example.org/repo theme night-ops
```

`POST /api/repo/extras` does the same thing over HTTP (`repo.write`). Reading needs no new
endpoint — `/api/repo/info` returns the manifest, and `extras` is part of it. The MCP tools
are `bmm_repo_extras` and `bmm_repo_extra_take`.

!!! note "The entry is looked up, not described"

    The endpoint takes a repo URL plus a `kind` and an `id`, and finds the entry in the
    manifest it fetched. A caller that could hand over its own `{kind, url, sha256}` would be
    using BMM's installer to install arbitrary files — and the hash check would be checking
    the caller's own number.
