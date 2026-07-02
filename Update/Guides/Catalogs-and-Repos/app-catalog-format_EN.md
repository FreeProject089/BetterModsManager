# BMM App Catalog — JSON Format Guide

How to create a catalog that BMM can read to display and install apps.

---

## Repository structure

```
your-repo/
└── catalog.json      ← only required file
```

Host it on GitHub and give BMM the **raw** URL:
```
https://raw.githubusercontent.com/YourUser/YourRepo/main/catalog.json
```

Add it in BMM under **App Catalog → Sources → Add**.

---

## Trust model

Badges (`Official`, `Partner`) are assigned by BMM based on **where the catalog comes from**, not what the JSON says. Writing `"official": true` in a community catalog does nothing — BMM overwrites it.

| Source | `Official` badge | `Partner` badge |
|---|---|---|
| The URL in `links.json` (`apps_catalog`) | ✅ | ❌ |
| A URL listed in `official.partner_catalogs` | ❌ | ✅ |
| Any other catalog (community / user-added) | ❌ | ❌ |

---

## catalog.json — root fields

```json
{
  "version": "1.0",
  "name": "My Catalog",
  "description": "Short description.",
  "partner_catalogs": [],
  "community_imports": [],
  "apps": [ ... ]
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `version` | string | No | Schema version, e.g. `"1.0"` |
| `name` | string | No | Display name of this catalog |
| `description` | string | No | Short description |
| `partner_catalogs` | array of URLs | No | **Read only from the official catalog.** URLs whose entries receive the `Partner` badge. |
| `community_imports` | array of URLs | No | Other catalogs to auto-load — no badge granted. |
| `apps` | array | **Yes** | List of app entries |

> `partner_catalogs` is silently ignored if your catalog is not the official one.

---

## App entry fields

```json
{
  "id":           "my-app-name",
  "title":        "My App Name",
  "description":  "What it does in 1–3 sentences.",
  "version":      "1.2.0",
  "category":     "utility",
  "price":        "free",
  "tags":         ["dcs", "tool", "audio"],
  "requirements": "Windows 10+",
  "md_link":      "https://github.com/user/repo/blob/main/README.md",
  "images": {
    "thumb": "https://raw.githubusercontent.com/user/repo/main/thumb.png",
    "extra": [
      "https://raw.githubusercontent.com/user/repo/main/screen1.png"
    ]
  },
  "download": {
    "url":       "https://github.com/user/repo/releases/download/v1.2.0/app.exe",
    "file_type": "exe",
    "size":      15728640,
    "sha256":    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
  }
}
```

### Required

| Field | Type | Description |
|---|---|---|
| `id` | string | Unique slug — **no spaces**, hyphens only. Used as install folder name. |
| `title` | string | Display name |
| `description` | string | Short description (1–3 sentences) |
| `category` | string | `"game"` · `"utility"` · `"other"` |
| `price` | string | `"free"` · `"freemium"` · `"paid"` |
| `tags` | array | Max **3** tags — used for search and filters |
| `download.url` | string | Direct download link |
| `download.file_type` | string | `"zip"` · `"exe"` · `"msi"` · `"script"` |

### Optional

| Field | Type | Description |
|---|---|---|
| `version` | string | App version shown in the UI |
| `requirements` | string | e.g. `"Windows 10+, .NET 6"` |
| `md_link` | string | URL to a README / doc page |
| `images.thumb` | string | Card thumbnail — shown on the browse grid. Recommended **16:9**, min 400×225 px. Must be a public HTTPS URL (GitHub raw, CDN…). |
| `images.extra` | array | Extra screenshots shown in the detail gallery (clickable strip). Up to ~5. Same URL rules as thumb. |
| `download.size` | integer | File size in bytes (shown before download) |
| `download.sha256` | string | **Recommended.** SHA-256 checksum of the downloaded file. When present, BMM verifies the download and warns (modal, install blocked by default) if it does not match — protecting users from tampered or corrupted files. |

> [!TIP]
> Generate the checksum with `sha256sum app.exe` (Linux/macOS) or `certutil -hashfile app.exe SHA256` (Windows), then paste the value into `download.sha256`.

### How to host images on GitHub

Store images in your repo and use the **raw** URL:
```
https://raw.githubusercontent.com/YourUser/YourRepo/main/images/thumb.png
```
Or use a GitHub Release asset URL (stable across branches):
```
https://github.com/YourUser/YourRepo/releases/download/v1.0.0/thumb.png
```

> **Do not include `official` or `partner` fields** — they are ignored for community catalogs and auto-assigned by BMM.

---

## download.file_type reference

| Value | BMM behaviour |
|---|---|
| `"zip"` | Extracts to `<install_path>/<id>/`. **If it contains the app directly** → portable, BMM picks the main `.exe` (best name match, skips uninstallers). **If it contains only an installer** (`setup.exe`, `*install*`, `.msi`) → BMM runs that installer and auto-detects the result via the Windows registry. |
| `"exe"` | If the filename looks like an installer (`setup`, `install`) → run it, then auto-detect the installed app (registry `DisplayIcon` / `InstallLocation` / `UninstallString`). Otherwise treated as a portable exe. |
| `"msi"` | Run via `msiexec`, then auto-detect through the registry. |
| `"script"` | Saved to `<install_path>/<id>/` and set as the launch target. **Launch** runs it via the right interpreter: `.ps1`→PowerShell, `.bat`/`.cmd`→cmd, `.py`→python, `.vbs`→wscript, `.sh`→bash. Managed by BMM (uninstall deletes the folder). |

> **Auto-detection (zero user action):** for any installer path, BMM snapshots install folders + the registry before running it, then diffs afterwards to find the launch `.exe` and the matching uninstaller automatically. The user only clicks through the app's own wizard.

---

## category reference

| Value | Badge colour |
|---|---|
| `"game"` | Blue |
| `"utility"` | Purple |
| `"other"` | Grey |

---

## Minimal copy-paste template

```json
{
  "version": "1.0",
  "name": "My Catalog",
  "apps": [
    {
      "id": "my-app",
      "title": "My App",
      "description": "Does something useful for DCS World.",
      "category": "utility",
      "price": "free",
      "tags": ["dcs", "tool"],
      "download": {
        "url": "https://example.com/my-app.zip",
        "file_type": "zip",
        "size": 5242880
      }
    }
  ]
}
```

---

## Rules & tips

- **IDs must be globally unique** across all catalogs. Prefix with your username if unsure (`"myuser-myapp"`).
- **Tags**: lowercase, no spaces, max 3.
- **Images**: use raw GitHub URLs or a public CDN. No auth-required URLs.
- **Size**: always fill it — shown to the user before they download.
- `community_imports` chains are loaded recursively up to 20 sources total.
