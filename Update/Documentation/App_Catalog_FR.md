# App Catalog

La page **App Catalog** permet de découvrir, installer, lancer et mettre à jour des applications et outils compagnons directement depuis BMM.

## Sources

Le catalogue agrège plusieurs types de sources :

| Source | Description |
|---|---|
| **Officielle** | Maintenue par l'équipe BMM |
| **Partenaire** | Catalogues tiers de confiance |
| **Communautaire** | N'importe quelle URL de catalogue que vous ajoutez |

Une source est un simple **fichier JSON** (voir *app-catalog format* dans la doc développeur) listant des apps avec nom, description, icône, URL de téléchargement, version et checksums optionnels. Vous pouvez ajouter ou retirer des sources communautaires dans les réglages du catalogue.

> ⚠️ N'ajoutez que des sources de confiance — installer une app exécute son installateur/exécutable sur votre machine.

## Installer & lancer

- Cliquez **Installer** sur une carte : BMM télécharge l'app, la vérifie quand un checksum est fourni, et suit la version installée.
- Les apps installées affichent une action **Lancer** directement sur leur carte.
- Quand la source publie une version plus récente, la carte propose une **Mise à jour**.
- Désinstaller supprime les fichiers suivis.

## Détection d'exécutables

Pour les apps installées hors de BMM, le catalogue peut **détecter les exécutables existants** : la carte passe en « installée » au lieu de proposer un téléchargement en double.

## Dépannage

- *« App catalog sources failed »* dans les logs signifie qu'une de vos URLs de source est injoignable (faute de frappe, serveur hors ligne, URL d'exemple). Retirez ou corrigez la source dans les réglages du catalogue.
- Les téléchargements respectent les limites d'E/S disque de BMM et s'annulent comme tout autre transfert.
