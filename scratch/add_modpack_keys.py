import json

def add_keys(path, new_keys):
    with open(path, 'r', encoding='utf-8') as f:
        data = json.load(f)
    for k, v in new_keys.items():
        data[k] = v
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=4)

fr_path = r'e:\Travaille\CodageAutres\Better Project\BetterModsManager\frontend\Lang\fr.json'
en_path = r'e:\Travaille\CodageAutres\Better Project\BetterModsManager\frontend\Lang\en.json'

fr_keys = {
    "modpack.modsAvailable": "mods disponibles",
    "modpack.modsSelected": "sélectionné(s)",
    "modpack.addModErrors": "{count} mod(s) ont échoué.",
    "modpack.depsCount": "dép.",
    "docs.modpacks.portability": "Portabilité Totale",
    "docs.modpacks.portabilityDesc": "Exportez votre configuration en un clic. Vos amis n'ont qu'à importer le fichier pour synchroniser leur jeu.",
    "docs.modpacks.howToCreate": "Comment créer un pack ?",
    "docs.modpacks.step1": "Allez dans l'onglet Modpacks et cliquez sur Créer.",
    "docs.modpacks.step2": "Donnez un nom et une description à votre pack.",
    "docs.modpacks.step3": "Ajoutez les mods souhaités. BMM récupérera automatiquement leurs signatures SHA-256.",
    "docs.modpacks.step4": "(Optionnel) Ajoutez des liens de téléchargement directs pour faciliter la vie de vos amis.",
    "docs.modpacks.step5": "Sauvegardez et cliquez sur Exporter pour obtenir votre fichier .bmp.",
    "docs.modpacks.intro": "Les Modpacks sont des collections de mods empaquetées dans un fichier .bmp. Ils utilisent des empreintes numériques (SHA-256) pour identifier vos fichiers, ce qui permet à vos amis de retrouver exactement les mêmes versions, même s'ils ont installé leurs mods différemment.",
    "docs.exploreLifecycle": "VOIR LE CYCLE DE VIE",
    "common.search": "Rechercher...",
}

en_keys = {
    "modpack.modsAvailable": "mods available",
    "modpack.modsSelected": "selected",
    "modpack.addModErrors": "{count} mod(s) failed.",
    "modpack.depsCount": "dep.",
    "docs.modpacks.portability": "Total Portability",
    "docs.modpacks.portabilityDesc": "Export your configuration in one click. Your friends just need to import the file to sync their game.",
    "docs.modpacks.howToCreate": "How to create a pack?",
    "docs.modpacks.step1": "Go to the Modpacks tab and click Create.",
    "docs.modpacks.step2": "Give your pack a name and description.",
    "docs.modpacks.step3": "Add the desired mods. BMM will automatically retrieve their SHA-256 fingerprints.",
    "docs.modpacks.step4": "(Optional) Add direct download links to make it easier for your friends.",
    "docs.modpacks.step5": "Save and click Export to get your .bmp file.",
    "docs.modpacks.intro": "Modpacks are collections of mods packaged into a .bmp file. They use digital fingerprints (SHA-256) to identify your files, allowing your friends to find exactly the same versions, even if they installed their mods differently.",
    "docs.exploreLifecycle": "VIEW LIFECYCLE",
    "common.search": "Search...",
}

add_keys(fr_path, fr_keys)
add_keys(en_path, en_keys)
print("Done!")
