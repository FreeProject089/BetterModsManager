# Translation Guide - Better Mod Manager

> 📚 **The comfortable way:** you don't need to hand-edit files at all. **Settings → Language**
> has a downloadable template, an **Import** button, and the **Translation Sandbox** — create a
> language, translate key by key with live previews and a progress bar, then export/import.
> Full guide: [BMM Docs — Settings → Language](https://freeproject089.github.io/BMM-Docs/features/settings/)
> and the in-app **Help & other → Translate BMM** article. The rest of this file covers the
> manual file-based route.

Want to add your own language to BMM? It's very easy!

## 1. Create the File
Go to the app's `Lang/` folder — next to the installed application (in a development checkout
it's `frontend/Lang`). If you'd rather not hunt for it, **Settings → Language → Import** copies
your file there for you.
Create a new file in `.json` format, for example `es.json` for Spanish or `de.json` for German.

## 2. File Structure
The file must start with an `_info` block that defines the language name and its flag.
For the flag, you can use either a standard emoji or a **2-letter ISO country code** (e.g., "us", "fr", "de"). 
BMM will automatically convert ISO codes into high-quality flag icons!

```json
{
    "_info": {
        "name": "Español",
        "flag": "es"
    },
    ...
    "nav.library": "Biblioteca",
    "nav.profiles": "Perfiles",
    ...
}
```

## 3. Automatic Detection
As soon as you save your file in the `Lang` folder, BMM will detect it at the next startup and automatically add it to the language selector in the bottom left!

## 4. Localized Video Tutorials (v0.9.9)
BMM supports localized video tutorials. You can define specific YouTube links and local MP4 paths for your language using the `docs.videos` keys.
For more details, see the [Localized Video Tutorials Guide](../Guides/Translation/video_localization_EN.md).

## 5. **Semantic Synonyms (`_synonyms`)**

BMM uses a semantic search engine in the Documentation tab. To help the engine find results across languages, each language file can define a list of synonym groups.

*   **How it works**: BMM merges synonym groups from *all* loaded language files at runtime.
*   **Format**: An object where each key is a **canonical term** (used as the anchor) and the value is an **array of strings** (synonyms).
*   **Adding new groups**: You can create any new key you want. If another language file uses the same key, BMM will combine the two lists automatically.

```json
"_synonyms": {
  "my_concept": ["term1", "term2", "term3"],
  "activation": ["enable", "install", "power on"]
}
```

6. **Validation**
   - Ensure the JSON remains valid (run it through a validator if unsure).
   - Check for missing trailing commas or duplicate keys.
   - Restart BMM to see your changes applied.

---
*Tip: Use the "Copy Template" button in Settings to get all the keys to translate at once!*
