# Translation Guide - Better Mod Manager

Want to add your own language to BMM? It's very easy!

## 1. Create the File
Navigate to the `frontend/Lang` folder in the application directory.
Create a new file in `.json` format, for example `es.json` for Spanish or `de.json` for German.

## 2. File Structure
The file must start with an `_info` block that defines the language name and its flag.
For the flag, you can use either a standard emoji (e.g., standard flag emoji) or a **2-letter ISO country code** (e.g., "us", "fr", "de"). 
BMM will automatically convert ISO codes into high-quality flag icons!

``` 
{
    "_info": {
        "name": "Español",
        "flag": "es"
    },
    "nav.library": "Biblioteca",
    "nav.profiles": "Perfiles",
    ...
}
```

## 3. Automatic Detection
As soon as you save your file in the `Lang` folder, BMM will detect it at the next startup and automatically add it to the language selector in the bottom left!

## 4. Sharing
Feel free to share your translation files on our Discord so they can be officially integrated into future updates.

---
*Tip: Use the "Copy Template" button in Settings to get all the keys to translate at once!*
