# Performances


Modder, c'est déplacer beaucoup d'octets. Le rôle de BMM est de le faire vite **et** de garder ta
machine utilisable pendant ce temps — et quand ces deux objectifs s'opposent, **la réactivité
gagne**. Presque tous les chiffres de cette page sont un sacrifice délibéré de débit maximal pour
éviter une fenêtre figée.

---

## Les trois chemins de copie

Chaque copie de fichier prend exactement l'une des trois routes, choisie à chaque appel :

| Chemin | Quand | Comment |
|---|---|---|
| **Bridé** | une limite Mo/s par disque est réglée pour ce chemin | blocs de 128 Ko, pauses pour tenir le débit visé |
| **Smart I/O** | Smart I/O activé, aucune limite | blocs de 1 Mio, un court yield sur un **budget d'octets** |
| **Pleine vitesse** | Smart I/O désactivé, aucune limite | `std::fs::copy` nu — l'OS fait tout |

Les chiffres de Smart I/O ont été mesurés, pas devinés. Le code le dit :

> *« Blocs de 1 Mio (moins d'appels système read/write → plus proche de la copie pleine vitesse), et
> yield sur un budget d'octets de ~16 Mio plutôt qu'à chaque bloc. L'ancien 256 Ko + sleep par bloc
> coûtait ~37% par rapport à la pleine vitesse ; budgétiser le yield garde l'UI réactive tout en
> récupérant l'essentiel de ce débit. »*

!!! warning "BMM ne fait jamais de hard-link ni de lien symbolique"

    Certains gestionnaires déploient en liant les fichiers au lieu de les copier. BMM **non** — il n'y
    a aucun `hard_link` ni symlink dans le chemin de déploiement. Chaque fichier activé est une vraie
    copie dans ton dossier de jeu. Ça coûte de l'espace disque, et c'est ce qui fait qu'un dossier de
    jeu géré par BMM fonctionne avec n'importe quel outil qui ne comprend pas les liens, survit à un
    dossier mods sur un autre disque, et reste intact si BMM est désinstallé.

---

## Ne jamais saturer la machine

```mermaid
flowchart TB
    JOB["Tâche de déploiement / copie"] --> SYS{"cible sur le<br/>disque système ?"}
    SYS -- oui --> ONE["1 thread — forcé,<br/>quel que soit le réglage"]
    SYS -- non --> TWO["2 threads max<br/>(Smart I/O activé)"]
    ONE --> LIM{"un plafond Mo/s<br/>sur ce disque ?"}
    TWO --> LIM
    LIM -- oui --> THR["chemin bridé<br/>128 Ko + pause"]
    LIM -- non --> SM["chemin Smart I/O<br/>1 Mio + yield budgété"]
```

Le parallélisme est plafonné à **2 threads** — *« pour que les copies de fichiers ne saturent jamais
tous les cœurs CPU (ce qui est la cause du gel "Ne répond pas" de l'UI) »*. Et si le dossier du jeu
ou le dossier de sauvegarde vit sur le disque système, ça descend à **un seul thread, quel que soit
ton réglage** :

> *« Renvoie true si `path` vit sur le même disque que l'OS (typiquement C:). Sert à réduire les I/O
> parallèles à un seul thread pour que Windows lui-même reste réactif pendant les grosses copies de
> mods. »*

Il y a **trois pools de threads distincts**, chacun plafonné pour sa propre raison :

| Pool | Taille | Pourquoi |
|---|---|---|
| Rayon global | plafonné, piles de 512 Ko | *« Empêcher Rayon de monopoliser 100% du CPU et de faire ramer l'OS »* — le travail parallèle de BMM ne récurse jamais profondément, ce qui économise ~7 Mo de RSS engagé par thread |
| Hachage | ≤ 4 (environ la moitié des cœurs) | BLAKE3 est assez rapide pour manger tous les cœurs — voir [Intégrité & hachage](doc-page:how-it-works/integrity-hashing) |
| Smart I/O | 1–2 | le chemin de copie ci-dessus |

L'allocateur est aussi remplacé : **mimalloc** à la place du HeapAlloc par défaut de Windows, pour un
*« working set du processus 30 à 60% plus petit, plus beaucoup moins de fragmentation »* — BMM alloue
et libère énormément de petites chaînes (chemins, entrées de hash) en usage normal.

---

## Sortir le travail lourd de la fenêtre

```mermaid
flowchart LR
    UI["Fenêtre principale"] -- "spawn --mod-worker" --> W["Processus worker<br/>priorité I/O BACKGROUND"]
    W --> OS[("Jeu / mods / sauvegarde")]
    UI -- "annuler = taskkill /T" --> W
    W -. "sortie 0 / non nulle / 3 = annulé" .-> UI
```

Les grosses applications et désapplications ne tournent pas du tout dans l'app. Elles tournent dans un
**processus séparé** — le même exécutable réinvoqué en `--mod-worker IN OUT`, qui court-circuite
*« sans démarrer Tauri, WebView2, ni quoi que ce soit d'autre »*. Trois conséquences :

- Il se rétrograde lui-même en **priorité I/O BACKGROUND** Windows, donc *« le noyau garde de la
  bande passante disque pour le processus UI »*.
- Annuler = un `taskkill /T` du PID du worker — *« instantané et fiable, quel que soit le degré de
  blocage des I/O »* — au lieu d'attendre le retour d'un appel bloquant.
- Annuler un worker annulable lance aussi *« un sous-processus d'annulation en opération inverse pour
  que toute écriture partielle soit revertie »*. Un déploiement annulé ne laisse pas la moitié d'un
  mod dans ton dossier de jeu.

Dans l'app, chaque boucle de copie interroge un drapeau d'annulation *« pour que le clic d'annulation
de l'utilisateur puisse interrompre les grosses copies de mods presque instantanément au lieu
d'attendre la fin du fichier entier »*, et un verrou global signifie **une seule opération de mod à la
fois** — jamais deux applications en course sur le même dossier de jeu.

---

## Les verrous servent aux métadonnées, jamais aux I/O

La règle énoncée partout dans le code : collecter ce qu'il faut sous le verrou, puis le relâcher avant
toute opération lente.

> *« Relâcher tous les verrous AVANT de hacher pour qu'aucune autre commande ne bloque pendant qu'on
> lit le contenu des fichiers (c'est ce qui figeait l'UI sur les gros mods). »*

> *« On ne les hache PAS ici (ça tournerait sous 4 verrous tenus et pourrait figer l'UI sur un gros
> mod) ; on les enregistre et on hache APRÈS la libération des verrous. »*

Le motif a un nom dans le code — une structure snapshot : *« Instantané léger des champs d'un mod —
collectés en tenant le verrou, puis utilisés après l'avoir relâché, pour que les I/O fichier lourdes
ne bloquent jamais AppState. »*

---

## Ce qui était lent — et ce qui l'a corrigé

Chacun de ces points est une vraie régression trouvée puis corrigée, avec la cause consignée :

| Était lent | Cause | Correctif |
|---|---|---|
| Chaque rafraîchissement / import | L'UI appelait une commande de conflits **par mod** — *« des centaines d'aller-retours IPC + acquisitions de verrou à chaque rafraîchissement/import — la principale source de lag de l'UI »* | Un seul appel groupé |
| Démarrage avec des mods archivés | Un gros `.zip` était extrait **sous le verrou** | Les archives sont listées depuis leur index ; rien n'est extrait |
| Le scan | Le re-hachage était synchrone | Une file de fond bridée hache *« un mod à la fois, sur le pool de hash plafonné, avec une pause entre chacun »* |
| La journalisation | `log_line` recalculait son chemin à chaque appel — *« le chemin le plus chaud de l'app »* | Le chemin est mis en cache |
| Un disque débranché | Listait zéro fichier et remettait en file du travail inutile | *« Garder ce qu'on avait déjà et réessayer quand le disque revient — ne pas brasser l'état hors ligne »* |
| L'extraction `.zip` | DEFLATE est CPU-bound et c'était *« l'opération la plus lente du chemin chaud de l'app quand elle était sérielle »* | Parallèle sur tous les cœurs, un handle d'archive **par thread worker** (pas par entrée), le répertoire central est donc analysé ~une fois par cœur |

!!! note "Une optimisation a été rejetée, et la raison est dans le code"

    > *« zlib-ng (le backend SIMD 2-3x) a besoin de cmake pour compiler libz-ng-sys, qui ne sait pas
    > cibler la toolchain VS 2026 installée — il n'est donc volontairement PAS utilisé. »*

    Bon à savoir si tu te demandes un jour pourquoi l'extraction zip n'est pas encore plus rapide.

---

## Rien de gros ne passe par la mémoire

La même discipline s'applique aux octets qui arrivent du réseau ou partent vers une archive : ils sont
**streamés**, jamais bufferisés en entier. Ça n'a pas toujours été le cas, et les défaillances avaient
toutes la même forme — un pic mémoire égal à la taille du payload, sans plafond ni vérification :

| Chemin | Maintenant |
|---|---|
| Ajouter un mod depuis une URL | Streame vers un `.part`, renifle la signature zip depuis le fichier, extrait via un reader. Avant, il bufferisait le mod entier **et gardait ce tampon vivant** pendant l'extraction depuis un curseur dessus |
| Synchro de dépôt, mod archivé | Streame. Le chemin par fichier le faisait déjà ; le chemin archive — souvent la plus grosse chose qu'une synchro déplace — non |
| Installation depuis le catalogue d'apps | Hache au fil du streaming, puis renomme après le contrôle SHA-256 |
| Import de modpack | Streame vers le zip temporaire qu'il allait de toute façon écrire |
| Export zip | Copie chaque entrée via un reader au lieu de lire les fichiers entiers en mémoire |
| Enregistrement de session | Spoolé sur disque au fil de l'eau ; le `.bmmreplay` est assemblé en streaming (voir [Confidentialité & télémétrie](doc-page:features/privacy-telemetry)) |

La règle à retenir : si la destination est un fichier, écris dans le fichier. Un tampon intermédiaire
n'apporte rien et transforme une grosse entrée en plantage mémoire.

## Le régime de WebView2

Avant même que le webview démarre, les fonctionnalités dont BMM ne se sert pas sont coupées — *« Retire
~50-150 Mo de l'empreinte WebView2 : AudioServiceOutOfProcess… extensions / background pages…
Translate / sync / default apps… background-networking… renderer-process-limit=2 »*. La fenêtre
DevTools est fermable pour la même raison : c'est *« le processus msedgewebview2 "DevTools" d'environ
480 Mo »*, il ne te coûte donc que tant qu'il est ouvert.

---

## Mesure-le sur ton propre matériel

BMM embarque une vraie suite de benchmarks plutôt que de te demander de croire ces chiffres. Elle
mesure ce que BMM fait réellement — **scanner** un dossier, **hacher** du contenu (BLAKE3),
**copier / déployer**, et **extraire** une archive — plus une charge explicite *« Vérification
d'intégrité (BLAKE3) »* qui *« re-hache chaque fichier et le compare à la baseline stockée »*, c'est-à-dire
le contrôle qui détecte un mod altéré ou corrompu.

Les résultats restent locaux. Tu peux aussi lancer un benchmark depuis le
[planificateur](doc-page:features/scheduler) et brancher sur le résultat — mesure un disque, et s'il
revient sous 50 Mo/s, applique un plafond ou préviens-toi. Voir la
[Référence des actions](doc-page:reference/actions).

!!! info "À voir dans l'app"
    Aide & autres → Développeur → **Limiteur d'I/O disque**, **Moteur & threads**, **Hachage
    BLAKE3**, **Architecture légère**.
