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

## Un catalogue peut porter ses applications

Une source est généralement un fichier JSON à une adresse. Ce peut aussi être un
**`.bmmbundle`** — un zip avec `catalog.json` à sa racine et les charges à côté.
**Sources → Suivre un .bmmbundle…** en suit un depuis le disque : un seul fichier à envoyer,
rien à héberger, et rien qui doive être encore en ligne l'année prochaine.

Les deux se mélangent dans un même document, entrée par entrée : un catalogue peut porter les
trois petits outils et pointer vers celui de 90 Mo que quelqu'un héberge déjà.

Une charge arrivée dans un bundle passe la **même barrière de somme de contrôle** qu'une
charge récupérée sur le réseau. Elle n'est pas plus digne de confiance ; elle est juste plus
proche. Une entrée dans un bundle ne peut nommer qu'un fichier voisin — chemins absolus,
lettres de lecteur, chemins UNC, segments `..` et tout schéma autre que http(s) sont refusés.

## Sur quoi porte la somme de contrôle

C'est le sha256 des **octets à l'URL de téléchargement** — l'installeur si l'entrée pointe
dessus, le zip si elle pointe sur un zip. Ce n'est *pas* l'empreinte de l'application une fois
installée : rien n'est installé au moment où BMM vérifie. La charge est hachée pendant qu'elle
s'écrit dans un fichier `.part`, et un écart signifie qu'elle n'est jamais renommée ni
exécutée.

La carte indique quelles entrées en publient une. Une somme absente est courante et ne prouve
rien en soi — c'est donc un contour discret, pas une alarme. Mais entre deux entrées qui
proposent la même application, c'est la différence à voir avant de cliquer.

## http est autorisé, et affiché

Beaucoup de petits catalogues sont servis depuis une machine sans certificat, et les refuser
signifie seulement que l'entrée n'arrive dans la liste de personne. Donc `http://` fonctionne
— et porte un marqueur ambre `http` dans **Sources**, sur la carte, et sur l'entrée pendant
que vous l'écrivez.

En http clair, qui est sur le chemin sert ce qu'il veut, **y compris un autre installeur et
une somme de contrôle qui lui correspond**. C'est pourquoi les deux marqueurs se lisent
ensemble : un « vérifiable » vert à côté d'une adresse http est la ligne la plus trompeuse
de l'écran, et elle le dit.

## En publier un

Dans **Créer**, une entrée prend une adresse *ou* un fichier. Confiez un fichier et BMM
remplit le type depuis son extension, la taille et la somme depuis ses octets. **Publier en un
seul fichier (.bmmbundle)** copie chaque fichier confié à côté du document et zippe le tout.

Le chemin absolu du fichier choisi n'atteint jamais le document publié.

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
