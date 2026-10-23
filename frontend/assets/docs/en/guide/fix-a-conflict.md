# Fix a conflict

Two mods contain the same file, and you want to choose which copy the game gets. BMM tells you before it writes anything, and changes nothing until you press **Apply**.

[Show me](show:view/library) [Practise in the tutorial](show:tutorial/basics/conflicts)

**You need:** two active mods that share files. Not sure they do? Switch the second one on: BMM will warn you.

![BMM sees the conflict coming](assets/docs/media/gifs/guide-conflict-warning.gif)

:::note[A conflict is not a bug]
Two people edited the same thing, so two mods ship the same path. Nothing is broken. You only
have to say which copy should win.
:::

## Steps

- [ ] **Switch on the second mod.** *You see:* a message that activating it will overwrite files from another mod, with the list of **Conflicting Files**: the exact paths that exist in both.
- [ ] **Decide, or look closer.** Continue if you accept that the new mod wins. To look first, cancel and open the Conflicts view.
- [ ] **Open the Conflicts view.** Press the conflict badge on the card, or :kbd[Ctrl+K] then *Resolve conflicts*. *You see:* every file two active mods share, which mod's copy is on disk now, and a summary per pair of mods (how many files, who gets how many).

![Choose who wins the shared files](assets/docs/media/gifs/guide-conflict-resolve.gif)

- [ ] **Choose who wins.** There are three ways, and you can mix them. **Reorder**: move a mod down so it is applied later and wins more often, or press **Make X win** for the smallest move that puts X after the other mod. **Keep X's copy**: a per-file choice, remembered for this profile, and you can tick several files to decide for all of them at once. **Disable** one of the mods.
- [ ] **Read the plan.** The footer says how many files **Apply** would re-copy. Press **Show changes** to see each one. *You see:* nothing changed yet. **Discard** forgets the plan.
- [ ] **Press Apply.** *You see:* a job in the activity centre that re-copies only those files, then the conflict badge goes quiet.

:::tip[Per-file choice beats the order]
A kept copy wins as long as its mod is active. Otherwise the last mod in the order wins. If you
want a whole mod to win, reorder. If you want one file from one mod, keep that copy.
:::

## If it does not work

| You see | Do this |
|---|---|
| The conflict list is empty but the game is wrong | The overlap may be with a disabled mod or another profile. Open **Inactive mods and other profiles** at the bottom of the view. |
| A mod you disabled brought back an old file | Disabling falls back to the next mod that has the file, then to the game's original. That is the design. |
| The files are in the wrong place inside the mod | See [Fix a mod the game ignores](doc-page:guide/fix-a-mod). |

## Next

[Share your order](doc-page:guide/activate-and-order) or [share a modpack](doc-page:guide/share-a-modpack).
Details: [Conflicts](doc-page:how-it-works/conflicts), [Activation order](doc-page:how-it-works/load-order).
