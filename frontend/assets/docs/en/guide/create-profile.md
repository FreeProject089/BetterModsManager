# Create a profile

A profile is one game's setup: which mods are on, in what order, and which folders they use. You make one so that a game update or a reinstall never wipes what you built.

[Show me](show:view/profiles) [Practise in the tutorial](show:tutorial/basics/profiles/s1)

**You need:** the folder of the game (where it keeps the files mods replace), and two empty folders of your choice: one for this profile's mods, one for its backups.

![Create a profile for the game](assets/docs/media/gifs/guide-create-profile.gif)

:::note[Why three folders]
The **destination** is the game folder, the only place BMM writes mods to. The **mods folder**
holds this profile's mods. The **backup folder** keeps the game's original files and the activity
log. Keeping them apart is what makes switching profiles and undoing safe.
:::

## Steps

- [ ] **Open Profiles.** Click **Profiles** in the sidebar. *You see:* an empty screen that says you have no active profile, or your existing profiles as cards.
- [ ] **Press New profile.** It is at the top right. *You see:* a dialog with **Profile name**, **Game name**, three folders and a colour.
- [ ] **Name it after the game.** For example *Main playthrough* with the game name *Northwind Saga*. Add a colour and an icon if you like: with five profiles, a colour is quicker to read than a name.
- [ ] **Pick the destination folder.** Press **Browse** next to **Destination folder** and choose the game folder. *You see:* the path in the field, and BMM may suggest folders it found for the game.
- [ ] **Pick a mods folder, and a backup folder.** Use a **different mods folder for each profile**. The backup folder is optional but recommended. *You see:* a warning if another profile already uses the folder you picked. Take it seriously.
- [ ] **Press Create.** *You see:* the profile card, marked **Active**, and a message saying your first profile is ready. **Create** stays greyed out until the game folder and the mods folder are filled in.

## If it does not work

| You see | Do this |
|---|---|
| A warning about a shared folder | Pick another mods folder. Two profiles in one folder is how you end up debugging a mod you thought was off. |
| You come from OvGME or Open Mod Manager | Import their profiles from the same screen instead of rebuilding them. |
| The folders are on an external drive | Keep that drive plugged in while you use the profile: BMM stores paths with the drive letter. |

:::tip[Several profiles are cheap]
Keep a *Vanilla-ish* one, a *Heavy* one and a *Testing* one. A new mod goes into *Testing* first,
so a bad one never touches the other two. Mods live in the Library and are shared, so nothing is
downloaded twice.
:::

## Next

[Install your first mod](doc-page:guide/install-first-mod). To move a setup to a friend: [Share a modpack](doc-page:guide/share-a-modpack).
Details: [Profiles](doc-page:features/profiles).
