# 🚀 Documentation: One-Click Installation (bmm://)

The `bmm://` protocol allows you to install mods directly from a web link, a Discord message, or any other application, without having to manually download the file and import it into Better Mod Manager.

## 🔗 Link Structure
For a link to be recognized by Better Mod Manager, it must follow this format:

```text
bmm://import?url=[DIRECT_LINK_TO_ZIP]&name=[MOD_NAME]
```
### Parameters:
- **url** (Mandatory): The direct URL address of the mod archive (usually a .zip or .rar file).
- **name** (Optional): The default name that will be suggested in the confirmation window.

## 🛠️ How it works?
1. **Launch**: As soon as you click a `bmm://` link, Windows automatically opens Better Mod Manager.
2. **Detection**: If the application is already open, it is brought to the foreground.
3. **Confirmation**: A "One-Click Installation" window appears.
   - **Mod Name**: You can modify the name if the suggested one does not suit you.
   - **Destination Profile**: You choose which profile the mod should be installed into.
4. **Installation**: After validation, BMM downloads the file, extracts it into the mod folder of the selected profile, and refreshes your library.

## ❓ FAQ & Help

### What is a "Direct Link" (DDL)?
BMM needs a **Direct Download Link (DDL)** to function. This is a link that points directly to the ZIP/RAR file, without going through an intermediate page (such as an ad page or a "Download" button on a site).

- ✅ **Direct Link**: `https://site.com/mod.zip` (Download starts immediately).
- ❌ **Indirect Link**: A Mediafire page, Mega (web interface), or a Nexus Mods page (requires account/click).

> [!TIP]
> On **GitHub**, you can get a direct link by right-clicking a file in a "Release" and choosing "Copy link address".

### How do I create my own bmm:// link?
You can generate a link to share your favorite mods with your friends. Use this structure:
1. Take the direct download URL of your mod.
2. Use a URL encoder (optional if the URL is simple) for the `url` parameter.
3. Assemble it:
```text
bmm://import?url=YOUR_URL&name=MOD_NAME
```

### Why does Tasky ask for confirmation?
This is an essential security measure. It prevents a malicious site from installing files on your computer without your explicit consent. You always keep control over the name and the target profile.

---
*Note: Ensure that the mod folder structure matches the game's requirements for a successful installation.*
