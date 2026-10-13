# Privacy Policy — Better Mods Manager (BMM)

**Version 2026-10-13** (BMM 1.0.2 and BetterInstaller setups that ship it) · replaces the version of
2026-10-06 (what changed: §12)

Better Mods Manager is an open-source desktop application (GPL‑3.0) that runs on your computer.
Your profiles, mods, modpacks, plugins and settings are stored **locally**, in BMM's data folder,
and you can export or delete them at any time. BMM shows no ads, needs no account, and we never sell
your data.

Some data does leave your computer. This policy lists **every network connection BMM and its
installer make**, checked against the source code of this version: **what** is sent, **when**, **to
whom**, **why**, on which **legal basis**, how long it is **kept**, how to **turn it off**, and its
**default**. The Terms of Service do not repeat any of this: on questions about data, this document
is the reference.

This policy exists in English and in French. **If the two differ, the English version prevails.**

---

## 1. Who is responsible

The controller for the data the BMM team receives (telemetry, reports, consent receipts, the
BetterCommunity services) is:

> **[OPERATOR LEGAL NAME]** — **[legal form, registration number if any]**
> **[postal address]**
> Privacy contact: **[privacy e-mail address]**
> Representative in the EU / the UK (art. 27 GDPR), if required: **[name and address, or "none"]**

_The fields in brackets are to be completed by the operator before publication; nothing in them is
an existing company's data._

Third parties you choose to connect to (a Server Repo's owner, Discord, an AI provider you
configure, GitHub, Google, Cloudflare) are responsible for what they do with what they receive,
under their own policies.

---

## 2. At a glance: what is on by default

The installer asks one privacy question, the way a cookie banner does, and **nothing is
pre-selected**: Install stays disabled until you pick one of three answers.

| What | Installer: *Essential only* | Installer: *Accept all* | Installer: *Customize* | Without the installer |
|---|---|---|---|---|
| Startup requests, update checks, connectivity checks, fonts (§4.1–4.4) | On | On | On (update checks can be unticked) | On |
| **Laya offline model download** during setup (§4.5) | Separate question, **ticked by default** | same | same | — (Settings → AI downloads it on request) |
| **Telemetry** and its categories: usage, performance, errors sent live, Laya statistics, masked session replay (§5) | **Off** | **On** (this is your consent; BMM does not ask again) | Each one as you set it | Off until you answer BMM's consent screen |
| **Weekly benchmark + hardware report** (§5.4) | Off | **Off** (never part of *Accept all*) | Off unless you tick it | Off (never part of *Turn all on*) |
| **Discord Rich Presence** (§6) | Off | **On** | As you set it | Off |
| Bug, crash and feedback reports (§7) | Only when you press Send | same | same | same |
| AI providers that send data (§8.10) | Off | Off | Off | Off |
| Consent receipts sent to the server (§9) | No (telemetry off) | Yes, with telemetry | With telemetry | With telemetry |

Every one of these can be changed later in BMM: Settings → Privacy for telemetry, its categories
and your consent receipts; the Discord and update switches in Settings; Settings → AI for Laya.

---

## 3. Data-flow inventory

Every connection, in one table. "Legal basis" refers to the GDPR (art. 6(1)) and, for Switzerland,
the revised Federal Act on Data Protection (nLPD, art. 31). Retention is what the BMM team keeps;
third parties keep what their own policies say.

| # | What is sent | When | To whom | Why | Legal basis | Kept | Off-switch | Default |
|---|---|---|---|---|---|---|---|---|
| 1 | IP address, request headers (no Creator ID) | Every launch | bettercommunity.ch, then GitHub as fallback (§4.1) | Download BMM's link list and contributors list | Legitimate interest: the app works with current links (f) | Server access logs, short-term | Stay offline | On |
| 2 | IP address, user-agent naming BMM | ~3 s after launch, and when you check | GitHub API, bettercommunity.ch fallback; the installer's update manifests (§4.2) | Offer security and bug-fix updates | Legitimate interest (f) | Server access logs | Settings → automatic update checks | On |
| 3 | IP address | When you install an update | GitHub releases (the setup and its signed manifest) | Download the update you asked for | Your request (b) | Server access logs | Do not update | When you click |
| 4 | IP address | Every 2 minutes | Google (`gstatic.com`), Cloudflare (§4.3) | Know whether BMM is online | Legitimate interest (f) | Their policies | Stay offline | On |
| 5 | IP address | When a page needs them | Google Fonts, jsDelivr, Simple Icons, flagcdn.com, YouTube (nocookie) (§4.4) | Fonts, icons, language flags, embedded videos | Legitimate interest (f) | Their policies | Stay offline | On |
| 6 | IP address | During setup, if *Laya offline* is ticked; later only if you ask | GitHub releases, BetterCommunity mirror (§4.5) | Download the local AI model (327 MB), checked against a pinned SHA-256 | Your choice (b) | Server access logs | Untick *Laya offline*; Settings → AI | **Ticked** in the installer |
| 7 | Creator ID, install id, system profile, usage, interactions, logs, performance (§5.1) | Every 90 s while telemetry is on | BetterCommunity telemetry server | Find bugs, measure what is used | **Consent** (a) | 180 days (configurable by the operator) | Settings → Privacy | **Off** (*Accept all*: on) |
| 8 | Masked recording of the BMM window (§5.2) | With telemetry | Telemetry server | Reproduce bugs | Consent (a) | 180 days | Settings → Privacy | With telemetry |
| 9 | Errors and crashes, cleaned of secrets, paths, e-mails, IPs; a hash of the Creator ID (§5.5) | Within seconds of an error, with telemetry | Telemetry server (classified by Laya on the same servers) | Fix errors quickly | Consent (a) | 180 days | Settings → Privacy | With telemetry |
| 10 | Laya usage statistics, never any text (§5.6) | With telemetry | Telemetry server | Know whether Laya helps | Consent (a) | 180 days | Settings → Privacy | With telemetry |
| 11 | Benchmark timings and hardware identifiers: serial numbers, machine UUID, MAC addresses (§5.4) | Weekly, only if you ticked it | Telemetry server | Hardware compatibility | Consent (a), asked separately | 180 days | Settings → Privacy | **Off** everywhere |
| 12 | Consent receipts: document, version, text hash, language, answer, time, source, app version, random install id (§9) | After an answer, if telemetry is on or you press *Send to the server* | Telemetry server | Prove which text you accepted or refused | Legal obligation to demonstrate consent (c), legitimate interest (f) | 3 years after a receipt is superseded or the install goes silent (configurable) | Do not send; erase by install id | With telemetry |
| 13 | Profile name, active mod count, BMM version, Creator ID (§6) | While Discord RPC is on | The Discord app on your PC, shown on your Discord profile | Show what you are playing | Consent (a) | Discord's policy | Settings | Off (*Accept all*: on) |
| 14 | What you type, attachments you pick, Creator ID with signed proof and device fingerprint hashes, app and OS details (§7) | When you press Send | BetterCommunity feedback centre | Answer your report | Your request (b); attachments you tick | Under the BetterCommunity platform's terms | Do not send | Only on Send |
| 15 | Creator ID, signed proof, device fingerprint hashes (§4.6) | Reports, account linking, once per key while linked | bettercommunity.ch | Prevent ban evasion and free-offer abuse | Legitimate interest (f) | Hashes: 180 days after last seen | Do not link, do not send reports | Only then |
| 16 | IP address, Creator ID, download password if any (§8.1) | When you connect to or sync a Server Repo | That repo's owner | Access control by its owner | Your request (b) | The owner's choice | Do not connect | Only then |
| 17 | Creator ID, one-time code checks (§8.6) | When you link an account | bettercommunity.ch | Link your account | Your request (b) | While linked | Unlink | Only then |
| 18 | Your BetterCommunity API key (§8.7) | Every 10 min, only if you stored a key | bettercommunity.ch | Your notifications | Your request (b) | — | Remove the key | No key, no request |
| 19 | A mod's name, author, description, file names, tag names, or a report's text, masked first (§8.10) | Only when you click *Suggest*, *draft* or *AI hint* with a network provider | The provider you chose | AI suggestions | Consent (a) | That provider's policy | Settings → AI | **Off** |
| 20 | What your own integrations send (§8.9) | As you configured | The service you configured | Your automation | Your request (b) | That service's policy | Remove it | Off |

Nothing else leaves your PC. Browsing and managing mods, profiles and modpacks sends nothing.

---

## 4. What happens whatever your telemetry choice

### 4.1 Startup configuration
Each time BMM starts it downloads its list of links (`links.json`) and the contributors list from
`bettercommunity.ch`, falling back to the copies on GitHub. **These startup downloads do not carry
your Creator ID**: no `X-Creator-ID` header, no key proof. BetterCommunity's server sees your IP
address, as any web server does, and nothing that identifies this installation.

Other requests BMM makes to a bettercommunity.ch address **do** carry your Creator ID in an
`X-Creator-ID` header: fetching a catalogue or a repository (the id is what gates access to private
content), and the feedback, report and account features you start yourself.

**What the Creator ID is.** It is the public half of an Ed25519 key pair BMM creates on first launch.
The key is **derived from identifiers of this PC** (Windows MachineGuid, product ID and install date;
motherboard, BIOS, CPU and disk serial numbers; the C: volume serial) through a one‑way key
derivation. It is kept, with the rest of the key material, in a store encrypted by Windows (DPAPI,
tied to your Windows account) in BMM's data folder and your user registry; on macOS and Linux under
a key kept in the system keyring (Keychain, Secret Service), or, with no keyring, in a file only your
account can read. The Creator ID is **pinned** (a `creator_v5.pin` file and a registry / keyring
entry holding public values only), so a store copied from another machine or edited is refused. A
reset, which you start yourself in Settings, is noted in a local `creator_v5.log` that never leaves
your computer. Consequences:

- it contains no name or e‑mail, and the identifiers it was derived from cannot be read back out of it;
- it is **stable**: the same PC gets the same Creator ID, even after a reinstall, so everything sent
  under it is **linkable to this machine over time**;
- it signs what you publish (repos, modpacks, tutorials), so anyone who receives those sees it (§8.3).

### 4.2 Update checks and updates
About three seconds after launch BMM asks GitHub's releases API
(`api.github.com/repos/FreeProject089/BetterModsManager/releases`) for a newer version, with
`bettercommunity.ch/api/updates/bmm` as a fallback. If BMM was installed with BetterInstaller, the
check goes through the installer's maintenance program, which reads the signed update manifests on
GitHub and `bettercommunity.ch`. These hosts see your IP address and a user‑agent naming the program.
Turn automatic checks off in Settings (or untick them in the installer's *Customize*).

When **you** choose to install an update, BMM downloads the signed manifest and the setup
(`BMM-Setup.exe`) from the GitHub release, checks the publisher's signature and the SHA‑256 before
anything is started, and keeps an interrupted download in its own folder so it can resume. Nothing
about you is sent with these downloads.

### 4.3 Connectivity checks
Every two minutes BMM checks whether it is online by requesting `www.gstatic.com/generate_204`
(Google) and `cloudflare.com/cdn-cgi/trace` (Cloudflare). They see your IP address and ordinary
request headers.

### 4.4 Fonts, icons, flags, videos and catalogues
- The interface loads its fonts from **Google Fonts**.
- Icons that are not bundled come from **jsDelivr** and **Simple Icons**; the language picker shows
  flags from **flagcdn.com**.
- At startup BMM reads the apps catalogue from GitHub (`raw.githubusercontent.com`), and checks the
  plugin catalogue if you installed plugins from it.
- Pages of the in‑app documentation can embed **YouTube** videos through `youtube‑nocookie.com`;
  Google/YouTube can then see your IP address and may store data under Google's policy.

These services see your IP address and ordinary request headers, under their own privacy policies.

### 4.5 BetterInstaller
During setup the installer contacts nothing, **except** to download:

- the **Laya offline model pack** (327 MB, from the project's GitHub release, with the
  BetterCommunity mirror as fallback) when *Laya offline* is ticked, **which it is by default**. The
  pack is refused unless it matches a pinned SHA‑256. The download carries nothing about you; GitHub
  sees your IP address, as for any download. Untick *Laya offline* (« Not now ») to skip it;
- an optional component you tick yourself (such as Python, from `python.org`).

When you open it again to repair, update or uninstall, it checks the same update manifests as §4.2.

What you choose in the installer is handed to BMM through a local file (`installer-handoff.json`)
that BMM reads once and renames; it is not sent anywhere. It now also carries a **receipt** for each
legal document you accepted (§9).

### 4.6 Proof of your Creator ID and the device fingerprint
When BMM has to **prove** its Creator ID to BetterCommunity, it signs a short, single‑use proof
(valid two minutes, bound to that site, with a random number so it cannot be reused). This happens
only when you **send a bug, crash or feedback report** (§7), when you **link a BetterCommunity
account** (§8.6), and **once per key while this install is linked to an account**.

That proof carries a **device fingerprint**: four one‑way hashes computed on your PC, of (1) the
motherboard, BIOS and processor identifiers, (2) the Windows installation identifiers, (3) the disk
identifiers, (4) a **canvas hash** (how your graphics card and drivers draw a fixed test image).

- **Only the hashes are sent.** Each is salted with the address of the site that receives it and
  iterated, so it cannot be matched with any other server's values.
- **Canvas fingerprinting is a tracking technique**, and we say so plainly. It is used for the one
  purpose below and changes when you update your graphics driver.
- **Purpose:** let BetterCommunity moderators see whether a new Creator ID comes from a computer that
  was banned or already used a free offer. A person looks at the match and decides; no rule acts on
  it automatically. Not used for analytics, advertising or profiling, and not shared.
- **Legal basis:** legitimate interest in preventing abuse and ban evasion (GDPR art. 6(1)(f); nLPD
  art. 31). The hashes identify a device, so your rights (§11) apply to them.
- **Retention:** each hash is deleted **180 days after it was last seen**.

---

## 5. Telemetry

Telemetry sends usage and diagnostic data to **BetterCommunity's telemetry server**
(`telemetry.bettercommunity.ch`, operated by the controller of §1). It is buffered on your disk (at
most 10 MB), compressed and sent over **HTTPS** every 90 seconds while the window is visible, when it
is hidden and when BMM closes. Each batch carries a random **packet id** so you can have it erased.

**Default: off.** Telemetry is **opt‑in**, and it is asked once:

- **In the installer's privacy step.** *Accept all* (or *Customize* with telemetry on) **is your
  consent**, given after the Privacy Policy was shown and accepted, with every category described on
  screen: BMM records it with a receipt (§9) and does not ask again. *Essential only*, or telemetry
  off under *Customize*, is a recorded refusal.
- **Installers that predate the privacy step** had a single box; ticking it was **not** consent: it
  only pre‑selects the answer on BMM's own consent screen, which still has to be accepted.
- **Without the installer**, telemetry is off until you answer BMM's consent screen. It has four
  answers, all buttons: **Turn all on** (the five categories of §5.0), **Choose** (a switch per
  category), **No thanks** (off, recorded) and **Later** (also Escape: records nothing, asks again at
  the next launch). A click beside the screen is not an answer.

Settings → Privacy turns it off at any time; when off, nothing in §5 is collected or sent, and the
local buffer is deleted. A `bmm://telemetry/…` link (which any web page can open) cannot change these
settings by itself: it opens BMM's consent screen, or a confirmation when it only turns something
off. A telemetry answer given through the local API, the command line or the MCP server is recorded
as such in your receipts.

If the consent text changes in a way that matters, or BMM finds telemetry on with no receipt proving
your consent (for example after an update from 1.0.x or an import of old settings), telemetry is
switched back to « not asked » and you are asked again.

### 5.0 Categories
One consent, five categories. Each can be switched off on its own, on the consent screen (*Choose*),
in the installer (*Customize*) and in Settings → Privacy.

| Category | What it covers |
|---|---|
| Usage statistics | Pages, dialogs, clicks, navigation path, session start and end (§5.1) |
| Performance | Frames per second, frame times, interface memory, page‑load timings (§5.1) |
| Errors sent live | Errors and crashes as they happen (§5.5), and the warning and error logs of §5.1 |
| Laya usage statistics | How Laya is used, without any content (§5.6) |
| Session replay | The masked recording of the BMM window (§5.2) |

The identity and system profile of §5.1 go with whichever category is on. Two options are **never**
part of *Turn all on* or *Accept all*: the weekly hardware report (§5.4) and unmasked replay (§5.2).

### 5.1 What is sent
- **Identity:** your Creator ID (§4.1) and a random per‑install id.
- **System profile:** operating system and version, CPU and core count, RAM, every GPU, motherboard,
  machine model and manufacturer, whether BMM runs in a virtual machine, your disks (size, mount
  point), your monitors (maker, model, year) and resolutions, BMM's version and interface language,
  and for each profile the **game name**, its number of mods and how its folders are spread across
  disks. **No IP address is part of the profile**, and BMM never asks a third‑party service what your
  address or location is.
- **Preferences and counts:** active theme, language, Tasky settings, the filesystem security mode,
  and how many mods, profiles, plugins, modpacks, tags, launch packs and apps you have (counts, not
  names).
- **Usage:** pages you open and how long you stay, your navigation path, dialogs you open (with their
  titles), session start and end.
- **Interactions:** the text of buttons you click, the **full address of external links** you open,
  the names of form fields you change (never their values), error messages.
- **Logs:** warnings and errors from the interface's console and, every 15 seconds, the warning and
  error lines of BMM's own log. **Log lines can contain file and folder paths**, which may include
  your Windows user name.
- **Performance:** frames per second, frame time, the worst frame, interface memory, page‑load
  timings.
- **Repositories:** when you connect to a Server Repo, its address, host and name; when you host one,
  the author name you enter.

### 5.2 Session replay
While telemetry and this category are on, BMM sends a **recording of the BMM window**: layout,
clicks, scrolling, navigation. **Text typed into fields is masked**, and so are elements marked as
names or paths. Other windows and the rest of your screen are never recorded. A separate **« full
(unmasked) »** mode exists for your own debugging: off unless you turn it on by hand in Settings →
Privacy, never by a `bmm://` link, never by *Accept all*.

### 5.3 What telemetry never sends
The contents of your mods, game files or other files; the values you type into fields (unless you
turn on unmasked replay); your name or e‑mail.

### 5.4 Weekly benchmark and detailed hardware report
**Off by default, everywhere, and asked separately.** When you turn it on *and* telemetry is on, BMM
runs a short benchmark once a week and sends its timings with a **detailed hardware report** of
**stable hardware identifiers**: motherboard model and serial number, BIOS version, date and vendor,
the machine UUID, CPU cache and thread details, each disk's model, serial number, size and interface,
the **MAC address of each physical network adapter**, OS build, UEFI or legacy boot, Secure Boot and
TPM state. **Neither the installer's *Accept all* nor BMM's *Turn all on* turns it on**: only its own
switch, under the installer's *Customize* or in BMM's Settings → Privacy, does.

### 5.5 Errors sent live
Within seconds of an error, while telemetry is on: JavaScript errors, crashes of the Rust side,
commands that failed with a real error, and failed deploys, installs, backups and scheduled tasks.
For each: the error message, where it happened in BMM's own code (function and file names), a
severity, how many times and when, the BMM version, the OS name and architecture, the telemetry
session id and, for a crash, the **file name** of the local crash report (never its content). Never
the arguments of a command, the contents of a file or anything you typed.

- **Removed on your PC before sending:** every secret BMM stores (tokens, passwords, keys,
  credentials in addresses), your Windows user‑folder name, e‑mail and IP addresses, your PC and
  account names. The server removes those shapes a second time.
- **Identity:** a **one‑way hash** of your Creator ID, not the Creator ID; a copy or erasure request
  for your Creator ID still reaches these reports.
- **How much:** the same error within 10 minutes only increases a counter; at most 60 new errors an
  hour; a waiting list of at most 200 lines kept on disk.
- **Who reads it:** the BMM team, in the telemetry dashboard. Each new group of errors is classified
  by **Laya**, the BetterCommunity classifier running on the same servers; the text is never sent to
  an outside AI provider.

### 5.6 Laya usage statistics
For each use of a Laya feature: **which feature** and **where it ran** (built into BMM, the
BetterCommunity server, your own Laya server, an external API, plain rules); **how long it took**
(rounded) and whether it answered or declined; for suggestions, **the names of the fields** suggested
and which you **kept or rejected**; for Ask Laya, **how many results** and the **kind** of result you
opened; the built‑in model being installed, removed or cancelled; an error as a **short code**.
**Never sent:** your question, any text Laya read or wrote, a suggestion's value, a mod, file or
profile name, a path or an error message.

### 5.7 Storage, location, retention, erasure
- **Where:** a server operated by the controller of §1. Reading the stored data needs an
  administrator key; the key built into BMM can only submit data and file erasure or access requests.
- **Your IP address is truncated, never stored whole:** before anything is stored, an address is cut
  to its network (`203.0.113.45` → `203.0.113.0`; the first three groups for IPv6). The exact address
  exists only in the server's memory for one request, as the key of the anti‑flood counter.
- **Location:** the truncated address is looked up with the third‑party service **ipwho.is**;
  country, region and city are stored, coordinates rounded to one decimal degree (about 11 km).
- **Retention:** everything is deleted automatically after **180 days** unless the administrator
  sets another value, including the stored networks, their locations and the live‑instance list.
- **Erasure per packet:** Settings → Privacy lists every packet sent; « Request deletion » erases it
  within 72 hours (at once if an administrator approves).
- **Erasure per person / a copy of your data:** a request tied to your Creator ID removes, or
  exports, everything held under it. A copy is sent back by e‑mail to the address you give.
- Export or clear BMM's local buffer at any time in Settings → Privacy.

---

## 6. Discord Rich Presence
When on, BMM tells the **Discord app running on your PC** what to show on your profile: the name of
your active BMM profile, the number of active mods, the BMM version with your **Creator ID**, and a
« Website » button whose link contains your Creator ID. Discord shows this to **anyone who can see
your profile**, under Discord's policy. Each update also re‑reads BMM's link list from GitHub.

**Default: off** in BMM; in the installer, *Accept all* turns it on (the card says so), *Essential
only* leaves it off, *Customize* lets you choose. Turn it off in Settings at any time. A
`bmm://discord/rpc` link only asks: nothing changes unless you confirm in BMM.

---

## 7. Bug, crash and feedback reports

### 7.1 Sending a report
A suggestion, bug report or crash report goes to the **BetterCommunity feedback centre**
(`bettercommunity.ch/api/feedback/bmm`) and nowhere else. **Nothing is sent until you press Send.**
Then BMM uploads:

- the title, description and steps you type, and screenshots you attach;
- a crash report `.zip` you select (§7.2);
- optionally the app log (`bmm_frontend.log`), pre‑ticked for bug and crash reports;
- optionally a **DxDiag report**, pre‑ticked for crash reports: a hardware and driver inventory that
  also contains machine and OS identifiers and your **Windows account name**;
- your **Creator ID** (with a signed proof carrying the hashed device fingerprint of §4.6), the app
  version, OS, language and user‑agent;
- the e‑mail or Discord name you type, if any, so staff can reply.

A small anti‑spam proof‑of‑work runs first; it sends no extra data. If the site cannot be reached,
the report is kept locally and retried after the next launch. Before sending, BMM checks the text
**on your PC** for secrets, paths with your user name, e‑mail and IP addresses and account names,
and offers to mask them (ticked by default). Once received, a report is held under the BetterCommunity
platform's terms.

### 7.2 What a crash report zip contains
When BMM crashes it writes a `.zip` **on your disk**: BMM's logs, a system‑info snapshot, the masked
session recording of §7.3 with the console and log output, and, for a report written at a normal
close, a **snapshot of BMM's data file** (profiles and settings, including addresses and folder
paths). **Secrets are redacted before the zip is written** (`[REDACTED: N chars]`). A crash zip does
not contain DxDiag. These files stay on your computer unless you send or share one yourself.

### 7.3 Local session recording
BMM keeps a masked recording of the current session **on your disk** (working segments in its data
folder, the latest session as `last_crash_session.bmmreplay`), so a crash report can show what
happened. The log and console output recorded with it are not masked. The **Session recorder**
(Settings → Debug & trouble) additionally keeps each session in a local list. **None of this is
uploaded** unless you send a report containing it, or telemetry's session replay (§5.2) is on.

---

## 8. Other features that contact a server when you use them

### 8.1 Server Repos
Connecting to or syncing from a Server Repo sends requests to that repo's server, which sees your
**IP address** and your **Creator ID**, so its owner can apply whitelists and bans. The repo owner,
not the BMM team, controls that server. A **download password** is sent with your requests for the
session and never written to disk. Repos that need an **identity key** receive a short‑lived signed
statement, never the key.

### 8.2 Hosting a Server Repo, publishing over SSH
If **you** host a repo, the people who connect expose **their** IP address and Creator ID to
**your** machine, and you become responsible for those logs. The public status feed
(`monitoring.json`) shows aggregates only. Publishing over SSH connects to the server **you**
configured; the key passphrase and passwords are read at the moment of use and never stored.

### 8.3 Documents you share carry your author id
Modpacks (`.bmp`), modpack catalogues (`.cbmp`), tutorials (`.bmmtut`) and automations you export are
**signed with your creator key**: anyone you share them with sees your Creator ID.

### 8.4 Downloads and catalogues you open
Downloading plugins, catalogue apps or themes and opening the community blog are ordinary HTTPS
requests: the host sees your IP address.

### 8.5 The local Plugin API
The Plugin API listens on `127.0.0.1` only. Its requests and your API token stay on your computer.

### 8.6 Linking a BetterCommunity account
Linking sends your **Creator ID** to `bettercommunity.ch`, with a signed proof and the hashed device
fingerprint (§4.6), to request a one‑time code, then checks whether the code has been entered. No
password or e‑mail is sent in this exchange.

### 8.7 BetterCommunity notifications (only with an API key)
If, and only if, you store a BetterCommunity **API key** (scoped to `notifications:read`), BMM's
native process asks `bettercommunity.ch/v1/notifications` for that account's notifications **every
ten minutes**. The key never enters the web view; it is **stored in clear** in BMM's data folder.
Remove it from the same screen and revoke it from your account page.

### 8.8 Auto-start and local files
Starting BMM with Windows (offered unticked by the installer) and everything BMM writes to your disk
send nothing.

### 8.9 Integrations you configure
Anything you set up yourself (a Discord webhook, a Cloudflare tunnel, a scheduled task that calls a
web address) sends data to that service, under its own terms.

### 8.10 Laya and optional AI
**Laya offline** runs the Laya classifier **on your PC**: the text of a mod or a report is read in
BMM's memory and **nothing is sent anywhere**. The model pack is downloaded once (§4.5). BMM switches
off the telemetry events of the ONNX Runtime library it uses (per Microsoft, a minimal start‑up event
may still be written to Windows' local event tracing, which Windows forwards only under your own
Windows diagnostic‑data settings). **Ask Laya** answers from what is already on your PC; the question
is never sent and not stored.

The **network providers are off by default**. Nothing leaves your PC unless you turn on Settings → AI
**and** choose a network provider, and then only when you click *Suggest*, *draft* or *AI hint*:

- **What is sent** for a mod: its name, author, description, readme or manifest excerpts, up to 40
  file names and your tag names, masked first, at most 4 000 characters; for a report hint, the
  masked report text. The dialog shows the exact text sent.
- **To whom:** *BetterCommunity* (with your Creator ID, its signed proof and, if stored, your API key,
  after you tick the consent box); *your own Laya server* (on this PC by default); or *an external
  API* you configure, under its own terms.
- Keys you enter for those providers are stored by the operating system (DPAPI, keychain).
- Turn AI off in Settings → AI, in the installer (« Not now »), with `--set=ai_features=false`, or for
  one session with `--no-ai` / `BMM_NO_AI=1`. *Remove the model* deletes the downloaded pack.

---

## 9. Proof of consent: your consent receipts

Every answer you give about these documents leaves a **receipt**: accepting the Terms of Service or
this Privacy Policy, and accepting, choosing, refusing or withdrawing telemetry (and live error
reports). A receipt records:

- the **document** (`tos`, `privacy`, `telemetry`, `crash_reports`) and its **version** (for the
  legal texts, a fingerprint of the English text in force; for telemetry, the version of the consent
  text);
- the **SHA‑256 of the exact text shown**, in the language you read it;
- the **language**, the **answer** (accepted, accepted in part, declined, withdrawn, asked again) and
  the per‑category choices;
- the **time**, the **source** (installer, first launch, asked again, Settings, a `bmm://` link, the
  local API, the command line, the MCP server, a data import), the **BMM version**;
- an **anonymous install id**: a random number made for the receipts, **not** derived from your
  hardware and **not** your Creator ID.

**On your PC** the receipts are kept in BMM's data folder (`consent-ledger.jsonl`) as an append‑only,
**tamper‑evident** chain: each receipt carries the hash of the one before it and a keyed seal, so an
edited, removed or inserted receipt is detected. Settings → Privacy → **My consents** lists them,
says whether the chain is intact, and exports them as JSON. They stay until you delete BMM's data
folder.

**What BMM does with them.** A setting that says « accepted » is not enough: BMM asks again whenever
there is no receipt for the version in force, for example after an update from a version that kept no
receipts, after importing old settings, or when the text of a document changes.

**On the server.** Receipts are sent to the telemetry server (`…/consents`) **only if telemetry is
on**, or when you press *Send to the server* in My consents. What is sent: the receipts above, keyed
by the anonymous install id; **no IP address is stored with them, and no text**, only hashes,
versions, answers and times. A refusal or withdrawal made while telemetry is off therefore stays on
your PC unless you send it yourself. The server recomputes each receipt's hash, refuses one that does
not match, and stores them **append‑only** (rows cannot be altered).

- **Why:** to be able to demonstrate which text you accepted or refused, and when (GDPR art. 7(1);
  legal basis art. 6(1)(c) and (f); nLPD art. 31).
- **Kept:** 3 years after a receipt is superseded by a newer answer, or after the install has sent
  nothing for that long (the operator can set another period); the receipt proving a consent still
  in force is kept while the install is active.
- **Erasure and access:** quote the install id shown in My consents (§11).

---

## 10. Data stored on your PC

Nothing in this list leaves your PC unless a section above says so.

| What | Where | Removed by |
|---|---|---|
| Profiles, mods, settings, catalogues (`data.json` and companions) | BMM's data folder | Delete BMM's data folder |
| Creator key store, pin and reset log | BMM's data folder, your user registry / keyring | Settings (reset), or delete them |
| Consent receipts (`consent-ledger.*`, `consent-install-id`) | BMM's data folder | Delete the folder |
| Telemetry buffer (at most 10 MB) | BMM's data folder | Settings → Privacy (clear), or turning telemetry off |
| Logs, crash reports, session recordings | BMM's data folder | Settings → Debug & trouble, or delete them |
| Interrupted update downloads (`updates/*.part`) | BMM's local app‑data folder | Deleted after use or on a failed check |
| Laya model pack | BMM's install folder (`models/laya`) or data folder | Settings → AI → *Remove the model* |
| Interface preferences | The WebView's local storage | Uninstall, or clear BMM's data |
| Stored API keys and provider keys | BMM's data folder (BetterCommunity key: in clear) / the OS key store | The screen where you entered them |

---

## 11. Your rights

Depending on where you live (GDPR in the EU/EEA, UK GDPR, the Swiss nLPD), you have the right to:

- **access** the data held about you and get a **copy** (portability);
- have it **corrected** or **erased**;
- **restrict** or **object** to processing based on legitimate interest;
- **withdraw consent** at any time, as easily as you gave it (Settings → Privacy), without affecting
  what was done before;
- **lodge a complaint** with a supervisory authority: in Switzerland the Federal Data Protection and
  Information Commissioner (FDPIC), in the EU the authority of your country of residence.

**How:** Settings → Privacy does most of it directly (export or clear the buffer, request erasure per
packet, request a copy tied to your Creator ID, view and export your consent receipts). For anything
else, write to the privacy contact of §1, quoting your Creator ID (telemetry, reports) or your
anonymous install id (consent receipts), or open an issue on
[GitHub](https://github.com/FreeProject089/BetterModsManager) **without** posting personal data
there. We answer within one month.

The startup requests of §4.1 and the connectivity checks of §4.3 cannot currently be turned off in
BMM; staying offline prevents them.

---

## 12. Changes to this policy

This policy changes when the app does; material changes are noted in the release notes. When its
text changes, BMM asks you to accept it again and keeps a receipt (§9). Earlier versions remain in
the repository's history.

**Version 2026-10-13 (BMM 1.0.2):** data‑flow inventory (§3); controller block (§1); the installer's
privacy step and what each answer does (§2, §5); the Laya model download during setup, ticked by
default (§4.5); Discord Rich Presence under *Accept all* (§6); update downloads (§4.2); flags from
flagcdn.com (§4.4); consent receipts and their server copy (§9); local data (§10); rights (§11);
« English prevails ».
