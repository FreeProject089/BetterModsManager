# Privacy Policy — Better Mod Manager (BMM)

_Last updated: 2026-06_

Better Mod Manager is a **local-first, open-source** desktop application (licensed under GPL‑3.0).
It runs on your machine and, by default, does **not** track you, show ads, or send analytics/telemetry.
This document explains the few cases where data leaves your computer, and exactly what is sent.

---

## 1. What we do NOT do

- **No analytics or telemetry.** BMM does not embed any tracking SDK and does not phone home with usage statistics.
- **No account required.** You do not need to sign in to use BMM.
- **No selling of data.** We have nothing to sell — most features are 100% offline.

All your data — profiles, mods, modpacks, plugins, settings — is stored **locally** on your disk
(in BMM's data folder). You can export or delete it at any time.

---

## 2. When data leaves your machine

### 2.1 Connecting to / syncing a Server Repo
When you **connect to** or **sync from** a Server Repo (a depot hosted by another user or by you),
your computer makes HTTP requests to that repo's server. As with any web request, the server can see:

- your **public IP address** (unavoidable for any network connection), and
- your **Creator ID** (a public identifier BMM generates for you), which is sent so the repo owner can
  apply whitelists / bans and show connection stats.

The repo owner — **not** the BMM team — controls that server and any logs it keeps.
If you only use BMM offline, none of this happens.

### 2.2 Hosting a Server Repo
If **you** host a repo (HTTP host / generate), people who connect to you will expose **their** IP and
Creator ID to **your** machine (so you can manage bans/whitelist). You become the data controller for
those logs. Treat other users' IPs and Creator IDs responsibly.

### 2.3 BetaHub reports (bug reports & feedback)
When you voluntarily submit a **bug report** or **feedback** through the in‑app BetaHub form, the
information **you type into that form** is sent to the BetaHub service so the issue can be triaged.
This can include: the title/description you write, the category, and any logs or screenshots you
choose to attach. Nothing is sent unless you press submit.

### 2.4 Update checks & downloads
- BMM checks GitHub for new releases (and can download plugins / catalog apps you request).
  These are standard HTTPS requests to GitHub / the download URL; the remote host sees your IP.
- Downloading a community plugin or catalog app contacts the URL listed for that item.

### 2.5 Optional integrations
Any feature you explicitly configure (e.g. a Discord webhook, a Cloudflare tunnel) sends data to the
service you configured, under that service's own privacy terms.

---

## 3. Summary table

| Action | Leaves your PC? | Data sent | Recipient |
|---|---|---|---|
| Browsing/managing mods, profiles, modpacks | No | — | — |
| Connect / sync a Server Repo | Yes | Public IP, Creator ID | The repo's owner/server |
| Host a Server Repo | Yes (incoming) | Visitors' IP + Creator ID stored locally | You (host) |
| Submit a BetaHub bug report / feedback | Yes | What you typed + attachments you add | BetaHub service |
| Check for updates / download plugin/app | Yes | Your IP (standard HTTPS) | GitHub / download host |

---

## 4. Your control

- Stay fully offline to avoid all of section 2.
- The Creator ID is a public key‑like identifier, not your name or email.
- You can clear locally stored data from BMM's data folder.

## 5. Contact

Questions? Open an issue on the GitHub repository:
<a href="https://github.com/FreeProject089/BetterModsManager" target="_blank" rel="noopener noreferrer">
BetterModsManager
</a>
> This policy may evolve with the app. Material changes will be noted in the release notes.
