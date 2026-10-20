# Fix a mod the game ignores

The mod is on, BMM says it is installed, and the game behaves as if it were not there. Nine times in ten the mod's files are one folder too deep. The Mapper shows you where they would land, and lets you move them.

[Show me](show:view/mapper) [Practise in the tutorial](show:tutorial/basics/map)

**You need:** the mod already in your Library, and its target in mind: the game folder a file must end up in.

![See where the mod's files would land](assets/docs/media/gifs/guide-see-problem.gif)

:::note[Why this happens]
A mod author packs a zip however they like. If the archive wraps everything in an extra folder,
the files land at `Game/Wrapper/Data/...` instead of `Game/Data/...`, and the game never looks
there. BMM copied exactly what the mod contained, which is the problem.
:::

## Steps

- [ ] **Open the Mapper.** Click **Mapper** in the sidebar and pick the mod in **Mod Structure**. *You see:* the mod's folders on the left, and on the right the **Destination Folder**: the game's own layout.
- [ ] **Find the first folder the game knows.** For many games that is `Data`, `Mods` or `Assets`. *You see:* it sits one or two levels below the top of the mod, inside a wrapper folder.
- [ ] **Make it the root.** Select that folder and drop it on the game's root in the destination (it is marked **Root**). *You see:* a note that the folder is queued as the root, and the **Apply structure** button lights up.
- [ ] **Read the Final preview.** Press **Final preview**, or **Apply structure**. *You see:* a tree of the files that will be written, counts of moved and overwritten files, and a warning if some replace game files (they are backed up first).

![Move Data up to the game folder](assets/docs/media/gifs/guide-move-root.gif)

- [ ] **Press Apply.** *You see:* the mod's copy rewritten in the new shape. Remove the empty wrapper folder if one is left.
- [ ] **Turn the mod off and on again.** *You see:* the card copies its files again to the new places.
- [ ] **Check the files.** Compute the mod's hashes and look at the integrity shield. *You see:* no red shield.

![Check the result](assets/docs/media/gifs/guide-verify.gif)

:::warning[Moving files changes the mod]
The Mapper edits the copy BMM keeps, not the game folder. If the mod is later updated from a
repo, check its layout again: an update brings back the author's folders.
:::

## If it does not work

| You see | Do this |
|---|---|
| The layout looks right but nothing changes | Check the mod does not conflict with another that overwrites the same files: [Fix a conflict](doc-page:guide/fix-a-conflict). |
| You are not sure which folder the game reads | Open another mod that works and copy its shape. |
| The shield turns red after you moved files | Recompute the hashes: the mod's fingerprint was of the old layout. |

## Next

Fill in the mod's details (name, version, author) so you can find it later. Details: [Mapper](doc-page:features/mapper), [How the Mapper works](doc-page:how-it-works/mapper).

<div class="bmm-replay" data-src="assets/docs/media/replays/fix-a-mod.bmmreplay" data-remote="https://freeproject089.github.io/BMM-Docs/assets/replays/fix-a-mod.bmmreplay" data-page="guide/fix-a-mod" data-title="Watch it: a mod one folder too deep, fixed in the Mapper"></div>
