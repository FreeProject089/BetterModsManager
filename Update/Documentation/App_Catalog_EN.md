# App Catalog

The **App Catalog** page lets you discover, install, launch and update companion apps and tools directly from BMM.

## Sources

The catalog aggregates several source types:

| Source | Description |
|---|---|
| **Official** | Maintained by the BMM team |
| **Partner** | Trusted third-party catalogs |
| **Community** | Any catalog URL you add yourself |

A source is a plain **JSON file** (see *app-catalog format* in the developer docs) listing apps with name, description, icon, download URL, version and optional checksums. You can add or remove community sources from the catalog settings.

> ⚠️ Only add sources you trust — installing an app runs its installer/executable on your machine.

## Installing & launching

- Click **Install** on a card: BMM downloads the app, verifies it when a checksum is provided, and tracks the installed version.
- Installed apps show a **Launch** action directly on their card.
- When the source publishes a newer version, the card offers an **Update**.
- Uninstalling removes the tracked files.

## Executable detection

For apps installed outside BMM, the catalog can **detect existing executables** so a card switches to "installed" instead of proposing a duplicate download.

## Troubleshooting

- *"App catalog sources failed"* in the logs means one of your configured source URLs is unreachable (typo, offline server, placeholder URL). Remove or fix the source in the catalog settings.
- Downloads honour BMM's disk I/O limits and can be cancelled like any other transfer.
