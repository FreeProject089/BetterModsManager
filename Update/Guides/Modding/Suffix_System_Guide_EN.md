# Documentation Suffix System Guide

This guide explains how BMM handles localized files for Release Notes and Guides using a suffix naming convention.

## Overview

To provide a seamless multilingual experience, BMM uses a simple suffix system to identify and prioritize files based on the user's current language setting.

## Naming Convention

Files should follow this pattern:
`[FileName]_[LANGUAGE_CODE].md`

- **English**: `MyGuide_EN.md`
- **French**: `MyGuide_FR.md`

## How it Works

1. **Filtering**: When the Release Notes or Documentation modal is opened, BMM checks the user's active language (e.g., `FR`).
2. **Hidden Files**: Any file ending with a suffix that does **not** match the current language (e.g., `_EN.md` when the app is in French) is automatically hidden from the tree view.
3. **Fallback**: If a file exists without a suffix (e.g., `GeneralGuide.md`), it will be visible for all languages as a fallback.
4. **Synchronization**: When you switch languages in the settings, the tree view updates instantly to show the correct version of the files.

## Best Practices

- **Consistency**: Always provide both `_EN` and `_FR` versions for important guides.
- **Root Files**: Keep general images or non-text resources in their own folders, but name the `.md` entry points using suffixes.
- **Organization**: Group related documents in sub-folders; the suffix system works recursively across all directories in `Update/`.

---
> [!TIP]
> This system avoids cluttering the interface with redundant files for languages the user doesn't understand.
