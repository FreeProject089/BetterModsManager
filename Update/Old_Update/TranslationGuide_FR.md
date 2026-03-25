# Guide de traduction - Better Mod Manager

Vous voulez ajouter votre propre langue à BMM ? C'est très facile !

## 1. Créer le fichier
Naviguez vers le dossier `frontend/Lang` dans le répertoire de l'application.
Créez un nouveau fichier au format `.json`, par exemple `es.json` pour l'Espagnol ou `de.json` pour l'Allemand.

## 2. Structure du fichier
Le fichier doit commencer par un bloc `_info` qui définit le nom de la langue et son drapeau.
Pour le drapeau, vous pouvez utiliser soit un emoji standard (ex: emoji drapeau standard), soit un **code pays ISO à 2 lettres** (ex: "us", "fr", "de").
BMM convertira automatiquement les codes ISO en icônes de drapeaux de haute qualité !

```json
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

## 3. Détection automatique
Dès que vous sauvegardez votre fichier dans le dossier `Lang`, BMM le détectera au prochain démarrage et l'ajoutera automatiquement au sélecteur de langue en bas à gauche !

## 4. Partage
N'hésitez pas à partager vos fichiers de traduction sur notre Discord afin qu'ils puissent être officiellement intégrés dans les prochaines mises à jour.

---
*Astuce : Utilisez le bouton "Copier le modèle" dans les Paramètres pour obtenir toutes les clés à traduire d'un coup !*
