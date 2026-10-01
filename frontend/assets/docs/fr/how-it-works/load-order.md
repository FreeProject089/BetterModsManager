# Ordre d'activation

Deux mods actifs qui fournissent le même fichier ne fusionnent pas : BMM copie des fichiers, donc
l'un des deux est celui que le jeu lit. Lequel, c'est une seule liste par profil qui le décide,
l'**ordre d'activation** : les mods sont appliqués du premier au dernier, et **le dernier qui fournit
un fichier le gagne**.

---

## Le modèle

L'ordre, c'est la liste `active_mods` du profil. Il n'y a ni seconde liste ni numéro de priorité :

- la position 0 est appliquée en premier, la dernière position en dernier et gagne chaque fichier
  qu'elle partage ;
- activer un mod l'ajoute à la fin, d'où « le dernier mod activé gagne » tant que tu ne réordonnes
  pas ;
- désactiver un mod le retire de la liste ; le réactiver le remet à la fin.

Rien n'a dû être migré quand l'ordre est devenu modifiable. La liste d'un profil était déjà l'ordre
dans lequel ses mods avaient été activés, c'est-à-dire exactement ce qui était sur le disque : un
profil existant s'ouvre avec son ordre actuel, et rien ne change pour qui n'y touche pas.

```mermaid
flowchart LR
    A["1 · Enhanced Textures<br/>fournit data/sky.dds"] --> B["2 · Weather Overhaul<br/>fournit data/sky.dds"]
    B --> DISK["sur le disque : le sky.dds de Weather Overhaul<br/>(appliqué plus tard, il gagne)"]
```

---

## Le changer

Ouvre l'ordre depuis une carte de profil (l'icône de liste), depuis la fenêtre de conflit
(**Ouvrir l'ordre d'activation**) ou depuis la palette de commandes (`Ctrl+K` → **Ordre
d'activation**).

| Pour | Fais |
|---|---|
| Déplacer un mod | Glisse sa ligne, ou sélectionne-la et appuie sur `Alt+↑` / `Alt+↓` |
| L'envoyer tout en haut ou tout en bas | Les flèches de la ligne, ou `Alt+Début` / `Alt+Fin` |
| Partir d'un ordre raisonnable | **Trier** : par nom, ou par date d'installation (le plus ancien d'abord met les mods récents en haut) |
| L'écrire dans le jeu | **Appliquer l'ordre** (`Ctrl+Entrée`) |
| Abandonner le brouillon | **Réinitialiser** |

Chaque raccourci est une commande de la palette, listée et réassignable dans Paramètres → Raccourcis
clavier ; ils n'agissent que quand la vue de l'ordre est ouverte.

Chaque ligne dit ce qu'elle fait aux autres — *Écrase 12 fichier(s) de X*, *3 fichier(s) écrasé(s)
par Y* — et suit le brouillon pendant que tu glisses, avant que rien ne soit écrit. Le pied de la
fenêtre compte les fichiers qui changeraient de main.

---

## Depuis la Bibliothèque de mods

Pas besoin de quitter la bibliothèque pour voir ou changer l'ordre du profil qu'elle affiche :

| Où | Ce que tu obtiens |
|---|---|
| L'icône de liste à côté du menu de tri | La vue complète de l'ordre ci-dessus, pour le profil de la bibliothèque |
| Le panneau de détail d'un mod | Un encadré **Ordre d'activation** : sa position (*Position 3 sur 12*), qui il écrase et qui l'écrase, et En haut / Monter / Descendre / En bas |
| Clic droit sur la carte d'un mod | Les mêmes quatre déplacements, et **Ouvrir l'ordre complet** |
| `Alt+↑` / `Alt+↓` / `Alt+Début` / `Alt+Fin` | Déplacer le mod sélectionné (commandes de la bibliothèque, réassignables comme les autres) |

Un déplacement fait depuis la bibliothèque s'applique tout de suite : pas de brouillon, le nouvel
ordre est enregistré et seuls les fichiers qui changent de main sont recopiés, exactement comme
**Appliquer l'ordre**. Le badge `#N` de chaque carte active est sa position, et le tri **Ordre
d'Activation** range la bibliothèque dans cet ordre. Un mod désactivé n'a pas de position : active-le
d'abord, il rejoint la fin.

---

## Ce qu'écrit « Appliquer l'ordre »

Le nouvel ordre est enregistré, puis **seuls les fichiers dont le gagnant a changé** sont recopiés,
depuis leur nouveau gagnant. Un fichier partagé dont le gagnant est le même dans les deux ordres n'est
pas réécrit, et un fichier fourni par un seul mod n'est jamais touché.

La copie est un déploiement comme un autre : elle passe par le gouverneur de ressources (un ticket
Deploy, la règle de vitesse du disque, une annulation qui s'arrête entre deux fichiers) et une seule
opération de mod à la fois.

Si elle échoue en route — une annulation, un fichier verrouillé par le jeu lancé — l'ordre est quand
même enregistré et le dossier du jeu est en retard sur lui. **Réappliquer** recopie le gagnant de
chaque fichier partagé, ce qui est aussi la réparation après une modification à la main du dossier du
jeu.

---

## La désactivation suit l'ordre

Quand un mod est désactivé, chaque fichier qu'il fournissait est remis depuis le mod **juste en
dessous** dans l'ordre qui fournit le même fichier ; s'il n'y en a aucun, depuis la sauvegarde
d'origine du jeu ; et si le jeu n'avait pas ce fichier, il est retiré. Voir [Conflits](doc-page:how-it-works/conflicts)
pour la règle de sauvegarde.

Les mods archivés (gardés en `.zip` dans le dossier des mods) sont des fournisseurs comme les autres :
leurs fichiers sont lus depuis le cache extrait quand ils doivent revenir.

!!! note "Deux bugs que cette page cachait"
    Avant que l'ordre devienne modifiable, désactiver un mod remettait la copie **la plus ancienne**
    d'un fichier partagé au lieu de celle juste en dessous (la liste de repli était construite du plus
    récent au plus ancien, puis lue à l'envers), et un mod archivé n'était jamais utilisé comme
    repli. Les deux sont corrigés et couverts par des tests qui déploient de vrais fichiers.

---

## Quand plusieurs mods s'activent d'un coup

Un modpack, **Tout activer**, une liste de mods `.mm`, une tâche planifiée, un BMMScript et un lien
`bmm://modpack/enable` finissent tous de la même façon : une fois leurs mods activés, un seul moteur
les place dans l'ordre. Il a trois modes.

| Mode | Dans l'app | Ce qui se passe |
|---|---|---|
| `top` | **Ils gagnent (placés en dernier)** | Le bloc passe après tout ce qui est déjà actif, dans son propre ordre : il gagne ce qu'il partage. Le défaut, et ce que les modpacks ont toujours fait. |
| `bottom` | **Les vôtres gagnent (placés en premier)** | Le bloc passe avant tout ce qui est déjà actif : les mods que vous aviez continuent de gagner. |
| `keep` | **Rien ne bouge** | Les mods déjà actifs gardent leur place ; les nouveaux restent là où l'activation les a mis, à la fin. |

Ce qui forme le bloc dépend de qui le demande :

- un **modpack** place tous ses mods, dans la séquence du pack (les flèches de son éditeur) ;
- **Tout activer** et une **liste de mods** ne placent que les mods qu'ils ont activés, pour qu'un
  ordre soigné ne soit jamais bousculé par un bouton qui voulait dire « active le reste ».

Quel mode s'applique :

1. celui que l'appelant nomme : le champ **Ordre d'activation** d'une étape de tâche, `placement:`
   en BMMScript, `order=` sur un lien `bmm://modpack/enable`, `order_mode` dans l'API ;
2. sinon l'**Ordre d'activation** propre au modpack (éditeur de modpack), qui voyage avec le pack
   (export `.bmp`, listes `.mm`, dépôts) ;
3. sinon le réglage par défaut, **Activation groupée** dans la vue de l'ordre (réglage
   `order_bulk_mode`, `top` s'il n'a jamais été choisi).

Seuls les fichiers qui changent de gagnant sont recopiés, comme avec **Appliquer l'ordre**.

---

## Partager un ordre

Un id, c'est le nom que *cette* machine donne à un mod, et un chemin n'est vrai qu'ici. Un ordre
partagé désigne chaque mod par ce qui survit au voyage : son empreinte de contenu, son id de dépôt,
son nom et sa version (et l'id local, pour un aller-retour sur le même PC).

**Partager** dans la vue de l'ordre donne le même ordre sous quatre formes :

| Forme | Ressemble à | Pour |
|---|---|---|
| Code | `BMMORDER1.eyJmb3Jt…` | un message de chat : une ligne |
| Lien | `bmm://order?d=BMMORDER1.…` | un clic ouvre l'aperçu d'import dans BMM |
| Liste | `1. Enhanced Textures`, `2. Weather Overhaul` | un post de forum ; lisible par tous |
| Fichier | `activation-order.json` | le garder à côté d'un pack |

**Importer** lit chacune de ces formes, une liste `.mm` collée en entier, ou une simple liste de
noms (un par ligne ; les puces `1.` et `-` sont acceptées). Chaque entrée est reliée par l'identité
la plus forte qu'elle porte : id local, puis empreinte, puis id de dépôt, puis le nom quand un seul
mod le porte (la version départage deux mods du même nom). L'aperçu indique ensuite :

- où chaque mod actif atterrit, et de combien de places il bouge ;
- combien de fichiers changeraient de gagnant ;
- ce qui est **non installé** et ce qui est **installé mais inactif** : un import n'active ni ne
  désactive rien, activez-les d'abord si vous voulez qu'ils soient placés ;
- quels mods actifs la liste ne connaît pas : ils **gardent leur place**.

Le résultat devient le brouillon de la vue. Rien n'est écrit avant **Appliquer l'ordre**. Un lien
`bmm://order` venu d'une page web est sans risque pour la même raison : il ne fait que remplir
l'aperçu.

Une liste `.mm` transporte l'ordre de son auteur (`load_order`, les mods qu'elle nomme). Appliquer
la liste (tâche **Appliquer une liste de mods**, **Importer un fichier** avec application) place les
mods qu'elle a activés selon le mode, puis met ceux qu'elle nomme dans l'ordre de l'auteur, sauf en
mode `keep`.

---

## Gardé avec vos données

L'ordre, c'est le `active_mods` du profil : un export des données, un export automatique et une
sauvegarde complète (`.databmm`) gardent l'ordre de chaque profil, et les restaurer le ramène.
Changer de profil ne change rien : chaque profil a son propre ordre.

---

## Depuis les scripts et les outils

| Surface | Lire | Écrire |
|---|---|---|
| API locale | `GET /api/mods/order`, `GET /api/mods/order/export`, `GET /api/mods/order/mode` | `POST /api/mods/order` (`order[]`, `profileId`, `reapply`), `POST /api/mods/order/import` (`text`, `dryRun`), `POST /api/mods/order/arrange` (`ids[]`, `mode`), `POST /api/mods/order/mode` |
| MCP | `bmm_get_mod_order`, `bmm_export_mod_order` | `bmm_set_mod_order`, `bmm_import_mod_order`, `bmm_arrange_mod_order`, `bmm_order_bulk_mode` |
| CLI | `bmm mod-order`, `bmm mod-order --export [code, link, text ou json]`, `bmm mod-order --bulk-mode` | `bmm mod-order --set a,b,c`, `--reapply`, `--import <code, lien, fichier ou ->` (`--dry-run`), `--arrange a,b --mode bottom`, `--mode keep` |
| Tâches, BMMScript | | `mods.order`, et `placement` sur `modpack.enable`, `mods.enableAll`, `modlist.apply` |

Un nouvel ordre doit contenir exactement les mods actifs : une liste avec un mod en moins ou en trop
est refusée, parce que l'appliquer laisserait dans le jeu des fichiers que rien ne revendique. Import
et placement ne peuvent pas enfreindre cette règle : ils ne déplacent que des mods déjà actifs.
