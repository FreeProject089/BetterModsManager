# Launch packs


Un **launch pack** est un groupe nommé d'**applications** lancées ensemble en un clic — ton jeu
plus les outils compagnons que tu ouvres toujours avec (une appli vocale, un tracker, un outil
de head-tracking…).

## En créer un

Dans **Paramètres**, crée un pack, nomme-le, puis ajoute des exécutables (`.exe`, `.bat`,
`.ps1`, `.cmd`, `.lnk`) de deux façons :

- le **sélecteur de fichiers** classique, ou
- le **sélecteur d'applis** intégré, qui liste tes programmes installés façon Steam (il lit les
  entrées d'applications installées du registre Windows et tes raccourcis du menu Démarrer,
  icônes comprises).

Ajoute une icône personnalisée si tu veux — elle est convertie en vrai `.ico`.

## Le lancer

- **Depuis la carte** dans Paramètres — chaque appli démarre **silencieusement** : aucune
  fenêtre de console qui clignote.
- **Depuis le bureau** — chaque pack reçoit aussi son propre **raccourci** généré, pour lancer
  tout le groupe sans ouvrir BMM.

Sous le capot, créer un pack génère un minuscule `launcher.vbs` qui démarre chaque exécutable
de façon invisible, et un raccourci `.lnk` qui pointe dessus :

```mermaid
graph TD
    START((Déclencheur)) --> USER_SELECT["Lancer le pack (carte ou raccourci bureau)"]
    USER_SELECT --> FETCH_PACK["Lecture de la définition du pack"]
    FETCH_PACK --> ITER_APPS["Pour chaque exécutable"]
    ITER_APPS --> CHECK_PATH{Fichier présent ?}
    CHECK_PATH -- non --> LOG_ERR["Journal + notification d'erreur"]
    CHECK_PATH -- oui --> VBS_BRIDGE["Pont VBScript"]
    VBS_BRIDGE --> SILENT_LAUNCH["Lancement silencieux (aucune console)"]
```

!!! tip "Modifiable à tout moment"

    Modifier un pack régénère son lanceur et son raccourci sur place — le raccourci bureau
    continue de fonctionner. Supprimer un pack retire proprement son dossier et son raccourci.

## Lancer un pack depuis l'extérieur de BMM

Un pack n'est pas seulement un bouton dans les Réglages. Il est adressable, et c'est ce qui le rend
utile dans une installation plus large :

| Depuis | Comment |
|---|---|
| Un lien, un `.bat`, un site, une autre app | `bmm://launchpack/run?id=<id du pack>` |
| L'API HTTP locale | `POST /api/launchpack/run` avec `{"id": "…"}` |
| Le planificateur | l'action *Exécuter un launch pack* — un pack peut donc partir sur un déclencheur, pas seulement sur un clic |
| Le générateur de scripts | la même action, émise en deeplink ou en appel HTTP |

Voir la [Référence des actions](doc-page:reference/actions) et la [Référence API](doc-page:reference/api).

## Pourquoi rien ne clignote

Chaque processus lancé par BMM passe par un helper qui pose le drapeau `CREATE_NO_WINDOW` de Windows.
Sans lui, les programmes console (`cmd`, `powershell`, `python`, un `.bat`…) font apparaître une
fenêtre noire une fraction de seconde en build release — exactement le genre de clignotement qu'un
utilisateur apprend à ignorer. Rendre les légitimes silencieuses est ce qui rend une fenêtre
inattendue signifiante.

!!! note "Un nom de pack est assaini avant de devenir un chemin"

    Le nom que tu tapes devient un dossier et un raccourci sur le disque, il est donc confiné au
    dossier du pack — *« pour que le raccourci ne puisse jamais être écrit hors du dossier du pack
    (ex. le dossier Démarrage auto-exécuté → persistance) »*. Cette garde existe précisément parce
    qu'un raccourci planté dans le dossier Démarrage de Windows est un mécanisme de persistance, pas
    juste un fichier égaré. Voir [Sécurité](doc-page:how-it-works/security).
