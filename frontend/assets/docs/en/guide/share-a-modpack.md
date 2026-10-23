# Share a modpack

You will turn your mods into one pack, and give friends the same setup: either a file they import, or a repo they follow.

[Show me](show:view/modpacks) [Practise in the tutorial](show:tutorial/basics/modpacks)

**You need:** a profile with the mods you want to share, switched on and working.

![Make a modpack from the profile](assets/docs/media/gifs/guide-make-modpack.gif)

:::note[A pack carries a signature, not the mods]
When you export a pack, BMM ships a hash of each mod. The BMM on the other PC finds the same
mods by that hash, so the file stays small and "the same mod" means byte for byte the same.
Mods the friend does not have are listed, never half-applied.
:::

## Make the pack

- [ ] **Open Modpacks** and press **Create Modpack**. *You see:* the **New Modpack** dialog with four steps: Basics, Mods, Options, Review.
- [ ] **Basics.** Give it a name, and optionally a target game and a description. **Next** moves on; **Create now** keeps the defaults and skips the rest.
- [ ] **Mods.** Pick the mods, or use the quick pick **Enabled now**. *You see:* mods that are not installed on this PC marked.
- [ ] **Options.** For a pack that leaves your machine, set **Dependency Mode** to **All** so it carries its own dependencies. Leave **Skip Integrity Check** off.
- [ ] **Review and create.** *You see:* BMM reading the mods' files to fingerprint them, then the pack card with **Activate**.

## Choose how to hand it over

| You want | Do this |
|---|---|
| A friend who already has some mods | **Export & share** in the card's **…** menu, then send the `.bmp` file. They press **Import** on their Modpacks screen. |
| A group that stays in step with you | Turn the pack into a **Server Repo** (next section), and they [follow it](doc-page:guide/follow-a-repo). |
| Just the order and names, no files | Export a [`.MM` list](doc-page:features/modlist) instead. |

## Host it as a Server Repo

- [ ] **Open Server Repo** and choose **Create a repo in one click**, from the pack. *You see:* a signed repo written to a folder, ready to host.
- [ ] **Host it.** Press **Host**, pick the folder and a port. *You see:* a status card for the running server with its address.

![A friend joins by the address](assets/docs/media/gifs/guide-friend-joins.gif)

- [ ] **Send the address.** Use **Share link** to get a ready message. On a home network this is your PC's local address and port. *You see:* the link and notes about a password or key if you set one.

:::warning[The server runs while BMM runs]
BMM's own server is available while BMM is open and the port is reachable. For a repo that must
be up all day, host the files on a static web host, or use the standalone mini-server.
:::

## If it does not work

| You see | Do this |
|---|---|
| The friend's import says some mods are not installed | Expected: they lack those files. Share through a repo so the files come with it. |
| The pack card says *Some mods are missing or corrupted* | Press **Repair & Apply** before anything else. |
| The friend cannot reach your address | Check the firewall and the port, or use a static host. |

## Next

[Follow a repo](doc-page:guide/follow-a-repo) is the friend's side. Details: [Modpacks](doc-page:features/modpacks), [Server Repo](doc-page:features/repo).
