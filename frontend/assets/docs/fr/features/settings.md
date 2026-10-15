# Paramètres

Les Paramètres forment une longue page, mais la plupart se règlent une fois pour toutes. Ce
tour commence par la poignée qui change la *sensation* de BMM, puis parcourt le reste section
par section pour que rien ne reste un mystère.

<div class="bmm-replay" data-src="assets/docs/media/replays/settings.bmmreplay" data-remote="https://freeproject089.github.io/BMM-Docs/assets/replays/settings.bmmreplay" data-page="features/settings" data-title="Un tour des Paramètres"></div>


## Trouver un réglage

Le haut de la page est un **index** de toutes les cartes, en sept groupes : **Apparence**,
**Bibliothèque**, **Automatisation**, **Performances**, **Comptes et services**,
**Confidentialité et sécurité**, **Application** (le reste est sous **Autres**). Clique sur un nom
pour aller à sa carte.

**Rechercher un réglage** (:kbd[Ctrl+F] quand les Paramètres sont ouverts) masque toutes les cartes
qui ne correspondent pas à ce que tu tapes et indique combien de sections restent. Vide la case pour
tout revoir.

**Masquer l'index** (le bouton à côté de la recherche) donne toute la largeur aux cartes ; le
bouton **Index** au-dessus des cartes le fait revenir. BMM retient ce choix, et :kbd[Ctrl+F] fait
revenir l'index pour chercher. Dans une fenêtre étroite, l'index reste la bande au-dessus des
cartes.

Toutes les cartes ont la même anatomie : une icône sur une tuile discrète, le titre et les actions
de la carte, **une phrase** sous le titre qui dit à quoi sert la carte, puis les réglages en
**lignes** (un libellé et son contrôle), un pied de carte pour les boutons qui appliquent ou
exportent et, quand quelque chose est irréversible, une **zone de danger** en bas. Un petit lien
**En savoir plus** sur une carte ouvre la page de cette documentation qui l'explique, à la bonne
section.

Les cartes sont rangées par ce que tu utilises le plus, groupe par groupe :

| Groupe | Cartes, dans l'ordre |
|---|---|
| **Apparence** | Thèmes, Langue, Interface et notifications, Graphismes et affichage, Raccourcis clavier |
| **Bibliothèque** | Analyse et mises à jour des mods, Tags, Index de catalogues, Intégrité (SHA) |
| **Automatisation** | Launch Packs, Planification et automatisation |
| **Performances** | Stockage, Benchmark |
| **Comptes et services** | Identité & API, Token GitHub, Discord Rich Presence |
| **Confidentialité et sécurité** | Confidentialité et télémétrie, IA optionnelle, Sécurité (confiance des plugins), Sécurité |
| **Application** | Mise à jour automatique, Sauvegarde et restauration, Anciennes installations, Retours, Rapports de crash, Enregistreur de session, Debug |

**Modifier la disposition** (à côté de la recherche) te laisse arranger la page : fais glisser une
carte, ou appuie sur :kbd[Alt+Haut] / :kbd[Alt+Bas], pour la déplacer dans son groupe, et utilise
l'œil pour la masquer de la page (la recherche la trouve toujours). **Terminé** quitte le mode ;
**Partager la disposition** copie un code ou un lien `bmm://` à importer sur un autre PC, et
**Réinitialiser** rend l'ordre par défaut.

## Des panneaux dans leur propre fenêtre

L'**éditeur de thème**, le **studio de traduction** et le **débogueur de tâches** peuvent
quitter la fenêtre de BMM : appuie sur **Ouvrir dans sa propre fenêtre** dans leur en-tête, ou fais
glisser l'en-tête au-delà du bord de la fenêtre de BMM et lâche. Le panneau devient une fenêtre à
part que tu peux placer où tu veux, sur un autre écran aussi, à côté de ce sur quoi il travaille
plutôt que par-dessus.

Tout continue de fonctionner depuis là et reste synchronisé avec BMM : le panneau tourne toujours
dans BMM, la fenêtre l'affiche et renvoie tes clics et ta saisie. Elle suit le thème, clair ou
sombre.

- La fenêtre de chaque panneau retient sa taille et sa place.
- **Remettre dans la fenêtre de BMM** remet le panneau où il était ; son bouton de fermeture ferme
  le panneau. Fermer la fenêtre autrement (:kbd[Alt+F4], la barre des tâches) remet aussi le
  panneau en place.
- Dans cette fenêtre, les listes de choix s'ouvrent comme la liste du système, et faire glisser
  des éléments à l'intérieur du panneau (réordonner, redimensionner) se fait dans la fenêtre de
  BMM.

## Les quatre qui comptent le plus

### Thèmes & Apparence

Les encadrés d'explication à travers l'app — les astuces colorées — peuvent être masqués
partout d'un coup avec **Afficher les astuces** dans l'onglet Tasky d'Interface et notifications, une fois que tu
connais le chemin. Les avertissements sont exempts par conception : masquer les astuces ne
masque jamais rien de porteur.

> Personnalise chaque couleur, police et élément de BMM. Partage tes thèmes en un clic.

Ce n'est pas un interrupteur clair/sombre — c'est un éditeur de thèmes. Tu peux remplacer les
images intégrées de BMM (logo, fond d'écran, même la mascotte Tasky), et *ajouter tes propres
boutons, bannières, badges ou widgets n'importe où dans BMM*. Un thème s'exporte et s'importe
en fichier, et un catalogue de thèmes fonctionne comme l'[App Catalog](doc-page:features/apps). Vois
[Thèmes](doc-page:features/themes) pour tout le moteur.

Pars d'un des préréglages intégrés et ajuste. Le conseil de l'éditeur lui-même : survole un
libellé pour l'aide, clique sur **?** pour la doc MDN de la propriété CSS.

### Stockage & Smart I/O

Le réglage à connaître si BMM rend ton PC poussif pendant l'activation des mods :

> Limite la vitesse de lecture/écriture sur tes disques pendant l'activation des mods pour
> éviter les ralentissements. (0 = illimité)

L'**auto-calibration** teste vos disques et fixe une limite d'E/S pour chacun. Elle est
**active par défaut et se lance seule** — quelques secondes après le démarrage de BMM, et de
nouveau dès que vous la réactivez. Il n'y a aucun bouton à presser.

Elle ne mesure que les disques réellement utilisés par vos profils, et pose une limite par
disque : un NVMe rapide et un disque externe lent ont chacun leur plafond. C'est la différence
entre « les mods s'activent en arrière-plan » et « ma machine a gelé trente secondes ».

### Mises à jour

La carte **Mise à jour automatique** : vérifier ou non une nouvelle version de BMM au démarrage,
choisir le **canal de mise à jour** (**Stable** ou **Préversion**), et une **vérification en
arrière-plan** tant que BMM reste ouvert (**Désactivé**, **Toutes les 6 h**, **Chaque jour**). Elle
affiche la dernière vérification. Ce qui se passe quand une version est trouvée, et comment
l'installateur est vérifié avant de se lancer, est dans
[Mettre BMM à jour](doc-page:getting-started/install#mettre-bmm-a-jour).

Un contrôle distinct vérifie tes *mods* (voir [Dépôt Serveur](doc-page:features/repo)), à ne pas confondre avec
la mise à jour de l'app elle-même.

### Données

Exporte tout, réimporte. Fais un export avant toute manip dont tu n'es pas sûr : c'est
l'assurance la moins chère de l'app.

Deux formes, et la différence compte :

| | |
|---|---|
| **`.DATABMM`** | Un ZIP contenant tes réglages et tes profils **plus les fichiers** — thèmes, launch packs, automatisations, enregistrements de session, ta barre de navigation et chaque page personnalisée. Signé, pour qu'un lecteur puisse vérifier que c'est toujours l'archive que BMM a écrite. |
| **JSON** | Réglages et profils seulement. Plus petit, diffable, et lisible par toutes les anciennes versions de BMM — c'est pour ça qu'il est toujours proposé. |

Une sauvegarde JSON ne peut pas transporter de fichiers : inliner un enregistrement de
40&nbsp;Mo le transforme en une chaîne base64 de 55&nbsp;Mo dans un document que rien ne peut
lire en flux. C'est toute la raison d'être du `.DATABMM`.

Ne coche que les sections que tu veux ; chacune rapporte ce qu'elle a **réellement pris**, donc
une section demandée qui s'avère vide, tu l'apprends maintenant et pas le jour où tu en as
besoin.

!!! tip "La navigation, c'est trois endroits, et une sauvegarde a besoin des trois"

    Ta barre de navigation, la source de chaque page personnalisée, et les permissions et
    données stockées de chaque page vivent séparément. La section **Navigation et pages
    personnalisées** prend les trois. Deux sur trois restaure quelque chose de cassé : des
    boutons pointant sur des pages disparues, ou une page qui a perdu les permissions pour
    lesquelles elle a été écrite et qui échoue à la première chose qu'elle tente.

### La remettre en place

**Restaurer un `.DATABMM`** ouvre l'archive et te montre ce qu'elle contient *avant* d'écrire
quoi que ce soit : chaque section, sa taille, et si le fichier est toujours celui que BMM a
écrit. Tu coches ce que tu veux récupérer. Rien n'est coché pour toi — une boîte de
restauration déjà armée est une boîte qu'on valide sans lire.

Deux choses se comportent différemment du reste, et c'est volontaire :

| | |
|---|---|
| **Profils, mods et réglages** | **Remplace** ce que tu as ; ce n'est pas fusionné. Une fusion devrait inventer une réponse pour deux profils du même nom avec des dossiers différents. Ton `data.json` actuel est copié à côté d'abord, dans un fichier horodaté, et le message te dit où. L'ordre d'activation de chaque profil revient avec. |
| **Rapports de plantage et diagnostics** | Listés, et jamais restaurés. Ils décrivent ce qui est arrivé à une installation sur une machine — remettre ceux de l'an dernier ici donne un dossier de support qui ment sur l'app dans laquelle il se trouve. |

Une archive **non signée** se restaure normalement : tout ce qui a été écrit avant l'existence
des signatures est non signé. Celle qui doit t'arrêter, c'est *modifiée depuis sa signature*,
et l'écran le dit avec ces mots-là.

BMM recharge ensuite, parce que la moitié de l'app lit son état au démarrage.

!!! note "Ça reste un ZIP ordinaire"

    L'extension dit que le fichier appartient à BMM ; le contenu est une archive normale,
    exprès, pour que tu puisses toujours l'ouvrir avec n'importe quoi et en sortir un fichier
    à la main.

!!! danger "Réinitialisation d'usine"

    La section Debug peut remettre BMM à zéro. Elle demande confirmation. Il n'y a pas de
    retour en arrière — exporte tes données avant de t'en approcher.

## Tout le reste, section par section

### Langue

Change la langue de l'interface. Les langues sont de simples fichiers JSON dans le dossier
`Lang/` de l'app — en ajouter une ne demande **aucune recompilation**. La carte fournit tout :
un **Guide**, un **modèle** téléchargeable, un bouton **Importer**, et le **Studio de
traduction**, qui a [sa propre page](doc-page:features/translation-studio) : une fenêtre flottante (qui peut aussi
se détacher) pour traduire clé par clé, vérifier les variables, voir tes brouillons en direct dans
toute l'app, et importer ou exporter un fichier de langue.

Conserve le bloc `_info` (nom + drapeau affichés dans le sélecteur) et les groupes `_synonyms`
(ils alimentent la recherche sémantique dans ta langue). **Le français est la base** : une clé
non traduite retombe sur le FR ; une clé absente partout affiche son id brut. `en`, `fr` et le
modèle ne peuvent pas être supprimés.

<a id="graphics"></a>
### Graphismes et affichage
> Comment la fenêtre de BMM est dessinée. Cela ne concerne que l'interface, jamais tes jeux ni tes
> mods.

L'interface de BMM est une vue web (Microsoft WebView2), qui dessine avec une carte graphique comme
un navigateur. La carte a un lien **En savoir plus** et s'ouvre depuis la palette de commandes
(*Graphismes et affichage*).

| Choix | Ce que fait BMM | Quand le choisir |
|---|---|---|
| **Automatique** (par défaut) | N'ajoute rien : WebView2 et Windows choisissent. Un choix fait pour WebView2 dans **Paramètres → Affichage → Graphiques** de Windows s'applique toujours | Presque toujours |
| **Économie d'énergie** | Démarre WebView2 avec `--force_low_power_gpu` | Un portable à deux puces graphiques, pour économiser la batterie et la chaleur |
| **Hautes performances** | Démarre WebView2 avec `--force_high_performance_gpu` | Un PC à deux puces graphiques dont les animations saccadent |
| **Désactivé** | Démarre WebView2 avec `--disable-gpu --disable-gpu-compositing` : le processeur dessine | Seulement quand la fenêtre devient noire, se fige ou clignote à cause d'un pilote cassé |

**Désactivé** est l'ancien interrupteur *Accélération matérielle* : un seul réglage maintenant, pas
deux. Un choix enregistré par une ancienne version de BMM garde son sens.

- Le choix est lu **avant que la fenêtre existe** : il s'applique au **prochain démarrage**. La
  carte dit avec quel choix cette session a démarré, et propose **Redémarrer BMM maintenant**
  (après avoir demandé : un redémarrage arrête un déploiement ou une installation en cours).
- Sur un PC à **une seule** carte graphique, Économie d'énergie et Hautes performances l'utilisent
  toutes les deux ; la carte dit combien de cartes elle a trouvées.
- **Dessine la fenêtre en ce moment** nomme la carte qui dessine vraiment BMM, lue depuis la fenêtre
  elle-même (WebGL). S'il dit *le processeur* alors que le PC a une carte et que le choix n'est pas
  **Désactivé**, WebView2 est retombé sur un dessin logiciel, en général parce que le pilote est
  bloqué ou a planté : mettre à jour le pilote graphique règle le problème la plupart du temps.
- **Réduire les animations** termine tout de suite les transitions et les effets, quel que soit le
  thème (un thème peut aussi le faire avec `--bmm-anim-speed: 0` ; l'un ou l'autre suffit). Les
  indicateurs de progression continuent de tourner, lentement. Ça s'applique immédiatement. Le
  réglage Windows *afficher moins d'animations* est respecté aussi.
- **Animation de démarrage** (Classique avec Tasky, Logo ou Désactivée) : affichée pendant que BMM
  démarre ; un clic ou une touche la passe. Elle suit **uniquement** le réglage **Réduire les
  animations** de BMM et le style **Désactivée**, pas le réglage Windows *Effets d'animation*, et un
  démarrage rapide joue toute l'entrée au lieu de la couper.
- Replié en dessous : le matériel détecté par BMM (instructions du processeur, cartes graphiques,
  bus de chaque disque).
- Si tu as défini toi-même la variable d'environnement `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS`, BMM
  n'y touche pas, ni à aucun argument, et le choix est grisé.
- Le fichier derrière, c'est `boot-flags.json` dans le dossier de données de BMM. Il contient un
  interrupteur et un mot parmi trois ; rien n'en est jamais collé dans les arguments, et un fichier
  abîmé veut dire Automatique.

### Identité & API

Dans **Comptes et services**, et plus sous Automatisation.

> Tous tes identifiants importants au même endroit. Clique sur l'icône œil pour révéler une
> valeur.

Ton **creator ID**, le **token API** local, l'**URL et le port** de l'API, et la version de
l'app. L'[API locale](doc-page:reference/api) se lie à `127.0.0.1` sur le port **51274** par
défaut ; tu peux changer le port ici (effet après redémarrage). C'est aussi là que tu révèles
ou réinitialises le token API avec lequel les plugins et scripts s'authentifient.

### Confidentialité & Télémétrie

Accepte ou refuse les données d'usage anonymes, et gère les sous-options (rejeux de session,
capture complète, partage de benchmark) indépendamment. Tout est coupé sauf si tu l'actives, et
la page détaille exactement ce que chaque interrupteur envoie.

**Mes consentements** liste chaque réponse que tu as donnée sur les Conditions, la Politique de
confidentialité et la télémétrie, avec une preuve pour chacune : voir
[Confidentialité](doc-page:features/privacy-telemetry#preuve-du-consentement-mes-consentements).

### Sécurité (confiance des plugins)

Choisis la liberté accordée aux plugins : **accès complet** ou mode **limité/en bac à sable**.
C'est le garde-fou global des permissions par plugin que tu accordes dans
[Plugins & API](doc-page:features/plugins) — resserre-le si tu exécutes des plugins que tu ne connais pas.

La carte nomme le mode **en vigueur** dans son en-tête (une pastille verte pour l'accès complet,
une pastille accent pour le limité), et les deux lignes en dessous sont le choix : la ligne
active porte le rail accent et une icône allumée. Choisir l'autre ligne ne fait qu'activer
**Appliquer** — rien ne change tant que tu n'as pas appuyé, et la pastille se met à jour ensuite.

### Discord Rich Presence

Affiche ce que tu fais dans BMM sur ton profil Discord, ou coupe-le. Purement cosmétique.

### Launch Packs

Un Launch Pack est une **liste nommée d'exécutables qui démarrent ensemble**. Donne-lui un nom,
ajoute les chemins `.exe` (un jeu, un outil de reconnaissance vocale, une app de carte…),
choisis une icône, et un clic — ou un [deeplink](doc-page:reference/api), ou une [tâche
planifiée](doc-page:features/scheduler) — les lance tous.

!!! tip "Construis ta routine « je m'installe pour jouer »"

    Le but n'est pas de lancer des apps ; c'est de lancer *ta config* dans le bon ordre sans
    chercher cinq raccourcis. Fais un pack par jeu. Couple-le au [Planificateur](doc-page:features/scheduler)
    (un Launch Pack est une action planifiable) et « 18h : active mon modpack multi, puis lance
    tout » devient une seule automatisation.

### Planification & automatisation

Enregistre des tâches — appliquer un modpack, lancer un launch pack, exporter tes données — et
déclenche-les sur planning ou à la demande. Ça va bien au-delà d'une minuterie : conditions,
boucles et étapes « attendre que » permettent de vrais workflows. Voir
[Planificateur](doc-page:features/scheduler) pour le tableau complet.

### Storage Manager & benchmark

Deux outils liés vivent ici, tous deux sur la façon dont BMM déplace les fichiers.

Les **limites Smart I/O** (ci-dessus) rythment l'activation des mods pour ne pas monopoliser ton
disque. Le **Storage Manager** est là où tu fixes les plafonds par disque, et le **recalcul
SHA** reconstruit les hachages par fichier que compare la vérification d'[intégrité](doc-page:features/library)
— lance-le si tu as édité les fichiers d'un mod hors de BMM et veux que ses hachages collent à
nouveau à la réalité.

Le **benchmark** est l'outil qui vaut le coup d'être compris. Il ne lance pas un test de vitesse
disque générique — il exécute les **vraies opérations d'activation, désactivation et annulation**
de BMM contre un espace de travail contrôlé et rapporte le débit réel. C'est pourquoi
l'**auto-calibration** l'utilise pour fixer tes limites d'E/S : il mesure exactement le travail
que fait l'activation, sur ton matériel exact.

!!! tip "Sandbox vs réel, et quand le lancer"

    Lance le benchmark sur le jeu de données **sandbox** (synthétique, sûr, reproductible) pour
    comparer du matériel ou des réglages ; lance-le sur **réel** (les mods de ton profil actif)
    pour voir ce qu'une grosse activation te coûte vraiment. Les tailles vont de **S → XL**, ou
    **Custom** pour une taille de données exacte. Lance-le une fois après un changement de
    matériel, laisse l'auto-calibration fixer tes limites, et oublie-le.

### Tags

Gère tes tags de mods personnalisés — les libellés par lesquels tu filtres la
[Bibliothèque](doc-page:features/library). Crée-les, modifie-les et supprime-les ici, au même endroit.

Un tag, c'est plus qu'un mot coloré :

| | |
|---|---|
| **Icône** | Choisis parmi 2000+ glyphes [Lucide](https://lucide.dev), 3400+ icônes de marques, ou importe ta propre petite image. Le même sélecteur sert aux icônes de profil et à la création de plugin. |
| **Dégradé** | Coche *dégradé* pour donner une seconde couleur au tag — la pastille fond de l'une vers l'autre au lieu d'une teinte plate. |
| **Modifier** | Le crayon sur une pastille la recharge dans le formulaire ; le bouton devient *Enregistrer*, et *Annuler* ressort sans rien toucher. |

L'icône voyage avec le tag : comme elle est stockée sous forme de simple référence, un tag
garde son glyphe à travers tous les partages — profil exporté, [dépôt serveur](doc-page:features/repo),
catalogue — sans rien de plus à faire.

### Interface et notifications

Une seule carte à quatre onglets : **Notifications** (ci-dessous), **Tasky** (la mascotte et les
bulles d'explication), **Son** (les sons de l'interface et leur volume) et **Barre d'outils** (les
boutons de la barre d'outils de la Bibliothèque). Chaque onglet montre d'abord les lignes de tous
les jours ; **Plus d'options** déplie le reste et **Moins d'options** le replie.

### Notifications

Tout ce que BMM te dit arrive dans **un seul centre de notifications** (la cloche), avec un seul
compteur de non-lus, affiché aussi sur l'icône de la barre des tâches. Les messages sont groupés
selon leur origine :

| Groupe | Ce qu'il contient |
|---|---|
| **Mises à jour** | Nouvelles versions de BMM, vérifications de mise à jour |
| **Dépôts suivis** | Les dépôts que tu suis : nouveaux mods, téléchargements |
| **Planificateur** | Tes automatisations et leurs résultats |
| **Tâches de fond** | Les tâches longues (15 secondes ou plus) qui se terminent pendant que BMM est en arrière-plan |
| **BetterCommunity** | Les messages de ton compte BetterCommunity |
| **BMM** | Tout le reste de ce que BMM te dit |

**Comment chaque type de notification vous parvient** règle chaque groupe sur **Dans
l'application**, **Dans l'application et en notification système** (celle du système seulement
quand BMM est en arrière-plan), ou **Désactivé (gardé dans la liste)**. Les anciens
interrupteurs par source sont repris. **Envoyer une notification de test** montre à quoi
ressemble une bulle.

**Ne pas déranger**, depuis la cloche ou ici, met les bulles en pause jusqu'à ce que tu le
désactives. **Heures calmes chaque jour** (De … à …) fait la même chose selon un horaire. Pendant
le calme, rien ne s'affiche et aucune notification système n'est envoyée. **Les erreurs
s'affichent quand même dans l'application, et tout reste dans le centre de notifications** : une
erreur que personne ne voit et que personne ne pense à aller chercher, c'est une appli qui a
échoué en silence.

Dans le centre, chaque message peut être **ouvert** (quand il mène quelque part, par exemple une
mise à jour disponible ou un dépôt suivi), **reporté** (1 heure, 4 heures, demain 9 h) ou écarté.
Un message reporté revient non lu à son heure, ou tout de suite avec **La remettre maintenant**.
Le même évènement deux fois, c'est une bulle et une entrée avec un compteur, pas une pile de
copies ; une mise à jour retrouvée par une vérification suivante rafraîchit son entrée. La liste
garde les 200 derniers messages et rien de plus de 30 jours.

Clavier dans le centre : :kbd[Haut] et :kbd[Bas] passent d'un message à l'autre, :kbd[Entrée]
ouvre, :kbd[Suppr] écarte, :kbd[S] reporte d'une heure, :kbd[Échap] ferme et revient à la cloche.

### Son

Active/coupe les sons de l'interface. Le volume est une ligne de la même table : le curseur se
remplit jusqu'à son niveau, et le chiffre à droite est la valeur enregistrée (appliquée pendant que
tu glisses, sans bouton Enregistrer).

### Raccourcis clavier

Une table de tous les raccourcis, avec recherche, où tu peux réassigner une commande ou ajouter ton
propre raccourci pour une carte des Paramètres, un profil, un modpack ou une automatisation. Tout
est dans [Palette de commandes et raccourcis](doc-page:features/command-palette#raccourcis-clavier).

### Navigation & pages personnalisées

**Personnaliser la navigation** (le crayon en bas de la barre latérale) réarrange la barre latérale et
y ajoute tes propres boutons et pages. Elle a [sa propre page](doc-page:features/navigation). L'ensemble voyage en
code `bmm://` ou en bundle — voir la note sur les sauvegardes plus haut : la disposition, la
source de chaque page et ses permissions sont trois choses séparées.

Importer un `.bmmnav` partagé crée ses pages **sans aucune permission** : une vérification
liste ce que chaque page demande, rien de coché, et seul ce que tu coches est accordé — voir
[Modèle de sécurité](doc-page:how-it-works/security#custom-pages-review).

### Enregistreur de session (local)

Dans **Application**, à côté des rapports de plantage.

Enregistre ce qui se passe à l'écran — tes actions plus les logs JS et Rust — pour qu'un
problème puisse être rejoué et analysé plutôt que décrit. **Rien n'est envoyé nulle part :**
l'enregistrement reste sur cette machine et c'est toi qui l'exportes si tu veux le partager.
À distinguer de la télémétrie ci-dessus, qui est opt-in et part vers un serveur ; celui-ci
produit un fichier et s'arrête là.

Les champs sensibles sont masqués à la capture, donc les valeurs en clair n'entrent jamais
dans l'enregistrement — voir [Confidentialité et télémétrie](doc-page:features/privacy-telemetry).

### Analyse et mises à jour des mods

À quel point BMM rescanne ton dossier de mods et interroge les dépôts d'où ils viennent. À
regarder si ta bibliothèque est très grosse et que tu veux alléger le démarrage.

### Token GitHub

Un token d'accès personnel optionnel, utilisé quand BMM parle à GitHub (vérifs de release,
téléchargements bruts) pour éviter la limite de débit anonyme plus stricte. Optionnel — n'en
ajoute un que si tu atteins les limites.

### Tutoriel

Rejoue les tutoriels interactifs de l'app à tout moment. Nouveau sur BMM ? Commence ici. Le guide
du tutoriel peut **se détacher dans sa propre fenêtre**, pour le garder à côté de BMM pendant que tu
suis les étapes. Tous les tutoriels ont été réécrits pour la 1.0.3, avec de nouvelles parties :
suivre un dépôt, conflits et ordre d'activation, notifications, créer un plugin, et Outils BMM. Le
tutoriel des Automatisations est maintenant dans Plugins & API.

### Debug & outils développeur

Diagnostics, outils de rapports de crash, et la **réinitialisation d'usine** notée plus haut.
Pratique quand quelque chose cloche ; la réinit est le seul contrôle de toute l'app sans retour
en arrière, donc protégé par une confirmation. Les outils développeur donnent aussi accès aux
[Outils BMM](doc-page:features/tools) et aux [studios Replay et Animation](doc-page:features/tools#replay-studio-et-animation-studio).
