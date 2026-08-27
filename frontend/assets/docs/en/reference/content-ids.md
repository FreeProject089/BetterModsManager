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
| Plugin | its declared id and everything it ships | where it is installed |
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
