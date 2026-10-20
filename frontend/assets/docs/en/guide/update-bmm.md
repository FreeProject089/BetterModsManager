# Update BMM

You will check for a new version, read what changed, and install it. Your profiles, mods and settings are kept.

[Show me: update settings](show:settings/updates) [Open the release notes](show:notes) [Practise in the tutorial](show:tutorial/other/updates)

**You need:** nothing else. If you installed BMM with BetterInstaller, the update goes through it by itself.

![The release notes window, with the story of 1.0 pinned above the versions](assets/docs/media/screenshots/guide-release-notes.png)

:::note[Why BMM checks before it installs]
The installer is checked against the release's signed manifest and its SHA-256 before it runs.
A file that does not match is shown in red, and installing it is not recommended.
:::

## Steps

- [ ] **Let BMM tell you.** It checks when it starts. In **Settings, Auto Update** you can add a check while it stays open (every 6 hours, or daily). *You see:* a window with the new version's notes.
- [ ] **Or check by hand.** Press **Check for updates** in the title bar or in Settings. *You see:* either the new version, or a message that you are up to date.
- [ ] **Read the notes.** Open **Release notes** from the update window. *You see:* the **Versions** tab, newest first, with **What's new in 1.0** pinned above the list. Start there if you skipped a few versions.
- [ ] **Choose a button.** **Install now** downloads, checks and installs, all inside BMM. **Install on next launch** installs the next time you start. **Remind me tomorrow** downloads nothing.
- [ ] **Wait for the three steps.** *You see:* **Download** (size, speed, time left), **Verify**, **Install**, and BMM restarts.

## Which build to follow

| Channel | What you get |
|---|---|
| **Stable** | Tested releases only. The default. |
| **Pre-release** | Beta builds before they are final: fixes first, and bugs first. |

Change it in **Settings, Auto Update, Update channel**.

## If it does not work

| You see | Do this |
|---|---|
| The installer did not start | The window says why in words (permission prompt declined, antivirus holding the file, a policy). Press **Try again**. |
| A red message about the checksum | Do not install. Press **Download from the release page** and compare. |
| You are on 0.9.11 | Accept 0.9.12 first, then the 1.0 update it offers next. |
| A major version, such as 0.9 to 1.0 | It is a full install with the installer, and BMM copies your data across on first launch. |

:::tip[A year behind is a problem]
A mod manager far behind the repos it reads will eventually disagree with them. If you turn the
automatic check off, update by hand now and then.
:::

## Next

[Install BMM](doc-page:getting-started/install) has every detail about updating and the installer.
What changed in each version: [Change history & release notes](doc-page:features/history).
