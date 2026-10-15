# Change history & release notes

BMM keeps a **timeline of what changed** and lets you undo some of it. A second, separate view keeps
the **release notes** of every BMM version.

## The change history

Open **History** from the Library or the command palette (*Show history*). It lists, day by day
(*Today*, *Yesterday*, then dates), everything that changed in BMM: mods enabled, disabled, edited or
deleted; profiles switched, created, edited or deleted; settings changed; repos followed or
unfollowed; catalogue sources added or removed; update checks and installs.

- **Filters.** The type chips narrow the list: **All, Mods, Profiles, Settings, Updates, Repos,
  Other**.
- **Search.** Type in the search box to find an entry by its text. When nothing matches, **Show
  everything** clears the filters.
- **What changed.** Open an entry to see a table with the **Field**, its value **Before** and **After**
  (an empty value reads *(empty)*). Entries that failed or were cancelled say so.

### Undo

Some entries have an undo button on them:

| Entry | Button |
|---|---|
| A mod's details were edited | **Put the old details back** |
| A mod was enabled | **Disable it again** |
| A mod was disabled | **Enable it again** |
| Settings were changed | **Restore these settings** |

If the mod is no longer in the library, the entry says so instead.

### How long it is kept

**Keep for** sets the retention: **7, 30 or 90 days**, **Forever**, or a number of days of your own.
**Clear** empties the history (click again to confirm).

### Export

**CSV** and **Export JSON** save the entries you are looking at, filters included, so you can
attach them to a bug report or keep a record. A filter that leaves nothing says *Nothing to export
with this filter*.

!!! note "Secrets are never stored"

    Passwords, tokens and keys are left out of the history: when a setting that holds a secret
    changes, the entry records that it changed, never its value.

## Release notes: the Versions tab

**Release notes** (from the update window, or *Show what's new* in the command palette) has two
tabs:

- **Versions**: every version's notes in one list, newest first. Each version carries counts (*n
  new, n improved, n fixed*) and a tag: **Installed** for yours, **Newer** for versions above it.
  The search box finds the versions that mention a word, and says *No version mentions this* when
  none does. Where there are several documents for one version (changelog, release notes, GitHub
  release, test-build notes), *Also for this version* lists them, and **Open the file** opens the
  source.
- **Documents**: the notes as separate documents.
