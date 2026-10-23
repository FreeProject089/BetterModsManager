# Install your first mod

You will add one mod to BMM, switch it on for a profile, and check that it reached the game folder.

[Show me](show:view/library) [Practise in the tutorial](show:tutorial/basics/scan/s0)

**You need:** BMM installed, a profile ([make one first](doc-page:guide/create-profile) if the Profiles screen is empty), and a mod as a `.zip`, `.rar`, `.7z` or a plain folder.

![Add a mod from its archive](assets/docs/media/gifs/guide-add-mods.gif)

:::note[Why a mod is added before it is turned on]
BMM keeps your mods on a shelf, the **Library**, and a profile decides which of them are on.
Adding a mod only puts it on the shelf: the game folder is not touched until you enable it.
:::

## Steps

- [ ] **Open the Library.** Click **Library** in the sidebar. *You see:* your mods as cards, or an empty shelf on a new install.
- [ ] **Drag the mod onto the window**, or press **Add a mod**. A `.zip` (or `.rar`, `.7z`, a folder) works: with the button, choose **Folder** or **Archive**. *You see:* the **Add a mod** dialog, filled in with the path and a name taken from the file, and a line that says nothing reaches the game until you enable it.
- [ ] **Confirm.** Check the name, version and author, then press **Add a mod**. *You see:* a new card in the Library, switched off, filed in the active profile's mods folder.
- [ ] **Click the card once.** *You see:* the mod's details open in a drawer at the side: version, author, description, files.
- [ ] **Switch it on.** Press the toggle on the card, or double-click the card. *You see:* the card goes through *Queued*, then *Copying*, then **On**, and the activity pill in the title bar counts the files.

![Switch the mod on and watch the card change](assets/docs/media/gifs/guide-enable.gif)

- [ ] **Check the result.** Open the mod's details and look at the **Files** tab, and at the integrity shield on the card. *You see:* no red shield. A red shield means a file is missing or has changed.

## If it does not work

| You see | Do this |
|---|---|
| The dialog does not open when you drop the file | Make sure the **Library** screen is the one showing, then drop it again. |
| The card says *Failed* | Open the activity centre (the title bar button) for the reason. The usual one is a game folder that is read-only or in use. |
| It is on, but the game looks the same | The files are probably in the wrong place inside the mod. See [Fix a mod the game ignores](doc-page:guide/fix-a-mod). |
| A warning says the mod overwrites files from another | That is a conflict, and BMM stopped you on purpose. See [Fix a conflict](doc-page:guide/fix-a-conflict). |

:::tip[Archives stay archives]
A `.zip` stays zipped. BMM unpacks it to a temporary cache only when something needs its files,
so a large library does not cost disk space you are not using.
:::

## Next

[Activate and order mods](doc-page:guide/activate-and-order), then [Fix a conflict](doc-page:guide/fix-a-conflict) when two mods meet.
Details of the screen: [Library](doc-page:features/library).
