# Privacy Policy — Better Mods Manager (BMM)

_Last updated: 2026-09-30_

Better Mods Manager is an open-source desktop application (GPL‑3.0) that runs on your computer.
Your profiles, mods, modpacks, plugins and settings are stored **locally**, in BMM's data folder,
and you can export or delete them at any time. BMM shows no ads and needs no account.

Some data does leave your computer. This policy lists every case we know of, **what** is sent,
**to whom**, and whether it happens **by default** or only if you turn it on. The Terms of Service
do not repeat any of this: on questions about data, this document is the reference.

---

## 1. At a glance: what is on by default

| What | Default when you install with BetterInstaller | Default when BMM runs without the installer |
|---|---|---|
| Startup requests to BetterCommunity (§2.1) | On, always — **without your Creator ID** | On, always — **without your Creator ID** |
| Update check (§2.2) | On | On |
| Connectivity checks and web fonts (§2.3) | On, always | On, always |
| **Telemetry** (§3) | Off. The installer's box is **unticked**; ticking it only pre‑selects the answer in BMM's own consent screen, which still has to be accepted | Off until you answer the first‑run consent screen |
| Telemetry categories: usage, performance, errors sent live, Laya usage statistics, session replay (§3.0) | Off with telemetry. Ticking telemetry ticks them all; its *Choose* link unticks any of them | Part of *Turn all on* on the consent screen; *Choose* shows a switch for each |
| Weekly benchmark + detailed hardware report (§3.3) | **Off**, even when telemetry is ticked (its own box under *Choose*) | **Off**: not part of *Turn all on*, a separate switch under *Choose* |
| **Discord Rich Presence** (§4) | **Off**: the installer's box is unticked | Off |
| Bug, crash and feedback reports (§5) | Only when you press Send | Only when you press Send |
| **Optional AI** (§6.10) | **Off**: the installer's box is unticked; ticking it turns the switch on with **no provider**, so still nothing is sent | Off |

Every one of these can be turned off in BMM's settings (Settings → Privacy for telemetry and its
options, the Discord and update toggles in Settings). Everything that sends data off this PC is
**opt‑in**: the BetterInstaller Configuration page shows each box unticked, with a description and a
"Sends data" mark, before anything is installed, and ticking the telemetry box there is a
pre‑selection — BMM still asks on its own consent screen, and collection starts only if you accept
it there.

---

## 2. What happens whatever your telemetry choice

### 2.1 Startup configuration, with your Creator ID
Each time BMM starts it downloads its list of links (`links.json`) and the contributors list from
`bettercommunity.ch`, falling back to the copies on GitHub. **These two startup downloads no longer
carry your Creator ID.** They are fetched anonymously — no `X-Creator-ID` header, no key proof — so
what BetterCommunity receives at launch is an ordinary web request for two public files: its server
sees your IP address, as any web server does, and nothing that identifies this installation.

Other requests BMM's native side makes to a bettercommunity.ch address **do** carry your Creator ID
in an `X-Creator-ID` header — fetching a catalogue or a repository, where the id is what gates access
to private content, and the feedback, report and account features you start yourself. Those happen
when you use the feature, not at every launch.

**What the Creator ID is.** It is the public half of an Ed25519 key pair BMM creates on first launch.
The key is **derived from identifiers of this PC** (Windows MachineGuid, product ID and install date;
motherboard, BIOS, CPU and disk serial numbers; the C: volume serial) through a one‑way key
derivation. Since **Creator key v5** it is kept, with the rest of the key material, in a store
encrypted by Windows (DPAPI, tied to your Windows account) in BMM's data folder and your user
registry; the older unencrypted copies are deleted once the encrypted one is verified. On macOS and
Linux the store is encrypted under a key kept in the system keyring (Keychain, Secret Service); with
no keyring available it is a file only your account can read, and Settings says which one applies.
Since **v5.1** the Creator ID is also **pinned** (a small `creator_v5.pin` file and a registry /
keyring entry, holding only public values): a store copied from another machine, an older backup or
an edited store is refused instead of silently replacing your identity. A reset, which you start
yourself in Settings, sets the old store aside and is noted in a local `creator_v5.log` (date and
Creator IDs only; it never leaves your computer). Consequences:

- it contains no name or e‑mail, and the identifiers it was derived from cannot be read back out of it;
- it is **stable**: the same PC gets the same Creator ID, even after BMM is reinstalled, so
  everything sent under it is **linkable to this machine over time**;
- it signs what you publish (repos, modpacks, tutorials), so it is also visible to anyone who
  receives those (§6.3).

Upgrading to v5 does **not** change your Creator ID. It adds a second, random key that signs the
proofs BMM gives BetterCommunity, and those proofs can carry a hashed device fingerprint (§2.4).
The startup requests above carry the Creator ID only, as before: no proof and no fingerprint.

### 2.2 Update checks
About three seconds after launch BMM asks GitHub's releases API
(`api.github.com/repos/FreeProject089/BetterModsManager/releases`) for a newer version, with
`bettercommunity.ch/api/updates/bmm` as a fallback. If BMM was installed with BetterInstaller it
also asks the installer, which reads the update manifests on GitHub and `bettercommunity.ch`. These
hosts see your IP address and a user‑agent naming the program. Turn automatic checks off in
Settings.

BetterInstaller itself contacts nothing while installing, except to download an optional
component you tick (such as Python, from `python.org`). When you open it again to repair, update or
uninstall, it checks the same update manifests.

### 2.3 Connectivity checks, fonts and catalogues
- Every two minutes BMM checks whether it is online by requesting
  `www.gstatic.com/generate_204` (Google) and `cloudflare.com/cdn-cgi/trace` (Cloudflare).
- The interface loads its fonts from Google Fonts.
- At startup it reads the apps catalogue from GitHub (`raw.githubusercontent.com`), and checks the
  plugin catalogue if you installed plugins from it.

These services see your IP address and ordinary request headers, under their own privacy policies.

### 2.4 Creator key v5: the proof and the device fingerprint
When BMM has to **prove** its Creator ID to BetterCommunity, it signs a short, single‑use proof
(valid two minutes, bound to that site, with a random number so it cannot be reused). This happens
only when you **send a bug, crash or feedback report** (§5.1), when you **link a BetterCommunity
account** (§6.6), and **once per key while this install is linked to an account**. Nothing is sent
for an install that is not linked and sends no report.

That proof carries a **device fingerprint**: four one‑way hashes computed on your PC, of

1. the motherboard, BIOS and processor identifiers,
2. the Windows installation identifiers (MachineGuid, product ID, install date),
3. the disk identifiers,
4. a **canvas hash**: how your graphics card and drivers draw a fixed test image in BMM's window.

- **What is sent is only the hashes.** No serial number, GUID or picture leaves your PC. Each hash
  is salted with the address of the site that receives it, so BetterCommunity's values cannot be
  matched with those of any other server, and each is iterated to make guessing the inputs costly.
- **Canvas fingerprinting is a tracking technique**, and we say so plainly. It is used for the one
  purpose below and changes when you update your graphics driver.
- **Purpose:** to let BetterCommunity moderators see whether a new Creator ID comes from the same
  computer as one that was banned or that already used a free offer. A person looks at the match
  and decides; no rule acts on it automatically. It is not used for analytics, advertising or
  profiling, and it is not shared.
- **Legal basis:** legitimate interest in preventing abuse of free offers and evasion of bans
  (art. 6(1)(f) GDPR; art. 31 of the Swiss nLPD). The hashes identify a device, so they are
  personal data, and your rights (access, erasure, objection; §8) apply to them.
- **Retention:** each hash is deleted by BetterCommunity **180 days after it was last seen**. The
  record of which key speaks for a Creator ID is kept while the ID is in use.

---

## 3. Telemetry

Telemetry sends usage and diagnostic data to **BetterCommunity's telemetry server**
(`telemetry.bettercommunity.ch`, run by the BMM team). It is buffered on your disk (at most 10 MB),
compressed and sent over **HTTPS** every 90 seconds while the window is visible, when it is hidden
and when BMM closes. Each batch carries a random **packet id** so you can have it erased (§3.5).

**Default: off.** Telemetry is **opt‑in**, and it is asked for in BMM, not in the installer:

- **If you install with BetterInstaller**, its telemetry box is **unticked**. Leaving it alone means
  nothing is ever collected and BMM does not ask again. **Ticking it is not consent** — it only
  **pre‑selects the answer** on BMM's own first‑run consent screen, which lists what is collected;
  nothing is collected unless you accept there. (Explicitly *unticking* it is recorded as a refusal,
  so the consent screen does not ask you a second time.)
- **If you install without the installer**, telemetry is off until you answer that same screen.

The consent screen has four answers, all of them buttons: **Turn all on** (recommended: the five
categories of §3.0), **Choose** (a switch per category, then *Save*), **No thanks** (off, recorded)
and **Later** (also the Escape key): *Later* records nothing, starts nothing, and the screen comes
back at the next launch. A click beside the screen is not an answer and changes nothing.

Settings → Privacy turns it off at any time; when off, none of §3 is collected or sent.

A `bmm://telemetry/…` link (which any web page can open) cannot change these settings by itself: it
opens BMM's consent screen, or a confirmation when it only turns something off, and nothing changes
unless you accept there.

### 3.0 Categories
Telemetry is one consent and five categories under it. Each can be switched off on its own, on the
consent screen (*Choose*) and in Settings → Privacy; *Turn all on* turns the five on.

| Category | What it covers |
|---|---|
| Usage statistics | Pages, dialogs, clicks, navigation path, session start and end (§3.1 *Usage*, *Interactions*) |
| Performance | Frames per second, frame times, interface memory, page‑load timings (§3.1 *Performance*) |
| Errors sent live | Errors and crashes as they happen (§3.6), and the warning and error logs of §3.1 |
| Laya usage statistics | How Laya is used, without any content (§3.7) |
| Session replay | The masked recording of the BMM window (§3.2) |

The identity and system profile of §3.1 go with whichever category is on: they are what makes the
others readable. Two options are never part of *Turn all on*: the weekly hardware report (§3.3) and
unmasked replay (§3.2).

### 3.1 What is sent
- **Identity:** your Creator ID (§2.1) and a random per‑install id.
- **System profile:** operating system and version, CPU and core count, RAM, every GPU, motherboard,
  machine model and manufacturer, whether BMM runs in a virtual machine, your disks (size, and where
  they are mounted), your monitors (maker, model, year) and screen resolutions, your **local network
  IP address** and your **public IP address** (which BMM obtains by asking `api.ipify.org`), BMM's
  version and interface language, and for each of your profiles the **game name**, its number of
  mods and how its folders are spread across disks. (What the server *keeps* of those two addresses
  is less than what BMM sends: the local one is discarded on arrival and the public one is truncated
  to its network before it is stored — see §3.5.)
- **Preferences and counts:** active theme (id, name, built‑in or custom), language, Tasky
  settings, the filesystem security mode, and how many mods, profiles, plugins, modpacks, tags,
  launch packs and apps you have (counts, not their names).
- **Usage:** the pages you open and how long you stay, your navigation path, the dialogs you open
  (with their titles), session start and end.
- **Interactions:** the text of buttons you click, the **full address of external links** you
  open, the names of form fields you change (never their values), and error messages.
- **Logs:** warnings and errors from the interface's console, and every 15 seconds the warning and
  error lines of BMM's own log. **Log lines can contain file and folder paths**, such as a mod
  folder, which may include your Windows user name.
- **Performance:** frames per second, frame time, the worst frame, memory used by the interface,
  and page‑load timings.
- **Repositories:** when you connect to a Server Repo, its address, host and name; when you host
  one, the author name you enter.

### 3.2 Session replay
While telemetry is on, BMM also sends a **recording of the BMM window**: its layout, clicks,
scrolling and navigation. **Text typed into input fields is masked**, and so are elements marked
as names or paths. Other windows and the rest of your screen are never recorded.

- **Default:** on **while telemetry is on**, as one of its categories (§3.0); telemetry is off
  unless you accepted it (§3), so by itself this sends nothing. In BetterInstaller it is the
  "Session replay (masked)" box under the telemetry box's *Choose* link; in BMM it is a switch of
  Settings → Privacy and of the consent screen's *Choose*.
- A separate **"full (unmasked)"** mode exists for your own debugging. It is off unless you turn it
  on; when on, typed text is not masked and local images shown in the window are embedded in the
  recording. It can only be turned on by hand in Settings → Privacy (or the consent screen you open
  yourself), never by a `bmm://` link.

### 3.3 Weekly benchmark and detailed hardware report
**Off by default, and asked about separately.** When you turn it on *and* telemetry is on, BMM runs
a short internal benchmark once a week (and when telemetry is first turned on) and sends its
timings. With it, BMM sends a **detailed hardware report** made of
**stable hardware identifiers**: motherboard model and serial number, BIOS version, date and
vendor, the machine UUID, CPU cache and thread details, each disk's model, serial number, size and
interface, the **MAC address of each physical network adapter**, OS build, UEFI or legacy boot,
Secure Boot and TPM state.

- **Default: off**, everywhere and on its own. BetterInstaller asks about it as a separate
  "Weekly hardware report" box under the telemetry box's *Choose* link, unticked even when
  telemetry is ticked; in BMM it is the "Weekly hardware report" switch in Settings → Privacy and
  under the consent screen's *Choose*, also off. **Accepting telemetry, even with *Turn all on*,
  does not turn it on**: the hardware identifiers above are collected only if you tick this one
  yourself.

### 3.4 What is never sent by telemetry
The contents of your mods, game files or other files; the values you type into fields (unless you
turn on the unmasked replay mode in §3.2); your name or e‑mail.

### 3.5 Storage, location, erasure
- **Where:** a server operated by the BMM team. Reading the stored data needs an administrator
  key; the key built into BMM can only submit data and file erasure or access requests.
- **A copy of your data:** the Privacy panel can file a request for everything tied to your
  Creator ID. You give an e‑mail address, which is sent with the request; an administrator reviews
  it and sends the export back by e‑mail.
- **Your IP address and location — truncated, never stored whole:** the server sees the address a
  batch comes from, and BMM also reports its own public address (§3.1). **Neither is written down in
  full.** Before anything is stored, an address is cut down to the network it belongs to: the first
  three numbers for IPv4 (`203.0.113.45` → `203.0.113.0`) and the first three groups for IPv6. That
  is what goes into the database, into the location lookup, into the live list and into the
  administrator activity log. The exact address exists only in the server's memory for the length of
  one request, as the key of the anti‑flood counter, and is never stored, logged or exported. **The
  local network address BMM used to report about itself is no longer stored at all** — it is dropped
  on arrival.
- **Location:** the truncated address is looked up with the third‑party service **ipwho.is**, and
  the country, region and city are stored. The coordinates are **rounded to one decimal degree
  (about 11 km)** before being stored, so what is kept is a city, not a place. IP geolocation finds
  the network you connect through, not your home.
- **Retention:** everything is deleted automatically after the retention period, **180 days** unless
  the administrator sets another value: usage events, benchmarks and session replays, **and also the
  stored networks, their locations and the "live instance" list** — those three used to be kept
  indefinitely and are now purged in the same pass.
- **Erasure per packet:** the Privacy panel lists every packet BMM has sent (id, time, which event
  types and how many). "Request deletion" erases that packet's events, benchmarks and replays after
  a review delay of at most 72 hours, or at once if an administrator approves it; a declined
  request can be made again. If that packet was the last data held about your installation, the
  erasure **also removes the stored network, its location and the live entry** for it.
- **Erasure per person:** a deletion request tied to your Creator ID removes your events,
  benchmarks and replays and, in the same pass, the network, the live entry and the cached location
  (the location only once no other installation is still seen on that same network).
- You can export or clear BMM's local buffer at any time in the Privacy panel.
- The server limits how many batches one address may send per minute.

### 3.6 Errors sent live
The **"Errors sent live"** category (Settings → Privacy, the consent screen's *Choose*, and a box
under the installer's telemetry box) sends a short report within seconds when BMM hits an error.
It works **only while telemetry is on**; turning telemetry off stops it and deletes the reports
still waiting on your PC. The same switch also covers the warning and error logs of §3.1.

- **Default:** **on with telemetry**. Accepting telemetry (with *Turn all on*, or by switching
  telemetry on in Settings → Privacy) turns it on; *Choose* lets you leave it off, and Settings →
  Privacy turns it off on its own at any time. Switching telemetry back on after turning it off
  turns it on again.
- **What is sent:** JavaScript errors, crashes of the Rust side, commands that failed with a real
  error (not a cancel, not being offline, not a message already shown to you), and failed
  deploys, installs, backups and scheduled tasks. For each: the error message, where it happened in
  BMM's own code (function and file names, no line numbers), a severity, how many times and when
  (first and last), the BMM version, the OS name and architecture, the telemetry session id and,
  for a crash, the **file name** of the local crash report (never its content). Never the
  arguments of a command, the contents of a file or anything you typed.
- **Removed on your PC before sending:** every secret BMM stores (the same pass as crash reports:
  tokens, passwords, keys, your BetterCommunity API key, credentials in addresses), your Windows
  user‑folder name, e‑mail addresses, IP addresses and your PC and account names. The server
  removes those shapes a second time on arrival.
- **Identity:** each report carries a **one‑way hash** of your Creator ID, not the Creator ID. The
  dashboard cannot match it to your other telemetry, but a copy or erasure request for your
  Creator ID still reaches these reports (the server computes the same hash).
- **How much:** the same error within 10 minutes only increases a counter; at most 60 new errors an
  hour; a waiting list of at most 200 lines, kept on disk so an offline PC sends it later.
- **Who reads it:** the BMM team, in the "Issues" screen of the telemetry dashboard. Each new
  group of errors is classified by **Laya**, the BetterCommunity classifier running on the same
  servers (category, severity, "your setup or a BMM bug"); the text is never sent to an outside AI
  provider. Same retention as the rest of telemetry (§3.5).

### 3.7 Laya usage statistics
A category of its own (§3.0), on with *Turn all on*. It tells the team whether Laya (§6.10) helps,
without sending anything Laya read or wrote. For each use of a Laya feature BMM sends:

- **which feature** (mod suggestions, description draft, Ask Laya, smart search, report triage, a
  connection test) and **where it ran**: built into BMM, the BetterCommunity server, your own Laya
  server, an external API, or plain rules;
- **how long it took** (rounded to 10 ms, and a range such as "1 to 3 s"), whether it answered, and
  whether it **declined to answer** (nothing confident enough);
- for suggestions, **the names of the fields** suggested (tags, category, author…) and, when you
  apply, which fields you **kept or rejected**;
- for Ask Laya, **how many results** it found, whether they were low‑confidence, and when you open
  one, **what kind** of result it was (a mod, a page, a setting…);
- the built‑in model being **installed, removed or cancelled**, and whether that worked;
- an error as a **short code** (`timeout`, `no_model`…), never its message.

**Never sent:** your question, the text Laya read or wrote, a suggestion's value, a mod, file or
profile name, an id, a path or an error message. It goes to the telemetry server with the rest of
telemetry, under the same retention and erasure (§3.5).

---

## 4. Discord Rich Presence
When on, BMM tells the **Discord app running on your PC** what to show on your profile: the name
of your active BMM profile, the number of active mods, the BMM version with your **Creator ID**, and
a "Website" button whose link contains your Creator ID. Discord displays this to **anyone who can
see your profile**, under Discord's own privacy policy. Each update also re‑reads BMM's link list
from GitHub.

**Default: off**, both in BMM and in BetterInstaller, whose box is now **unticked** — installing
with it changes nothing here unless you tick it yourself.
Turn it on or off in Settings. A `bmm://discord/rpc` link (which any web page can open) only asks: BMM
says what will become visible, and nothing changes unless you confirm in BMM.

---

## 5. Bug, crash and feedback reports

### 5.1 Sending a report
A suggestion, bug report or crash report goes to the **BetterCommunity feedback centre**
(`bettercommunity.ch/api/feedback/bmm`), and nowhere else: the BetaHub forms that used to be the
fallback were removed on 25 September 2026, so an app configured with an empty feedback endpoint
sends no report at all. **Nothing is sent until you press Send.** Then BMM
uploads:

- the title, description and reproduction steps you type, and any screenshots you attach;
- any crash report `.zip` you select (see §5.2 for its contents);
- optionally the app log (`bmm_frontend.log`), pre‑ticked for bug and crash reports;
- optionally a **DxDiag report**, pre‑ticked for crash reports: a full hardware and driver inventory
  that also contains machine and OS identifiers and your **Windows account name**;
- your **Creator ID** (with a signed proof of it, which carries the hashed device fingerprint of
  §2.4), the app version, OS, language and user‑agent;
- the e‑mail or Discord name you type, if any, so staff can reply. With a linked BetterCommunity
  account the report opens a thread in your dashboard instead.

A small anti‑spam proof‑of‑work runs before sending; it sends no extra data. If the site cannot be
reached, the report is kept locally and retried 15 seconds after the next launch, and nowhere else.
BMM keeps a local list of your last 50 submissions (with a list of each report's significant words,
used only to tell you, on this PC, that you already sent a similar one). Once received, a report is
held under the BetterCommunity platform's terms.

Before a report is sent, BMM checks its text **on your PC**: it finds secrets, folder paths with
your user name, e‑mail and IP addresses and your Windows account and PC names, shows you how many
it found and offers to mask them (ticked by default), and points out a similar report you sent in
the last 30 days. None of this sends anything. Only if you turned on the optional AI (§6.10) and
click *Get an AI hint* is the **already masked** text sent to the provider you chose, for a
category / severity hint; the report itself still goes only when you press Send.

### 5.2 What a crash report zip contains
When BMM crashes it writes a report `.zip` **on your disk**. It contains BMM's logs, a system‑info
snapshot, and the masked session recording of §5.3 together with the console and log output; a
report written when BMM closes normally also holds a **snapshot of BMM's data file** (your profiles
and settings, including your mods' and repositories' addresses and your folder paths, which may
include your Windows user name). **Secrets are redacted before the zip is written**: the GitHub
access token, the local API token, plugin tokens, the scheduler key, and any other value kept under
a token, password, key, secret, auth, cookie or webhook field, as well as passwords inside
addresses, appear as `[REDACTED: N chars]` (the length only, no part of the value). Reports written
by older versions are cleaned the same way the next time BMM starts. A crash zip **does not contain
DxDiag**: it is attached to a report only when you tick its box (§5.1). These files stay on your
computer unless you send or share one yourself; open the zip first if you want to see exactly what
it holds.

### 5.3 Local session recording
BMM always keeps a recording of the current session (masked like §3.2) **on your disk**: working
segments in its data folder, and the latest session saved as `last_crash_session.bmmreplay` about
every 45 seconds, so a crash report can show what happened just before. The BMM log and console
output recorded with it are not masked. Turning on the **Session recorder** (Settings → Debug &
trouble) additionally keeps each session in a local replay list. **None of this is uploaded** unless
you send a crash report containing it (§5.1), or unless telemetry's replay (§3.2) is on, which is a
separate recording. A `bmm://recorder/set` link asks in BMM before changing the recorder, and can
never switch it to unmasked.

---

## 6. Other features that contact a server when you use them

### 6.1 Server Repos
Connecting to or syncing from a Server Repo sends requests to that repo's server, which sees your
**IP address** and your **Creator ID**, so its owner can apply whitelists and bans and see
connection statistics. The repo owner, not the BMM team, controls that server. Repos that need a
**download password** receive it with your requests for the session; BMM never writes it to disk.
Repos and catalogues that need an **identity key** receive a short‑lived signed statement, never the
key; BMM stores only the path to your key file, and which key answers which server.

### 6.2 Hosting a Server Repo, publishing over SSH
If **you** host a repo, the people who connect expose **their** IP address and Creator ID to
**your** machine, and you become responsible for those logs. The repo's public status feed
(`monitoring.json`, readable without a password) shows **aggregates only**: how many downloads are
running, the bytes sent and each running file's progress, never an IP address or a Creator ID. Who
is downloading is shown only to you, in BMM's own screen (or, for a standalone server, on its
dashboard behind the admin password). Publishing over SSH connects to the
server **you** configured; host, port, user, remote folder and your private‑key **path** are saved
locally, while the key passphrase and any password are read at the moment of use and never stored.
The server's fingerprint is recorded on first connection so a changed server is refused.

### 6.3 Documents you share carry your author id
Modpacks (`.bmp`), modpack catalogues (`.cbmp`) and tutorials (`.bmmtut`) you export are **signed
with your creator key**. Anyone you share the file with can see your author id (your Creator ID)
and check the file was not modified.

### 6.4 Downloads and catalogues you open
Downloading plugins, catalogue apps or themes, opening the community blog, and icons shown from
the jsDelivr and Simple Icons services are ordinary HTTPS requests: the host sees your IP address.

### 6.5 YouTube videos in the documentation
Pages of the in‑app documentation can embed YouTube videos, loaded through the
`youtube‑nocookie.com` embed when you open such a page online. Google/YouTube can see your IP
address and may store data under **Google's** privacy policy.

### 6.6 Linking a BetterCommunity account
Linking sends your **Creator ID** to `bettercommunity.ch`, with a signed proof of it and the
hashed device fingerprint (§2.4), to request a one‑time code, then checks whether the code has been
entered. While the install stays linked, BMM sends one more proof each time its key changes, so the
site knows which key speaks for your Creator ID. BMM sends no password or e‑mail in this exchange.

### 6.7 BetterCommunity notifications (only with an API key)
If, and only if, you store a BetterCommunity **API key** in Settings → Identity & API, BMM asks
`bettercommunity.ch/v1/notifications` for that account's notifications **every ten minutes**
while it is open.

- **The key never enters the web view.** It is stored in BMM's data folder and read only by BMM's
  native process, which makes the request. The interface can save one, ask whether one exists and
  delete it; it cannot read it back.
- **It is scoped** to `notifications:read`: it can read your notifications and nothing else.
- **It is stored in clear on disk.** Anyone who can read your data folder can read it. Remove it
  from the same screen, and revoke it from your account page on the website.

No key stored, no request.

### 6.8 The local Plugin API
The Plugin API (see the Terms of Service) listens on `127.0.0.1` only. Its requests and your API
token stay on your computer; they are not sent to the BMM team.

### 6.9 Integrations you configure
Anything you set up yourself (a Discord webhook, a Cloudflare tunnel, …) sends data to that service,
under its own terms.

### 6.10 Optional AI (Laya)
**Laya built in (offline)** — the installer's *Laya offline (local AI, nothing sent)* option, ticked
by default — runs the Laya classifier **on your PC**: the text of a mod or a report is read in
BMM's memory and **nothing is sent anywhere**, to BetterCommunity or anyone else. Installing it
downloads a model pack once (from BMM's GitHub release, or the BetterCommunity mirror), checked
against a pinned SHA‑256; that download carries nothing about you. BMM switches off the telemetry
events of the ONNX Runtime library it uses (Microsoft's builds emit Windows event‑tracing events by
default; per Microsoft, a minimal start‑up event may still be written to Windows' local event
tracing, which Windows only forwards under your own Windows diagnostic‑data settings).

**Ask Laya** (the palette's *Ask Laya*, the docs hub, the library's *smart search*) answers from
what is already on your PC: BMM's bundled documentation, the Settings screen, your mods' names,
descriptions, tags and scanned file lists, and your profiles. The question is **never sent**
anywhere and **not stored** (no history). The search itself runs even with AI off; the built-in
model only ranks the results when the master switch is on and the model is installed.

The other providers are **off by default**. The mod-detail *Suggest details* action always reads
the mod's own files on your PC first; nothing leaves it unless you turn on Settings → AI **and**
choose a network provider, and then only when you click *Suggest*, *ask for a description draft*
or *Get an AI hint*:

- **What is sent** for a mod: its name, author, description, excerpts of its readme or manifest,
  up to 40 file names and the names of your tags, after BMM masks user names in paths, e‑mail and
  IP addresses; at most 4 000 characters. For a report hint: the report text, after masking.
  The dialog shows the exact text sent.
- **To whom**: *BetterCommunity* — `bettercommunity.ch`, with your Creator ID, its signed proof
  (§2.4) and, if you stored one, your BetterCommunity API key, only after you tick the consent box;
  processed there by the Laya classifier. *Your own Laya server* — the address you enter, on this PC
  by default (another machine needs an explicit tick). *An external API* you configure (for
  description drafts only) — that service, with your key, under its own terms.
- **Keys** you enter for your Laya server or external API are stored by the operating system
  (Windows DPAPI, the macOS/Linux keychain) and never sent anywhere else; without either, they are
  kept for the session only.
- **Nothing is written** to a mod until you tick a suggestion and click Apply.
- Turn it off in Settings → AI, with the installer's *Laya offline* box (or
  `--set=ai_features=false`), or for one session with `--no-ai` / `BMM_NO_AI=1`. With the switch off,
  BMM makes no AI request and runs no model at all. Settings → AI → *Remove the model* deletes a
  downloaded model pack.

---

## 7. Summary

| Action | Leaves your PC? | What is sent | To whom |
|---|---|---|---|
| Browsing and managing mods, profiles, modpacks | No | — | — |
| Every launch (links, contributors) | Yes, always | IP address only — **no Creator ID** (§2.1) | bettercommunity.ch (GitHub as fallback) |
| Update check | Yes, by default | IP address, program user‑agent | GitHub, bettercommunity.ch |
| Connectivity checks, fonts, apps catalogue | Yes, always | IP address | Google, Cloudflare, GitHub |
| **Telemetry** (**off** unless you accept it in BMM) | Yes | Creator ID, system profile with public and local IP, usage, clicked button text, external link addresses, logs, performance, game names, repo addresses — the server keeps the public address truncated to its network and discards the local one | BetterCommunity telemetry server; your IP to ipify.org, your truncated network to ipwho.is |
| Session replay (a telemetry category, on with telemetry unless switched off) | Yes | Masked recording of the BMM window | BetterCommunity telemetry server |
| Laya usage statistics (a telemetry category, on with telemetry unless switched off) | Yes | Feature, where it ran, duration, fields suggested and kept or rejected, result counts, error codes; never any text (§3.7) | BetterCommunity telemetry server |
| Weekly benchmark + hardware report (**off**, its own question, not in *Turn all on*) | Yes | Benchmark timings, hardware serial numbers, machine UUID, MAC addresses | BetterCommunity telemetry server |
| Errors sent live (a telemetry category, **on with telemetry** unless switched off) | Yes, within seconds | Error message and code location with secrets, folder names, e‑mails and IPs removed, BMM version, OS, a one‑way hash of the Creator ID | BetterCommunity telemetry server (classified by Laya on the same servers) |
| **Discord Rich Presence** (**off** by default, in BMM and in the installer) | Yes | Profile name, active mod count, Creator ID | Discord, shown on your profile |
| Connect or sync a Server Repo | Yes | IP address, Creator ID | That repo's owner |
| Host a Server Repo | Yes (incoming) | Visitors' IP and Creator ID, stored on your PC | You |
| Send a suggestion, bug or crash report | Yes, when you press Send | What you type, your attachments (the crash zip holds logs and, for a normal-close report, a snapshot of your settings with tokens and passwords redacted; DxDiag, with your Windows account name, only if you tick it), Creator ID with signed proof and hashed device fingerprint (§2.4), app and OS details | BetterCommunity feedback centre |
| Link a BetterCommunity account (and once per key while linked) | Yes | Creator ID, signed proof, hashed device fingerprint (§2.4) | bettercommunity.ch |
| BetterCommunity notifications (only with a stored API key) | Yes, every 10 min | The API key, scoped to `notifications:read` | bettercommunity.ch |
| Optional AI — *Suggest* / *draft* / *AI hint* (**off** by default; only when you click) | Yes | A mod's name, author, description, readme excerpts, file names and your tag names, or a report's text — masked first (§6.10) | The provider you chose: bettercommunity.ch (with Creator ID and proof), your own Laya server, or your external API |

---

## 8. Your choices and contact

- Telemetry, the weekly hardware report and Discord Rich Presence are **off unless you turn them
  on**: the installer's boxes start unticked, and ticking the telemetry one only pre‑selects the
  answer on BMM's consent screen. Each telemetry category (§3.0) can be switched off on its own, in
  the installer (*Choose*), on the consent screen (*Choose*) or in Settings → Privacy; turn any of
  them on or off later in Settings; turn off automatic update checks in Settings.
- Export or clear the local telemetry buffer, request erasure per packet, or request a copy of
  your data (§3.5).
- The startup requests of §2.1 and §2.3 cannot currently be turned off in BMM; staying offline
  prevents them.
- We never sell your data, and it is not used for advertising.

For any other request about your data (access, erasure, a question),
open an issue on the GitHub repository:
[BetterModsManager](https://github.com/FreeProject089/BetterModsManager)

> This policy changes when the app does. Material changes are noted in the release notes.
