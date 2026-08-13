# Privacy Policy — Better Mod Manager (BMM)

_Last updated: 2026-06_

Better Mod Manager is a **local-first, open-source** desktop application (licensed under GPL‑3.0).
It runs on your machine and, by default, does **not** track you or show ads. BMM includes an
**optional telemetry** feature that is **OFF in the application until you turn it on** — with one
exception: the BetterInstaller Configuration page ships it pre‑ticked, visible and uncheckable
there. This document explains the cases where data leaves your computer, and exactly what is
sent.

---

## 1. What we do NOT do

- **No tracking without consent.** Telemetry is **off by default** in BMM itself: nothing is
  collected or sent until you enable it on the first‑run consent screen (or later in
  Settings → Privacy). **One exception, stated plainly:** when you install through
  BetterInstaller, the Configuration page shows the telemetry checkbox **already ticked**. It is
  visible and you can untick it there before installing — but if you click through that page
  without reading it, telemetry ends up on. Settings → Privacy turns it off at any time.
- **No account required.** You do not need to sign in to use BMM.
- **We never sell your personal data.** Your data is not the product and is never sold or shared
  for advertising. (This is about your data — it is not a statement about BMM's products or any
  paid services that may exist now or in the future.)
- **No file or mod contents, ever.** We never read or send the contents of your mods, files, or
  what you type into inputs.

All your data — profiles, mods, modpacks, plugins, settings — is stored **locally** on your disk
(in BMM's data folder). You can export or delete it at any time.

---

## 2. Optional telemetry (opt‑in)

If — and only if — you turn on telemetry, BMM sends **anonymous, aggregated usage data** to a
self‑hosted BMM dashboard to help the team improve the app. It is buffered locally and sent in
batches over **HTTPS**; each batch is tagged with a random **packet id** so you can later have it
erased (see §2.4).

### 2.1 What is collected (when enabled)
- **Pseudonymous identity — your Creator ID.** This is **not a random hash.** Your Creator ID is the
  **public half of an Ed25519 cryptographic key pair** that BMM generates **once, on your machine**
  (the matching **private key never leaves your PC** — it is stored in your user registry and sealed
  to this machine, so copying it elsewhere is rejected). The Creator ID is shown as a 64‑character
  hex string and is used to **cryptographically sign** the repos you publish, so others can verify
  authorship and apply whitelists/bans. Two consequences for privacy: **(a)** it does **not** contain
  your name, email, or any personal detail — it is a public key, not an identity document; but
  **(b)** because it is **stable** (it does not rotate), telemetry sent under the same Creator ID over
  time is **linkable to the same install**. If you have no key yet, a random per‑install id is used
  instead. You can see your Creator ID anytime in BMM.
- **System profile (DxDiag‑style):** OS, CPU, GPU(s), RAM, disk count/size, whether you run in a
  VM, motherboard, locale. Hardware/diagnostic info only.
- **App usage:** which pages/views you open, which features you use, which **modals** you open,
  tutorials started, session length and navigation path.
- **Performance:** frames‑per‑second, frame time, worst frame (jank), JavaScript heap (memory),
  and Web‑Vitals (load timings) of the in‑app interface.
- **Benchmarks:** timing of BMM's internal benchmark, including per‑operation timings and
  **throughput (MB/s)** — no file contents.
- **Preferences:** active theme (and whether it's a built‑in or custom one), language, Tasky
  settings, and the filesystem **Security Access Mode** you chose.
- **Content counts only:** how many mods / profiles / plugins / modpacks / tags / launch packs /
  apps you have — **counts, never names or contents**.
- **Interaction capture (privacy‑safe):** button **labels** clicked, form submissions, input
  field **names** that changed, copy actions, outbound link clicks, and errors — **never the
  values you type**.
- **Session replay (rrweb, masked by default):** when replay capture is enabled, BMM records a
  reconstruction of the **app interface** during your session — DOM structure and UI events
  (clicks, scrolling, navigation) — so the team can see *how* an issue happened. **All text inputs
  are masked by default**, so the characters you type are replaced by dots and never recorded. An
  explicit, separate **"full (unmasked)"** option exists for your own local debugging; it stays off
  unless you turn it on. Replays cover the BMM window only — never other apps or your screen.
- **Local crash recording (always on, never sent):** to help diagnose crashes, BMM continuously
  keeps a short **in-memory** recording of the current session (same masking as above). It is
  **never saved as a file and never transmitted** — *except* that, **if BMM crashes**, the most
  recent recording is written into the **local crash report `.zip`** so you (or, only if you choose
  to share that zip) can see what happened right before the crash. Turning on the **Session
  recorder** (Settings → Debug & trouble) additionally saves each session to a **local** replay
  list on your disk. Nothing here is uploaded; crash reports stay on your machine unless you send
  one yourself.
- **Approximate location:** derived **server‑side from your IP** (country / region / city). The
  location shown is **rounded and never precise** — your exact location is never stored or shown.

### 2.1.b Extra hardware report (opt‑in, tied to the weekly benchmark)
If you keep the **"Automatic Benchmark (every 7 days) + extra hardware report"** toggle **on** (in
the consent screen, or Settings → Privacy), BMM additionally sends a **precise hardware identity**
report so the team can correlate performance/benchmarks with exact configurations. This is **only**
sent while that toggle is on, and the consent screen shows the full list before you agree. It
includes: **motherboard** (model + serial number), **BIOS** version/date/vendor, **machine UUID**,
**CPU** logical processors + cores/threads + L2/L3 cache, **disks** (model, serial, size, interface),
**physical network MAC address(es)**, **OS version + build / kernel**, and **UEFI vs Legacy**,
**Secure Boot** and **TPM** state when available. These are **stable hardware identifiers** — more
identifying than the basic profile — which is why they are **opt‑in and separately disclosed**. Turn
the toggle **off** to send only the basic system profile (§2.1) and skip this entirely. Still no file
contents, no typed values, no personal identity.

### 2.2 What is NOT collected
File contents, mod names or contents, the text/values you type (masked in session replay too),
your real‑world identity, precise GPS/location, and anything from features you didn't use.

### 2.3 Consent & control
- Telemetry is **off by default** in BMM itself — but the BetterInstaller Configuration page
  pre‑ticks it (visible, and uncheckable there). You choose on first launch and can change it
  anytime in **Settings → Privacy**.
- When off, **nothing is collected** and nothing is sent.
- You can **export** everything BMM has buffered, and **clear** the local buffer at any time.
- The Privacy panel lists every **packet** BMM has sent (id, time, and a breakdown of *which
  event types* it contained — names and counts only).

### 2.4 Right to erasure (per packet)
For any packet you can press **"Request deletion"**. The request is applied **after a short
mandatory review delay (≤ 72 h)**, or **immediately** if a BMM admin approves it. When erased, the
exact rows tagged with that packet id are deleted from the dashboard and the packet turns
**"Deleted"**. If a request is declined, the **Request deletion** button reappears so you can ask
again.

### 2.5 Retention & security
- Collected data is **auto‑purged** from the dashboard after a fixed retention window.
- Ingestion uses a **public key** that only permits *submitting* telemetry; administrative actions
  (approving deletions) require a separate **private key held only on the server**.
- The dashboard is **rate‑limited** per client to prevent abuse.

---

## 3. When data leaves your machine (besides telemetry)

### 3.1 Connecting to / syncing a Server Repo
When you **connect to** or **sync from** a Server Repo, your computer makes HTTP requests to that
repo's server, which can see your **public IP address** and your **Creator ID** (so the repo owner
can apply whitelists / bans and show connection stats). The repo owner — **not** the BMM team —
controls that server. If you only use BMM offline, none of this happens.

### 3.2 Hosting a Server Repo
If **you** host a repo, people who connect expose **their** IP and Creator ID to **your** machine
(so you can manage bans/whitelist). You become the data controller for those logs.

### 3.3 BetaHub reports (bug reports & feedback)
When you voluntarily submit a **bug report** or **feedback**, the information **you type** (plus
any logs/screenshots you attach) is sent to the BetaHub service. Nothing is sent unless you submit.

### 3.4 Update checks & downloads
BMM checks GitHub for new releases and downloads plugins / catalog apps you request — standard
HTTPS requests; the remote host sees your IP.

### 3.5 Embedded tutorial videos (YouTube)
The in‑app **Documentation** can embed **YouTube** tutorial videos. When you are online and open a
page with an embed, your browser engine loads it directly from YouTube/Google, which can see your
IP and may set cookies under **Google's** privacy policy (we use the `youtube‑nocookie` style embed
where possible). When offline, a bundled local video is shown instead and nothing is contacted.

### 3.6 Linking a BetterCommunity account (optional)
If you choose to link an account, BMM sends your **Creator ID** to bettercommunity.ch to
request a one-time code, then polls whether the code has been entered. The Creator ID is an
identifier, not a secret â€” you already hand it to repo owners for whitelisting. No password or
e-mail is sent by BMM at any point in this exchange.

### 3.7 BetterCommunity notifications (optional, needs an API key)
If â€” and only if â€” you store a BetterCommunity **API key** in *Settings â†’ Identity & API*, BMM
asks that account's notifications from `bettercommunity.ch/v1/notifications` **every ten minutes**
while the app is open, and shows them in its notification centre.

Three things about this are worth stating plainly, because it is the only request BMM makes that
carries a credential:

- **The key never enters the web view.** It is stored in BMM's app-data folder and read only by
  the native process, which makes the request. The interface can save one, ask whether one exists,
  and delete it â€” it can never read it back.
- **It is scoped.** The key you create carries `notifications:read` and nothing else. Compromised,
  it permits reading your notifications; it cannot post, pay, publish or change your account.
- **It is stored in clear on disk.** Anyone who can read your app-data folder can read the key.
  You can remove it at any time from the same screen, and revoke it from your account page on the
  website â€” which also invalidates any copy of it.

No key stored means no request is ever made.

### 3.8 Optional integrations
Any feature you explicitly configure (Discord webhook, Cloudflare tunnel, …) sends data to the
service you configured, under that service's own terms.

---

## 4. Summary table

| Action | Leaves your PC? | Data sent | Recipient |
|---|---|---|---|
| Browsing/managing mods, profiles, modpacks | No | — | — |
| **Telemetry OFF (default)** | No | — | — |
| **Telemetry ON** (you turned it on, or left the installer's box ticked) | Yes | Anonymous usage, system profile, performance, approximate geo (counts/labels only — no contents/values) | Self‑hosted BMM dashboard |
| Connect / sync a Server Repo | Yes | Public IP, Creator ID | The repo's owner/server |
| Host a Server Repo | Yes (incoming) | Visitors' IP + Creator ID stored locally | You (host) |
| Submit a BetaHub bug report / feedback | Yes | What you typed + attachments | BetaHub service |
| Check for updates / download plugin/app | Yes | Your IP (standard HTTPS) | GitHub / download host |
| Link a BetterCommunity account | Yes | Creator ID (an identifier, not a secret) | bettercommunity.ch |
| **BetterCommunity notifications** (only with a stored API key) | Yes, every 10 min | An API key scoped to `notifications:read` | bettercommunity.ch |

---

## 5. Your control

- Telemetry is **off by default in the app**, but **pre‑ticked in the installer** — untick it
  there, or turn it off in Settings → Privacy (or stay fully offline) to avoid all of §2.
- Disable telemetry anytime; export or clear the local buffer; request per‑packet erasure.
- The Creator ID is your **public signing key** (Ed25519), not your name or email; the private key
  stays on your PC. It is stable, so activity under it is linkable over time — see §2.1.

## 6. Contact

Questions? Open an issue on the GitHub repository:
<a href="https://github.com/FreeProject089/BetterModsManager" target="_blank" rel="noopener noreferrer">
BetterModsManager
</a>

> This policy may evolve with the app. Material changes will be noted in the release notes.
