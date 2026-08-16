# Dependencies & conflicts, as a tree

Every mod already carries a list of the mods it needs, and BMM already knows which mods fight over
which files. What was missing was the **shape**. A flat list of pairs answers *"does A conflict with
B?"* and never answers the question you actually have before installing or removing something:
*what does this pull in, and which of those collide?*

Open it with ++ctrl+k++ → **Dependencies & conflicts**.

---

## What the tree is

Each root is a mod **nothing else depends on** — the things you chose, rather than the things they
dragged in. Under each one sit its dependencies, and theirs, to the bottom.

```
Weapon Overhaul                          3 conflict(s)
 ├── Core Framework
 │    └── Asset Library
 └── Sound Pack                          1 conflict(s)
Texture Pack HD
```

The count on the right is how many other **enabled** mods share at least one file with that mod.

---

## Three things it refuses to smooth over

Each of these would produce a tree that looks correct and is not.

### A missing dependency is a node, not a gap

If a mod names a dependency that nothing in your library provides, it is drawn in place and marked
**not installed**, and the summary counts them:

> *3 dependency/ies named by a mod and provided by nothing:*

Dropping the line would make the tree agree with a library that is broken. It is usually the most
useful line on the screen.

### A cycle is drawn once and marked

`A → B → A` is a thing people build by accident. A renderer that follows it recurses until the stack
runs out, so the second visit is drawn as **cycle** and not followed.

### A mod reached twice appears twice

Reached by two paths, it is shown under both — the second marked **seen above**. Deduplicating would
hide that two different things depend on it, which is exactly what you need to know before removing
it.

---

## Copy as text

The **Copy as text** button puts the whole tree on the clipboard in box-drawing form. It is
searchable and quotable in an issue or a message, which a screenshot is not.

---

## Where the logic lives

`mod-graph.ts` is pure — tree building, root finding, cycle marking, text rendering — and is tested
directly. `mod-graph-view.ts` is the part that talks to Tauri and the DOM. The split is the rule for
this whole folder: anything importing Tauri cannot be loaded by a test, so the thinking lives where
it can be checked and only the plumbing lives beside it.

The conflict side reads `get_all_mod_conflicts`, which reports **one entry per side** — the same pair
arrives twice. Pairs are flattened on the sorted ids before counting, or every number in the summary
would be doubled.

---

## What this page is not

It does not decide anything. Which mod wins a conflict is still the enable order, unchanged and
explained in **[Conflicts](doc-page:how-it-works/conflicts)** — this is the view that shows you the shape of the problem
before you act on it.
