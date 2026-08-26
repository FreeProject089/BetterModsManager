# 🔑 Passphrases and identity keys

*🇫🇷 [Version française](Passphrases_And_Keys_FR.md).*

Three things in BMM can hold a secret: a **data backup**, a **shared mod list**, and your
**identity keys**. This is one page about all three, because the rules are the same and
getting one wrong costs the same thing.

---

## The one sentence that matters

**A passphrase cannot be recovered.** Not by you, not by BMM, not by anybody. There is no
reset, no hint, no support address that can open the file. If you lose it, the backup is
gone and the list is unreadable — not withheld, *gone*, because what is in there is not
readable text with a lock in front of it. It is not there.

Write it down somewhere that is not the file it opens.

---

## What a passphrase actually does

It encrypts. This is worth being exact about, because a password prompt that only refuses to
open a file is a sign on a door: the file is a zip, and anybody who opens it in a zip tool
reads everything regardless.

| | What is encrypted | What stays readable |
|---|---|---|
| **Data backup** (`.DATABMM`) | The whole archive | Nothing — it stops being a zip |
| **Mod list** (`.mm`) | The whole list, mods included | A header: name, author, game, how many mods |

The mod list keeps a header on purpose. A `.mm` is read by BMM, by BetterCommunity's
inspector and by a person deciding whether to trust it, and a list nobody can check is worse
than one whose contents are private. The header is enough to decide whether to ask its author
for the phrase, and not enough to install anything.

**The signature is applied before the lock.** A signature over an envelope would only say who
did the encrypting — which is not the question you are asking when you open somebody's list.

---

## When BMM asks for one

| Where | When |
|---|---|
| **Export data** | Optional. Required if you include your identity keys. |
| **Restore a backup** | Only if the file turns out to be locked, and it says so. |
| **Export a mod list** | Required if you include credentials. |
| **Import a mod list** | Only if it is locked. |
| **Install from a mod-list catalogue** | **Every time**, for every locked entry. |

That last one is deliberate, and it is the one that looks like an oversight. A catalogue is a
list of addresses somebody else controls. If BMM remembered the phrase for a source, a list
*swapped at that address* would open with a secret its new author never had.

---

## Identity keys

A key is how a protected source knows it is you. Two halves:

- the **public** line, which you give to whoever runs the source;
- the **private** half, which never leaves your machine and is never shown on screen — only
  where it went.

**Settings → Identity & API → Identity keys → Create one…** makes one. Pick **ed25519**
unless a server tells you otherwise: every source in this protocol accepts it and the key is
short enough to paste into a message. ECDSA and RSA are there for a host that predates it.

The key you already have can be added with **Add…**, and both live on one ring. That ring is
edited in one place, on purpose: every other screen that needs a key sends you here rather
than showing you a second copy of the list, because the copy you edited would stop being the
one that signs.

### Backing them up

A key is the one thing in BMM you cannot replace by asking again. Everything else in a
backup costs you an afternoon of setup; this costs you the thing that proves you are you.

**Export data → Identity keys (private)** carries them — and BMM refuses to write that
without a passphrase. That is the one export deleting the file afterwards cannot undo: by
then it is wherever your backups go.

---

## Credentials in a shared mod list

A `.mm` can carry the download passwords and identity keys its sources need. This is off,
both kinds, separately, and it writes to disk something BMM otherwise refuses to write:
download passwords are kept **in memory only** and never stored, because settings end up in
backups and crash reports.

So:

- Only the hosts **that list points at**. Not every password the session happens to hold.
- Only passwords typed **since BMM started** — there are no others; nothing is stored.
- The screen names the hosts before you tick anything, because whether including them is safe
  depends entirely on which they are.

### On the other side

Importing such a list asks twice, separately:

**Passwords** are offered for the session, exactly like one you typed yourself.

**Keys** get their own question and a blunt warning. A signing key is who you are to every
source that asks — installing one from a file somebody sent you means signing as whoever made
it. Say no unless you know exactly why you want that.

A key name already on your ring is **skipped, never overwritten**. Importing a list cannot
replace the key you sign with.

---

## See also

- [Server access control](Server_Access_Control_EN.md)
- [Embed or link](Embed_Or_Link_EN.md)
