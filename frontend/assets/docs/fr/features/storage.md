# Stockage & E/S disque


> Limites de vitesse par disque, alertes d'espace, et comment BMM copie les fichiers sans figer ton PC.

Ouvre-le depuis **Réglages → Stockage → Ouvrir le Gestionnaire de Stockage**. Il répond à trois
questions : combien d'espace il reste, à quelle vitesse va chaque disque, et jusqu'où BMM a le droit
de solliciter tes disques. Il est organisé en [onglets](#tabs).


*Enregistrement provisoire — un clip ciblé de cet écran le remplacera.*

## Les deux réglages qui comptent le plus

:::tip[Smart I/O — fluide vs. rapide]
**Smart I/O** (activé par défaut) copie les fichiers de mods via un pool de threads borné avec de
petites pauses régulières, pour que l'interface reste réactive pendant une grosse activation.
Désactive-le et les copies saturent tous les cœurs CPU pour une vitesse maximale — plus rapide, mais
l'app (et le reste de la machine) peut saccader jusqu'à la fin.
:::

:::tip[Auto-calibration des performances]
Activée par défaut. BMM benchmarke les disques que tes profils utilisent vraiment et te fixe une
limite de vitesse par disque, à environ 70 % de la vitesse d'écriture mesurée. Il le fait une fois
par disque, puis seulement quand la dernière mesure de ce disque a plus de 30 jours, quelques
secondes après le démarrage. Il ne mesure plus chaque disque à chaque lancement. Laisse-la activée
sauf si tu veux régler les limites à la main.
:::

<a id="tabs"></a>
## Les onglets
Le Gestionnaire de Stockage est découpé en cinq onglets. La ligne du haut, au-dessus des onglets, dit
toujours quel preset est en vigueur et si une application tourne. Chaque onglet s'ouvre sur une
phrase qui dit à quoi il sert et un lien **En savoir plus** vers la partie correspondante de cette documentation ;
chaque réglage a une infobulle. La première fois, une courte carte explique la fenêtre ; **Compris**
la masque pour de bon.

| Onglet | À quoi il sert |
|---|---|
| **Disques et espace** | Le remplissage de chaque disque, les [profils](doc-page:features/profiles) qui y vivent, les alertes d'espace faible, l'**auto-calibration**, et une **limite de vitesse** par disque avec son benchmark ([plus bas](#per-disk-cards)) |
| **Intensité de travail** | Quelle part de ton PC BMM peut utiliser pour le travail lourd : les trois presets, chacun avec ce qu'il change pour toi, et **Smart I/O** |
| **Mode application** | Si BMM s'efface pendant qu'une autre application tourne, et les applications qu'il surveille |
| **Activité en direct** | Quatre courbes en direct et tout ce que fait BMM, avec **Suspendre**, **Reprendre** et **Annuler** |
| **Règles par disque** | Des règles fines, facultatives, pour un disque et une sorte de travail, avec une légende de chaque colonne |

L'onglet utilisé en dernier s'ouvre la fois suivante.

### Intensité de travail : les presets

L'onglet, c'est le [gouverneur de ressources](doc-page:how-it-works/resources) : l'endroit unique qui
décide combien d'opérations lourdes tournent en même temps, sur combien de threads, et à quelle
vitesse elles peuvent écrire.

| Preset | Ce que ça change pour toi |
|---|---|
| **Silencieux** | BMM se fait oublier pendant que tu utilises d'autres applications. Les déploiements et installations prennent plus de temps |
| **Équilibré** (par défaut, recommandé) | Le BMM habituel : rapide, et ton PC reste utilisable. Exactement le fonctionnement de toujours |
| **Tout pour BMM** | Tout finit aussi vite que tes disques le permettent. Ton PC peut sembler lent pendant ce temps |

**En vigueur** dit le preset appliqué en ce moment : le mode application ou une tâche planifiée peuvent en
changer un temps, et ton choix revient tout seul ensuite. Les chiffres exacts de chaque preset sont
dans [Les presets](doc-page:how-it-works/resources#presets).

<a id="mode-jeu"></a>
### Mode application
Le mode application (appelé mode jeu auparavant) vaut pour toute application dont BMM gère les
mods : un jeu, mais aussi Blender, un simulateur ou tout programme que tu choisis. **Le détecter**
(par défaut), **Forcer**, **Arrêter**. L'onglet dit en clair ce qui se passe : quelle application a
allumé le mode application (*Une application tourne : SkyrimSE.exe*), où BMM l'a trouvée (*dans le
dossier de l'application de ton profil « Skyrim SE »*, *dans ta liste d'applications*, *en plein
écran exclusif*), depuis combien de temps, ce qui est retenu en ce moment et, une fois l'application
fermée, dans combien de temps BMM revient à la normale.

- **Tout suspendre jusqu'à ce que je ferme l'application** retient toutes les opérations,
  déploiements compris, et les relâche toutes seules quand le mode application se termine (ou quand
  tu appuies sur **Tout reprendre**).
- **Pendant que l'application tourne** : coche ce qui attend que tu fermes l'application : vérifications de
  fichiers (empreintes), maintenance et benchmarks de disque (cochés par défaut), téléchargements,
  analyses de dossiers, décompression et compression d'archives, traitement d'images. Activer des
  mods, installer et sauvegarder sont ralentis, jamais retenus.
- **Retour à la normale après** : le délai après la fermeture de l'application, de 5 à 600 secondes (30 par
  défaut).
- **Me prévenir quand le mode application s'allume ou s'éteint** : un avis à chaque changement automatique
  (activé par défaut).
- **Compter aussi toute fenêtre plein écran** : attrape les applications en fenêtre sans bordure qui ne sont
  dans aucune liste, mais une vidéo plein écran compte aussi, d'où le réglage désactivé par défaut.
  Les navigateurs, lecteurs vidéo, messageries et lanceurs de jeux ne comptent jamais, en plein
  écran ou dans le dossier d'un profil, sauf si tu les ajoutes toi-même à ta liste.
- **Applications surveillées par BMM** : le dossier de l'application de chaque profil est surveillé
  tout seul, chacun avec un interrupteur pour l'ignorer (un disque entier n'est jamais surveillé) ;
  en dessous, les programmes que tu as ajoutés (`eldenring.exe`, `blender.exe`…), chacun avec un
  bouton de retrait, ajoutés par leur nom, avec **Parcourir…** (le `.exe` de l'application) ou avec
  **Choisir un programme lancé…** (lance l'application, puis choisis-la dans la liste).

Les détails et le coût d'un coup d'œil sont dans
[Comment marche la détection](doc-page:how-it-works/resources#comment-marche-la-detection).

### Activité en direct

Quatre courbes (le CPU de BMM, le CPU de tout le PC, les lectures et écritures de BMM en Mo/s) et
chaque opération en cours, suspendue ou en attente, avec **Suspendre**, **Reprendre** et **Annuler**,
plus **Tout suspendre** et **Tout reprendre**. Les valeurs sont mesurées une fois par seconde, et
seulement quand ça sert : le Gestionnaire de Stockage est ouvert, un des onglets **Intensité de
travail**, **Mode application** ou **Activité en direct** est affiché, et la fenêtre de BMM n'est pas cachée.
Sinon BMM ne se mesure pas du tout.

### Règles par disque

Des règles pour un disque et une sorte de travail (Mo/s, en même temps, tampon, priorité). Une
légende au-dessus du tableau dit ce que fait chaque colonne. Une case vide hérite, et son texte gris
dit la valeur en vigueur et d'où elle vient ; une case grisée ne s'applique pas à son opération.

!!! warning "Lis sur quoi agit chaque colonne"

    Les Mo/s agissent sur les copies de BMM, sur l'extraction, sur les zip que BMM écrit et sur les
    téléchargements de dépôt et de modpack ; le tampon et une priorité *basse* agissent sur les
    copies de BMM et sur l'extraction zip. Une case qui n'agit sur rien pour son opération est
    grisée : les lignes **Analyse** et **Empreintes** en entier, par exemple. Un mod téléchargé
    depuis un lien n'est pas encore cadencé. Les détails sont sur
    [la page du gouverneur](doc-page:how-it-works/resources#sur-quoi-agit-chaque-colonne).

<a id="presets"></a>
### Préréglages pour ce PC
Au-dessus du tableau, **Préréglages pour ce PC** remplit tout le tableau d'un coup. BMM lit tes
disques (taille, espace libre, SSD ou disque dur, externe ou non, et quel disque porte le jeu, les
mods et les sauvegardes de chaque profil), recommande un préréglage et dit pourquoi. Choisir une
carte n'applique rien : elle montre chaque changement, une ligne chacun, et **Appliquer** les écrit.
**Annuler** remet ce que le dernier changement a remplacé, tant que BMM reste ouvert.

| Préréglage | Intensité de travail | Règles écrites | Alertes d'espace |
|---|---|---|---|
| **Équilibré** | Équilibré | aucune | activées, à la taille de tes disques |
| **Discret** | Silencieux | aucune | activées, à la taille de tes disques |
| **Performance / SSD** | Max | sur chaque disque dur : sauvegardes en priorité basse | activées, à la taille de tes disques |
| **Petit SSD + grand HDD** | Équilibré | disque dur : pas de 512 Kio, une sauvegarde à la fois, sauvegardes et archives en priorité basse ; SSD : installations et extraction par pas de 4 Mio | activées, à la taille de tes disques |
| **Économe en espace** | Équilibré | aucune | activées, plus tôt (environ 10 points de plus) |
| **Disques externes** | Équilibré | chaque disque USB ou amovible : pas de 256 Kio, priorité basse, une sauvegarde à la fois | activées, à la taille de tes disques |

- **À la taille de tes disques** : l'avertissement vise environ 30 Go libres et le niveau critique
  environ 10 Go, sur le plus petit disque utilisé par tes profils (entre 10 et 40 % pour
  l'avertissement). Sous le niveau critique, BMM refuse d'activer des mods sur ce disque.
- Un préréglage qui n'a rien à régler (pas de disque dur pour *Petit SSD + grand HDD*, pas de disque
  externe pour *Disques externes*) est grisé et ne peut pas être appliqué.
- **Les plafonds de vitesse sont gardés.** Le plafond d'un disque (Disques et espace, ou le
  benchmark) reste tel quel ; toutes les autres règles du tableau sont remplacées, et l'aperçu liste
  celles qui partent.
- Si un disque est branché ou une règle modifiée entre l'aperçu et **Appliquer**, BMM refuse et te
  demande de revoir l'aperçu.
- Il n'y a pas de préréglage « tout mettre sur un autre disque » : une règle cadence le travail sur
  un disque, elle ne choisit pas le disque. L'endroit où vivent le jeu, les mods et les sauvegardes
  se règle dans chaque profil.

!!! note "Les graphismes ont déménagé"

    Quelle carte graphique dessine la fenêtre de BMM est un réglage de toute l'application :
    **Réglages → Graphismes et affichage** ([détails](doc-page:features/settings#graphics)).

<a id="per-disk-cards"></a>
## Cartes par disque
Chaque disque du système a une carte :

| Élément | Ce qu'il t'indique |
|---|---|
| **Badge de type** | SSD / HDD / Inconnu, plus **Cloud** ou **Réseau** si détecté (Drive, OneDrive, Dropbox, MEGA, iCloud, NAS). |
| **Barre UTILISÉ** | Utilisé vs. total, colorée bleu → ambre (>70 %) → rouge (>90 %). |
| **Barre PROFILS** | Taille totale des mods de profils sur ce disque vs. espace libre — colorée selon tes seuils d'alerte. |
| **Pastilles de profil** | Quels [profils](doc-page:features/profiles) utilisent le disque, et comment (dossier de l'application / dossier mods / sauvegarde). |

!!! note "Les badges Cloud/Réseau sont heuristiques"

    La détection compare le **nom du disque ou son point de montage** à des chaînes de
    fournisseurs connus (« OneDrive », « google »…), donc un disque au nom inhabituel peut être
    mal étiqueté — et un disque qui se trouve simplement sous un dossier synchronisé peut être
    étiqueté correctement sans être lui-même un disque cloud. C'est un indice, pas une garantie.

## Ce que tu peux faire

=== "Limiter la vitesse d'un disque"

    Saisis une limite en **Mo/s** sur la carte du disque. `0` signifie **Illimité** (pas « bloqué »).
    Utile pour empêcher un HDD lent ou un disque cloud de ralentir toute la machine pendant une
    grosse copie. Enregistré après une courte pause.

    La limite est partagée : chaque copie qui écrit sur ce disque puise dans le même budget, donc
    deux copies en même temps restent ensemble sous la limite au lieu de l'avoir chacune. C'est le
    même chiffre que la règle avancée *ce disque, toutes les opérations* : change l'un, l'autre suit.

=== "Benchmarker un disque"

    **Benchmarker ce disque** écrit et relit un fichier temporaire de 50 Mo et rapporte les Mo/s en
    lecture/écriture plus une limite suggérée (~70 % de la vitesse d'écriture). **Appliquer la
    suggestion** inscrit cette valeur comme limite.

    La lecture se fait sans le cache du système, donc elle mesure le disque et pas la mémoire qui
    garde le fichier tout juste écrit. Le benchmark tourne comme une maintenance de fond : il attend
    pendant qu'on active ou installe des mods, et pendant le mode application.

=== "Tout réinitialiser"

    **Réinitialiser les limites** remet chaque limite par disque sur Illimité.

!!! warning "Le benchmark exige un accès en écriture"

    La sonde de 50 Mo est écrite sur le disque puis supprimée. Sur un disque en lecture seule ou
    verrouillé par les permissions, elle renvoie *Accès refusé* — c'est attendu, pas un bug.

## Alertes d'espace faible

Active **Alerte d'espace faible** pour que les barres PROFILS te préviennent avant qu'un disque se
remplisse. Deux seuils (pourcentage d'espace libre) :

- **Avertissement %** — la barre passe à l'ambre (40 % par défaut).
- **Critique %** — la barre passe au rouge (30 % par défaut).

BMM garde automatiquement *avertissement > critique*. Ces seuils alimentent aussi les vérifications
d'espace au moment de l'activation.

## Mods archivés & le cache temporaire

Un mod stocké en archive (`.zip`, `.7z`, `.rar`, `.tar[.gz]`) **reste compressé** dans ton dossier
de mods — c'est le gain de place. BMM ne l'extrait dans un cache temporaire que quand les fichiers
sont vraiment nécessaires, et chaque fonction (hachage, intégrité, conflits, le mapper) le traite
exactement comme un mod décompressé. Voir [la Bibliothèque](doc-page:features/library) pour le flux des mods
archivés.

!!! note "Où vit le cache"

    Les copies extraites vont dans le dossier temp du système (`%TEMP%/bmm_mod_cache/…`), indexées
    par la taille + la date de modification de l'archive — donc remplacer l'archive ré-extrait
    automatiquement. L'OS vide le temp à son propre rythme ; BMM ré-extrait à la demande. Il n'y a
    **pas** de bouton « vider le cache » intégré, volontairement — rien n'y est précieux.

## Une note sur le hachage vs. les E/S

Les limites de vitesse et Smart I/O gouvernent la *copie*. Le **hachage** d'intégrité (SHA / BLAKE3)
est un système séparé avec ses propres réglages (hachage paresseux, animation de chargement). Les
grosses activations sautent souvent le re-hachage exprès — voir
[Intégrité & hachage](doc-page:how-it-works/integrity-hashing).

Le gouverneur a quand même son mot à dire sur le hachage : il tourne sur son propre pool de threads,
dimensionné par le preset, compte comme travail de fond, et donc s'efface pendant qu'on active ou
installe des mods et attend la fin du mode application.

## Automatise-le

Le [Planificateur](doc-page:features/scheduler) peut *benchmarker un disque*, *appliquer une limite de vitesse*,
*vérifier l'espace libre* et basculer *Smart I/O* / *Auto-calibration* comme actions de workflow — et
brancher sur le résultat mesuré (ex. *si `disk.write_mbps` < 50, afficher un avertissement*). Il
peut aussi choisir un preset pour la durée d'une tâche, changer le mode application et suspendre la file :
voir [L'intensité de travail de BMM](doc-page:features/scheduler#lintensite-de-travail-de-bmm).
