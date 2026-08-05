# Stockage & E/S disque


> Limites de vitesse par disque, alertes d'espace, et comment BMM copie les fichiers sans figer ton PC.

Ouvre-le depuis **Réglages → Stockage → Ouvrir le Gestionnaire de Stockage**. Il répond à trois
questions : combien d'espace il reste, à quelle vitesse va chaque disque, et jusqu'où BMM a le droit
de solliciter tes disques.

<div class="bmm-replay"
     data-src="../assets/replays/bmm-demo.bmmreplay"
     data-title="Le Gestionnaire de Stockage (clip provisoire)"></div>

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
limite de vitesse par disque raisonnable, au démarrage et quand ça change. Laisse-la activée sauf si
tu veux régler les limites à la main.
:::

## Cartes par disque

Chaque disque du système a une carte :

| Élément | Ce qu'il t'indique |
|---|---|
| **Badge de type** | SSD / HDD / Inconnu, plus **Cloud** ou **Réseau** si détecté (Drive, OneDrive, Dropbox, MEGA, iCloud, NAS). |
| **Barre UTILISÉ** | Utilisé vs. total, colorée bleu → ambre (>70 %) → rouge (>90 %). |
| **Barre PROFILS** | Taille totale des mods de profils sur ce disque vs. espace libre — colorée selon tes seuils d'alerte. |
| **Pastilles de profil** | Quels [profils](doc-page:profiles) utilisent le disque, et comment (dossier jeu / dossier mods / sauvegarde). |

!!! note "Les badges Cloud/Réseau sont heuristiques"

    La détection se fait par nom de disque (un volume nommé « OneDrive », « google »…), donc un
    disque au nom bizarre peut être mal étiqueté. C'est un indice, pas une garantie.

## Ce que tu peux faire

=== "Limiter la vitesse d'un disque"

    Saisis une limite en **Mo/s** sur la carte du disque. `0` signifie **Illimité** (pas « bloqué »).
    Utile pour empêcher un HDD lent ou un disque cloud de ralentir toute la machine pendant une
    grosse copie. Enregistré après une courte pause.

=== "Benchmarker un disque"

    **Benchmarker ce disque** écrit et relit un fichier temporaire de 50 Mo et rapporte les Mo/s en
    lecture/écriture plus une limite suggérée (~70 % de la vitesse d'écriture). **Appliquer la
    suggestion** inscrit cette valeur comme limite.

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
exactement comme un mod décompressé. Voir [la Bibliothèque](doc-page:library) pour le flux des mods
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
[Intégrité & hachage](doc-page:../how-it-works/integrity-hashing).

## Automatise-le

Le [Planificateur](doc-page:scheduler) peut *benchmarker un disque*, *appliquer une limite de vitesse*,
*vérifier l'espace libre* et basculer *Smart I/O* / *Auto-calibration* comme actions de workflow — et
brancher sur le résultat mesuré (ex. *si `disk.write_mbps` < 50, afficher un avertissement*).
