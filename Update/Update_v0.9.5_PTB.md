# Update Notes - v0.9.5 (Public Test Build)

## 🚀 What's New?

### 🔄 Auto-Updater System (PTB)
Say goodbye to manual downloads! Better Mod Manager now features a built-in auto-updater.

*   **Automatic Check:** BMM will now check for new versions automatically 3 seconds after each launch.
*   **Safety First:** Every update is digitally signed to ensure authenticity and prevent tampering.
*   **Manual Trigger:** Want to check right now? A new "Check for Updates" button has been added to the sidebar footer.
*   **Full Control:** You can enable or disable the auto-updater anytime from the **Settings** menu.

### ⚙️ Settings & Configuration
*   Added a toggle switch in the Settings page for the Auto-Updater.
*   Persistent storage: BMM remembers your preference across sessions.

### 🛡️ Digital Signature v1
*   Security enhancement: The application now uses an RSA/Minisign signature v1 for all future updates.
*   Automatic verification: The app will refuse to install any update if the signature doesn't match the developer's key.

---

## 🛠️ Internal Improvements
*   Updated Tauri core dependencies for better stability.
*   Improved startup performance for the version sync mechanism.
*   Fixed a bug where the version pill in the sidebar wasn't always up to date.

---
*Thank you for testing the Public Test Build! Join our Discord to report any issues.*
---
*Better Mod Manager is developed by FreeProject089.*
