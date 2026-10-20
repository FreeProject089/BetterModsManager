# Activate and order mods

You will turn mods on and off, then decide which mod wins when two of them contain the same file.

[Show me](show:view/library) [Practise in the tutorial](show:tutorial/basics/activate) [Order tutorial](show:tutorial/order/order)

**You need:** at least two mods in the Library and an active profile.

![Settle who wins the shared files](assets/docs/media/gifs/guide-order.gif)

:::note[The one rule]
When two mods ship the same file, the **last one in the order wins**. The order is the
resolution: two people with the same mods in a different order do not have the same game.
:::

## Turn mods on and off

- [ ] **Open the Library** and find the mod.
- [ ] **Press its toggle**, or double-click the card. *You see:* *Queued*, *Copying 45%*, then **On** with a short glow. Turning it off walks the same states in amber and ends on **Off**.
- [ ] **Queue several in a row.** They run one after another, in the order you clicked. *You see:* the activity pill count (`3/12`) and a **Cancel** button.

## Choose the order

- [ ] **Open the order view.** Press the list icon on the profile card, or the list icon next to the sort menu in the Library, or press :kbd[Ctrl+K] and type *Activation order*. *You see:* every active mod as a row, with *Overrides 12 file(s) from X* or *3 file(s) overridden by Y*.
- [ ] **Move a mod.** Drag its row, or select it and press :kbd[Alt+↑] or :kbd[Alt+↓]. *You see:* the notes on each row change as you drag, and the footer counts the files that would change hands.
- [ ] **Apply it.** Press **Apply order** (:kbd[Ctrl+Enter]). *You see:* only the files that change hands are copied again. **Reset** throws the draft away.

:::tip[From the Library, with no draft]
A mod's detail panel has an **Activation order** box with Top, Up, Down and Bottom. A move made
there is applied at once. The `#N` badge on each active card is its position.
:::

## Keep and share an order

- [ ] **Save it as a list** with **Lists** in the toolbar, so you can switch between orders.
- [ ] **Share it** with **Share**: a code, a `bmm://order` link, a readable list or a file. Importing shows a preview first and never turns a mod on or off.

## If it does not work

| You see | Do this |
|---|---|
| A disabled mod has no position | Enable it first. It joins at the end. |
| The game folder looks wrong after many moves | Press **Re-apply** in the order view to repair it. |
| Two mods fight over files and you do not know which | Open the [Conflicts view](doc-page:guide/fix-a-conflict): it shows who wins each file. |

## Next

[Fix a conflict](doc-page:guide/fix-a-conflict). Details: [Activation order](doc-page:how-it-works/load-order), [Library](doc-page:features/library).

<div class="bmm-replay" data-src="assets/docs/media/replays/share-list.bmmreplay" data-remote="https://freeproject089.github.io/BMM-Docs/assets/replays/share-list.bmmreplay" data-page="guide/activate-and-order" data-title="Watch it: settle an order, keep it as a list, share it"></div>
