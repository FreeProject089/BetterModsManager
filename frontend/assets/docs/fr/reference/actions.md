# Référence des actions


Toutes les actions que BMM peut exécuter pour toi, au même endroit. Il y a **deux catalogues** —
leurs capacités se recoupent mais ce sont deux systèmes distincts :

| | Où | Ce que ça pilote |
|---|---|---|
| **Actions de tâche planifiée** | [Planificateur](doc-page:../features/scheduler) — Réglages → Planificateur | Des étapes d'un workflow que BMM exécute sur un déclencheur |
| **Actions du générateur de scripts** | [Plugins & API](doc-page:../features/plugins) — générateur de scripts | Des blocs qui produisent un script exécutable (deeplinks `bmm://` et/ou appels HTTP) |

!!! tip "Lequel me faut-il ?"

    Prends le **planificateur** quand BMM doit le faire *tout seul* selon un horaire. Prends le
    **générateur de scripts** quand tu veux un script lançable depuis l'extérieur de BMM (un
    fichier batch, un autre outil, un lanceur de jeu).

---

## Partie 1 — Actions de tâche planifiée

Regroupées exactement comme dans la liste déroulante des actions.

### Mods & profils

| Action | Ce que ça fait | Ce que tu fournis |
|---|---|---|
| Activer un profil | Change le [profil](doc-page:../features/profiles) actif | profil |
| Activer un mod | Active un mod | mod |
| Désactiver un mod | Désactive un mod | mod |
| Activer un modpack | Active tous les mods d'un [modpack](doc-page:../features/modpacks) | modpack |
| Désactiver un modpack | Désactive tous les mods d'un modpack | modpack |
| Créer un modpack | Crée un modpack vide | nom, profil |
| Ajouter un mod (depuis URL) | Télécharge et installe un mod | URL, nom |
| Exporter une liste de mods (.mmlist) | Écrit une liste de mods | — |
| Importer une liste de mods (.mmlist) | Relit une liste de mods | — |
| Activer tous les mods | Active tout dans le profil | — |
| Désactiver tous les mods | Désactive tout dans le profil | — |
| Scanner le dossier mods | Re-scanne à la recherche de nouveaux mods | — |
| Appliquer un plugin | Applique la liste de mods d'un plugin | id du plugin |
| Comparer un plugin | Compare à la liste d'un plugin | id du plugin |
| Supprimer un plugin | Désinstalle un plugin | id du plugin |
| Vérifier les MàJ de mods | Cherche de nouvelles versions | — |
| Auto-importer les mods Open Mod Manager | Importe depuis une installation OMM | — |
| Vider l'historique d'activité du profil | Efface l'historique du profil | profil |
| Exporter un modpack (.bmp) | Écrit un fichier modpack | modpack, destination |

!!! warning "Les actions d'activation sautent le contrôle d'intégrité"

    *Activer un mod*, *Activer un modpack* et *Activer tous les mods* s'exécutent avec la
    vérification SHA contournée — une exécution planifiée ne peut pas s'arrêter pour te demander
    quoi faire d'un hash manquant. Active à la main si tu veux l'invite. Voir
    [Intégrité & hachage](doc-page:../how-it-works/integrity-hashing).

### Dépôt & partage

| Action | Ce que ça fait | Ce que tu fournis |
|---|---|---|
| Connecter un repo | Ajoute un [dépôt](doc-page:../features/repo) distant | URL repo.json, nom |
| Synchroniser un repo | Télécharge et intègre un profil distant | URL du repo, profil distant |
| Générer un repo | Ouvre la génération de dépôt | — |
| Mettre à jour un repo | Met à jour un dossier de dépôt | dossier du dépôt |
| Héberger un repo (HTTP) | **Sert un dossier en HTTP** | dossier, port |

### Apps & lancement

| Action | Ce que ça fait | Ce que tu fournis |
|---|---|---|
| Lancer une app | Démarre une app enregistrée | app (ou chemin de l'exe) |
| Ouvrir / lancer un fichier ou programme | **Exécute n'importe quel fichier**, y compris un `.exe` | chemin |
| Ouvrir un dossier | Ouvre un dossier dans l'explorateur | chemin |
| Installer une app | Télécharge et installe une app | id, URL, titre |
| Lancer un launch pack | Exécute un [Launch Pack](doc-page:../features/launch-packs) | launch pack |

### Apparence

| Action | Ce que ça fait | Ce que tu fournis |
|---|---|---|
| Appliquer un thème | Applique un [thème](doc-page:../features/themes) | thème |

### Benchmarks & stockage

| Action | Ce que ça fait | Capture |
|---|---|---|
| Lancer un benchmark | Lance le benchmark d'app (jeu de données, taille S/M/L/XL ou Mo personnalisés) | `benchmark.mbps`, `benchmark.total_ms` |
| Benchmarker un disque | Mesure la vitesse lecture/écriture d'un disque | `disk.read_mbps`, `disk.write_mbps`, `disk.suggested_limit` |
| Appliquer la limite de vitesse disque | Fixe un plafond Mo/s par disque — laisse vide pour reprendre la valeur suggérée par un benchmark précédent, `0` = illimité | — |
| Auto-calibration des performances | Active/désactive l'auto-calibration | — |
| Smart I/O | Active/désactive [Smart I/O](doc-page:../features/storage) | — |
| Activer/désactiver un réglage (avancé) | Bascule **n'importe quel** réglage booléen par sa clé | — |
| Vérifier l'espace disque libre | Lit l'espace libre | `disk.free_gb`, `disk.total_gb`, `disk.free_percent` |

Ces valeurs captées sont ce que compare la condition `value` — c'est ainsi qu'on construit
« *benchmarke le disque, et s'il est sous 50 Mo/s, préviens-moi* ».

### Confidentialité & enregistreur

| Action | Ce que ça fait |
|---|---|
| Consentement télémétrie | Active/désactive la [télémétrie](doc-page:../features/privacy-telemetry) |
| Options télémétrie | Replay / **Complet (démasqué)** / rapport de benchmark |
| Enregistreur de session | Enregistrement on/off, **Complet (démasqué)**, log Rust, log JS |
| Exporter le replay | Exporte l'enregistrement courant |
| Importer un replay | Charge un `.bmmreplay` depuis un chemin ou une URL |

!!! danger "« Complet » signifie démasqué"

    Normalement les replays masquent noms de mods, noms de profils et chemins en `••••`. Les
    interrupteurs *Complet* **désactivent** ce masquage. Ne le planifie pas sans savoir où
    partent les données.

### Système & flux

| Action | Ce que ça fait | Notes |
|---|---|---|
| Afficher une notification | Affiche un toast | |
| Discord Rich Presence | Active/désactive le RPC Discord | |
| Exporter les données (backup) | Écrit une sauvegarde — le modèle de nom accepte `{date}`, `{time}`, `{datetime}` | le mode de collision *overwrite* **remplace** une sauvegarde existante |
| Définir une valeur | Fixe une variable pour les conditions suivantes | |
| Vérifier les mises à jour de BMM | Cherche une nouvelle version | capture `update.available` |
| Vider le journal API | Vide le journal de l'API | |
| Vider les relevés du moniteur de ressources | Vide les relevés | |
| Lancer une autre tâche planifiée | Lance une autre tâche et attend | fixe `lasttask.ok` (1/0) — **une tâche qui s'appelle elle-même récurse** |
| Redémarrer BMM | Redémarre l'app | met fin à la tâche en cours |
| Ouvrir une URL / un lien | Ouvre un lien dans ton navigateur | |
| Lancer une commande personnalisée | **Exécute un programme arbitraire** | exige *Autoriser les commandes personnalisées* sur la tâche |
| Lancer un deeplink `bmm://` | Déclenche n'importe quel deeplink | peut atteindre n'importe quelle action de deeplink |

### Logique & maths

| Action | Ce que ça fait |
|---|---|
| Calculer dans une variable | Arithmétique (`+ - * / % ^`, parenthèses, variables, fonctions). Un vrai analyseur — **pas d'`eval`** |
| Ternaire | `var = condition ? a : b` |
| Table de règles | Parcourt les lignes, **la première qui correspond gagne**, écrit le résultat dans une variable |
| Arrêter la tâche (guard clause) | Termine la tâche **proprement** — ce n'est pas une erreur |

### Conditions

Utilisées par **SI**, **ATTENDRE** et **BOUCLE**. Chaque condition a une case **NON**.

| Condition | Vraie quand |
|---|---|
| `always` | Toujours — aucune barrière |
| `value` | Un nombre capté se compare (`>` `<` `>=` `<=` `==` `!=`) à ton seuil |
| `profileActive` | Un profil donné est l'actif |
| `modEnabled` / `modDisabled` | Un mod donné est on / off |
| `modpackActive` / `modpackInactive` | Tous les mods d'un modpack sont on / off |
| `allModsActive` | Tout est activé dans le profil actif |
| `appRunning` / `appNotRunning` | Un processus (par nom d'exe) tourne / ne tourne pas |
| `fileExists` | Un chemin existe |
| `fileHash` | Le hash d'un fichier (blake3/sha256) correspond |
| `fileSize` | La taille d'un fichier se compare |
| `fileType` | L'extension d'un fichier correspond |
| `fileName` | Un nom de fichier contient une sous-chaîne |
| `fileNewer` | Un fichier a été modifié dans les N dernières minutes |
| `online` | Il y a une connexion internet |
| `timeReached` | L'horloge a dépassé une heure |
| `dayOfWeek` | Aujourd'hui est un des jours choisis |
| `timeRange` | L'horloge est dans une plage (**passe minuit**) |
| `commandSucceeds` | Une commande externe sort en `0` — note que ça **exécute le programme** rien que pour évaluer la condition |

!!! note "Une donnée absente est fausse, pas une erreur"

    Si une condition `value` nomme une variable jamais captée, elle est simplement fausse — elle
    ne se déclenchera pas sur une donnée manquante.

**Variables captables :** `disk.read_mbps`, `disk.write_mbps`, `disk.suggested_limit`,
`benchmark.mbps`, `benchmark.total_ms`, `lasttask.ok` (dans la liste), plus `disk.free_gb`,
`disk.total_gb`, `disk.free_percent`, `update.available` et toute variable que tu définis.

---

## Partie 2 — Actions du générateur de scripts

Le générateur construit un script à partir de blocs et l'émet dans le langage cible. Chaque bloc
est soit un **deeplink** (`bmm://…`), soit un **appel HTTP** à l'API locale de BMM, soit une
opération **native** (une pause, une boucle, un affichage) qui n'a besoin d'aucune API.

!!! note "Deeplink ou HTTP ?"

    En mode deeplink, les actions qui ont une URL `bmm://` native en émettent une ; tout le reste
    retombe sur un appel HTTP — et un appel HTTP exige un jeton d'API. Ce qui n'a pas de deeplink
    dédié reste atteignable via le passe-plat générique
    `bmm://api?method=<M>&path=<chemin>&<champ>=<valeur>`.

### Mods

| Action | Émet |
|---|---|
| Activer un mod | `bmm://mod/enable?id=` · `POST /api/mods/enable` |
| Désactiver un mod | `bmm://mod/disable?id=` · `POST /api/mods/disable` |
| Changer de profil | `bmm://profile/activate?id=` · `POST /api/profiles/activate` |
| Activer un modpack | `bmm://modpack/enable?id=` · `POST /api/modpacks/enable` |
| Désactiver un modpack | `bmm://modpack/disable?id=` · `POST /api/modpacks/disable` |
| Appliquer un plugin | `bmm://plugin/activate?id=` · `POST /api/plugins/apply` |
| Comparer un plugin | `bmm://plugin/compare?id=` · `POST /api/plugins/compare` |
| Mettre à jour un modpack | `PUT /api/modpacks/{id}` |
| Supprimer un mod | `DELETE /api/mods/{id}` |
| Modifier un mod | `PUT /api/mods/{id}` — nom, version, auteur, description |
| Créer un profil | `POST /api/profiles` — nom, jeu, les trois dossiers |
| Modifier un profil | `PUT /api/profiles/{id}` |
| Supprimer un profil | `DELETE /api/profiles/{id}` |
| Créer un modpack | `POST /api/modpacks/create` |
| Supprimer un modpack | `DELETE /api/modpacks/{id}` |
| Lancer un benchmark | `bmm://benchmark/run?…` · `POST /api/benchmark` |
| Vérifier les MàJ de mods | `bmm://mod/check-updates` · `POST /api/mod/check-updates` |

### Dépôt

| Action | Émet |
|---|---|
| Synchroniser un repo | `POST /api/repo/sync` — URL, dossiers, limite de débit, **mot de passe de téléchargement**, écrasement, *supprimer les extras* |
| Annuler la synchro | `DELETE /api/repo/sync/cancel` |
| Générer un repo | `POST /api/repo/gen` — profil, sortie, auteur, port, mot de passe admin, zip, démarrage auto |
| Annuler la génération | `DELETE /api/repo/gen/cancel` |
| Démarrer le serveur HTTP | `POST /api/repo/host` — dossier, port, limite d'envoi |
| Arrêter le serveur HTTP | `DELETE /api/repo/host` |
| Mettre à jour un repo | `POST /api/repo/update` |
| Connecter un repo | `POST /api/repo/connect` |
| Retirer un repo | `DELETE /api/repo` |

!!! warning "« Supprimer les extras » efface des fichiers locaux"

    Sur *Synchroniser un repo*, cet interrupteur aligne exactement la copie locale sur le distant —
    tout ce que tu as en plus est supprimé.

### Apps

| Action | Émet |
|---|---|
| Installer une app | `POST /api/apps/install` — id, titre, URL, type de fichier |
| Lancer une app | `POST /api/apps/launch` |
| Lister les apps installées | `GET /api/apps` |
| Désinstaller une app | `DELETE /api/apps/{appId}` — déréférence, les fichiers restent sur le disque |

### Lecture (tout en `GET`, sans jeton, affiche du JSON)

`GET /api/status` · `/api/mods` · `/api/mods/active` · `/api/mods/all` · `/api/profiles` ·
`/api/plugins` · `/api/modpacks` · `/api/check-update` · `/api/creator-id` · `/api/health` ·
`/api/repo/list` · `/api/repo/info?url=&password=`

!!! warning "Infos repo met le mot de passe dans l'URL"

    *Infos repo* passe le mot de passe de téléchargement en paramètre d'URL. Ne colle pas la ligne
    générée dans un log partagé ou une conversation.

### Système

| Action | Émet |
|---|---|
| Attendre | pause native (secondes) |
| Fermer un processus | natif — **termine de force** un processus par son nom |
| Ouvrir une URL | ouverture native |
| Afficher un message | popup native, attend l'utilisateur |
| Lancer un jeu | natif — **exécute un exécutable arbitraire** |
| Journaliser un message | affichage natif |
| Redémarrer BMM | `POST /api/restart` |
| Lancer un launch pack | `bmm://launchpack/run?id=` · `POST /api/launchpack/run` |
| Discord Rich Presence | `bmm://discord/rpc?enabled=` · `POST /api/discord/rpc` |
| Exporter les données (sauvegarde) | `bmm://data/export-auto?…` · `POST /api/data/export-auto` |
| Consentement télémétrie | `bmm://telemetry/consent?enabled=` · `POST /api/telemetry/consent` |
| Options de télémétrie | `bmm://telemetry/set?…` · `POST /api/telemetry/settings` |
| Enregistreur de session | `bmm://recorder/set?…` · `POST /api/recorder` |
| Exporter le replay | `bmm://replay/export` · `POST /api/replay/export` |
| Importer un replay | `bmm://replay/import?…` · `POST /api/replay/import` |

### Contrôle de flux

| Action | Ce que ça fait |
|---|---|
| Lancer une tâche planifiée | `bmm://schedule/run?id=` · `POST /api/schedule/run` — passerelle vers le planificateur |
| Commentaire | Une ligne de commentaire ; n'exécute rien |
| Définir une variable | Affecte une variable |
| Si le fichier existe / est absent | Ouvre un bloc conditionnel |
| Si variable == / != | Ouvre un bloc conditionnel |
| Si appel API OK / échoué | **Exécute l'appel API lié**, puis branche sur son résultat |
| Sinon | L'autre branche |
| Fin de bloc | Ferme un `si` / `sinon` |
| Pause (attendre une touche) | Attend une frappe |
| Arrêter le script | Sort immédiatement |
| Code brut | Insère du code verbatim dans le script généré |
| Boucle (répéter N fois) / Fin de boucle | Une boucle comptée |
| Vérifier un fichier (hash → variable) | SHA-256 d'un fichier dans une variable |
| Attendre qu'un fichier existe | Sonde jusqu'à son apparition, ou expiration |
| Maths (calcul → variable) | Arithmétique dans une variable |
| Ternaire | Affectation conditionnelle |
| Guard clause (arrêter si…) | Sort quand une condition est vraie |

!!! note "Les deux catalogues sont séparés volontairement"

    Le planificateur a de **vraies étapes imbriquées** (des blocs SI / BOUCLE / ATTENDRE qui
    contiennent d'autres étapes). Le générateur, qui produit du texte plat, utilise à la place des
    **marqueurs de bloc** (`Si…` / `Sinon` / `Fin de bloc`). Certaines actions n'existent que d'un
    côté : le planificateur possède les actions de stockage, *Tout activer/désactiver*, *Scanner*,
    *Appliquer un thème* et les deeplinks bruts ; le générateur possède le CRUD complet et les
    endpoints de lecture, *Fermer un processus*, *Code brut* et le contrôle de flux textuel.

---

## Voir aussi

- [Planification & automatisation](doc-page:../features/scheduler) — déclencheurs, workflows, partage `.BMMPA`
- [Plugins & API](doc-page:../features/plugins) — la référence des deeplinks et endpoints, les jetons d'API
- [Référence API](doc-page:api) — les endpoints HTTP en détail
