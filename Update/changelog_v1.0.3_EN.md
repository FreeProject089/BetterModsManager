# Changelog v1.0.3 (since 627f956c, the 1.0.2 build)

1.0.3 brings a notification centre, a Conflicts view that shows which mod wins each shared file, panels that pop out into their own window, seven more BMM Tools, following a repo by its address or plain IP, a rebuilt SSH servers dialog, one list for every catalogue source, a guided plugin creator and a rebuilt theme editor. It is also the first build able to link to BetterCommunity v2 later on: that link ships switched off, and nothing changes until it is announced.

## [NEW] Notification centre
- One place for every message, with one unread count (also on the taskbar icon). Messages are grouped by where they come from: Updates, Followed repos, Scheduler, Background jobs, BetterCommunity and BMM itself.
- Open a message when it leads somewhere (an available update, a followed repo), snooze it (1 hour, 4 hours, tomorrow 9:00) or dismiss it. A snoozed message comes back unread when its time comes.
- **Settings → Notifications**: show each group in the app, in the app and as a Windows notification (only while BMM is in the background), or not at all (it stays in the list). Your old per-source switches carry over.
- **Do not disturb**, from the bell or in Settings, and daily quiet hours. While quiet nothing pops up; errors still show in the app, and everything stays in the list.
- The same event twice is one message with a count, not a stack of copies. The list keeps the last 200 messages, none older than 30 days.
- A long background job that finishes while BMM is in the background tells you so.
- Keyboard: Up and Down move, Enter opens, Delete dismisses, S snoozes for an hour, Escape closes.

## [NEW] Conflicts view
- For every file two active mods share, the Conflicts view says whose copy is on disk with the current activation order, with a summary per pair of mods.
- Resolve a conflict by reordering (move up or down, « Make X win »), by keeping one mod's copy of chosen files whatever the order (remembered per profile), or by disabling a mod. Tick several files to decide for all of them at once.
- Nothing changes until **Apply**. BMM first tells you how many files it would re-copy, and « Show changes » lists each one. Applying runs in the activity centre and re-copies only those files.
- Open it from a mod's conflict badge in the library, from the mod details, or from the command palette (« Resolve conflicts »).

## [NEW] Panels in their own window
- The theme editor, the translation sandbox and the task debugger can leave BMM's window: « Open in its own window » in their header, or drag the header past the edge of the window. Put the panel anywhere, on another screen too, next to what it works on instead of over it.
- The panel keeps working and stays in step with BMM, and follows the light or dark theme.
- Each panel's window remembers its size and place. « Back into BMM's window », or closing that window, puts the panel back where it was.

## [IMPROVED] BMM Tools: 14 tools
- Seven new tools: **Deployed files check** (files gone from the game folder, broken links, files missing from a mod), **Large files**, **Names and versions** (tidy-up suggestions, nothing is renamed), **Duplicate profiles**, **Cache cleaner** (measures, then empties only what you tick, after a confirmation), **Log viewer** (this session's log and saved reports, filtered by level and words) and **Catalogue diff** (two versions of a catalogue or repo.json compared).
- The tools list has a search box, groups and a one-line description for each tool.
- Every tool says where it is (not run, running with progress and Cancel, failed with the reason and Retry, done) and offers the same Copy JSON, Save JSON and Save CSV buttons.
- Long scans show in the activity centre and can be stopped from there.

## [IMPROVED] Followed repos: follow one by its address or IP
- « Follow a repo » sits in the Followed repos card and opens one dialog: the address, an optional download password and key, « Test the connection », how often to check, and what to do with an update (tell me, download it, download and apply it).
- The test shows the repo's name, version, format, signature (valid, does not match, or unsigned) and how many mods it offers, or says plainly why it failed (nothing answered, timeout, HTTP error, password needed).
- A « Follow » button wherever BMM already knows a repo: the one you just fetched, browse results and history entries.
- Type an address the way you reach the machine: `192.168.1.20:8000`, `[::1]:8000`, `nas.local:8080/mods/` or a full `http://…/repo.json`. BMM shows the repo.json address it will use. Plain http is fine on your PC and local network; over the internet BMM warns that a password would travel readable.
- Repos on your PC and local network no longer go through the system proxy, which could not reach them.

## [IMPROVED] SSH servers
- A redone dialog: your saved servers with their state (incomplete, not tested, key trusted, test passed, last test failed) and a form that says what is wrong with each field. Pasting `me@nas.local:2222` into the host fills the user and port.
- « Test the connection » goes step by step: reach the server, check its key, sign in, check the base folder (exists, writable, and if not, who owns it).
- SSH errors read as sentences instead of raw details. Sending or fetching a single file over SSH shows in the activity centre.
- Keyboard: Up and Down move through the servers, Enter or Ctrl+S saves, Escape closes.

## [IMPROVED] Catalogue sources
- One source list, the same in the App catalogue (Sources tab) and in **Settings → Catalogue index**: name, address, kind (official, partner or yours), signature, last refresh, item count, status and an on/off switch.
- Add and Edit open a dialog with **Test**, which reads the address the way BMM will. A catalogue index is recognised and its catalogues can be added at once.
- Reorder your sources (the first one wins when two list the same item), rename, remove, import or export them as JSON. Official sources are shown read-only.
- When a source really fails, the message names it, says why, and offers Retry, Disable, Remove and Details.

## [IMPROVED] Plugins & API
- **Create**: a guided form in six steps (start from, identity, contents, on apply, permissions, save and share) with a step bar that shows what still needs attention. Start from a template (mod list, server mod list, script pack, mods + scripts, automation pack, catalogue bundle, blank).
- Each permission shows a risk level (low, medium, high), and the plugin's overall risk is shown as you build it.
- A live preview shows the plugin card, a checklist of what is missing or risky, and the `plugin.json` that will be written.
- After saving: « Dry run » shows what applying would change without changing anything, « See the files » opens what was packed, and the next steps explain how to export and share the plugin.
- **Installed**: filters (update available, mod lists, scripts, automations, catalogues, asks for permissions), the number of permissions and the highest risk on each card, and « vX available » when a newer version was not installed automatically.
- **API reference**: endpoints grouped by area (mods, profiles, plugins, server repos, …) instead of by HTTP method, with filters by method or « no token needed ».

## [IMPROVED] Theme editor, rebuilt
- Sections on the left (Basics, All tokens, Pictures, Elements, CSS, Library), a live preview of real BMM parts on the right, contrast checks below. It still floats, docks to the side, and can now pop out into its own window.
- The preview wears only the theme you are editing; BMM changes when you save, or as you edit if you tick « Apply to BMM as I edit ». The editor itself stays readable whatever colours you try.
- **Basics**: dark or light, a whole palette from one colour, a built-in theme to start from. Switching mode rebuilds backgrounds and text and keeps your accent, so a light version of a dark theme is one click.
- **All tokens**: every colour and style setting BMM uses, explained and searchable, with a « Changed only » filter.
- **Contrast**: each pair that must stay readable shows its WCAG grade; « Fix » picks the closest colour that passes, « Fix all » fixes them all.
- Undo and redo (Ctrl+Z, Ctrl+Y), Ctrl+S to save, Save as new, and a File menu for export, import, copy as JSON and share link. A built-in theme is never overwritten.
- Theme files now carry a format version. Older files are upgraded when read and only rewritten when you save; nothing you made is lost.

## [VISUAL] Cards, Settings and theme ids
- No more coloured bar down the left edge of cards and rows, anywhere in the app. The current item gets a soft tinted background instead, and tips are softly tinted boxes.
- **Settings**: the index column can be hidden to give the cards the full width (button beside the search), and comes back with « Index ». BMM remembers your choice.
- Settings cards share one calmer header: icon, title, actions, and the description right under the title.
- Six built-in themes had ids named after other products. Their ids are renamed; the themes do not change, and the names you see in BMM stay the same except « Editor », now « Charcoal ». The old ids keep working everywhere (your saved theme, scheduled tasks, links):

| Old id | New id |
|---|---|
| `bmm-discord` | `bmm-indigo` (Indigo) |
| `bmm-spotify` | `bmm-neon` (Neon) |
| `bmm-claude` | `bmm-clay` (Clay) |
| `bmm-nord` | `bmm-arctic` (Arctic) |
| `bmm-vscode` (Editor) | `bmm-charcoal` (Charcoal) |
| `bmm-macos` | `bmm-cobalt` (Cobalt) |

## [NEW] Ready for BetterCommunity v2 (switched off)
- 1.0.3 can talk to BetterCommunity v2, the next version of the BetterCommunity service. **It ships switched off**: until v2 is announced, BMM talks to BetterCommunity exactly as 1.0.2 does, address for address.
- When v2 opens, the BetterCommunity team turns it on from the links file BMM already reads at start, so installed 1.0.3 copies follow without another update. BMM only uses v2 after it has answered a health check; otherwise it stays on the current service for that session. A line in `app.cfg` can keep an install on the current service whatever the links file says.
- Once on: a **Linked BetterCommunity account** card in Settings, where you sign in by approving a short code on the website (no password typed into BMM; signing out revokes the sign-in). Feedback, notifications, the Community page and Laya's suggestions then use that account. Updates are still checked against the release's signed manifests, exactly as before.
- Consent stays the rule: telemetry and consent receipts are only sent if you turned telemetry on, and if BetterCommunity v2 publishes a newer version of the Terms or Privacy Policy, BMM shows it and asks Accept, Refuse or Later, with a receipt kept in **My consents**.

## [FIXED]
- **App catalogue**: « a source did not answer » showed for people who had added no source. Empty placeholder addresses are skipped, followed `.bmmbundle` files are no longer counted as failures (and adding one from Sources now survives a restart), and feed addresses with a `?query` are kept intact. With no source switched on, the page says so and offers to add one.
- **Followed repos with a download password** failed every scheduled check. The password is now saved sealed on this PC, never in BMM's settings file, and is forgotten when you stop following the repo.
- `192.168.1.20:8000` and `http://192.168.1.20:8000/repo.json` are now the same followed repo, not two.
- **SSH servers**: the passphrase prompt, and the Delete and Discard confirmations, could not be answered. They now use BMM's own dialogs; the passphrase is typed in the form and never stored.
- **Plugins, Duplicate**: the copy listed the original plugin's scripts, folders, automations, bundles and icon without having them. They are now copied into the new plugin when it is saved.
- **Plugins, Create**: editing a plugin on a PC that lacks some of its mods no longer drops them (they show as « not on this PC »); the scripts list shows its empty state; the current icon shows when editing; the mod list falls back to the current profile when the all-profiles list cannot be read.
- **API reference**: parts of it were in French only and ignored the theme; an endpoint without fields no longer shows an empty table.
- **Themes**: `bmm://theme/apply` now applies built-in themes too (it answered « Theme not found »). Importing a theme whose id is already used by a different theme no longer overwrites it. « Pick on screen » now matches any colour, not only nine fixed ones.
- The navigation editor's buttons follow the order of every other dialog.

## [SECURITY]
- **SSH**: a server seen for the first time shows its key fingerprint and asks « Trust this server » before anything is sent to it. A changed key is refused, with both fingerprints side by side.
- **Themes**: a colour value that tries to break out of the stylesheet is ignored, and an imported theme archive whose id is not a plain name is refused (it could write outside the themes folder).
- **Plugins, Duplicate**: only files inside the original plugin's folder are copied; absolute paths, `..` and links are left out.
- **Secrets**: repo download passwords and the BetterCommunity v2 sign-in are kept like BMM's other secrets (protected by Windows for your account) and only sent to the address they belong to.
- Bypassing the system proxy applies only to repo addresses on your PC or local network. BMM's blocks on local-network addresses for scheduled tasks, AI endpoints and custom pages are unchanged.

## Release
- One version everywhere: 1.0.3.
