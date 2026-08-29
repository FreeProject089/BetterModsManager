# Passphrases, locked files and identity keys

!!! danger "A passphrase cannot be recovered"

    Not by you, not by BMM, not by anybody. There is no reset, no hint, no support address
    that can open the file. If you lose it, the backup is gone and the list is unreadable —
    not withheld, *gone*, because what is inside is not readable text behind a lock. It is
    not there.

    Write it down somewhere that is not the file it opens.

Three things BMM writes can hold a secret: a **data backup** (`.DATABMM`), a **shared mod
list** (`.mm`), and your **identity keys**. All three use one envelope, and the rules are the
same for each.

## The envelope

Argon2id derives a key from the phrase; AES-256-GCM seals the bytes.

| Choice | Why |
|---|---|
| **Argon2id** | The attacker has the file and unlimited time. A memory-hard KDF is the only thing that makes a human-typed phrase cost anything to guess. |
| **AES-256-GCM** | It authenticates. A tampered envelope fails to open rather than decrypting to something plausible that a reader would then try to parse. |
| **Parameters in the file** | Raising the cost later must not lock anybody out of what they already exported. |

The envelope is self-describing JSON rather than an opaque blob:

```json
{ "bmm_enc": 1, "kdf": "argon2id", "m": 19456, "t": 2, "p": 1,
  "salt": "…", "nonce": "…", "ct": "…" }
```

These files get inspected — by BetterCommunity's moderation tools and by people. "Encrypted,
and here is the recipe" is a fact somebody can act on; a wall of base64 gets reported as
corruption.

## What is locked, and what stays readable

=== "Data backup (`.DATABMM`)"

    The **whole archive**. A locked backup stops being a zip: open it in 7-Zip and there is
    nothing to list.

    That is the point. A prompt that only makes the import screen refuse is a sign on a door
    — the file is a zip and anybody with an archive tool reads it regardless. It would be a
    worse-than-useless lock here, because its whole purpose is to make including your private
    keys a reasonable thing to do.

=== "Mod list (`.mm`)"

    The **whole list**, mods included — with a readable header left outside it:

    ```json
    { "bmm_locked": true, "name": "…", "author": "…",
      "game_name": "…", "created_at": "…", "mods_count": 12, "sealed": { … } }
    ```

    The header is deliberate and it is the smallest one that still answers the question
    somebody holds *before* deciding whether to ask the author for the phrase. A `.mm` is
    read by BMM, by BetterCommunity's inspector and by a person deciding whether to trust it,
    and a list nobody can check is worse than one whose contents are private.

    **The signature is applied before the lock.** A signature over an envelope would only say
    who did the encrypting — not the question you are asking when you open somebody's list.

## When BMM asks

| Where | When |
|---|---|
| Export data | Optional. **Required** if you include identity keys. |
| Restore a backup | Only if the file turns out to be locked, and it says so. |
| Export a mod list | **Required** if you include credentials. |
| Import a mod list | Only if it is locked. |
| Install from a mod-list catalogue | **Every time**, for every locked entry. |

!!! note "Why the last row is not an oversight"

    A catalogue is a list of addresses somebody else controls. If BMM remembered the phrase
    for a source, a list *swapped at that address* would open with a secret its new author
    never had. Nothing about a phrase is remembered — not for the session, not per source.

## Identity keys

A key is how a protected source knows it is you. The **public** line goes to whoever runs the
source; the **private** half never leaves your machine and is never shown on screen — only
where it went.

**Settings → Identity & API → Identity keys → Create one…**

| Type | When |
|---|---|
| `ed25519` | The default, and what to pick. Every source in this protocol accepts it, and the key is short enough to paste into a message. |
| `ECDSA` (nistp256) | A host that predates ed25519 support. |
| `RSA 4096` | The same, older. Generation takes seconds — that is prime search, not a hang. |

Each type is tested to **sign**, not merely to generate: a key that produces a file BMM
cannot use would be a promise broken at the moment somebody is reaching for a server.

### A key that has its own passphrase

An OpenSSH key you already own may be protected by a passphrase — `ssh-keygen` offers to set
one. Add it the same way; BMM asks for the phrase when the file will not open, and re-asks
with the reason if it is wrong.

**It is held for that run and nothing more.** Restarting BMM means unlocking again, and that
is deliberate: the only place to write it down would be beside the key's path in
`settings.json`, in plain text, next to the very thing it protects.

For a script or a link, the phrase travels with the request that needs it:

```
bmm://catalog/follow?type=plugin&url=…&key=bmmkey-1a2b3c&passphrase=…
```

```json
POST /api/catalogs
{ "type": "plugin", "url": "…", "key": "bmmkey-1a2b3c", "passphrase": "…" }
```

Neither is stored. `key` takes an id or a name; the passphrase is checked before the key is
chosen, so a wrong one is reported as a wrong passphrase rather than as a server that would
not answer.

!!! warning "A link that carries a passphrase is a secret"
    It goes in shell history, in the address bar, and in whatever chat you paste it into.
    Prefer letting BMM ask. Send one only where you would send the key file itself.

!!! note "Keys BMM makes for you are not protected"
    A passphrase BMM invented would be one nobody could type, and asking for one in the
    middle of *make me a key* is a second question about a decision nobody came here to make.
    Protect it afterwards with `ssh-keygen -p` if you want that.

### Backing them up

A key is the one thing in BMM you cannot replace by asking again. Everything else in a backup
costs you an afternoon of setup; this costs you the thing that proves you are you.

**Export data → Identity keys (private)** carries them, and BMM refuses to write that without
a passphrase. It is the one export that deleting the file afterwards cannot undo — by then it
is wherever your backups go.

## Credentials in a shared list

A `.mm` can carry the download passwords and identity keys its sources need. Off, both kinds,
asked for separately.

!!! warning "This writes down something BMM otherwise refuses to write down"

    Download passwords are held **in memory only** and never stored, because settings end up
    in backups and crash reports. Putting them in a file you hand somebody undoes that on
    purpose — so it is asked for on purpose, and what it writes is unreadable without the
    phrase.

    It also means only passwords typed **since BMM started** can be carried. There are no
    others.

Only the hosts *that list points at* are included, and the screen names them before you tick
anything: whether including them is safe depends entirely on which they are.

### On the other side

Importing such a list asks twice, separately.

**Passwords** are offered for the session, exactly like one you typed yourself.

**Keys** get their own question and a blunt warning. A signing key is who you are to every
source that asks — installing one from a file somebody sent you means signing as whoever made
it. A key name already on your ring is **skipped, never overwritten**: importing a list cannot
replace the key you sign with.
