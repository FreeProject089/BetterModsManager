# Stockage & E/S disque


> Limites de vitesse par disque, alertes d'espace, et comment BMM copie les fichiers sans figer ton PC.

Ouvre-le depuis **Réglages → Stockage → Ouvrir le Gestionnaire de Stockage**. Il répond à trois
questions : combien d'espace il reste, à quelle vitesse va chaque disque, et jusqu'où BMM a le droit
de solliciter tes disques.


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

## L'intensité de travail de BMM

La carte en haut du Gestionnaire de Stockage, c'est le
[gouverneur de ressources](doc-page:how-it-works/resources) : l'endroit unique qui décide combien
d'opérations lourdes tournent en même temps, sur combien de threads, et à quelle vitesse elles
peuvent écrire.

| Partie de la carte | Ce qu'elle fait |
|---|---|
| **Silencieux · Équilibré · Tout pour BMM** | Le preset. **Équilibré** est celui par défaut, et c'est exactement le fonctionnement de toujours. **Silencieux** fait une chose à la fois, doucement, pour quand tu joues. **Tout pour BMM** va aussi vite que les disques le permettent |
| **En vigueur** | Le preset réellement appliqué en ce moment, que le mode jeu ou une tâche planifiée peuvent changer un temps |
| **CPU de BMM · CPU du PC · Lecture · Écriture** | Des courbes en direct, une fois par seconde, seulement tant que la carte est à l'écran |
| **Mode jeu** | **Le détecter**, **Forcer**, **Arrêter**. Tant qu'il est actif, BMM travaille comme en Silencieux, et les empreintes et la maintenance de fond attendent qu'il se termine. La détection automatique n'est pas encore branchée dans cette version : utilise **Forcer** ([pourquoi](doc-page:how-it-works/resources#le-mode-jeu)) |
| **Ce que fait BMM** | Chaque opération en cours, suspendue ou en attente, avec **Suspendre**, **Reprendre** et **Annuler**, plus **Tout suspendre** et **Tout reprendre** |
| **Avancé : par disque et par opération** | Des règles pour un disque et une sorte de travail (Mo/s, en même temps, tampon, priorité). Une case vide hérite, et son texte gris dit la valeur en vigueur et d'où elle vient |

!!! warning "Lis sur quoi agit chaque colonne avancée"

    Les Mo/s et le tampon agissent sur les copies que BMM fait lui-même (déploiement, sauvegarde des
    originaux, installation du dossier d'un mod, copies d'images). Pour l'extraction, la
    compression, les analyses, les empreintes et les téléchargements, ils sont enregistrés mais ne
    ralentissent rien, et la colonne **Priorité** n'est pas encore transmise à Windows. Les détails
    sont sur [la page du gouverneur](doc-page:how-it-works/resources#sur-quoi-agit-chaque-colonne).

## Cartes par disque

Chaque disque du système a une carte :

| Élément | Ce qu'il t'indique |
|---|---|
| **Badge de type** | SSD / HDD / Inconnu, plus **Cloud** ou **Réseau** si détecté (Drive, OneDrive, Dropbox, MEGA, iCloud, NAS). |
| **Barre UTILISÉ** | Utilisé vs. total, colorée bleu → ambre (>70 %) → rouge (>90 %). |
| **Barre PROFILS** | Taille totale des mods de profils sur ce disque vs. espace libre — colorée selon tes seuils d'alerte. |
| **Pastilles de profil** | Quels [profils](doc-page:features/profiles) utilisent le disque, et comment (dossier jeu / dossier mods / sauvegarde). |

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
    pendant qu'on active ou installe des mods, et pendant le mode jeu.

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
installe des mods et attend la fin du mode jeu.

## Automatise-le

Le [Planificateur](doc-page:features/scheduler) peut *benchmarker un disque*, *appliquer une limite de vitesse*,
*vérifier l'espace libre* et basculer *Smart I/O* / *Auto-calibration* comme actions de workflow — et
brancher sur le résultat mesuré (ex. *si `disk.write_mbps` < 50, afficher un avertissement*). Il
peut aussi choisir un preset pour la durée d'une tâche, changer le mode jeu et suspendre la file :
voir [L'intensité de travail de BMM](doc-page:features/scheduler#lintensite-de-travail-de-bmm).
