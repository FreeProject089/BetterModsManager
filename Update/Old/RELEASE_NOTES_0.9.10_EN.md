# Better Mods Manager v0.9.10 Release Notes

## Major Improvements

### Cloudflare Tunnel Enhancements
- **Fixed DNS resolution issues** - Tunnel now properly initializes with extended timeout (45s + 5s buffer)
- **Hidden CMD window** - Cloudflared process now runs completely in background
- **Improved reliability** - Better error handling and connection stability

### Server Status Persistence
- **Fixed server detection on app refresh** - Server status now correctly persists across application restarts
- **Smart port checking** - Detects running servers even when internal state is lost
- **Accurate status display** - UI now shows correct server state after refresh

### Notification System Improvements
- **Session-based download notifications** - "Download started" shows once per session, "Download finished" shows when complete
- **Anti-spam protection** - Prevents notification flooding during multiple file downloads
- **Clean notification flow** - Better user experience with reduced notification clutter

### Server Monitoring Enhancements
- **Unified client display** - Shows all connected clients (idle and downloading) without duplicates
- **Clean creator ID display** - Removes Rust Option wrappers for better readability
- **Real-time client tracking** - Accurate monitoring of all connected users

### UI/UX Improvements
- **Fixed search bar styling** - Resolved icon clipping issues in Ban/Whitelist Management modals
- **Rounded search bars** - Improved visual consistency with modern design
- **Modal header improvements** - Better alignment and responsive design for management modals

### Translation Fixes
- **Fixed missing translations** - Added proper i18n for "Exporter la liste actuelle" and related elements
- **Complete localization** - All UI elements now properly translate across languages
- **Placeholder translations** - Form inputs now have localized placeholder text

### Bug Fixes
- **Fixed mod folder scanning** - Graceful handling when mods folder doesn't exist
- **Resolved toast notification errors** - Fixed undefined toast function in repo monitoring
- **Fixed compilation warnings** - Clean codebase with no cargo warnings
- **Improved error handling** - Better resilience for edge cases and invalid states

## Technical Improvements
- **Windows API integration** - Added proper Windows crate for background process management
- **Enhanced state management** - Better persistence and recovery mechanisms
- **Optimized performance** - Reduced resource usage and improved response times
- **Code quality** - Removed all compilation warnings and improved code maintainability


---

**Previous Issues Resolved:**
- Cloudflare tunnel DNS errors
- Server status persistence on refresh
- Notification spam during downloads
- Visual bugs in management modals
- Translation gaps
- CMD window visibility
- Compilation warnings

