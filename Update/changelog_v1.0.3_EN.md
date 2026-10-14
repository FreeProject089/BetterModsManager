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

## [IMPROVED] Release
- One version everywhere: 1.0.3.
