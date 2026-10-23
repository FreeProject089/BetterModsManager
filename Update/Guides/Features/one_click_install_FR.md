# 🚀 Documentation : Installation en 1 clic (bmm://)

Le protocole `bmm://` permet d'installer des mods directement depuis un lien web, un message Discord ou n'importe quelle autre application, sans avoir à télécharger manuellement le fichier et à l'importer dans Better Mod Manager.

## 🔗 Structure du lien
Pour qu'un lien soit reconnu par Better Mod Manager, il doit suivre ce format :

```text
bmm://import?url=[LIEN_DIRECT_VERS_LE_ZIP]&name=[NOM_DU_MOD]
```
### Paramètres :
- **url** (Obligatoire) : L'adresse URL directe de l'archive du mod (généralement un fichier .zip ou .rar).
- **name** (Optionnel) : Le nom par défaut qui sera suggéré dans la fenêtre de confirmation.

## 🛠️ Comment cela fonctionne-t-il ?
1. **Lancement** : Dès que vous cliquez sur un lien `bmm://`, Windows ouvre automatiquement Better Mod Manager.
2. **Détection** : Si l'application est déjà ouverte, elle passe au premier plan.
3. **Confirmation** : Une fenêtre "Installation en 1 clic" apparaît.
   - **Nom du mod** : Vous pouvez modifier le nom si celui suggéré ne vous convient pas.
   - **Profil de destination** : Vous choisissez dans quel profil le mod doit être installé.
4. **Installation** : Après validation, BMM télécharge le fichier, l'extrait dans le dossier des mods du profil sélectionné, et rafraîchit votre bibliothèque.

## ❓ FAQ & Aide

### Qu'est-ce qu'un "Lien Direct" (DDL) ?
BMM a besoin d'un **Direct Download Link (DDL)** pour fonctionner. C'est un lien qui pointe directement vers le fichier ZIP/RAR, sans passer par une page intermédiaire (comme une page de pub ou un bouton "Télécharger" sur un site).

- ✅ **Lien direct** : `https://site.com/mod.zip` (Le téléchargement démarre immédiatement).
- ❌ **Lien indirect** : Une page Mediafire, Mega (interface web) ou une page Nexus Mods (nécessite un compte/clic).

> [!TIP]
> Sur **GitHub**, vous pouvez obtenir un lien direct en faisant un clic droit sur un fichier dans une "Release" et en choisissant "Copier l'adresse du lien".

### Comment créer mon propre lien bmm:// ?
Vous pouvez générer un lien pour partager vos mods préférés avec vos amis. Utilisez cette structure :
1. Prenez l'URL de téléchargement direct de votre mod.
2. Utilisez un encodeur d'URL (facultatif si l'URL est simple) pour le paramètre `url`.
3. Assemblez le tout :
```text
bmm://import?url=VOTRE_URL&name=NOM_DU_MOD
```

### Pourquoi Tasky me demande-t-il une confirmation ?
C'est une sécurité essentielle. Cela empêche un site malveillant d'installer des fichiers sur votre ordinateur sans votre accord explicite. Vous gardez toujours le contrôle sur le nom et le profil de destination.

---
*Note : Assurez-vous que la structure du dossier du mod correspond aux attentes du jeu pour une installation réussie.*
