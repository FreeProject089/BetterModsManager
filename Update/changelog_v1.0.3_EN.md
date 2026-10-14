# Changelog v1.0.3 (since e4b7943d, the 1.0.2 build)

1.0.3 links Better Mods Manager to BetterCommunity v2. Everything ships switched off: BMM keeps talking to BetterCommunity v1 exactly as 1.0.2 does. The day BetterCommunity v2 goes live, its team flips one value in the links file BMM reads at every start, and installed 1.0.3 copies follow without a new release.

## [NEW] BetterCommunity v2, ready and dormant
### One switch, decided at start
- BMM reads the switch in this order: your `app.cfg` (`BCApiVersion`, `BCv2Base`), then the links file published by BetterCommunity (`bc_api`, `bc_v2_base`), then v1. An explicit `BCApiVersion=v1` in `app.cfg` keeps an install on v1 whatever the links file says.
- v2 is used only after BetterCommunity v2 answered its health check in this session. If it does not answer, BMM stays on v1 for the session and writes the reason in its log. Until the check answers, BMM is on v1.
- Without the switch nothing changes: every address BMM calls is the one 1.0.2 called (checked by a test, address by address).

### Linked BetterCommunity account (v2)
- Settings shows a « Linked BetterCommunity account » card when the session runs on v2. « Sign in with BetterCommunity » shows a short code; you approve it on the website. No password is typed into BMM.
- The sign-in is kept the way BMM keeps its other secrets: protected by Windows for your user account (the OS keyring on macOS and Linux). If neither works it lasts until BMM closes, and the card says so. BMM never shows it, and only sends it to the BetterCommunity v2 address that issued it.
- Signing out revokes the sign-in on the website and forgets it on this PC.
- In v1 mode the card is hidden and the existing account link works as before.

### What moves to v2 when the switch is on
- Feedback, bug and crash reports go to the v2 feedback centre: as your account when you are signed in, else with BMM's public app key.
- Consent receipts: your telemetry answers, and your answers to the Terms and the Privacy Policy once BetterCommunity v2 publishes the version this build ships. Same rule as before: sent only with telemetry on, or when you press « Send to the server » in My consents.
- When BetterCommunity v2 publishes a newer version of BMM's Terms or Privacy Policy than the one you accepted, BMM shows the new version with a link to read it, and asks Accept, Refuse or Later. Your answer is recorded by BetterCommunity with the version and revision shown, and a copy of the receipt is kept in My consents.
- BetterCommunity notifications are read with your v2 sign-in (no API key to paste).
- The Community page reads the journal from v2. Avatars stay on v1 (v2 has none yet).
- Laya's BetterCommunity suggestions use your v2 sign-in.
- The update check's fallback feed and the credits list come from v2. Every update is still checked against the release's signed `update-manifest.json` or `update.json`, exactly as before.
- Laya's offline model can also be downloaded from v2. Its SHA-256 pin is unchanged.
- Anonymous telemetry, if you turned it on, goes to v2 with only the categories you accepted, read from your consent receipts. BMM keeps only the details the BetterCommunity team declared and drops the rest before sending, including the precise hardware identity. Session replay stays on the current telemetry server.

### Still on v1 in v2 mode
- Avatars, launch announcements, author search by creator id and the Discord link. BetterCommunity v2 does not serve them yet.

## [IMPROVED] Notifications
- One notification centre, one unread count (also on the taskbar icon). Messages are grouped by where they come from: Updates, Followed repos, Scheduler, Background jobs, BetterCommunity and BMM itself.
- Each message can be opened (when it leads somewhere, for example an available update or a followed repo), snoozed (1 hour, 4 hours, tomorrow 9:00) or dismissed. Snoozed messages come back unread when their time comes.
- Settings, Notifications: each group is shown in the app, in the app and as a system notification (only when BMM is in the background), or turned off (kept in the list only). The old per-source switches carry over.
- Do not disturb, from the bell or in Settings, and daily quiet hours. While quiet nothing pops up and no system notification is sent; errors still show in the app, and everything stays in the list.
- The same event twice is one popup with a count and one entry with a count, not a stack of copies. An update found again by a later check refreshes its entry.
- The list keeps the last 200 messages and nothing older than 30 days.
- Keyboard: Up and Down move between messages, Enter opens, Delete dismisses, S snoozes for an hour, Escape closes and returns to the bell.
- A long background job (15 seconds or more) that finishes while BMM is in the background is reported under Background jobs.

## [IMPROVED] Conflicts
- A new Conflicts view says, for every file two active mods share, which mod's copy is on disk under the current activation order, with a summary per pair of mods (how many shared files, who gets how many).
- Resolve by reordering (move up or down, « Make X win », the smallest move that puts X after the other mod), by keeping one mod's copy of chosen files whatever the order says (a per-file choice, kept per profile), or by disabling a mod. Tick many files to choose for all of them at once.
- Nothing changes until Apply. The footer says how many files Apply would re-copy, and « Show changes » lists each one (from which mod to which, or back to the game's own file). Applying is a job in the activity centre and re-copies only those files.
- The rule is the one deployment uses: the per-file choice wins while its mod is active, otherwise the last mod in the order. Enabling or disabling a mod puts kept files back afterwards.
- The library's live conflict badge, the mod details and the old conflict list open the view on that mod. It is also in the command palette (« Resolve conflicts »). Overlaps with disabled mods or other profiles stay in the existing list, one click away.

## [IMPROVED] Panels in their own window
- The theme editor, the translation sandbox and the task debugger can leave BMM's window: « Open in its own window » in their header, or drag the header past the edge of BMM's window and let go. The panel becomes a window of its own that you can put anywhere, on another screen too, beside what it works on instead of over it.
- Everything keeps working from there and stays in step with BMM: the panel still runs in BMM, the window shows it and sends your clicks and typing back. It follows the theme, light or dark.
- Each panel's window remembers its size and place. « Back into BMM's window » puts the panel back where it was; its close button closes the panel. Closing the window any other way (Alt+F4, the taskbar) also puts the panel back.
- In that window, lists of choices open as the system's own list, and dragging things inside the panel (reordering, resizing) is done in BMM's window.

## [IMPROVED] Cards, Settings and dialogs
- No more coloured bar down the left edge of cards and rows: the active Settings entry, the main menu, mod cards, tips and notes, quotes, scheduler steps, the security and identity cards and the rest. The current item is a soft tinted background, a tip is a softly tinted box, a kind is shown by its icon.
- Settings: the index column can be hidden (button beside the search) to give the cards the full width, and comes back with the « Index » button above the cards. BMM remembers the choice, and Ctrl+F brings it back to search. On a narrow window the index stays the strip above the cards.
- Settings cards share one header: the icon on a quiet tile, the title, the actions, and the description right under the title. No rule under the title, a calmer card.
- The navigation editor's buttons follow the order of every dialog: Reset and Share on the left, Done on the right at its normal size.

## [FIXED] App catalogue: « a source did not answer » with no source added
- The official app catalogue lists an empty partner address as a placeholder. BMM tried to fetch that empty address, counted the failure, and said one source did not answer to people who had added none. Empty and non-web addresses are now skipped, never counted.
- A followed `.bmmbundle` was also handed to the web fetcher and counted as a failure while its apps loaded fine. It no longer is, and adding one from the Sources tab now saves it for the next start.
- Feeds whose address already has a query (`catalog.json?project=bmm&kind=APP`) are fetched with their query intact.
- When a source really fails, the notice names it, says why (timeout, HTTP code, refused signature, not a catalogue) and offers Retry, Disable, Remove (your sources) and Details. Switched-off sources are never fetched nor counted.
- With the official catalogue switched off and no source on, the page says there is no source and offers to add one, instead of « catalogue empty » or an error.

## [IMPROVED] Catalogue sources
- One list in the App catalogue (Sources) and in Settings, Catalogue index: name, address, kind, official, partner or yours, signature state, last refresh, item count, status and an on/off switch.
- Add and Edit open a dialog with Test, which reads the address the way BMM will: item count, format, signature. An index is recognised and its catalogues can be added at once.
- Your sources can be moved up and down (the first catalogue wins when two list the same item), given a name, removed after a confirmation, and imported or exported as a JSON file.
- Official sources come from BMM's links file and are shown read-only, with a short explanation of official and partner catalogues versus yours.

## [IMPROVED] BMM Tools
- The tools list has a search box, groups, and one line under each tool. The results area always says where it is: not run yet, running (with progress and Cancel), failed (with the reason and Retry), or done (summary and the same Copy JSON, Save JSON, Save CSV buttons for every tool).
- New: Deployed files check. For each active mod, files gone from the game folder, links that point nowhere, files missing from the mod in the library, and leftover broken links next to them.
- New: Large files. The biggest files in a profile's mods and backups folders, with their mod.
- New: Names and versions. Mod names and versions to tidy (extra spaces, version inside the name, empty or odd version), with a suggestion each. Nothing is renamed.
- New: Duplicate profiles. Profiles with the same (or nearly the same) active mods, or sharing a game or mods folder.
- New: Cache cleaner. Measures the catalogue cache, extracted mod archives, update leftovers and archived reports, then empties only the ones you tick, after a confirmation that shows the size. It refuses to touch extracted archives while a mod is being activated.
- New: Log viewer. This session's log and the saved session and crash reports, filtered by level and by words.
- New: Catalogue diff. Two versions of a catalogue or repo.json: entries added, removed and changed, with the fields that changed.
- The long scans (duplicates, disk usage, large files, deployed files, cache measure) appear in the activity centre and can be stopped from there.

## [IMPROVED] Followed repos: follow one by its address or IP
- « Follow a repo » sits in the Followed repos card itself and opens a dialog: the address, an optional download password and an optional key, « Test the connection », how often to check, and what to do with an update (tell me, download it, download and apply it). Nothing is saved before « Follow ».
- The test reads the repo once and shows its name, version, repo.json format, signature (valid, does NOT match, or unsigned) and how many mods it offers. Errors are said plainly: nothing answered, timeout, HTTP code, password needed.
- A « Follow » button where a repo is already known: the repo you just fetched, each browse result and each history entry. It opens the same dialog, filled in.
- A download password given there is saved sealed on this PC (protected by Windows for your account, the OS keyring on macOS and Linux), never in BMM's settings file, and used by the scheduled checks. Before, a followed repo with a password failed every check. Stopping following a repo forgets it.

## [IMPROVED] Repos reachable by plain IP
- An address can be typed the way you reach the machine: `192.168.1.20:8000`, `http://192.168.1.20:8000/repo.json`, `[::1]:8000`, `nas.local:8080/mods/`, or a bare name. BMM turns it into the repo.json address and shows it under the field. `HTTP://` in capitals, a share key (`?k=…`) and a trailing `#…` are handled.
- Plain http is accepted. On this PC or the local network the dialog says it is normal; over the internet it warns that a download password would travel readable.
- Requests to this PC and to local-network addresses no longer go through the system proxy, which cannot reach them. Internet addresses still use it. BMM's private-address blocks for scheduled tasks, AI endpoints and custom pages are unchanged: they are for addresses you did not type.
- `192.168.1.20:8000` and `http://192.168.1.20:8000/repo.json` are the same followed repo, not two.

## [IMPROVED] SSH servers
- The SSH servers dialog is redone: a list of saved servers with their state (incomplete, not tested yet, server key trusted, test passed, last test failed), and a form whose every field says what is wrong with it (host, port 1 to 65535, user, key file, base folder, a name usable in `ssh://name/`). Pasting `me@nas.local:2222` into the host fills the user and port.
- « Test the connection » works step by step: reach the server, check its key, sign in, look at the base folder (exists, writable, and if not, who owns it).
- A server seen for the first time shows its key fingerprint (`SHA256:…`) and asks « Trust this server » before anything is sent to it: no password, no key signature. A changed key is refused, with the trusted and the new fingerprint side by side and the way out if you rebuilt the server.
- The passphrase or password is typed in the form, used for Test and Browse, and never stored. The old dialog asked for it in a box the app could not show, and its Delete and Discard confirmations could not be answered either; both now use BMM's own dialogs.
- Keyboard: Up and Down move through the servers, Enter goes to the form, Enter or Ctrl+S saves, Escape closes.
- SSH errors read as sentences (« Could not reach nas.local: Connection refused ») instead of a sentence with blanks followed by raw details.
- Sending or fetching a single file over SSH (a repo.json, a catalogue) now shows in the activity centre, like whole-repo transfers already did.

## [IMPROVED] Release
- One version everywhere: 1.0.3.
