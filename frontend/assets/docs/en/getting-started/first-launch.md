# First launch

Three steps. Do them in order — the second one is the one people skip, and it's the one that
matters.

## 1. Create a profile

BMM opens on an empty [Profiles](doc-page:features/profiles) screen and says:

> No active profile — create your first profile so a game update or a reinstall never wipes
> your setup again — or import your existing OvGME configs in one click.

The form asks for a name and **three folders**, all required: the **game folder** (where
BMM deploys), a **mods folder** (where this profile's mods are stored), and a **backup
folder** (originals and the activity log). Optionally a game name, a colour and an icon.

Use a separate mods folder per profile — BMM warns you if two profiles share one, because
that is how you end up debugging a mod you thought was off.

## 2. Understand what just happened

> Your first profile is ready! Everything you enable from now on is saved right here — safe
> from game updates and reinstalls.

That's the deal in one sentence. Your mods live in BMM, not in the game. The game folder
becomes something BMM *writes to*, not something you maintain by hand.

## 3. Add a mod and turn it on

With the [Library](doc-page:features/library) open, drag a `.zip` or a mod folder onto the
window: the **Add Mod** dialog opens pre-filled, and confirming files the mod into this
profile. Then enable it — a single click on the card's toggle, or a
**double-click anywhere on the card**, is what puts it in the game, for *this* profile.

Select a card (single click) and the **detail panel** opens: version, author, description, its
cross-machine identity, any conflicts with other mods, dependencies, tags, and an integrity
check. You don't need any of it on day one — but it's there when you do.

If the game acts like the mod isn't there, it's almost always packaging, not BMM: see the
[Mapper](doc-page:features/mapper).

## Coming from another manager?

Don't rebuild a setup by hand if you don't have to. BMM imports existing profiles from:

- **OvGME** — it scans your OvGME data folder and brings the profiles over.
- **OMM / Open Mod Manager** — import an `.omm` or `.omx` profile directly.

Do that first; then tidy up in BMM.

!!! tip "Practise without risk"

    **Help & other → Interactive Tutorial Hub** guides you through the real app with a built-in
    practice sandbox: it creates a "🎓 Tutorial Example" profile with example mods (including a
    deliberate conflict) and an example modpack, so you learn the whole flow — profiles,
    activation, conflicts, sharing — without touching a real install. The sandbox cleans itself
    up automatically.
