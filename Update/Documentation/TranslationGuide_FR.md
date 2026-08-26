# Guide de traduction - Better Mod Manager

> 📚 **La voie confortable :** aucun besoin d'éditer des fichiers à la main. **Réglages → Langue**
> propose un modèle téléchargeable, un bouton **Importer**, et le **Bac à sable de traduction** —
> créez une langue, traduisez clé par clé avec aperçus en direct et barre de progression, puis
> exportez/importez. Guide complet : [BMM Docs — Paramètres → Langue](https://freeproject089.github.io/BMM-Docs/fr/features/settings/)
> et l'article **Help & other → Traduire BMM** dans l'app. La suite de ce fichier couvre la voie
> manuelle par fichiers.

Vous voulez ajouter votre propre langue à BMM ? C'est très facile !

## 1. Créer le fichier
Allez dans le dossier `Lang/` de l'app — à côté de l'application installée (dans un checkout de
développement, c'est `frontend/Lang`). Si vous ne voulez pas le chercher, **Réglages → Langue →
Importer** y copie votre fichier pour vous.
Créez un nouveau fichier au format `.json`, par exemple `es.json` pour l'Espagnol ou `de.json` pour l'Allemand.

## 2. Structure du fichier
Le fichier doit commencer par un bloc `_info` qui définit le nom de la langue et son drapeau.
Pour le drapeau, vous pouvez utiliser soit un emoji standard, soit un **code pays ISO à 2 lettres** (ex: "us", "fr", "de").
BMM convertira automatiquement les codes ISO en icônes de drapeaux de haute qualité !

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

## 3. Détection automatique
Dès que vous sauvegardez votre fichier dans le dossier `Lang`, BMM le détectera au prochain démarrage et l'ajoutera automatiquement au sélecteur de langue en bas à gauche !

## 4. Synonymes Sémantiques (`_synonyms`)

BMM intègre un moteur de recherche sémantique dans l'onglet Documentation. Pour aider le moteur à trouver des résultats quelle que soit la langue, chaque fichier de traduction peut définir une liste de groupes de synonymes.

*   **Fonctionnement** : BMM fusionne les groupes de synonymes de *tous* les fichiers de langue chargés au démarrage.
*   **Format** : Un objet dont chaque clé est un **terme canonique** (le pivot) et la valeur est un **tableau de chaînes** (les synonymes).
*   **Création de groupes** : Vous pouvez créer n'importe quelle nouvelle clé. Si un autre fichier de langue utilise la même clé, BMM combinera automatiquement les deux listes de mots.

```json
"_synonyms": {
  "mon_concept": ["mot1", "mot2", "mot3"],
  "activation": ["activer", "installer", "allumer"]
}
```

## 5. Tutoriels Vidéo Localisés (v0.9.9)
BMM supporte les tutoriels vidéo localisés. Vous pouvez définir des liens YouTube spécifiques et des chemins MP4 locaux pour votre langue via les clés `docs.videos`.
Pour plus de détails, consultez le [Guide des Vidéos Localisées](../Guides/Translation/video_localization_FR.md).

## 6. Validation
- Assurez-vous que le JSON reste valide (utilisez un validateur si besoin).
- Vérifiez l'absence de virgules traînantes ou de clés en double.
- Relancez BMM pour voir vos changements appliqués.

## 7. Partage
N'hésitez pas à partager vos fichiers de traduction sur notre Discord afin qu'ils puissent être officiellement intégrés dans les prochaines mises à jour.

---
*Astuce : Utilisez le bouton "Copier le modèle" dans les Paramètres pour obtenir toutes les clés à traduire d'un coup !*
