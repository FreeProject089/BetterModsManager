# Feedback, bugs & crash reports


> The in-app dialog that sends a suggestion, a bug or a crash to the BetterCommunity feedback
> centre — what it attaches, where it goes, and what happens when the site is down.

Open it from **Settings → Feedback & bug reports**, or from the button on the crash dialog. It
sends to the **BetterCommunity feedback centre**, the only destination. If the app is configured
with an empty `feedback_endpoint`, reports are switched off and the button says so instead of
opening the dialog (the older BetaHub forms, once the fallback, were removed in September 2026).


## Three kinds

- **Suggestion** — an idea or something to improve. Just a title and a description.
- **Bug** — something that does not do what it should. Add steps to reproduce; the app log is
  attached by default.
- **Crash** — BMM closed on its own. The crash zip and a DxDiag report are attached by default;
  untick either.


## What is sent

**Nothing leaves your machine until you press Send.** When you do, the report carries:

| Item | When | What it is |
|---|---|---|
| Title, description, steps | always | what you typed |
| Screenshots | if you attach them | images you pick |
| Crash zip | if you attach it | logs + a system snapshot + a masked replay of the moments before the crash |
| App log | pre-ticked for bug/crash | `bmm_frontend.log` |
| DxDiag report | pre-ticked for crash | a full hardware/driver inventory that also contains machine/OS ids and your Windows account name |

Your **Creator ID** rides along as a header, with the app version, OS and locale. Full detail is in
the app's Privacy Policy (§3.3).

:::warning[The DxDiag report is broad]
It is the raw `dxdiag /t` dump — more than the telemetry "system profile", including your Windows
user name. It is pre-ticked only for crashes, and you can untick it.
:::


## Laya's proposals

With AI on, a **Laya** box under the description proposes the type, category, severity, part of
the app, tags, an earlier look-alike report and, for a crash, the matching crash report. Nothing
is applied until you click **Apply**; only what you applied is sent (as labels with the report).
See [AI: Laya while you write a report](doc-page:features/ai#laya-while-you-write-a-report).


## Replies: linked or anonymous

:::note[Link your account]
If your BetterCommunity account is linked, a report opens a **thread in your dashboard** and BMM
notifies you when staff reply. Otherwise, leave an **e-mail** or **Discord** so they can reach you.
:::


## If the site is unreachable

A report BMM could not send is **kept locally and retried automatically on the next launch** — it
is never sent anywhere else. BMM also keeps a local list of your last 50 submissions, and limits
itself (a handful per ten minutes, a couple of dozen a day) so nothing floods the centre. A small
anti-spam proof-of-work runs before sending — it costs a little CPU and sends no extra data.
