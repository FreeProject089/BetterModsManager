# Two ids, and the difference is the point

Everything BMM holds has a **local id** — the name this machine gave it. Nine kinds also have
a **content id**, which names *what the thing is*. They answer different questions, and using
the wrong one is the reason two people comparing setups get nowhere.

| | Local id | Content id |
|---|---|---|
| Looks like | `sched-1755269...`, a uuid, `my-tools` | `bmmc1:9f2a…` |
| Same on two machines? | no | **yes**, if the content matches |
| Use it for | a `bmm://` link, an API call, a step in an automation | asking somebody "do you have this?" |
| Changes when | never | the content changes |

The prefix is deliberate. A local modpack id is a uuid and a task id is `sched-<millis>`; a
content id looks like neither, which matters the first time one is pasted into the wrong
field.

## What each kind hashes

The rule is the same everywhere: **hash what the thing IS, never what it is called here.**

| Kind | Is | Is not |
|---|---|---|
| Modpack | its members — each one's sha256, or its mod id when there is none | its name, its description, the order they were added |
| Mod list | the same | the same |
| Plugin | its declared id, and every file in its folder **with that file's bytes** | where it is installed |
| Bundle | the sha256 of the `.bmmbundle` itself | what the catalogue inside it says |
| Automation | its steps, as canonical JSON | its id, `lastRun`, `lastResult`, `history`, `enabled`, `osSchedule`, `createdAt` |
| Profile | the game and what is switched on | its name, colour, icon, and all three paths |
| Launch pack | its programs, by **file name** | where those programs live |
| Theme | its tokens | its name, author, description, version |
| App | the download's checksum, falling back to its URL | which catalogue listed it |
| Repo | what it publishes | its address |

Two things are worth reading twice.

**Members are sorted, steps are not.** A pack whose mods were added in a different order is
the same pack; an automation whose steps are in a different order is a different automation.

**A launch pack ignores paths on purpose.** `D:\Games\DCS\bin\DCS.exe` and
`C:\DCS\bin\DCS.exe` are one launcher on two machines. An id that disagreed about that
would never match anywhere, which is the same as not having one.

## Is it always the same if the file has not changed?

Yes — that is the whole promise, and it holds in both directions: the same content gives the
same id, and different content gives a different one.

The second half was not true for plugins until recently. The id folded the file **names**, so
a plugin whose script was rewritten from top to bottom kept the same content id, and two
plugins with matching filenames and entirely different code shared one. It now folds each
file's path *and its bytes*, walked from the plugin's folder rather than read from the
manifest — what the author declared is a claim, what is in the folder is what the plugin
ships. Editing a script, renaming one, or dropping an extra file beside them all change the
answer.

A few consequences worth knowing:

- **A modpack** follows its members' checksums, so it changes when a mod's main file changes,
  and not when you rename the pack.
- **A bundle** is one file, so its id is that file's sha256. Reading the catalogue inside and
  folding its entries would keep the id when a packed payload changed — the same mistake the
  plugin id was making.
- **An automation** ignores whether it has ever run. Two people with the same steps get the
  same id even when one of them has run it a hundred times.
- **A file a plugin declares but does not have** contributes its path with an empty hash.
  "Declared, not present" is a real state, and it is different from both "absent" and
  "present with content".

Nothing about it is random, and nothing about it depends on the machine: the same bytes on
two computers fold to the same id, which is the only reason it is worth quoting to somebody.

## Copying one

Every card that has ids shows two small buttons beside the name — the plain one copies the
local id, the one with a dot copies the content id. The content id is **derived when you
click**, not stored, so it can fail for a real reason: a pack whose members have no
fingerprints yet, a plugin uninstalled between the page being drawn and the button being
pressed. It says which.

## From a script

`POST /api/content-id` with `{ "kind": "modpack", "doc": { … } }` returns the same id the
button copies. It takes the **document**, not an id — which is why it needs only a token and
not each kind's read scope: the caller supplies what is hashed, so the answer discloses
nothing about this install. A by-id variant would be an oracle for "does this machine have
X".

!!! note "Nothing about a content id is a secret"

    It is a hash of content, so anybody with the same content can compute it. It proves two
    things are the same; it proves nothing about who you are, and it is not a credential.
