# Installer BMM

BMM est une application **Windows**. L'installation tient en trois étapes :

1. Télécharge **`BMM-Setup.exe`** depuis la dernière version :
   [releases GitHub](https://github.com/FreeProject089/BetterModsManager/releases/latest) ·
   [BetterCommunity](https://bettercommunity.ch/p/bmm) — le même fichier, au choix.
2. Lance-le. Windows peut afficher un avertissement SmartScreen la première fois (il le fait pour tout
   nouvel éditeur) — choisis **Informations complémentaires → Exécuter quand même**.
3. Lance BMM.

Aucun compte à créer. L'installeur te pose quelques questions de configuration au passage, et BMM les
reprend au premier lancement : tu arrives donc dans une app déjà réglée plutôt que vide — voir
[Premier lancement](doc-page:getting-started/first-launch).

!!! tip "Choisis un emplacement d'installation que tu contrôles"

    Installe BMM quelque part qui t'appartient (ton dossier utilisateur, un disque de jeux), pas au
    fond de `Program Files` si tu préfères éviter les demandes de permission de Windows quand il se
    met à jour. BMM ne touche jamais à tes dossiers de jeu tant que *tu* n'actives pas un mod.

---

## Ce qu'il te faut

| | |
|---|---|
| **OS** | Windows 10 ou 11 |
| **WebView2** | Requis par BMM lui-même. Présent sur Windows 11 et sur un Windows 10 à jour. S'il manque, installe le [Evergreen Runtime](https://developer.microsoft.com/microsoft-edge/webview2/) — l'installeur ne l'embarque pas (sa propre fenêtre est native, elle n'a besoin de rien) |
| **Disque** | L'app elle-même est petite. Prévois pour tes **mods**, et souviens-toi que BMM déploie en **copiant** — un mod activé existe deux fois, une dans ton dossier mods et une dans le dossier du jeu |
| **Droits admin** | Seulement si tu installes dans un emplacement protégé |

BMM est une app native autour du webview de l'OS, pas un navigateur embarqué : le téléchargement et
l'empreinte mémoire sont donc une fraction de ceux d'un gestionnaire basé sur Electron. Voir
[Architecture](doc-page:how-it-works/architecture).

---

## L'installeur

`BMM-Setup.exe` est construit avec **[BetterInstaller](https://github.com/FreeProject089/BetterInstaller)**,
le moteur d'installation du projet. Il a remplacé les paquets NSIS et MSI que BMM publiait avant. Un seul fichier, aucun runtime à installer d'abord : la
fenêtre de l'installeur est native, pas une vue web.

Ce qu'il fait au-delà de copier des fichiers :

| | |
|---|---|
| **Vérifie la signature** | Le paquet porte une signature Ed25519 et l'installeur refuse d'installer celui qui ne correspond pas à sa clé publique embarquée — avant d'écrire quoi que ce soit |
| **Enregistre `bmm://`** | Pour que les deeplinks de BetterCommunity et de cette doc atteignent l'app |
| **Installe pour l'utilisateur** | Dans `%LOCALAPPDATA%\Programs\Better Mods Manager` par défaut — aucune demande d'admin. **Parcourir…** permet un autre dossier |
| **Sert aussi de mise à jour** | Relance-le sur un BMM installé et il devient un écran de maintenance : mettre à jour, réparer, désinstaller |

### Les morceaux optionnels

Trois composants, à cocher ou décocher au passage :

| Composant | Par défaut | Ce que c'est |
|---|---|---|
| **Better Mods Manager** | obligatoire | L'application elle-même |
| **Serveur IA MCP** | activé | Le sidecar qui permet à une IA de piloter BMM — voir la [référence MCP](doc-page:reference/mcp) |
| **Outils CLI** | désactivé | `bmm-cli.exe`, pour l'automatisation en ligne de commande |

En laisser un de côté n'est pas définitif : relance l'installeur et coche-le.

### Les questions qu'il pose

C'est la partie qu'on rate facilement. L'installeur demande ta **langue**, l'acceptation des
conditions, et quelques préférences — télémétrie, Discord Rich Presence, Smart I/O, effets sonores,
sauter ou non le tutoriel interactif. Il écrit tes réponses à côté des données de BMM, et **BMM les
lit une fois au premier lancement**.

Un réglage choisi dans l'installeur est donc déjà appliqué à la première ouverture. Tous se
retrouvent aussi dans les **Paramètres** ensuite : rien de ce que demande l'installeur n'est un choix
définitif.

---

## Où BMM range les choses

Bon à savoir avant de sauvegarder quoi que ce soit ou de changer de machine :

| Quoi | Où |
|---|---|
| L'app | là où tu l'as installée |
| `data.json` — profils, mods, réglages, tokens | `%APPDATA%\com.bettermm.desktop\` |
| Journaux de crash | `%APPDATA%\com.bettermm.desktop\Crashes\` |
| Journal d'activité de l'API | `%APPDATA%\com.bettermm.desktop\api-activity.log` |
| Replays de session, caches | sous le même dossier |
| Tes mods, jeux, sauvegardes | **là où pointent tes profils** — BMM ne les déplace jamais |

`data.json` garde un `.bak` tournant, et si le fichier principal devient illisible BMM récupère depuis
la sauvegarde plutôt que de réinitialiser ; un fichier corrompu est conservé sous
`data.corrupt-<horodatage>.json` au lieu d'être supprimé.

!!! note "Migration depuis 0.9.x — tes données se déplacent toutes seules"

    L'identifiant de bundle a changé (`com.bettermm.app` → `com.bettermm.desktop`) et Windows dérive
    le dossier de données applicatives de cet identifiant : une installation 1.0 fraîche irait donc
    chercher dans un dossier tout neuf et vide pendant que tes vraies données resteraient sous
    l'ancien nom. BMM les recopie **une fois, avant que quoi que ce soit lise `data.json`** — et il
    *copie* au lieu de déplacer, l'ancien dossier reste donc comme filet de sécurité. La migration est
    gardée : elle ne tourne que si le nouveau dossier n'a pas de données et que l'ancien en a
    clairement, et elle saute tout fichier déjà présent, donc une migration relancée ne peut jamais
    écraser quelque chose de plus récent.

---

## Désinstaller

Désinstaller retire l'application. Ça ne touche **pas** :

- tes mods, tes jeux ni tes sauvegardes — ils vivent dans tes propres dossiers,
- ce que BMM a déjà déployé dans un dossier de jeu.

Ce second point compte : parce que BMM déploie de vraies copies et non des liens, un mod activé au
moment de la désinstallation **reste activé** dans le jeu. Si tu veux un dossier de jeu propre,
désactive tes mods *avant* de désinstaller — BMM restaurera chaque fichier d'origine depuis
`_original/` au passage. Voir [Conflits](doc-page:how-it-works/conflicts).

Ton dossier `%APPDATA%` est aussi laissé en place, donc une réinstallation ultérieure reprend
exactement où tu t'étais arrêté. Supprime-le à la main si tu veux vraiment repartir de zéro — et
**exporte d'abord**, depuis Réglages → Données.

---

## Quelle version ?

**Stable**, sauf raison particulière. Dans **Réglages → Mises à jour** tu peux opter pour les
**pré-versions** : elles reçoivent les correctifs en premier et les bugs en premier. C'est un vrai
compromis, d'où l'interrupteur plutôt qu'un défaut. Si tu aimes être en avance et que signaler une
aspérité de temps en temps ne te dérange pas, active-le ; si tu veux juste que tes mods marchent,
laisse-le coupé.

---

## Mise à jour automatique

Activée par défaut. BMM vérifie, te le dit, et se met à jour. Tu peux la couper au même endroit — mais
alors mets à jour à la main, parce qu'un gestionnaire de mods avec un an de retard sur les dépôts
qu'il lit finira par ne plus être d'accord avec eux.

Une mise à jour est vérifiée avant de pouvoir toucher ton installation : le paquet **doit** porter une
signature Ed25519 valide pour la clé d'éditeur inscrite dans l'installeur, sinon il est refusé *avant*
que le dossier d'installation soit touché. L'installeur prend ensuite un instantané et rollback si
l'installation elle-même échoue. Voir [Sécurité](doc-page:how-it-works/security).

Où il regarde, dans l'ordre : le manifeste sur les
[releases GitHub](https://github.com/FreeProject089/BetterModsManager/releases/latest), puis le
miroir sur BetterCommunity. Il interroge toutes les sources joignables et retient la version la plus
récente annoncée, donc une source hors service ne bloque jamais une mise à jour. Quand la version
propose un delta, seules les parties modifiées sont téléchargées.

!!! note "Limité par GitHub ?"

    Les vérifications de mises à jour et de téléchargements passent par GitHub. Si tu vois des erreurs
    de limitation, ajoute un **token GitHub** optionnel dans **Réglages → Identité & API** — ça relève
    la limite. Il n'a besoin que du scope lecture, il est stocké localement, et il n'est jamais envoyé
    ailleurs qu'à GitHub. Purement optionnel ; la plupart des gens n'en ont jamais besoin.

---

## Ensuite

- [Premier lancement](doc-page:getting-started/first-launch) — créer ton premier profil et ajouter un mod.
- [Dépannage](doc-page:reference/troubleshooting) — si quelque chose cloche déjà.

## Où le récupérer

| | |
|---|---|
| **Versions** | [github.com/FreeProject089/BetterModsManager/releases](https://github.com/FreeProject089/BetterModsManager/releases) — toutes les versions, avec leur changelog |
| **BetterCommunity** | [bettercommunity.ch/p/bmm](https://bettercommunity.ch/p/bmm) — la page du projet : téléchargement, actualités, et la communauté autour |
| **Sources** | [le dépôt](https://github.com/FreeProject089/BetterModsManager) — GPL-3.0, voir [Crédits](doc-page:reference/credits) |
