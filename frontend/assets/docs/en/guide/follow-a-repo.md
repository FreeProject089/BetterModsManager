# Follow a repo

A friend or a community runs a repo. You will sync it once into a profile, then follow it so BMM tells you, or updates for you, when it changes.

[Show me](show:view/repo) [Practise: sync a repo](show:tutorial/advanced/repo) [Practise: follow it](show:tutorial/advanced/follow)

**You need:** the repo's address (a web address, or an IP and a port like `192.168.1.20:8000`), and its password or key if it is protected.

![Join a repo by its address](assets/docs/media/gifs/guide-friend-joins.gif)

:::note[Why follow instead of syncing by hand]
A sync downloads only the files that changed, so updating a big repo after a small patch costs a
few megabytes. Following makes BMM do the checking on a schedule, and it never downloads or
applies anything while a game is running.
:::

## Sync it once

- [ ] **Open Server Repo** and stay on the **Sync** tab.
- [ ] **Paste the address and press Fetch.** The field is **repo.json URL**; a bare address such as `192.168.1.20:8000` is enough. *You see:* the repo's card: name, version, signature (*Signed, signature valid* is what you want) and how many mods it offers. If it is protected, type the download password in the row under the field before you fetch.
- [ ] **Choose where mods go.** The profile's own game, mods and backup folders, or folders of your choice. *You see:* the three paths.

![Choose the folders and sync](assets/docs/media/gifs/guide-friend-syncs.gif)

- [ ] **Press Synchronize** (the **Sync now** button at the top does the same). *You see:* progress in the activity centre. The repo's mods appear in your Library, marked with the repo's name.

## Follow it

- [ ] **Press Follow a repo** in the **Followed repos** card, or the **Follow** button next to a repo you just fetched. *You see:* a dialog with the address already filled in.
- [ ] **Press Test the connection.** *You see:* the repo's name, version and signature. A signature that does not match means the manifest was changed after it was signed: follow it only if you know why.
- [ ] **Choose the schedule.** Check every 15 minutes, hour, 6 hours, day or week, and what to do on an update: **Tell me** (the default), **Download it**, or **Download and apply it**.
- [ ] **Press Follow.** *You see:* the repo in the followed list. **Check now** checks every followed repo at once.

:::tip[Start with Tell me]
**Download and apply it** turns the enabled mods off and on again in the active profile so the
game gets the new files. Use it once you trust the repo's owner.
:::

## If it does not work

| You see | Do this |
|---|---|
| Nothing answered at the address | Check the address, the port and that the host's BMM is running. |
| It asks for a password | Type the download password. It is saved sealed on this PC, never in a settings file. |
| *Signature does NOT match* | Stop. Ask the owner. Do not sync until you know why. |
| An update waits and never arrives | BMM does not touch files while a game runs. Close the game and press **Check now**. |

## Next

[Update BMM](doc-page:guide/update-bmm) keeps the app itself current. Details: [Server Repo](doc-page:features/repo), [How syncing works](doc-page:how-it-works/sync-repos).

<div class="bmm-replay" data-src="assets/docs/media/replays/share-setup.bmmreplay" data-remote="https://freeproject089.github.io/BMM-Docs/assets/replays/share-setup.bmmreplay" data-page="guide/follow-a-repo" data-title="Watch it: join, sync and follow, then the next update arrives"></div>
