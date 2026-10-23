# Localized Video Tutorials System

BMM now supports a localized and hybrid video tutorial system. This means the application can display different videos based on the user's language, and it can automatically switch between a YouTube link (online) and a local file (offline).

## How it works

The system uses the standard translation files (en.json, fr.json) to define the video sources.

1.  Online Mode: If internet is available, BMM tries to load the YouTube iframe defined in the translation key.
2.  Offline Mode: If the user is offline, BMM automatically switches to a <video> tag playing a local .mp4 file.

## Configuration

To update or add videos, edit the following keys in your language files:

### English (en.json)
```json
"docs.videos.tuto1.online": "https://www.youtube.com/embed/VIDEO_ID_EN",
"docs.videos.tuto1.offline": "assets/videos/tuto1_en.mp4",
"docs.videos.tuto2.online": "https://www.youtube.com/embed/VIDEO_ID2_EN",
"docs.videos.tuto2.offline": "assets/videos/tuto2_en.mp4"
```

### French (fr.json)
```json
"docs.videos.tuto1.online": "https://www.youtube.com/embed/VIDEO_ID_FR",
"docs.videos.tuto1.offline": "assets/videos/tuto1_fr.mp4",
"docs.videos.tuto2.online": "https://www.youtube.com/embed/VIDEO_ID2_FR",
"docs.videos.tuto2.offline": "assets/videos/tuto2_fr.mp4"
```

## Asset Placement

- Local Videos: Place your .mp4 files in frontend/assets/videos/.
- Naming: Ensure the filename in the folder matches the path in the offline translation key.

## Technical Note

The logic is handled in frontend/src/docs/docs-ui.ts within the setupVideoPlayers() function. It uses navigator.onLine and the t() translation tool to determine which source to render dynamically.
