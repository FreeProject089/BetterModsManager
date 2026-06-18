# Privacy Policy — Better Mod Manager (BMM)

_Last updated: 2026-06_

Better Mod Manager is a **local-first, open-source** desktop application (licensed under GPL‑3.0).
It runs on your machine and, by default, does **not** track you or show ads. BMM includes an
**optional, opt‑in telemetry** feature that is **OFF until you explicitly turn it on**. This
document explains the cases where data leaves your computer, and exactly what is sent.

---

## 1. What we do NOT do

- **No tracking without consent.** Telemetry is **opt‑in** and **off by default**. Nothing is
  collected or sent until you explicitly enable it on the first‑run consent screen (or later in
  Settings → Privacy).
- **No account required.** You do not need to sign in to use BMM.
- **No selling of data.** We have nothing to sell — most features are 100% offline.
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
- **Anonymous identity:** your **Creator ID** (a public, key‑like identifier — not your name or
  email), or a random per‑install id if you have none.
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
- **Approximate location:** derived **server‑side from your IP** (country / region / city). The
  location shown is **rounded and never precise** — your exact location is never stored or shown.

### 2.2 What is NOT collected
File contents, mod names or contents, the text/values you type, your real‑world identity, precise
GPS/location, and anything from features you didn't use.

### 2.3 Consent & control
- Telemetry is **off by default**. You choose on first launch and can change it anytime in
  **Settings → Privacy**.
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

### 3.5 Optional integrations
Any feature you explicitly configure (Discord webhook, Cloudflare tunnel, …) sends data to the
service you configured, under that service's own terms.

---

## 4. Summary table

| Action | Leaves your PC? | Data sent | Recipient |
|---|---|---|---|
| Browsing/managing mods, profiles, modpacks | No | — | — |
| **Telemetry OFF (default)** | No | — | — |
| **Telemetry ON (opt‑in)** | Yes | Anonymous usage, system profile, performance, approximate geo (counts/labels only — no contents/values) | Self‑hosted BMM dashboard |
| Connect / sync a Server Repo | Yes | Public IP, Creator ID | The repo's owner/server |
| Host a Server Repo | Yes (incoming) | Visitors' IP + Creator ID stored locally | You (host) |
| Submit a BetaHub bug report / feedback | Yes | What you typed + attachments | BetaHub service |
| Check for updates / download plugin/app | Yes | Your IP (standard HTTPS) | GitHub / download host |

---

## 5. Your control

- Telemetry is **opt‑in**; stay off (or fully offline) to avoid all of §2.
- Disable telemetry anytime; export or clear the local buffer; request per‑packet erasure.
- The Creator ID is a public key‑like identifier, not your name or email.

## 6. Contact

Questions? Open an issue on the GitHub repository:
<a href="https://github.com/FreeProject089/BetterModsManager" target="_blank" rel="noopener noreferrer">
BetterModsManager
</a>

> This policy may evolve with the app. Material changes will be noted in the release notes.
