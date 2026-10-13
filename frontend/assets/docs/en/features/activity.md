# Activity centre

Everything BMM is doing, in one place, whatever screen you are on. Before, a sync or an export
showed its progress only on its own screen, and leaving the screen hid the work.

## The button

The **Activity** button sits in the title bar, beside the window controls. While something
runs, a ring fills with the overall progress and a badge shows how many tasks are running.

It covers mods turned on or off, downloads, repo syncs and exports, scans, installs (apps,
plugins, mod lists, modpacks), exports and imports, backups and restores, checksums,
[scheduled tasks](doc-page:features/scheduler), [Laya](doc-page:features/ai) jobs, benchmarks, and the checks of the
[repos you follow](doc-page:features/repo#following-a-repo).

## The panel

Click the button to open the panel:

| Part | What it shows |
|---|---|
| **Running** | One row per task: its kind, its title, the current step, a progress bar and the time elapsed. **Cancel** appears where the task can stop. |
| **Recent** | The last 30 tasks that ended: **Done**, **Failed** with its message, or **Cancelled**. **Clear** empties it. |

The recent list is kept on this PC, so it survives a restart of BMM. When nothing runs, the panel says so.

**Keyboard:** the button is a normal button. Opening moves the focus into the panel, :kbd[Tab]
walks its buttons, :kbd[Esc] closes it and gives the focus back. A click outside closes it too.
