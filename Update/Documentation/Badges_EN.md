# BMM Documentation Badges Reference

This document serves as a visual and technical reference for all standard badges supported by the Better Mods Manager (BMM) Markdown renderer.

## 🎨 Visual Preview

| Type | Badge Preview | Syntax | Use Case |
|:---|:---|:---|:---|
| **Feature** | <span style="background:rgba(16,185,129,0.15);color:#10b981;border:1px solid rgba(16,185,129,0.3);padding:2px 10px;border-radius:6px;font-size:11px;font-weight:800;text-transform:uppercase;">NEW</span> | `[NEW]` | Completely new features or components. |
| **Polish** | <span style="background:rgba(59,130,246,0.15);color:#3b82f6;border:1px solid rgba(59,130,246,0.3);padding:2px 10px;border-radius:6px;font-size:11px;font-weight:800;text-transform:uppercase;">REFINE</span> | `[REFINE]` | Small improvements or fine-tuning. |
| **Logic** | <span style="background:rgba(245,158,11,0.15);color:#f59e0b;border:1px solid rgba(245,158,11,0.3);padding:2px 10px;border-radius:6px;font-size:11px;font-weight:800;text-transform:uppercase;">IMPROVED</span> | `[IMPROVED]` | Performance or functional logic improvements. |
| **Bugfix** | <span style="background:rgba(239,68,68,0.15);color:#ef4444;border:1px solid rgba(239,68,68,0.3);padding:2px 10px;border-radius:6px;font-size:11px;font-weight:800;text-transform:uppercase;">FIXED</span> | `[FIXED]` | Bug resolutions and stability fixes. |
| **UI/UX** | <span style="background:rgba(168,85,247,0.15);color:#a855f7;border:1px solid rgba(168,85,247,0.3);padding:2px 10px;border-radius:6px;font-size:11px;font-weight:800;text-transform:uppercase;">VISUAL</span> | `[VISUAL]` | Graphic changes, styling, or animations. |
| **System** | <span style="background:rgba(156,163,175,0.15);color:#9ca3af;border:1px solid rgba(156,163,175,0.3);padding:2px 10px;border-radius:6px;font-size:11px;font-weight:800;text-transform:uppercase;">SYSTEM</span> | `[SYSTEM]` | Core engine or backend changes. |

## 📢 GitHub Alerts

BMM also supports standard GitHub-style alerts for calling out important information in your documentation.

| Syntax | Renders As | Use Case |
|:---|:---|:---|
| `> [!NOTE]` | Blue alert box | Useful information or context. |
| `> [!TIP]` | Green alert box | Helpful advice or best practices. |
| `> [!IMPORTANT]` | Purple alert box | Crucial information users shouldn't miss. |
| `> [!WARNING]` | Yellow/Orange alert box | Potential issues or side effects. |
| `> [!CAUTION]` | Red alert box | High-risk actions or critical warnings. |

## 🛠️ Implementation Details

Badges are automatically rendered using a custom regex parser in the `renderMarkdown` function of the BMM UI.

- **English files**: Use the English syntax (e.g., `[NEW]`).
- **French files**: Use the French syntax equivalents (e.g., `[NOUVEAU]`).

> [!TIP]
> Always place badges at the beginning of a line or after a bullet point for the best visual alignment.

---
*Generated for Better Mods Manager Documentation Standard.*
