# Developer Guide: Adding New Documentation Badges

This guide explains how to add new specialized badges to the Better Mods Manager (BMM) Markdown renderer.

## Overview

Badges are implemented using **Regular Expression (Regex)** replacements within the `renderMarkdown` function in the frontend. To add a new badge, you need to update the logic, the styling, and the translations.

## Step 1: Update the Logic

Open `frontend/src/ui/update-notes.ts` and locate the `renderMarkdown(md)` function. Add a new replacement rule:

```javascript
// Example: Adding a [CRITICAL] badge
html = html.replace(/\[CRITICAL\]/g, '<span class="md-badge md-badge-critical">' + t('update.badge.critical') + '</span>');
```

For French support, add the equivalent:
```javascript
html = html.replace(/\[CRITIQUE\]/g, '<span class="md-badge md-badge-critical">' + t('update.badge.critical') + '</span>');
```

## Step 2: Add Styling

In the same file (`update-notes.ts`), scroll down to the `injectMarkdownStyles()` function (usually an IIFE at the bottom). Add your new CSS class:

```css
.md-badge-critical {
    background: rgba(239, 68, 68, 0.15);
    color: #ef4444;
    border: 1px solid rgba(239, 68, 68, 0.3);
}
```

## Step 3: Add Translations

Update the language files:

- `frontend/Lang/en.json`:
  ```json
  "update": {
    "badge": {
      "critical": "CRITICAL"
    }
  }
  ```

- `frontend/Lang/fr.json`:
  ```json
  "update": {
    "badge": {
      "critical": "CRITIQUE"
    }
  }
  ```

## Step 4: Update Reference Docs

Don't forget to update `Update/Documentation/Badges_EN.md` and `Badges_FR.md` to include your new badge in the table!

---

## 📢 Note on GitHub Alerts

BMM also parses standard GitHub-style alerts using `<blockquote>` and specific tags. The following tags are supported:
- `> [!NOTE]`
- `> [!TIP]`
- `> [!IMPORTANT]`
- `> [!WARNING]`
- `> [!CAUTION]`

To add a new type of GitHub alert, update the regex in `frontend/src/ui/update-notes.ts` that captures `<blockquote>\s*<p>\[!(NOTE|TIP...)\]` and add the corresponding CSS classes (`.md-alert-[type]`) in `injectMarkdownStyles()`.

> [!IMPORTANT]
> Always use `rgba` for backgrounds to maintain the glassmorphism aesthetic of BMM.
